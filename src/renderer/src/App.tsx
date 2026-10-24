import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Project } from '../../shared/projects'

export function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    window.sct.listProjects().then((saved) => {
      if (active) setProjects(saved)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Cannot load your projects.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (adding) nameInput.current?.focus()
    else addButton.current?.focus()
  }, [adding])

  async function browse() {
    setBusy(true)
    setError('')
    try {
      const selected = await window.sct.pickDirectory()
      if (selected) {
        setDirectory(selected)
        if (!name.trim()) setName(selected.split('/').filter(Boolean).at(-1) ?? 'Project')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cannot select a folder.')
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const project = await window.sct.addProject({ name, directory })
      setProjects((current) => [...current, project])
      setAdding(false)
      setName('')
      setDirectory('')
      setNotice(`${project.name} was added.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cannot save the project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-start"><span className="wordmark">.sct</span><span className="current-page">Projects</span></div>
        <span className="local-label">On this Mac</span>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>Projects</h1>
            <p className="description">Your folders. Right where you left them.</p>
          </div>
          <button ref={addButton} type="button" disabled={loading || adding} onClick={() => {
            setAdding(true)
            setNotice('')
            setError('')
          }}><span aria-hidden="true">+</span> Add a project</button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <p className="sr-only" role="status">{notice}</p>

        {adding && (
          <section className="project-form" aria-labelledby="add-heading">
            <h2 id="add-heading">Add a project</h2>
            <p>Choose an existing folder on your Mac. Your files stay where they are.</p>
            <form onSubmit={(event) => { void save(event) }}>
              <fieldset disabled={busy}>
                <label htmlFor="project-name">Project name</label>
                <input ref={nameInput} id="project-name" value={name} maxLength={100} required
                  placeholder="My project" onChange={(event) => setName(event.target.value)} />
                <label htmlFor="project-directory">Folder path</label>
                <div className="folder-field">
                  <input id="project-directory" value={directory} maxLength={4096} required
                    placeholder="/Users/you/projects/my-project" aria-describedby="folder-help"
                    onChange={(event) => setDirectory(event.target.value)} />
                  <button type="button" className="secondary" onClick={() => { void browse() }}>Choose folder…</button>
                </div>
                <p id="folder-help" className="field-help">Select a folder or enter its full path.</p>
                <div className="form-actions">
                  <button type="button" className="secondary" onClick={() => {
                    setAdding(false)
                    setName('')
                    setDirectory('')
                    setError('')
                  }}>Cancel</button>
                  <button type="submit" disabled={!name.trim() || !directory.trim()}>{busy ? 'Please wait…' : 'Add project'}</button>
                </div>
              </fieldset>
            </form>
          </section>
        )}

        {loading ? <p role="status">Loading projects…</p> : projects.length > 0 ? (
          <ul className="project-list" aria-label="Projects">
            {projects.map((project) => (
              <li key={project.id}>
                <div><h2>{project.name}</h2><p>{project.directory}</p></div>
                <span className="project-tag">Local folder</span>
              </li>
            ))}
          </ul>
        ) : !adding && !error && (
          <section className="empty-state" aria-labelledby="empty-heading">
            <h2 id="empty-heading">Your projects start here</h2>
            <p>Add an existing folder to get started.</p>
            <p className="empty-note">Your files stay on this Mac.</p>
          </section>
        )}
        <footer>Project names and folder paths are saved on this Mac.</footer>
      </main>
    </div>
  )
}
