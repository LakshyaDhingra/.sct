import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { gsap } from 'gsap'
import type { Project } from '../../shared/projects'
import type { SecretMetadata } from '../../shared/secrets'
import type { PairingPreview, SharingDevice, SharingState, TransferPreview } from '../../shared/sharing'
import { errorText, StatusLine, useOperation } from './operation'
import type { Loaded, Run, UpdateSecrets } from './types'

interface SharingViewProps {
  projectId?: string
  projects: Loaded<Project[]>
  secrets: Loaded<SecretMetadata[]>
  updateSecrets: UpdateSecrets
}

export function SharingView({ projectId, projects, secrets, updateSecrets }: SharingViewProps) {
  const [sharing, setSharing] = useState<Loaded<SharingState & { location: string }>>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const operation = useOperation()

  useEffect(() => {
    let active = true
    const refresh = () => {
      Promise.all([window.sct.getSharingState(), window.sct.getVaultLocation()]).then(([value, location]) => {
        if (active) setSharing({ state: 'ready', value: { ...value, location } })
      }).catch((cause: unknown) => {
        if (active) setSharing({ state: 'error', error: errorText(cause, 'Cannot load sharing. Unlock Keychain and retry.') })
      })
    }
    refresh()
    const unsubscribe = window.sct.onSharingChanged(refresh)
    return () => { active = false; unsubscribe() }
  }, [attempt])

  async function openTransfer() {
    await operation.run('Reading the encrypted transfer…', async () => {
      const transfer = await window.sct.pickTransfer()
      if (!transfer) return ''
      setSharing((current) => current.state === 'ready' ? {
        state: 'ready', value: { ...current.value, incoming: [...current.value.incoming.filter((item) => item.id !== transfer.id), transfer] }
      } : current)
      return 'Choose a destination project below.'
    })
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Sharing</h1>
          <p className="description">Send encrypted secrets through AirDrop. Choose a local project when you receive them.</p>
        </div>
        <button type="button" className="secondary" disabled={operation.busy || sharing.state !== 'ready'}
          onClick={() => { void openTransfer() }}>Open transfer…</button>
      </div>

      <SharingActivity busy={operation.busy} />
      <StatusLine status={operation.status} />
      {sharing.state === 'loading' && <p role="status">Loading sharing…</p>}
      {sharing.state === 'error' && <p className="error" role="alert">{sharing.error}</p>}
      {sharing.state === 'error' && <button type="button" className="secondary" onClick={() => {
        setSharing({ state: 'loading' })
        setAttempt((current) => current + 1)
      }}>Retry sharing</button>}
      {projects.state === 'error' && <p className="error" role="alert">{projects.error}</p>}
      {secrets.state === 'error' && <p className="error" role="alert">{secrets.error}</p>}

      {sharing.state === 'ready' && (
        <>
          {sharing.value.incoming.length > 0 && (
            <section className="sharing-section" aria-labelledby="incoming-heading">
              <h2 id="incoming-heading">Received transfers</h2>
              {sharing.value.incoming.map((transfer) => (
                <IncomingTransfer key={transfer.id} transfer={transfer} projects={projects} location={sharing.value.location}
                  busy={operation.busy} run={operation.run} updateSecrets={updateSecrets}
                  remove={() => setSharing((current) => current.state === 'ready' ? {
                    state: 'ready', value: { ...current.value, incoming: current.value.incoming.filter((item) => item.id !== transfer.id) }
                  } : current)} />
              ))}
            </section>
          )}

          <SendSecrets projectId={projectId} projects={projects} secrets={secrets} peers={sharing.value.peers}
            busy={operation.busy} run={operation.run} />
          <DeviceVerification device={sharing.value.device} peers={sharing.value.peers} busy={operation.busy} run={operation.run}
            onVerified={(device) => setSharing((current) => current.state === 'ready' ? {
              state: 'ready', value: { ...current.value, peers: [...current.value.peers.filter((peer) => peer.id !== device.id), device] }
            } : current)} />
        </>
      )}
      <footer>AirDrop may save the encrypted package in Downloads first. Open it in .sct to choose its vault project.</footer>
    </>
  )
}

function SendSecrets({ projectId, projects, secrets, peers, busy, run }: {
  projectId?: string
  projects: Loaded<Project[]>
  secrets: Loaded<SecretMetadata[]>
  peers: SharingDevice[]
  busy: boolean
  run: Run
}) {
  const [source, setSource] = useState(projectId ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [recipient, setRecipient] = useState('')

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run('Encrypting the selected secrets…', async () => {
      await window.sct.shareSecrets({ projectId: source, secretIds: [...selected], recipientId: recipient })
      return 'Choose AirDrop in the macOS share menu. Receipt is confirmed on the recipient Mac.'
    })
  }

  return (
    <section className="panel" aria-labelledby="send-heading">
      <h2 id="send-heading">Send secrets</h2>
      {peers.length === 0 && <p>Verify a recipient below before you send secrets.</p>}
      {projects.state === 'loading' && <p role="status">Loading projects…</p>}
      {projects.state === 'ready' && projects.value.length === 0 && <p><a href="#/">Add a project</a> to store and send secrets.</p>}
      {projects.state === 'ready' && projects.value.length > 0 && (
        <form onSubmit={(event) => { void send(event) }}>
          <fieldset disabled={busy}>
            <label htmlFor="sharing-project">Source project</label>
            <select id="sharing-project" value={source} required onChange={(event) => { setSource(event.target.value); setSelected(new Set()) }}>
              <option value="">Choose a project</option>
              {projects.value.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <label htmlFor="sharing-recipient">Verified recipient</label>
            <select id="sharing-recipient" value={recipient} required onChange={(event) => setRecipient(event.target.value)}>
              <option value="">Choose a verified device</option>
              {peers.map((peer) => <option key={peer.id} value={peer.id}>{peer.name}</option>)}
            </select>
            <SecretSelection secrets={secrets} source={source} selected={selected} onChange={setSelected} />
            <p className="field-help">Only the verified recipient can decrypt this transfer. They choose the destination project.</p>
            <div className="form-actions">
              <button type="submit" disabled={!source || !recipient || selected.size === 0}>
                {busy ? 'Please wait…' : 'Send via AirDrop…'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}

function SecretSelection({ secrets, source, selected, onChange }: {
  secrets: Loaded<SecretMetadata[]>
  source: string
  selected: Set<string>
  onChange: (selected: Set<string>) => void
}) {
  if (secrets.state === 'loading') return <p role="status">Loading secrets…</p>
  if (secrets.state !== 'ready' || !source) return null
  const projectSecrets = secrets.value.filter((secret) => secret.projectId === source)
  if (projectSecrets.length === 0) return <p className="field-help">This project has no secrets to send.</p>

  return (
    <fieldset className="sharing-selection">
      <legend>Secrets to send</legend>
      <label className="check-field">
        <input type="checkbox" checked={projectSecrets.every((secret) => selected.has(secret.id))}
          onChange={(event) => onChange(event.target.checked ? new Set(projectSecrets.map((secret) => secret.id)) : new Set())} />
        Select all secrets
      </label>
      {projectSecrets.map((secret) => (
        <label className="check-field" key={secret.id}>
          <input type="checkbox" checked={selected.has(secret.id)} onChange={(event) => {
            onChange(event.target.checked ? new Set([...selected, secret.id]) : new Set([...selected].filter((id) => id !== secret.id)))
          }} />
          {secret.name}
        </label>
      ))}
    </fieldset>
  )
}

function DeviceVerification({ device, peers, busy, run, onVerified }: {
  device: SharingDevice
  peers: SharingDevice[]
  busy: boolean
  run: Run
  onVerified: (device: SharingDevice) => void
}) {
  const [pairing, setPairing] = useState<PairingPreview | null>(null)
  const [compared, setCompared] = useState(false)

  async function addPeer() {
    await run('Reading the device card…', async () => {
      setPairing(await window.sct.pickSharingPeer())
      setCompared(false)
      return ''
    })
  }

  async function confirmPeer() {
    if (!pairing) return
    await run('Saving the verified device…', async () => {
      const verified = await window.sct.confirmSharingPeer(pairing.token)
      onVerified(verified)
      setPairing(null)
      return `${verified.name} is verified on this Mac.`
    })
  }

  return (
    <section className="panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">Verify devices</h2>
      <p>Exchange device cards through AirDrop in both directions. Compare the pairing code on both Macs before you confirm.</p>
      <p className="field-help">This Mac: {device.name}</p>
      <p className="path sharing-fingerprint">{device.fingerprint}</p>
      <div className="form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => {
          void run('Opening the macOS share menu…', async () => {
            await window.sct.shareDeviceCard()
            return 'Choose AirDrop to share this Mac’s public device card. Private keys stay on this Mac.'
          })
        }}>Share device card…</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void addPeer() }}>Add recipient…</button>
      </div>
      {pairing && (
        <div className="pairing-review" aria-labelledby="pairing-heading">
          <h3 id="pairing-heading">Verify {pairing.device.name}</h3>
          <p className="pairing-code" aria-label="Pairing code">{pairing.code}</p>
          <p className="field-help">Both Macs must show this exact code. Do not confirm if the codes differ.</p>
          <label className="check-field">
            <input type="checkbox" checked={compared} disabled={busy} onChange={(event) => setCompared(event.target.checked)} />
            I compared this code on both Macs
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => { setPairing(null); setCompared(false) }}>Cancel verification</button>
            <button type="button" disabled={busy || !compared} onClick={() => { void confirmPeer() }}>Confirm device</button>
          </div>
        </div>
      )}
      {peers.length > 0 && (
        <ul className="sharing-peers" aria-label="Verified devices">
          {peers.map((peer) => <li key={peer.id}><span>{peer.name}</span><span className="sharing-fingerprint">{peer.fingerprint}</span></li>)}
        </ul>
      )}
    </section>
  )
}

function IncomingTransfer({ transfer, projects, location, busy, run, updateSecrets, remove }: {
  transfer: TransferPreview
  projects: Loaded<Project[]>
  location: string
  busy: boolean
  run: Run
  updateSecrets: UpdateSecrets
  remove: () => void
}) {
  const [destination, setDestination] = useState('')
  const project = projects.state === 'ready' ? projects.value.find((item) => item.id === destination) : undefined

  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run('Importing the encrypted transfer…', async () => {
      const imported = await window.sct.importTransfer({ transferId: transfer.id, projectId: destination })
      updateSecrets((current) => [...current.filter((secret) => !imported.some((saved) => saved.id === secret.id)), ...imported])
      remove()
      return `Imported ${imported.length} ${imported.length === 1 ? 'secret' : 'secrets'} into ${project?.name ?? 'the selected project'}.`
    })
  }

  return (
    <section className="panel" aria-labelledby={`transfer-${transfer.id}`}>
      <h3 id={`transfer-${transfer.id}`}>From {transfer.sender.name}</h3>
      <p className="field-help">Source project: {transfer.projectName}. Import before {new Date(transfer.expiresAt).toLocaleString()}.</p>
      <ul className="sharing-names" aria-label={`Received secrets from ${transfer.projectName}`}>
        {transfer.secretNames.map((name) => <li key={name}>{name}</li>)}
      </ul>
      {projects.state === 'ready' && projects.value.length === 0 && <p><a href="#/">Add a local project</a> before you import these secrets.</p>}
      <form onSubmit={(event) => { void receive(event) }}>
        <fieldset disabled={busy || projects.state !== 'ready'}>
          <label htmlFor={`destination-${transfer.id}`}>Destination project</label>
          <select id={`destination-${transfer.id}`} value={destination} required onChange={(event) => setDestination(event.target.value)}>
            <option value="">Choose a local project</option>
            {projects.state === 'ready' && projects.value.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {project && <p className="path sharing-destination">{location}/{project.name}/secrets.sct</p>}
          <p className="field-help">Existing secrets stay unchanged. If names conflict, choose another project or resolve the names before import.</p>
          <div className="form-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => {
              void run('Removing the pending transfer…', async () => {
                await window.sct.dismissTransfer(transfer.id)
                remove()
                return 'The pending transfer was removed.'
              })
            }}>Dismiss transfer</button>
            <button type="submit" disabled={!project || busy}>Import secrets</button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}

function SharingActivity({ busy }: { busy: boolean }) {
  const indicator = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!busy) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(indicator.current, { scaleX: 0.2, opacity: 0.5 }, {
        scaleX: 1, opacity: 1, duration: 0.8, ease: 'steps(4)', repeat: -1, yoyo: true
      })
    })
    return () => media.revert()
  }, [busy])

  return <div className="sharing-activity" aria-hidden="true" data-active={busy}><span ref={indicator} /></div>
}
