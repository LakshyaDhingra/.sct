import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

const glyphs = '0123456789abcdef#$%&*+=<>/'

// A square steps along a dashed line from the sender to the recipient. CSS runs the motion.
export function Transit({ from, to, arrived = false }: { from: string; to: string; arrived?: boolean }) {
  return (
    <div className="sharing-transit" aria-hidden="true" data-arrived={arrived}>
      <span>{from}</span>
      <span className="sharing-transit-track"><span className="sharing-transit-lane"><span /></span></span>
      <span>{to}</span>
    </div>
  )
}

// Names change to random glyphs while the app encrypts, and change back after the app decrypts.
// The glyphs are decoration only. They are not the ciphertext, and screen readers get the real name.
export function Scramble({ text, mode }: { text: string; mode: 'encrypt' | 'decrypt' }) {
  const node = useRef<HTMLSpanElement>(null)

  // A layout effect sets the first frame before paint, so the decrypt mode never shows the name too early.
  useLayoutEffect(() => {
    const element = node.current
    if (!element) return
    const progress = { value: 0 }
    const draw = () => { element.textContent = scramble(text, progress.value, mode) }
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      draw()
      const timeline = gsap.timeline().to(progress, { value: 1, duration: 0.9, ease: `steps(${text.length})`, onUpdate: draw })
      // Encrypted names keep changing until the operation ends.
      if (mode === 'encrypt') timeline.to({}, { duration: 0.15, repeat: -1, onRepeat: draw })
      return () => { element.textContent = text }
    })
    return () => media.revert()
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
