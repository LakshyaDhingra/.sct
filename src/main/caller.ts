import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import type { AgentCaller } from '../shared/agent'

const run = promisify(execFile)

// Each entry maps an agent's executable name to its signing identifier and Apple Team ID.
const signedAgents = new Map([['claude', {
  name: 'Claude Code',
  requirement: 'identifier "com.anthropic.claude-code" and anchor apple generic and certificate leaf[subject.OU] = "Q6L2SF6YDW"'
}]])

// Walk up the parent processes to the first listed agent name and check its running code signature.
// MCP clients start `sct mcp` directly. Shell tools start `sct agent` through a shell, so the agent can be an ancestor.
// Return null when a process uses a listed agent name but fails that agent's signature check.
export async function identifyCaller(): Promise<AgentCaller | null> {
  let pid = process.ppid
  while (pid > 1) {
    const ancestor = await readProcess(pid)
    if (!ancestor) break
    const agent = signedAgents.get(basename(ancestor.executable))
    if (agent) return await satisfies(pid, agent.requirement) ? { name: agent.name, verified: true } : null
    pid = ancestor.parent
  }
  return { name: 'Unverified caller', verified: false }
}

async function readProcess(pid: number): Promise<{ parent: number; executable: string } | null> {
  try {
    const match = /^\s*(\d+)\s+(.+)$/.exec((await run('/bin/ps', ['-o', 'ppid=,comm=', '-p', String(pid)])).stdout.trim())
    return match ? { parent: Number(match[1]), executable: match[2] ?? '' } : null
  } catch {
    // The process exited before the check. Its identity is unknown.
    return null
  }
}

async function satisfies(pid: number, requirement: string): Promise<boolean> {
  try {
    await run('/usr/bin/codesign', ['--verify', `-R=${requirement}`, String(pid)])
    return true
  } catch {
    return false
  }
}
