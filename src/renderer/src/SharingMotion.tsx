import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { animate, createScope, createTimeline, createTimer, stagger, utils } from 'animejs'
import type { Timeline } from 'animejs'

const glyphs = '0123456789abcdef#$%&*+=<>/'
const reducedMotion = { reduce: '(prefers-reduced-motion: reduce)' }
// The modal closes this long after the last movement ends.
const holdAfterEnd = 1500

// prepare: the main process makes the file. wait: the object waits at the AirDrop picker.
// handed: the picker closed. macOS reports no delivery, so the object goes through the gate and never lands.
// arrived: .sct imported a received transfer, so the object lands in the project.
export type HandoffStage = 'prepare' | 'wait' | 'handed' | 'arrived'

// A mock Wallet card travels as a card. Secrets and public keys travel as a key.
export type HandoffObject =
  | { shape: 'card'; label: string; title: ReactNode; detail: ReactNode; back: string }
  | { shape: 'key'; title: ReactNode; detail: ReactNode }

// A square-cut key: a bow with a hole, a shaft, and three teeth. The even-odd rule cuts the hole.
const keyPath = 'M0 8H48V26H160V52H148V38H142V48H134V38H128V50H118V38H48V56H0ZM14 22H34V42H14Z'
// Copies of the outline at different depths give the flat key a visible thickness when it turns.
const keyLayers = [0, 1, 2, 3, 4]

// The last frame of each stage. Reduced motion shows it with no movement.
// --x runs from 0 (sender slot) to 1 (recipient slot). --rx and --ry are 3D rotations in degrees.
const still: Record<HandoffStage, Record<string, number>> = {
  prepare: { '--x': 0, '--y': 0, '--rx': 14, '--ry': 0, '--r': 0, '--s': 1, opacity: 1 },
  wait: { '--x': 0.5, '--y': -14, '--rx': 14, '--ry': 0, '--r': 0, '--s': 1, opacity: 1 },
  handed: { '--x': 0.56, '--y': -14, '--rx': 14, '--ry': 90, '--r': 0, '--s': 0.9, opacity: 0 },
  arrived: { '--x': 1, '--y': 0, '--rx': 0, '--ry': 0, '--r': 0, '--s': 1, opacity: 1 }
}

// A modal shows an object that travels from the sender to the recipient. It locks while work is in progress
// and closes by itself after the object passes the AirDrop gate or lands.
export function HandoffModal({ heading, from, to, stage, object, onDone }: {
  heading: string
  from: string
  to: string
  stage: HandoffStage
  object: HandoffObject
  onDone: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stageNode = useRef<HTMLDivElement>(null)
  const previous = useRef<HandoffStage | null>(null)
  const locked = stage === 'prepare' || stage === 'wait'

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  // A layout effect sets the first frame before paint, so the object never shows in a wrong position.
  useLayoutEffect(() => {
    let closing: ReturnType<typeof setTimeout> | undefined
    const close = () => { closing = setTimeout(() => dialog.current?.close(), holdAfterEnd) }
    const scope = createScope({ root: stageNode, mediaQueries: reducedMotion }).add((self) => {
      if (self?.matches.reduce) {
        utils.set('.handoff-object', still[stage])
        utils.set('.handoff-note', { opacity: stage === 'handed' || stage === 'arrived' ? 1 : 0 })
        utils.set('.handoff-slot-to', { opacity: stage === 'arrived' ? 1 : 0.4 })
        if (!locked) close()
        return
      }
      choreograph(stage, previous.current, close)
    })
    previous.current = stage
    return () => {
      clearTimeout(closing)
      scope.revert()
    }
  }, [stage, locked])

  return (
    <dialog ref={dialog} className="handoff-dialog" aria-labelledby="handoff-heading"
      onCancel={(event) => { if (locked) event.preventDefault() }} onClose={onDone}>
      <h2 id="handoff-heading">{heading}</h2>
      <p className="handoff-caption" role="status">{caption(stage, to)}</p>
      <div ref={stageNode} className="handoff" aria-hidden="true">
        <span className="handoff-slot handoff-slot-from" />
        <span className="handoff-slot handoff-slot-to" />
        <span className="handoff-track"><span className="handoff-flow" /></span>
        {stage !== 'arrived' && <span className="handoff-gate"><span className="handoff-gate-mark" /></span>}
        <div className={`handoff-object handoff-object-${object.shape}`}>
          {object.shape === 'card' ? <>
            <div className="handoff-face handoff-front">
              <span className="handoff-kind">{object.label}</span>
              <span className="handoff-chip" />
              <span className="handoff-number">•••• •••• •••• ••••</span>
              <span className="handoff-bottom">
                <span className="handoff-title">{object.title}</span>
                <span className="handoff-detail">{object.detail}</span>
              </span>
            </div>
            <div className="handoff-face handoff-back">
              <span className="handoff-stripe" />
              <span className="handoff-signature" />
              <span className="handoff-back-text">{object.back}</span>
            </div>
          </> : <>
            <span className="handoff-key">
              {keyLayers.map((layer) => <svg key={layer} className="handoff-key-layer" viewBox="0 0 160 64"><path d={keyPath} fillRule="evenodd" /></svg>)}
            </span>
            <span className="handoff-key-text">
              <span className="handoff-title">{object.title}</span>
              <span className="handoff-detail">{object.detail}</span>
            </span>
          </>}
        </div>
        <span className="handoff-label handoff-label-from">{from}</span>
        {stage !== 'arrived' && <span className="handoff-label handoff-label-gate">AirDrop</span>}
        <span className="handoff-label handoff-label-to">
          {to}
          <span className="handoff-note">{stage === 'arrived' ? 'Imported' : 'Sent if you chose it'}</span>
        </span>
      </div>
    </dialog>
  )
}

function caption(stage: HandoffStage, to: string): string {
  if (stage === 'prepare') return 'Preparing the file…'
  if (stage === 'wait') return `Choose ${to} in the AirDrop picker.`
  if (stage === 'handed') return `Sent if you chose ${to}. macOS does not confirm delivery.`
  return `Imported into ${to}.`
}

function choreograph(stage: HandoffStage, previous: HandoffStage | null, close: () => void): void {
  if (stage === 'prepare') {
    appear(createTimeline())
    // The object sways in 3D while the main process signs or encrypts the file.
    animate('.handoff-object', { '--ry': [-14, 14], '--y': [0, -5], duration: 1400, delay: 700, ease: 'inOutSine', loop: true, alternate: true })
    return
  }
  if (stage === 'wait') {
    const timeline = createTimeline()
    // The previous stage was reverted, so the object starts again from the last prepare frame.
    if (previous === 'prepare') utils.set('.handoff-object', still.prepare)
    else appear(timeline)
    travel(timeline, 0.5, 14)
    timeline.add('.handoff-gate-mark', { scaleY: [0, 1], duration: 360, ease: 'outExpo' }, '-=240')
    // The object hovers at the gate until the picker closes.
    const hover = animate('.handoff-object', { '--y': [-14, -20], '--ry': [-10, 10], duration: 1600, ease: 'inOutSine', loop: true, alternate: true, autoplay: false })
    timeline.call(() => { hover.play() })
    flow()
    return
  }
  if (stage === 'handed') {
    utils.set('.handoff-object', still.wait)
    utils.set('.handoff-gate-mark', { scaleY: 1 })
    // The object turns edge-on and goes through the gate.
    createTimeline({ onComplete: close })
      .add('.handoff-object', { '--ry': 90, '--x': still.handed['--x'], '--s': still.handed['--s'], duration: 620, ease: 'inQuad' })
      .add('.handoff-object', { opacity: 0, duration: 160, ease: 'linear' }, '-=160')
      .add('.handoff-gate-mark', { scaleY: [1, 0], duration: 420, ease: 'outQuad' }, '-=120')
      .add('.handoff-note', { opacity: [0, 1], translateY: [4, 0], duration: 400, ease: 'outQuad' }, '-=300')
    return
  }
  const timeline = createTimeline({ onComplete: close })
  appear(timeline)
  travel(timeline, 1, 0)
  timeline
    .add('.handoff-object', { '--y': 0, '--s': [1.04, 1], duration: 420, ease: 'outBack' })
    .add('.handoff-slot-to', { opacity: [0.4, 1], duration: 300, ease: 'outQuad' }, '-=320')
    .add('.handoff-note', { opacity: [0, 1], translateY: [4, 0], duration: 400, ease: 'outQuad' }, '-=200')
  flow()
}

// The object rises out of its slot and tilts toward the viewer.
function appear(timeline: Timeline): void {
  utils.set('.handoff-object', { '--x': 0, '--y': 18, '--rx': 64, '--ry': 0, '--r': 0, '--s': 0.9, opacity: 0 })
  timeline
    .add('.handoff-object', { '--y': 0, '--rx': 14, '--s': 1, opacity: 1, duration: 620, ease: 'outExpo' })
    .add('.handoff-front > *, .handoff-key-text > *', { opacity: [0, 1], translateY: [6, 0], duration: 360, ease: 'outQuad', delay: stagger(60) }, '-=480')
}

// The object lifts, flips one full turn on its vertical axis along an arc, and levels out at the target.
function travel(timeline: Timeline, to: number, tilt: number): void {
  timeline
    .add('.handoff-object', { '--y': -16, '--r': -3, duration: 260, ease: 'outQuad' })
    .add('.handoff-object', {
      '--x': to,
      '--y': [{ to: -46, ease: 'outQuad' }, { to: -14, ease: 'inQuad' }],
      '--ry': [0, 360],
      '--rx': [{ to: 28 }, { to: tilt }],
      '--r': [{ to: 2 }, { to: 0 }],
      duration: 1000 + to * 300,
      ease: 'inOutCubic'
    })
    // The flip ends at 360 degrees. Reset it to 0 so the next rotation starts from the front.
    .set('.handoff-object', { '--ry': 0 })
}

// Dashes move toward the recipient while the object is on its way.
function flow(): void {
  animate('.handoff-flow', { translateX: [-16, 0], duration: 600, ease: 'linear', loop: true })
}

// Names change to random glyphs while the app encrypts, and change back after the app decrypts.
// The glyphs are decoration only. They are not the ciphertext, and screen readers get the real name.
export function Scramble({ text, mode }: { text: string; mode: 'encrypt' | 'decrypt' }) {
  const node = useRef<HTMLSpanElement>(null)

  // A layout effect sets the first frame before paint, so the decrypt mode never shows the name too early.
  useLayoutEffect(() => {
    const element = node.current
    if (!element) return
    const scope = createScope({ mediaQueries: reducedMotion }).add((self) => {
      if (self?.matches.reduce) return
      const progress = { value: 0 }
      const draw = () => { element.textContent = scramble(text, progress.value, mode) }
      draw()
      // Encrypted names keep changing until the operation ends.
      const churn = createTimer({ duration: 150, loop: true, autoplay: false, onLoop: draw })
      animate(progress, { value: 1, duration: 900, ease: 'linear', onUpdate: draw, onComplete: () => { if (mode === 'encrypt') churn.play() } })
      return () => { element.textContent = text }
    })
    return () => scope.revert()
  }, [text, mode])

  return (
    <>
      <span className="sr-only">{text}</span>
      <span ref={node} className="sharing-scramble" aria-hidden="true">{text}</span>
    </>
  )
}

function scramble(text: string, progress: number, mode: 'encrypt' | 'decrypt'): string {
  const changed = Math.round(progress * text.length)
  return [...text].map((character, index) => {
    const hidden = mode === 'encrypt' ? index < changed : index >= changed
    return hidden ? glyphs.charAt(Math.floor(Math.random() * glyphs.length)) : character
  }).join('')
}
