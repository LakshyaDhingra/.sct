import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Project } from '../../shared/projects'
import type { SecretMetadata } from '../../shared/secrets'
import type { PairingPreview, SharingDevice, SharingState, TransferPreview } from '../../shared/sharing'
import type { RelayPeer, RelaySentItem, RelayState } from '../../shared/relay'
import { errorText, StatusLine, useOperation } from './operation'
import { Scramble, Transit } from './SharingMotion'
import type { Loaded, Run, SharingTab, UpdateSecrets } from './types'

interface SharingViewProps {
  projectId?: string
  tab?: SharingTab
  projects: Loaded<Project[]>
  secrets: Loaded<SecretMetadata[]>
  updateSecrets: UpdateSecrets
}

export function SharingView({ projectId, tab, projects, secrets, updateSecrets }: SharingViewProps) {
  const [sharing, setSharing] = useState<Loaded<SharingState & { location: string }>>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const operation = useOperation()
  const activeTab = activeSharingTab(sharing, receipt !== null, tab)

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

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Sharing</h1>
          <p className="description">Send encrypted secrets by AirDrop or relay. Received values stay in the main process.</p>
        </div>
      </div>

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
          {activeTab !== 'receive' && sharing.value.incoming.length > 0 && <p className="sharing-waiting">
            <a href={sharingRoute('receive', projectId)}>
              {sharing.value.incoming.length === 1 ? 'A received transfer is waiting.' : `${sharing.value.incoming.length} received transfers are waiting.`}
            </a>
          </p>}
          <SharingTabs activeTab={activeTab} projectId={projectId} canShare={sharing.value.peers.length > 0} />
          {sharing.value.peers.length > 0 && <div hidden={activeTab !== 'secrets'}>
            <SendSecrets projectId={projectId} active={activeTab === 'secrets'} projects={projects} secrets={secrets}
              peers={sharing.value.peers} busy={operation.busy} run={operation.run} />
          </div>}
          <div hidden={activeTab !== 'receive'}>
            <ReceiveSecrets device={sharing.value.device} incoming={sharing.value.incoming} canImport={sharing.value.peers.length > 0}
              receipt={receipt} projects={projects} location={sharing.value.location} busy={operation.busy} run={operation.run}
              updateSecrets={updateSecrets} setReceipt={setReceipt}
              update={(incoming) => setSharing((current) => current.state === 'ready' ? {
                state: 'ready', value: { ...current.value, incoming: incoming(current.value.incoming) }
              } : current)} />
          </div>
          <div hidden={activeTab !== 'devices'}>
            <DeviceVerification projectId={projectId} device={sharing.value.device} peers={sharing.value.peers}
              busy={operation.busy} run={operation.run}
              onVerified={(device) => setSharing((current) => current.state === 'ready' ? {
                state: 'ready', value: { ...current.value, peers: [...current.value.peers.filter((peer) => peer.id !== device.id), device] }
              } : current)} />
          </div>
          <div hidden={activeTab !== 'relay'}>
            <RelaySharing projectId={projectId} projects={projects} secrets={secrets}
              busy={operation.busy} run={operation.run} />
          </div>
        </>
      )}
    </>
  )
}

interface Receipt {
  id: string
  sender: string
  project: string
  names: string[]
}

// A waiting transfer or a new receipt opens the Receive tab unless the route names another tab.
function activeSharingTab(sharing: Loaded<SharingState>, received: boolean, tab?: SharingTab): SharingTab {
  if (tab === 'relay') return 'relay'
  if (tab === 'receive') return 'receive'
  if (sharing.state !== 'ready') return 'devices'
  if (!tab && (received || sharing.value.incoming.length > 0)) return 'receive'
  return sharing.value.peers.length > 0 ? tab ?? 'secrets' : 'devices'
}

function sharingRoute(tab: SharingTab, projectId?: string): string {
  return `#/sharing/${tab}${projectId ? `/${encodeURIComponent(projectId)}` : ''}`
}

function SharingTabs({ activeTab, projectId, canShare }: { activeTab: SharingTab; projectId?: string; canShare: boolean }) {
  const navigation = useRef<HTMLElement>(null)

  useEffect(() => {
    const showActiveTab = () => {
      const tabs = navigation.current
      const active = tabs?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!tabs || !active) return
      if (active.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = active.offsetLeft
      else if (active.offsetLeft + active.offsetWidth > tabs.scrollLeft + tabs.clientWidth) {
        tabs.scrollLeft = active.offsetLeft + active.offsetWidth - tabs.clientWidth
      }
    }
    showActiveTab()
    const observer = new ResizeObserver(showActiveTab)
    if (navigation.current) observer.observe(navigation.current)
    return () => observer.disconnect()
  }, [activeTab])

  return (
    <>
      <nav ref={navigation} className="sharing-tabs" aria-label="Sharing">
        <a href={sharingRoute('devices', projectId)} aria-current={activeTab === 'devices' ? 'page' : undefined}>Verify devices</a>
        {canShare ? (
          <a href={sharingRoute('secrets', projectId)} aria-current={activeTab === 'secrets' ? 'page' : undefined}>Send secrets</a>
        ) : <span aria-disabled="true" aria-describedby="sharing-verification-required">Send secrets</span>}
        <a href={sharingRoute('receive', projectId)} aria-current={activeTab === 'receive' ? 'page' : undefined}>Receive secrets</a>
        <a href={sharingRoute('relay', projectId)} aria-current={activeTab === 'relay' ? 'page' : undefined}>Relay</a>
      </nav>
      {!canShare && activeTab !== 'relay' && <p id="sharing-verification-required" className="field-help sharing-tab-help">
        Verify a device before you can send secrets.
      </p>}
    </>
  )
}

function RelaySharing({ projectId, projects, secrets, busy, run }: {
  projectId?: string
  projects: Loaded<Project[]>
  secrets: Loaded<SecretMetadata[]>
  busy: boolean
  run: Run
}) {
  const [relay, setRelay] = useState<Loaded<RelayState>>({ state: 'loading' })

  useEffect(() => {
    let active = true
    const refresh = () => {
      window.sct.getRelayState().then((value) => {
        if (active) setRelay({ state: 'ready', value })
      }).catch((cause: unknown) => {
        if (active) setRelay({ state: 'error', error: errorText(cause, 'Cannot read relay status.') })
      })
    }
    refresh()
    const unsubscribe = window.sct.onRelayChanged(refresh)
    return () => { active = false; unsubscribe() }
  }, [])

  if (relay.state === 'loading') return <p role="status">Loading relay…</p>
  if (relay.state === 'error') return <p className="error" role="alert">{relay.error}</p>
  return (
    <>
      <RelayConnection state={relay.value} />
      <RelayPairing state={relay.value} busy={busy} run={run} />
      <RelaySend projectId={projectId} projects={projects} secrets={secrets} state={relay.value} busy={busy} run={run} />
      <RelayActivity state={relay.value} />
    </>
  )
}

function RelayConnection({ state }: { state: RelayState }) {
  const live = state.connection === 'connected'
  return (
    <section className="relay-summary" aria-labelledby="relay-heading">
      <div>
        <h2 id="relay-heading">Relay sharing</h2>
        <p>{relayConnectionText(state)}</p>
      </div>
      <p className="relay-state" data-state={state.connection}>{live ? 'Live status' : 'Cached status'}</p>
      {state.identity && <div className="relay-identity">
        <span>This device’s relay ID</span>
        <code>{state.identity}</code>
      </div>}
      {!live && state.updatedAt && <p className="field-help">Last relay update: {formatTime(state.updatedAt)}.</p>}
      {state.error && <p className="error" role="alert">{state.error}</p>}
    </section>
  )
}

function relayConnectionText(state: RelayState): string {
  if (state.connection === 'connected') return state.registered
    ? 'This Mac is connected. Relay updates appear without a page reload.'
    : 'This Mac is connected but is not registered yet.'
  if (state.connection === 'connecting') return 'This Mac is connecting. Saved activity remains available.'
  if (state.connection === 'offline') return 'The relay is offline. Saved activity can be out of date.'
  return 'The relay is off. Set SCT_RELAY to connect this app.'
}

function RelayPairing({ state, busy, run }: { state: RelayState; busy: boolean; run: Run }) {
  const [identity, setIdentity] = useState('')
  const [compared, setCompared] = useState<Set<string>>(() => new Set())

  async function requestPair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run('Sending the relay pairing request…', async () => {
      await window.sct.requestRelayPair(identity)
      setIdentity('')
      return 'The relay pairing request was sent.'
    })
  }

  return (
    <section className="panel" aria-labelledby="relay-pair-heading">
      <h2 id="relay-pair-heading">Pair relay devices</h2>
      <p>Enter the relay ID from the other Mac. Compare the code on both screens before confirmation.</p>
      <form onSubmit={(event) => { void requestPair(event) }}>
        <fieldset disabled={busy || state.connection !== 'connected'}>
          <label htmlFor="relay-peer-identity">Other device’s relay ID</label>
          <input id="relay-peer-identity" name="relayPeerIdentity" autoComplete="off" spellCheck="false"
            value={identity} minLength={64} maxLength={64} pattern="[0-9a-f]{64}" required
            onChange={(event) => setIdentity(event.target.value.trim().toLowerCase())} />
          <div className="form-actions">
            <button type="submit" disabled={busy || identity.length !== 64}>Request pairing</button>
          </div>
        </fieldset>
      </form>
      {state.peers.length === 0 ? <p className="field-help">No relay devices are paired.</p> : (
        <ul className="relay-peers" aria-label="Relay devices">
          {state.peers.map((peer) => <li key={peer.pairId}>
            <div className="relay-peer-heading">
              <div><h3>{peer.name}</h3><p>{relayPeerState(peer)}</p></div>
              <button type="button" className="secondary" disabled={busy} onClick={() => {
                void run('Removing the relay pair…', async () => {
                  await window.sct.removeRelayPair(peer.pairId)
                  return `${peer.name} was removed from relay sharing.`
                })
              }}>Remove</button>
            </div>
            {peer.code && peer.trust !== 'verified' && <div className="relay-code">
              <p aria-label={`Pairing code for ${peer.name}`}>{peer.code}</p>
              <label className="check-field">
                <input type="checkbox" checked={compared.has(peer.pairId)} onChange={(event) => setCompared((current) => {
                  const next = new Set(current)
                  if (event.target.checked) next.add(peer.pairId)
                  else next.delete(peer.pairId)
                  return next
                })} />
                I compared this code on both Macs
              </label>
              <button type="button" disabled={busy || !compared.has(peer.pairId)} onClick={() => {
                void run('Saving the verified relay device…', async () => {
                  await window.sct.confirmRelayPair({ pairId: peer.pairId, code: peer.code ?? '' })
                  return `${peer.name} is verified for relay sharing.`
                })
              }}>Confirm relay device</button>
            </div>}
          </li>)}
        </ul>
      )}
    </section>
  )
}

function relayPeerState(peer: RelayPeer): string {
  if (peer.trust === 'changed') return 'Keys changed. Compare a new code before sharing.'
  if (peer.trust === 'invalid') return 'The device keys are invalid.'
  if (peer.trust === 'verified' && peer.status === 'Verified') return 'Verified recipient'
  return peer.requestedByMe ? 'Waiting for the other device' : 'Pairing request received'
}

function RelaySend({ projectId, projects, secrets, state, busy, run }: {
  projectId?: string
  projects: Loaded<Project[]>
  secrets: Loaded<SecretMetadata[]>
  state: RelayState
  busy: boolean
  run: Run
}) {
  const recipients = state.peers.filter((peer) => peer.status === 'Verified' && peer.trust === 'verified')
  const [source, setSource] = useState(projectId ?? '')
  const [recipient, setRecipient] = useState(recipients.length === 1 ? recipients[0]?.identity ?? '' : '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [deliverBy, setDeliverBy] = useState('')
  const [accessExpiresAt, setAccessExpiresAt] = useState('')
  const [injectionOnly, setInjectionOnly] = useState(true)

  async function queue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run('Encrypting and saving the relay transfer…', async () => {
      await window.sct.queueRelayTransfer({
        projectId: source,
        secretIds: [...selected],
        recipient,
        deliverBy: new Date(deliverBy).getTime(),
        accessExpiresAt: accessExpiresAt ? new Date(accessExpiresAt).getTime() : null,
        injectionOnly
      })
      setSelected(new Set())
      return 'The encrypted transfer is queued on this Mac.'
    })
  }

  return (
    <section className="panel" aria-labelledby="relay-send-heading">
      <h2 id="relay-send-heading">Queue a relay transfer</h2>
      {recipients.length === 0 && <p>Verify a relay device before you queue secrets.</p>}
      {projects.state === 'ready' && projects.value.length === 0 && <p><a href="#/">Add a project</a> to store and share secrets.</p>}
      {recipients.length > 0 && projects.state === 'ready' && projects.value.length > 0 && <form onSubmit={(event) => { void queue(event) }}>
        <fieldset disabled={busy}>
          <label htmlFor="relay-project">Source project</label>
          <select id="relay-project" value={source} required onChange={(event) => {
            setSource(event.target.value)
            setSelected(new Set())
          }}>
            <option value="">Choose a project</option>
            {projects.value.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <label htmlFor="relay-recipient">Verified relay recipient</label>
          <select id="relay-recipient" value={recipient} required onChange={(event) => setRecipient(event.target.value)}>
            <option value="">Choose a verified device</option>
            {recipients.map((peer) => <option key={peer.identity} value={peer.identity}>{peer.name}</option>)}
          </select>
          <SecretSelection secrets={secrets} source={source} selected={selected} onChange={setSelected} />
          <div className="relay-deadlines">
            <div>
              <label htmlFor="relay-deliver-by">Deliver before</label>
              <input id="relay-deliver-by" name="deliverBy" type="datetime-local" required value={deliverBy}
                onChange={(event) => setDeliverBy(event.target.value)} />
            </div>
            <div>
              <label htmlFor="relay-access-expires">Access expires (optional)</label>
              <input id="relay-access-expires" name="accessExpiresAt" type="datetime-local" value={accessExpiresAt}
                onChange={(event) => setAccessExpiresAt(event.target.value)} />
            </div>
          </div>
          <label className="check-field">
            <input type="checkbox" checked={injectionOnly} onChange={(event) => setInjectionOnly(event.target.checked)} />
            Allow command injection only. Block reveal, copy, and reshare.
          </label>
          <p className="field-help">Queued transfers stay encrypted on this Mac. Secret values never enter this screen.</p>
          <div className="form-actions">
            <button type="submit" disabled={busy || !source || !recipient || selected.size === 0 || !deliverBy}>Queue encrypted transfer</button>
          </div>
        </fieldset>
      </form>}
    </section>
  )
}

function RelayActivity({ state }: { state: RelayState }) {
  const cached = state.connection !== 'connected'
  return (
    <section className="relay-activity" aria-labelledby="relay-activity-heading">
      <div className="group-heading">
        <h2 id="relay-activity-heading">Delivery activity</h2>
        {cached && <span>Cached status</span>}
      </div>
      {state.sent.length === 0 && state.inbox.length === 0 ? (
        <div className="empty-state compact"><p>No relay delivery activity is saved on this Mac.</p></div>
      ) : <>
        {state.sent.length > 0 && <table>
          <caption>Sent transfers</caption>
          <thead><tr><th scope="col">Transfer</th><th scope="col">Recipient</th><th scope="col">Status</th><th scope="col">Deadline</th></tr></thead>
          <tbody>{state.sent.map((item) => <RelayActivityRow key={`${item.messageId}/${item.recipient}`} item={item} state={state} />)}</tbody>
        </table>}
        {state.inbox.length > 0 && <table>
          <caption>Received ciphertext</caption>
          <thead><tr><th scope="col">Transfer</th><th scope="col">Sender</th><th scope="col">Received</th></tr></thead>
          <tbody>{state.inbox.map((item) => <tr key={item.messageId}>
            <td><code>{shortId(item.messageId)}</code></td>
            <td>{peerName(state, item.sender)}</td>
            <td>{formatTime(item.createdAt)}</td>
          </tr>)}</tbody>
        </table>}
      </>}
    </section>
  )
}

function RelayActivityRow({ item, state }: { item: RelaySentItem; state: RelayState }) {
  return <tr>
    <td><code>{shortId(item.messageId)}</code></td>
    <td>{peerName(state, item.recipient)}</td>
    <td><span className="delivery-state" data-state={item.state}>{item.state}</span></td>
    <td>{item.deliverBy ? formatTime(item.deliverBy) : 'Not cached'}</td>
  </tr>
}

function peerName(state: RelayState, identity: string): string {
  return state.peers.find((peer) => peer.identity === identity)?.name ?? shortId(identity)
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString()
}

function SendSecrets({ projectId, active, projects, secrets, peers, busy, run }: {
  projectId?: string
  active: boolean
  projects: Loaded<Project[]>
  secrets: Loaded<SecretMetadata[]>
  peers: SharingDevice[]
  busy: boolean
  run: Run
}) {
  const source = projectId ?? ''
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [recipient, setRecipient] = useState(peers.length === 1 ? peers[0]?.id ?? '' : '')
  const [sending, setSending] = useState(false)
  const projectField = useRef<HTMLSelectElement>(null)
  const recipientField = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (!active) return
    if (projectId) recipientField.current?.focus()
    else projectField.current?.focus()
  }, [active, projectId])

  const recipientName = peers.find((peer) => peer.id === recipient)?.name ?? 'their Mac'

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    try {
      await run(`Encrypting the secrets. Choose ${recipientName} in the picker.`, async () => {
        await window.sct.shareSecrets({ projectId: source, secretIds: [...selected], recipientId: recipient })
        return `If you chose ${recipientName}, the encrypted secrets are on their way. Their app confirms import.`
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="send-heading">
      <h2 id="send-heading">Send secrets</h2>
      {projects.state === 'loading' && <p role="status">Loading projects…</p>}
      {projects.state === 'ready' && projects.value.length === 0 && <p><a href="#/">Add a project</a> to store and send secrets.</p>}
      {projects.state === 'ready' && projects.value.length > 0 && (
        <form onSubmit={(event) => { void send(event) }}>
          <fieldset disabled={busy}>
            <label htmlFor="sharing-project">Source project</label>
            <select ref={projectField} id="sharing-project" value={source} required onChange={(event) => {
              window.location.hash = sharingRoute('secrets', event.target.value)
            }}>
              <option value="">Choose a project</option>
              {projects.value.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <label htmlFor="sharing-recipient">Verified recipient</label>
            <select ref={recipientField} id="sharing-recipient" value={recipient} required onChange={(event) => setRecipient(event.target.value)}>
              <option value="">Choose a verified device</option>
              {peers.map((peer) => <option key={peer.id} value={peer.id}>{peer.name}</option>)}
            </select>
            <SecretSelection secrets={secrets} source={source} selected={selected} onChange={setSelected} />
            <p className="field-help">Choose the same Mac in the picker. Only that Mac can open the secrets and choose a destination project.</p>
            <div className="form-actions">
              <button type="submit" disabled={!source || !recipient || selected.size === 0}>
                {busy ? 'Please wait…' : 'Send to…'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {sending && secrets.state === 'ready' && <div className="sharing-motion">
        <ul className="sharing-names" aria-label="Secrets being encrypted">
          {secrets.value.filter((secret) => selected.has(secret.id)).map((secret) => (
            <li key={secret.id}><Scramble text={secret.name} mode="encrypt" /></li>
          ))}
        </ul>
        <Transit from="This Mac" to={recipientName} />
      </div>}
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

function DeviceVerification({ projectId, device, peers, busy, run, onVerified }: {
  projectId?: string
  device: SharingDevice
  peers: SharingDevice[]
  busy: boolean
  run: Run
  onVerified: (device: SharingDevice) => void
}) {
  const [pairing, setPairing] = useState<PairingPreview | null>(null)
  const [compared, setCompared] = useState(false)
  const [sendingCard, setSendingCard] = useState(false)
  const importButton = useRef<HTMLButtonElement>(null)
  const comparisonHeading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (pairing) comparisonHeading.current?.focus()
  }, [pairing])

  async function shareCard() {
    setSendingCard(true)
    try {
      await run('Choose their Mac in the picker.', async () => {
        await window.sct.shareDeviceCard()
        return 'If you chose their Mac, your public device card is on its way. Ask them to send their card back.'
      })
    } finally {
      setSendingCard(false)
    }
  }

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
      setCompared(false)
      return `${verified.name} is verified on this Mac.`
    })
  }

  return (
    <>
      {peers.length > 0 && <section className="sharing-verified" aria-labelledby="verified-heading">
        <div className="group-heading">
          <h2 id="verified-heading">Verified devices</h2>
          <a className="button-link" href={sharingRoute('secrets', projectId)}>Continue to Send secrets</a>
        </div>
        <ul className="sharing-peers" aria-label="Verified devices">
          {peers.map((peer) => <li key={peer.id}>
            <details className="sharing-details">
              <summary>{peer.name}</summary>
              <p className="sharing-fingerprint">{peer.fingerprint}</p>
            </details>
          </li>)}
        </ul>
      </section>}
      <section className="panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">{peers.length === 0 ? 'Verify your first device' : 'Verify another device'}</h2>
      <p>Set up both Macs once. Send your public device card, and ask them to send theirs back.</p>
      <ol className="sharing-setup">
        <li>
          <h3>Send your device card</h3>
          <p>Choose their Mac in the picker. Your card contains public keys only.</p>
          <button type="button" className={pairing || peers.length > 0 ? 'secondary' : undefined} disabled={busy}
            onClick={() => { void shareCard() }}>Send my card to…</button>
          {sendingCard && <Transit from="This Mac" to="Their Mac" />}
        </li>
        <li>
          <h3>Import their device card</h3>
          <p>They send you their card from .sct. macOS saves it in Downloads. Choose their .sct-device file.</p>
          <button ref={importButton} type="button" className="secondary" disabled={busy}
            onClick={() => { void addPeer() }}>Import .sct-device file…</button>
        </li>
      </ol>
      {pairing && (
        <div className="pairing-review" aria-labelledby="pairing-heading">
          <h3 ref={comparisonHeading} tabIndex={-1} id="pairing-heading">Compare codes with {pairing.device.name}</h3>
          <p className="pairing-code" aria-label="Pairing code">{pairing.code}</p>
          <p className="field-help">Have them import your card too. Both Macs must show this exact code before either person confirms.</p>
          <label className="check-field">
            <input type="checkbox" checked={compared} disabled={busy} onChange={(event) => setCompared(event.target.checked)} />
            I compared this code on both Macs
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => {
              setPairing(null)
              setCompared(false)
              importButton.current?.focus()
            }}>Cancel verification</button>
            <button type="button" disabled={busy || !compared} onClick={() => { void confirmPeer() }}>Confirm recipient</button>
          </div>
        </div>
      )}
      <details className="sharing-details">
        <summary>Their Mac is not in the picker?</summary>
        <p>On both Macs, turn on Wi-Fi and Bluetooth. In Finder, open AirDrop and allow discovery by Everyone.</p>
      </details>
      <details className="sharing-details">
        <summary>This Mac’s device details</summary>
        <p>{device.name}</p>
        <p className="path sharing-fingerprint">{device.fingerprint}</p>
      </details>
      </section>
    </>
  )
}

function ReceiveSecrets({ device, incoming, canImport, receipt, projects, location, busy, run, updateSecrets, setReceipt, update }: {
  device: SharingDevice
  incoming: TransferPreview[]
  canImport: boolean
  receipt: Receipt | null
  projects: Loaded<Project[]>
  location: string
  busy: boolean
  run: Run
  updateSecrets: UpdateSecrets
  setReceipt: (receipt: Receipt) => void
  update: (change: (incoming: TransferPreview[]) => TransferPreview[]) => void
}) {
  async function chooseFile() {
    await run('Reading the received file…', async () => {
      const transfer = await window.sct.pickTransfer()
      if (!transfer) return ''
      update((current) => [...current.filter((item) => item.id !== transfer.id), transfer])
      return 'Choose a project for these secrets.'
    })
  }

  return (
    <>
      {receipt && <section key={receipt.id} className="panel" aria-labelledby="receipt-heading">
        <h2 id="receipt-heading">Received from {receipt.sender}</h2>
        <Transit from={receipt.sender} to={receipt.project} arrived />
        <ul className="sharing-names" aria-label={`Secrets imported into ${receipt.project}`}>
          {receipt.names.map((name) => <li key={name}><Scramble text={name} mode="decrypt" /></li>)}
        </ul>
      </section>}
      {incoming.length > 0 && <section className="sharing-section" aria-labelledby="incoming-heading">
        <h2 id="incoming-heading">Received transfers</h2>
        {incoming.map((transfer) => (
          <IncomingTransfer key={transfer.id} transfer={transfer} projects={projects} location={location}
            busy={busy} run={run} updateSecrets={updateSecrets} setReceipt={setReceipt}
            remove={() => update((current) => current.filter((item) => item.id !== transfer.id))} />
        ))}
      </section>}
      <section className="panel" aria-labelledby="receive-heading">
        <h2 id="receive-heading">Receive secrets</h2>
        {!canImport && <p className="field-help">Verify the sender’s device before you import their secrets.</p>}
        <ol className="sharing-setup">
          <li>
            <h3>Ask them to send to this Mac</h3>
            <p>They choose {device.name} in the picker. Accept the file when macOS asks.</p>
          </li>
          <li>
            <h3>Open the received file</h3>
            <p>macOS saves it in Downloads. Its name ends in .sct-transfer.</p>
            <button type="button" className={incoming.length > 0 ? 'secondary' : undefined} disabled={busy}
              onClick={() => { void chooseFile() }}>Choose received file…</button>
          </li>
          <li>
            <h3>Choose a project</h3>
            <p>The secrets appear on this tab. Choose the local project that keeps them.</p>
          </li>
        </ol>
      </section>
    </>
  )
}

function IncomingTransfer({ transfer, projects, location, busy, run, updateSecrets, setReceipt, remove }: {
  transfer: TransferPreview
  projects: Loaded<Project[]>
  location: string
  busy: boolean
  run: Run
  updateSecrets: UpdateSecrets
  setReceipt: (receipt: Receipt) => void
  remove: () => void
}) {
  const [destination, setDestination] = useState('')
  const project = projects.state === 'ready' ? projects.value.find((item) => item.id === destination) : undefined

  async function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run('Importing the encrypted transfer…', async () => {
      const imported = await window.sct.importTransfer({ transferId: transfer.id, projectId: destination })
      updateSecrets((current) => [...current.filter((secret) => !imported.some((saved) => saved.id === secret.id)), ...imported])
      setReceipt({ id: transfer.id, sender: transfer.sender.name, project: project?.name ?? 'the selected project', names: imported.map((secret) => secret.name) })
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
