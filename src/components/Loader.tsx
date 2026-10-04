import { useEffect, useRef, useState, type Ref } from 'react'
import { content } from '../content'

const MIN_MS = 2600 // even on a fast connection, give the loader its moment
const STATUS: [number, string][] = [
  [0, 'Pouring the coffee'],
  [0.3, 'Opening the laptop'],
  [0.6, 'Pushing the last commit'],
  [0.9, 'Almost ready'],
]
const DIGITS = '0123456789'.split('')

// Live backdrop match: the loader video's background flickers a shade or two from frame to
// frame (AI video), so no fixed colour matches it. Instead the page gradient is re-sampled
// from the video's own side edges several times a second (see --b0…--b10 in styles.css).
const BACKDROP_STOPS = 11
const BACKDROP_MS = 120

function matchBackdrop(video: HTMLVideoElement, target: HTMLElement) {
  const c = document.createElement('canvas')
  c.width = 72
  c.height = 128
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return () => {}
  const smoothed: (number[] | null)[] = []
  const side = (x: number, y: number) => {
    const d = ctx.getImageData(x, y, 2, 3).data
    const rgb = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) rgb[k] += d[i + k] / (d.length / 4)
    return rgb
  }
  const lum = (c: number[]) => (c[0] + c[1] + c[2]) / 3
  const tick = () => {
    if (video.readyState < 2) return
    ctx.drawImage(video, 0, 0, c.width, c.height)
    const colors: (number[] | null)[] = []
    for (let s = 0; s < BACKDROP_STOPS; s++) {
      const y = Math.min(c.height - 3, Math.round((s / (BACKDROP_STOPS - 1)) * (c.height - 3)))
      const left = side(0, y)
      const right = side(c.width - 2, y)
      // props and shadows are darker than the backdrop: when the two edges disagree (the chair
      // or table reaching one side), trust the brighter one; when both are dark, skip the stop
      const [bright, dim] = lum(left) >= lum(right) ? [left, right] : [right, left]
      const pick = lum(bright) - lum(dim) <= 5 ? bright.map((v, k) => (v + dim[k]) / 2) : bright
      colors.push(lum(pick) > 236 ? pick : null)
    }
    // fill skipped stops from their nearest valid neighbours
    for (let s = 0; s < colors.length; s++) {
      if (colors[s]) continue
      const before = colors.slice(0, s).findLast(Boolean)
      const after = colors.slice(s + 1).find(Boolean)
      colors[s] = before && after ? before.map((v, k) => (v + after[k]) / 2) : (before ?? after ?? null)
    }
    colors.forEach((col, s) => {
      if (!col) return
      // ease toward the new sample so the page never visibly steps
      const prev = smoothed[s]
      const next = prev ? prev.map((v, k) => v + (col[k] - v) * 0.5) : col
      smoothed[s] = next
      target.style.setProperty(`--b${s}`, `rgb(${next.map(Math.round).join(' ')})`)
    })
  }
  const id = window.setInterval(tick, BACKDROP_MS)
  video.addEventListener('loadeddata', tick)
  return () => {
    clearInterval(id)
    video.removeEventListener('loadeddata', tick)
  }
}

function Digit({ d, dim }: { d: number; dim: boolean }) {
  return (
    <span className={dim ? 'digit is-dim' : 'digit'}>
      <span className="digit__strip" style={{ transform: `translateY(${-d * 10}%)` }}>
        {DIGITS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  )
}

interface Props {
  progress: number
  reduced: boolean
  onComplete: () => void
  ref: Ref<HTMLDivElement>
}

export function Loader({ progress, reduced, onComplete, ref }: Props) {
  const [shown, setShown] = useState(0)
  const latest = useRef({ progress, onComplete })
  latest.current = { progress, onComplete }
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    const loader = video?.closest<HTMLElement>('.loader')
    return video && loader ? matchBackdrop(video, loader) : undefined
  }, [])

  useEffect(() => {
    const start = performance.now()
    const minMs = reduced ? 500 : MIN_MS
    let last = start
    let disp = 0
    let raf = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      // the counter never runs ahead of real progress, nor of the minimum duration
      const target = Math.min(latest.current.progress, (now - start) / minMs)
      disp += (target - disp) * (1 - Math.exp(-dt * 4))
      if (target >= 1 && disp > 0.994) disp = 1
      setShown(disp)
      if (disp === 1) {
        window.setTimeout(() => latest.current.onComplete(), reduced ? 0 : 350)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const value = Math.round(shown * 100)
  const digits = String(value).padStart(3, '0').split('').map(Number)
  const lead = value < 10 ? 2 : value < 100 ? 1 : 0
  const status = STATUS.filter(([at]) => shown >= at).at(-1)![1]

  return (
    <div className="loader" ref={ref} aria-live="polite" aria-label={`Loading, ${value}%`}>
      <div className="loader__bar">
        <i style={{ transform: `scaleX(${shown})` }} />
      </div>
      <div className="loader__top mono">
        <span data-out>{content.mark}</span>
        <span data-out>Portfolio ©{new Date().getFullYear()}</span>
      </div>
      <div className="loader__film">
        {/* the same character from a second angle: full body, coffee in hand */}
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay={!reduced}
          loop
          poster="/media/loader-poster.webp"
          aria-hidden
        >
          <source src="/media/loader.webm" type='video/webm; codecs="vp9"' />
          <source src="/media/loader.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="loader__bottom">
        <p className="loader__status mono" data-out>
          <i className="pulse" />
          {status}
        </p>
        <p className="loader__count" data-out aria-hidden>
          {digits.map((d, i) => (
            <Digit key={i} d={d} dim={i < lead} />
          ))}
          <span className="loader__pct">%</span>
        </p>
      </div>
    </div>
  )
}
