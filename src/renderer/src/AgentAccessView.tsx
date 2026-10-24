import { useEffect, useState } from 'react'
import type { AgentRequestView } from '../../shared/agent'
import type { Loaded } from './types'
import { errorText, StatusLine, useOperation } from './operation'

export function AgentAccessView() {
  const [requests, setRequests] = useState<Loaded<AgentRequestView[]>>({ state: 'loading' })
  useEffect(() => {
    let active = true
    const refresh = () => {
      void window.sct.getAgentRequests().then((value) => {
        if (active) setRequests({ state: 'ready', value })
      }).catch((cause: unknown) => {
        if (active) setRequests({ state: 'error', error: errorText(cause, 'Cannot read local requests. Close this window to refuse pending requests.') })
      })
    }
    const stop = window.sct.onAgentChanged(refresh)
    refresh()
    return () => { active = false; stop() }
  }, [])

  return (
    <main>
      <div className="page-heading">
        <div><h1>Agent Access</h1><p>Approve only the operation and project you recognize.</p></div>
      </div>
      {requests.state === 'loading' && <p role="status">Loading local requests…</p>}
      {requests.state === 'error' && <p className="error" role="alert">{requests.error}</p>}
      {requests.state === 'ready' && requests.value.length === 0 && (
        <section className="empty-state compact"><h2>No pending requests</h2><p>You can close this window. The agent session remains available.</p></section>
      )}
      {requests.state === 'ready' && requests.value.map((request) => <Request key={request.id} request={request} />)}
    </main>
  )
}

function Request({ request }: { request: AgentRequestView }) {
  const [comparedCode, setComparedCode] = useState(false)
  const { status, busy, run } = useOperation()
  const respond = (approved: boolean) => {
    void run(approved ? 'Running the approved operation…' : 'Refusing the request…', async () => {
      await window.sct.respondToAgent({ id: request.id, approved, comparedCode })
      return approved ? 'The approved operation finished. The agent receives its result.' : 'The request was refused.'
    })
  }

  return (
    <section className="panel" aria-label={`Request ${request.operation}`}>
      <h2>{request.operation}</h2>
      <p>{request.detail}</p>
      {request.project && <><h3>{request.project.name}</h3><p className="path">{request.project.directory}</p></>}
      {request.secrets.length > 0 && <ul className="sharing-names" aria-label="Selected secrets">
        {request.secrets.map((secret) => <li key={secret.id}>{secret.name}</li>)}
      </ul>}
      {request.pairing && <div className="pairing-review">
        <h3>{request.pairing.name}</h3>
        <p className="sharing-fingerprint">{request.pairing.fingerprint}</p>
        <p className="pairing-code" aria-label="Pairing code">{request.pairing.code}</p>
        <label className="check-field"><input type="checkbox" checked={comparedCode} disabled={busy || request.status === 'running'}
          onChange={(event) => setComparedCode(event.target.checked)} />I compared this code on both Macs</label>
      </div>}
      <p>Deadline: <time dateTime={request.expiresAt}>{new Date(request.expiresAt).toLocaleTimeString()}</time></p>
      <p className="sharing-fingerprint">Request: {request.id}</p>
      <StatusLine status={status} />
      {request.error && <p className="error" role="alert">{request.error}</p>}
      {request.status === 'running' && <p role="status">Running the approved operation…</p>}
      {request.status === 'completed' && <p role="status">Completed. The agent received the result.</p>}
      {request.status === 'pending' && (
        <div className="form-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => respond(false)}>Refuse</button>
          <button type="button" disabled={busy || (Boolean(request.pairing) && !comparedCode)} onClick={() => respond(true)}>
            {request.operation === 'delete_secret' ? 'Approve deletion' : 'Approve once'}
          </button>
        </div>
      )}
    </section>
  )
}
