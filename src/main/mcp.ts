import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { version } from '../../package.json'

export async function runMcp(args: string[]): Promise<void> {
  if (args.length === 2 && args[1] === '--help') {
    console.log('Usage: sct mcp\nConnect an MCP client through stdin and stdout. Tools require issue #9.')
    return
  }
  if (args.length !== 1 || process.stdin.isTTY || process.stdout.isTTY) {
    throw new Error('Usage: sct mcp. The MCP transport requires private process pipes.')
  }
  const server = new McpServer({ name: '.sct', version })
  const closed = new Promise<void>((resolve) => { server.server.onclose = resolve })
  server.server.onerror = () => { console.error('The MCP input or transport is invalid.') }
  await server.connect(new StdioServerTransport())
  await closed
}
