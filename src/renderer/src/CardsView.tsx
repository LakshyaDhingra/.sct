import { useState } from 'react'
import type { FormEvent } from 'react'
import { cardNotice } from '../../shared/cards'
import { StatusLine, useOperation } from './operation'
import { Transit } from './SharingMotion'

export function CardsView() {
  const [cardholder, setCardholder] = useState('')
  const [label, setLabel] = useState('')
  const [sharing, setSharing] = useState(false)
  const operation = useOperation()

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let id = ''
    const created = await operation.run('Creating the signed pass with walletmcppass.com…', async () => {
      id = await window.sct.createMockCard({ cardholder, label })
      return 'The signed pass is ready.'
    })
    if (!created) return
    setSharing(true)
    try {
      await operation.run('Choose the iPhone in the picker.', async () => {
        await window.sct.shareMockCard(id)
        return 'If you chose the iPhone, the pass is on its way. The recipient taps Add in Wallet. .sct cannot confirm delivery or installation.'
      })
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Cards</h1>
          <p className="description">Create a mock Wallet card and send it to an iPhone.</p>
        </div>
      </div>

      <StatusLine status={operation.status} />
      <section className="panel" aria-labelledby="card-heading">
        <h2 id="card-heading">Create a mock card</h2>
        <p>Use fake details only. walletmcppass.com signs the pass. .sct sends it these fields, and no secrets or keys.</p>
        <form onSubmit={(event) => { void create(event) }}>
          <fieldset disabled={operation.busy}>
            <label htmlFor="card-holder">Cardholder name</label>
            <input id="card-holder" autoComplete="off" required maxLength={40} placeholder="Ada Example" value={cardholder}
              onChange={(event) => setCardholder(event.target.value)} />
            <label htmlFor="card-label">Card label</label>
            <input id="card-label" autoComplete="off" required maxLength={40} placeholder="Demo card" value={label}
              onChange={(event) => setLabel(event.target.value)} />
            <p className="card-notice">{cardNotice}</p>
            <p className="field-help">Every card shows this text. The recipient needs no .sct app. The service allows 30 free cards a day.</p>
            <div className="form-actions">
              <button type="submit" disabled={!cardholder.trim() || !label.trim()}>{operation.busy ? 'Please wait…' : 'Create and send to…'}</button>
            </div>
          </fieldset>
        </form>
        {sharing && <Transit from="This Mac" to="iPhone" />}
        <details className="sharing-details">
          <summary>The iPhone is not in the picker?</summary>
          <p>On the iPhone, open Control Center and set AirDrop to Everyone for 10 Minutes. Turn on Wi-Fi and Bluetooth on both devices.</p>
        </details>
      </section>
    </>
  )
}
