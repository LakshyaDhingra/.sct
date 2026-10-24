import { useEffect, useState } from 'react'
import { errorText, StatusLine, useOperation } from './operation'
import type { Loaded } from './types'

export function StorageView() {
  const [location, setLocation] = useState<Loaded<string>>({ state: 'loading' })
  const operation = useOperation()

  useEffect(() => {
    let active = true
    window.sct.getVaultLocation().then((value) => {
      if (active) setLocation({ state: 'ready', value })
    }).catch((cause: unknown) => {
      if (active) setLocation({ state: 'error', error: errorText(cause, 'Cannot read the storage location.') })
    })
    return () => { active = false }
  }, [])

  async function change() {
    await operation.run('Moving the vault…', async () => {
      const moved = await window.sct.chooseVaultLocation()
      if (!moved) return 'The storage location did not change.'
      setLocation({ state: 'ready', value: moved })
      return `The vault moved to ${moved}.`
    })
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Storage</h1>
          <p className="description">Where .sct keeps encrypted secrets on this Mac.</p>
        </div>
      </div>

      <StatusLine status={operation.status} />

      <section className="panel" aria-labelledby="location-heading">
        <h2 id="location-heading">Vault folder</h2>
        {location.state === 'loading' && <p role="status">Loading the storage location…</p>}
        {location.state === 'error' && <p className="error" role="alert">{location.error}</p>}
        {location.state === 'ready' && <p className="path">{location.value}</p>}
        <p className="field-help">Select a folder. .sct moves its .sct folder and all project secrets into it. Keychain keys do not move.</p>
        <div className="form-actions">
          <button type="button" disabled={location.state !== 'ready' || operation.busy} onClick={() => { void change() }}>
            {operation.busy ? 'Please wait…' : 'Change location…'}
          </button>
        </div>
      </section>
    </>
  )
}
