import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { Hero } from './components/Hero'
import { Loader } from './components/Loader'
import { CharacterEngine, type CharacterState } from './character/engine'
import { loadCharacter, loadDeferred, loadStill } from './character/assets'

type Phase = 'loading' | 'revealing' | 'ready'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const LOAD_CAP_MS = 12000 // never trap a visitor behind a slow network

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [progress, setProgress] = useState(0)
  const [charState, setCharState] = useState<CharacterState>('working')
  const [hintSeen, setHintSeen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<CharacterEngine | null>(null)

  // ─── load ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    const bump = (p: number) => !dead && setProgress((prev) => Math.max(prev, p))
    const cap = window.setTimeout(() => bump(1), LOAD_CAP_MS)

    if (reduced) {
      loadStill(bump).then(() => bump(1))
    } else {
      loadCharacter(bump, (assets) => {
        if (dead || !canvasRef.current) return
        engineRef.current = new CharacterEngine(canvasRef.current, assets, setCharState)
        engineRef.current.start()
        if (import.meta.env.DEV) Object.assign(window, { __character: engineRef.current })
      }).then((assets) => {
        bump(1)
        if (!dead) loadDeferred(assets)
      })
    }
    return () => {
      dead = true
      clearTimeout(cap)
      engineRef.current?.destroy()
    }
  }, [])

  // ─── reveal: at 100% the loader lifts away like a curtain; the hero, already
  //     running underneath, drifts up into place and its copy rises in ───────────
  const reveal = () => {
    setPhase('revealing')
    const done = () => {
      setPhase('ready')
      document.body.classList.remove('is-loading')
    }
    if (reduced) {
      gsap.to(loaderRef.current, { opacity: 0, duration: 0.4, onComplete: done })
      return
    }
    gsap
      .timeline({ onComplete: done })
      .to('.loader__bar', { opacity: 0, duration: 0.3 })
      .to(loaderRef.current, { yPercent: -100, duration: 1.15, ease: 'expo.inOut' }, 0.1)
      .to('.loader__film', { yPercent: -18, duration: 1.15, ease: 'expo.inOut' }, 0.1) // a touch of parallax
      .from('.hero', { y: () => innerHeight * 0.12, duration: 1.15, ease: 'expo.inOut' }, 0.1)
      .from('[data-reveal]', { yPercent: 100, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07 }, 0.7)
  }

  // ─── page light: centre the background's highlight on the character so the clip's
  //     own vignette continues seamlessly into the page ───────────────────────────
  useLayoutEffect(() => {
    const place = () => {
      const el = stageRef.current
      if (!el) return
      // layout box (ignores transforms); the hero sits at the top of the page
      const [x, y, w, h] = [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight]
      const s = document.body.style
      s.setProperty('--spot-x', `${x + w / 2}px`)
      s.setProperty('--spot-y', `${y + h * 0.3}px`)
      s.setProperty('--spot-rx', `${w * 0.9}px`)
      s.setProperty('--spot-ry', `${h * 1.1}px`)
    }
    place()
    addEventListener('resize', place)
    return () => removeEventListener('resize', place)
  }, [])

  // ─── input ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'loading' || reduced) return
    const onPointer = (e: PointerEvent) =>
      engineRef.current?.pointer(e.clientX, e.clientY, e.type === 'pointerdown' ? 'down' : 'move')
    const onLeave = () => engineRef.current?.pointerLeave()
    const root = document.documentElement
    addEventListener('pointermove', onPointer, { passive: true })
    addEventListener('pointerdown', onPointer, { passive: true })
    root.addEventListener('pointerleave', onLeave)
    addEventListener('blur', onLeave)
    return () => {
      removeEventListener('pointermove', onPointer)
      removeEventListener('pointerdown', onPointer)
      root.removeEventListener('pointerleave', onLeave)
      removeEventListener('blur', onLeave)
    }
  }, [phase === 'loading'])

  return (
    <div className="app" data-phase={phase}>
      <Hero
        charState={charState}
        reduced={reduced}
        hintSeen={hintSeen}
        stageRef={stageRef}
        canvasRef={canvasRef}
        onCharacterClick={() => {
          engineRef.current?.click()
          setHintSeen(true)
        }}
      />
      {phase !== 'ready' && (
        <Loader
          ref={loaderRef}
          progress={progress}
          reduced={reduced}
          onComplete={reveal}
        />
      )}
    </div>
  )
}
