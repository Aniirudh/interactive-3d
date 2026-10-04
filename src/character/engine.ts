import type { CharacterAssets, ClipName } from './assets'
import type { GazeMap } from './gaze'

/**
 * He works (work_loop) until you bother him. How much he reacts depends on how much you bother him:
 *
 *   small cursor movement  → glance (glance_left/right, keeps typing)
 *   sustained movement     → noticing (look_up) → watching: head follows the cursor
 *   cursor parked on face  → leaning (lean_around: peeks past it, back to work)
 *   cursor shaken at him   → eyebrow ("can I help you?")
 *   clicks, escalating     → cheers → eyebrow → headphones on, ignores you, headphones off
 *   left alone             → settling → returning (back_to_work) → working
 *
 * Every reaction clip starts and ends on the working pose, so any of them can follow any other.
 * Reactions whose clip isn't available yet are skipped.
 */
export type CharacterState =
  | 'working'
  | 'glancing'
  | 'noticing'
  | 'watching'
  | 'settling'
  | 'returning'
  | 'cheers'
  | 'leaning'
  | 'eyebrow'
  | 'headphones'

export const STAGE_W = 1360
export const STAGE_H = 1040

const HEAD = { x: 600 / STAGE_W, y: 350 / STAGE_H } // head centre as a fraction of the stage
const CENTER = { x: 16, y: -22 } // tracked face offset when he looks straight into the camera
// how often the route toward the cursor is recomputed: every frame (it takes <1 ms). Planning
// less often let the head reach a stale target and wait for the next plan: stop-go stutter
const REPLAN_MS = 0
// head glide along the route, in head-offset px (the full left↔right range is ~275 px)
const GLIDE_MIN = 40 // px/s: floor, so the last few px don't crawl
const GLIDE_RATE = 12 // per second: speed = distance still to go × this (eases in and out)
const GLIDE_MAX = 420 // px/s: fastest head turn (~7 px a frame: quick, but no frames skipped in a blur)
const JOIN_BLEND_PX = 10 // a join between takes blends across at least this much travel
const STALL_MS = 20 // longest the head waits for a frame to decode before moving on
const SIP: [number, number] = [3.7, 8.2] // seconds of work_loop where he's mid-sip; he finishes first
// when he's already looking at you, skip the part of these clips where he's still looking down
const CHEERS_FROM_WATCHING = 1.5
const EYEBROW_FROM_WATCHING = 1.0
const CLIP_FADE_MS = 180

// ── how easily he's bothered ──
const MOVE_WINDOW = 500 // ms of recent movement considered
const JITTER_PX = 2
const MAX_STEP_PX = 40
const GLANCE_TRAVEL = 45 // px within the window → a glance
const GLANCE_COOLDOWN = 3500
const NOTICE_TRAVEL = 150 // px within the window, spread over ≥ NOTICE_SPAN ms → he looks up
const NOTICE_SPAN = 140
const ANNOY_PER_PX = 0.035 // annoyance meter: movement and clicks fill it, it drains over time
const ANNOY_PER_CLICK = 20
const ANNOY_DRAIN = 7 // per second
const ANNOY_NOTICE = 22 // meter level that makes him look up even from small, repeated nudges
const FACE_RADIUS = 0.13 // × stage width: "cursor on his face"
const FACE_PARK_MS = 1100 // cursor parked on his face this long → he leans around it
const SHAKE_REVERSALS = 5 // direction changes within SHAKE_WINDOW → eyebrow
const SHAKE_WINDOW = 900
const CLICK_RESET_MS = 12000 // clicks further apart than this start the escalation over
const HEADPHONES_MS = 9000
const IDLE_MS = 3500 // cursor still for this long → back to work
const LEFT_MS = 1200 // cursor left the window → back to work sooner

type Layer = CanvasImageSource | 'gaze'
type Move = { t: number; d: number; vx: number }

const once = (el: EventTarget, ev: string) =>
  new Promise<void>((r) => el.addEventListener(ev, () => r(), { once: true }))
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const ease = (t: number) => t * t * (3 - 2 * t)

/** Pushes small offsets out a little so a nearby cursor still produces a visible turn. */
const shape = (n: number) => {
  const c = Math.max(-1, Math.min(1, n))
  return Math.sign(c) * Math.abs(c) ** 0.8
}

async function seek(v: HTMLVideoElement, t: number) {
  if (Math.abs(v.currentTime - t) < 0.02) return
  v.currentTime = t
  await Promise.race([once(v, 'seeked'), wait(500)])
}

/**
 * A clip leaving the screen: pause it and rewind it to the start in the background, so the
 * next time it's needed it plays instantly instead of first waiting on a seek (16–110 ms).
 */
function release(l: Layer | null) {
  if (!(l instanceof HTMLVideoElement)) return
  l.pause()
  if (l.currentTime > 0.02) l.currentTime = 0
}

export class CharacterEngine {
  private readonly ctx: CanvasRenderingContext2D
  private layer: Layer
  private prev: Layer | null = null
  private fadeStart = 0
  private state: CharacterState = 'working'
  private token = 0 // bumps on every state change so stale async transitions bail out
  private raf = 0
  private lastTick = 0

  // input
  private pointerAt: { x: number; y: number } | null = null
  private pointerOut = true
  private moves: Move[] = []
  private lastInput = 0
  private onFaceSince = 0
  private annoy = 0
  private clicks = 0
  private lastClick = 0
  private lastGlance = 0
  private queued: (() => void) | null = null // a working-state reaction waiting for the sip to finish

  // tracking: the head walks frame by frame along the gaze map toward `aim`
  private aim = { ...CENTER }
  private node = -1
  private path: number[] = []
  private goal = -1 // the frame being walked toward
  private lastPlan = 0
  private next = -1 // the neighbouring frame the head is gliding toward (-1 = resting on `node`)
  private frac = 0 // how far from `node` to `next` it is, 0…1
  private lastHead: ImageBitmap | null = null
  private stallSince = 0 // when the walk started waiting on a frame that isn't decoded yet

  // drawing only happens when something changed: a new video frame, a head step, a fade
  private dirty = true
  private rect: DOMRect

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: CharacterAssets,
    private readonly onState: (s: CharacterState) => void = () => {},
  ) {
    canvas.width = STAGE_W
    canvas.height = STAGE_H
    this.ctx = canvas.getContext('2d')!
    this.ctx.imageSmoothingQuality = 'high'
    this.layer = assets.poster
    this.rect = canvas.getBoundingClientRect()
    document.addEventListener('visibilitychange', this.onVisibility)
    addEventListener('resize', this.measure)
    addEventListener('scroll', this.measure, { passive: true })
  }

  /** The canvas's position on screen, re-measured on resize/scroll rather than per event. */
  private measure = () => {
    this.rect = this.canvas.getBoundingClientRect()
  }

  start() {
    const loop = this.assets.clips.work_loop
    if (loop) {
      loop.loop = true
      loop.play().catch(() => {})
      this.setLayer(loop)
    }
    this.raf = requestAnimationFrame(this.tick)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.token++
    document.removeEventListener('visibilitychange', this.onVisibility)
    removeEventListener('resize', this.measure)
    removeEventListener('scroll', this.measure)
    for (const v of Object.values(this.assets.clips)) v?.pause()
  }

  // ─── input ──────────────────────────────────────────────────────────────

  pointer(x: number, y: number, kind: 'move' | 'down' = 'move') {
    const now = performance.now()
    const from = this.pointerOut ? null : this.pointerAt
    this.pointerAt = { x, y }
    this.pointerOut = false
    if (kind === 'down') {
      if (this.state === 'working') this.whenNotSipping(() => this.enterNoticing())
      return
    }
    // entering the window isn't movement, and one event can only count so much: a real
    // movement arrives as many small steps, a cursor re-appearing elsewhere as one big jump
    const d = from ? Math.min(MAX_STEP_PX, Math.hypot(x - from.x, y - from.y)) : 0
    if (d < JITTER_PX) return

    this.moves.push({ t: now, d, vx: x - from!.x })
    while (this.moves.length && now - this.moves[0].t > SHAKE_WINDOW) this.moves.shift()
    this.annoy = Math.min(100, this.annoy + d * ANNOY_PER_PX)
    this.lastInput = now

    switch (this.state) {
      case 'working':
        this.botherWhileWorking(now, x)
        break
      case 'settling':
        this.setState('watching')
        break
      case 'watching':
        if (this.isShaking()) this.react('eyebrow', 'eyebrow')
        break
    }
  }

  /** The cursor left the window: stop tracking it and let him get back to work. */
  pointerLeave() {
    this.pointerOut = true
    this.moves = []
    this.onFaceSince = 0
    if (this.state === 'watching') this.lastInput = Math.min(this.lastInput, performance.now() - IDLE_MS + LEFT_MS)
  }

  /** Clicking him escalates: cheers → eyebrow → headphones. */
  click() {
    const now = performance.now()
    if (now - this.lastClick > CLICK_RESET_MS) this.clicks = 0
    this.lastClick = now
    this.annoy = Math.min(100, this.annoy + ANNOY_PER_CLICK)
    if (!this.interruptible()) return
    this.clicks++
    const { clips } = this.assets
    if (this.clicks >= 3 && clips.headphones_on && clips.headphones_loop && clips.headphones_off) {
      this.clicks = 0
      this.enterHeadphones()
    } else if (this.clicks === 2 && clips.eyebrow) {
      this.react('eyebrow', 'eyebrow')
    } else {
      this.enterCheers()
    }
  }

  private botherWhileWorking(now: number, x: number) {
    const recent = this.moves.filter((m) => now - m.t <= MOVE_WINDOW)
    const travel = recent.reduce((s, m) => s + m.d, 0)
    const span = recent.length ? now - recent[0].t : 0
    if ((travel >= NOTICE_TRAVEL && span >= NOTICE_SPAN) || this.annoy >= ANNOY_NOTICE) {
      this.whenNotSipping(() => this.enterNoticing())
      return
    }
    if (travel >= GLANCE_TRAVEL && now - this.lastGlance > GLANCE_COOLDOWN && !this.queued) {
      const r = this.rect
      const side = x < r.left + r.width * HEAD.x ? 'glance_left' : 'glance_right'
      if (this.assets.clips[side]) {
        this.lastGlance = now
        this.whenNotSipping(() => this.react(side, 'glancing'))
      }
    }
  }

  private isShaking() {
    let reversals = 0
    let dir = 0
    for (const m of this.moves) {
      if (Math.abs(m.vx) < 6) continue
      const s = Math.sign(m.vx)
      if (dir && s !== dir) reversals++
      dir = s
    }
    return reversals >= SHAKE_REVERSALS
  }

  private interruptible() {
    return this.state === 'working' || this.state === 'watching' || this.state === 'settling'
  }

  /** While working, reactions wait until he's finished any sip in progress. */
  private whenNotSipping(fn: () => void) {
    if (this.state !== 'working') return
    this.queued = fn
  }

  // ─── states ─────────────────────────────────────────────────────────────

  private async enterWorking() {
    const loop = this.assets.clips.work_loop
    if (!loop) return
    const token = ++this.token
    this.setState('working')
    this.moves = []
    this.queued = null
    loop.loop = true
    await seek(loop, 0)
    if (token !== this.token) return
    await loop.play().catch(() => {})
    if (token === this.token) this.setLayer(loop)
  }

  /**
   * Where to start a working → reaction clip: the lead-in frame whose head is closest to where
   * the work loop's head is right now, so the switch doesn't jolt the head into a new position.
   */
  private entryFor(name: ClipName) {
    const heads = this.assets.heads
    const lead = heads?.entries[name]
    const loop = this.assets.clips.work_loop
    if (!heads || !lead?.length || !loop) return 0
    const now = heads.work_loop[Math.min(heads.work_loop.length - 1, Math.floor(loop.currentTime * heads.fps))]
    if (!now) return 0
    let best = 0
    let bestD = Infinity
    lead.forEach(([dx, dy], i) => {
      const d = Math.hypot(dx - now[0], dy - now[1])
      if (d < bestD - 0.5) {
        bestD = d
        best = i
      }
    })
    return best / heads.fps
  }

  private enterNoticing() {
    this.transition('look_up', 'noticing', this.entryFor('look_up'), () => this.enterWatching())
  }

  private enterWatching() {
    this.token++
    this.setState('watching')
    this.lastInput = performance.now()
    this.onFaceSince = 0
    this.aim = { ...CENTER }
    this.node = -1
    this.path = []
    this.goal = -1
    this.next = -1
    this.frac = 0
  }

  private enterReturning() {
    this.transition('back_to_work', 'returning', 0, () => this.enterWorking())
  }

  private enterCheers() {
    const from = this.state === 'working' ? this.entryFor('cheers') : CHEERS_FROM_WATCHING
    this.queued = null
    this.transition('cheers', 'cheers', from, () => this.enterWatching())
  }

  /** A working → action → working clip. */
  private react(name: ClipName, state: CharacterState) {
    if (!this.assets.clips[name]) return
    const from =
      this.state === 'working' ? this.entryFor(name) : name === 'eyebrow' ? EYEBROW_FROM_WATCHING : 0
    this.queued = null
    this.transition(name, state, from, () => this.enterWorking())
  }

  private enterHeadphones() {
    this.queued = null
    const from = this.state === 'working' ? this.entryFor('headphones_on') : 0
    this.transition('headphones_on', 'headphones', from, async () => {
      const token = this.token
      const loop = this.assets.clips.headphones_loop!
      loop.loop = true
      await seek(loop, 0)
      if (token !== this.token) return
      await loop.play().catch(() => {})
      if (token !== this.token) return
      this.setLayer(loop)
      await wait(HEADPHONES_MS)
      if (token !== this.token) return
      this.annoy = 0
      this.transition('headphones_off', 'headphones', 0, () => this.enterWorking())
    })
  }

  /** Plays a one-shot clip from `from`, cross-fading into it, then calls `next` when it ends. */
  private async transition(name: ClipName, state: CharacterState, from: number, next: () => void) {
    const v = this.assets.clips[name]
    if (!v) return next()
    const token = ++this.token
    this.setState(state)
    v.loop = false
    v.onended = null
    v.pause()
    await seek(v, from)
    if (token !== this.token) return
    await v.play().catch(() => {})
    if (token !== this.token) return
    this.setLayer(v)
    v.onended = () => token === this.token && next()
  }

  private setState(s: CharacterState) {
    if (s === this.state) return
    this.state = s
    this.onState(s)
  }

  // ─── frame loop ─────────────────────────────────────────────────────────

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - (this.lastTick || now)) / 1000)
    this.lastTick = now
    this.annoy = Math.max(0, this.annoy - ANNOY_DRAIN * dt)

    if (this.state === 'working' && this.queued) {
      const t = this.assets.clips.work_loop?.currentTime ?? 0
      if (t < SIP[0] || t > SIP[1]) {
        const fn = this.queued
        this.queued = null
        fn()
      }
    }
    if (this.state === 'watching' || this.state === 'settling') this.track(now, dt)

    this.draw(now)
    this.raf = requestAnimationFrame(this.tick)
  }

  private track(now: number, dt: number) {
    if (this.state === 'watching') {
      if (now - this.lastInput > IDLE_MS) this.setState('settling')
      else if (this.checkFacePark(now)) return
    }
    const map = this.assets.gaze
    if (!map) return
    const settling = this.state === 'settling'
    const target = settling || !this.pointerAt || this.pointerOut ? CENTER : this.target(this.pointerAt)
    // the aim point glides, so the route doesn't twitch with every pixel of cursor noise
    const k = 1 - Math.exp(-dt * 20)
    this.aim.x += (target.x - this.aim.x) * k
    this.aim.y += (target.y - this.aim.y) * k

    if (this.node < 0) {
      const start = map.nearest(CENTER.x, CENTER.y) // look_up ends looking straight at you
      map.prefetch(map.around(start))
      if (!map.get(start)) return // hold the clip's last frame until the first head is decoded
      this.node = start
      this.setLayer('gaze')
    }
    if (now - this.lastPlan > REPLAN_MS) {
      this.lastPlan = now
      // plan from where the head is heading; if the new route turns straight back, reverse
      // along the current step instead of finishing it first
      const from = this.next >= 0 ? this.next : this.node
      const plan = map.plan(from, this.aim.x, this.aim.y, this.goal)
      this.goal = plan.goal
      if (this.next >= 0 && plan.path[0] === this.node) {
        ;[this.node, this.next] = [this.next, this.node]
        this.frac = 1 - this.frac
        this.path = plan.path.slice(1)
      } else {
        this.path = plan.path
      }
    }
    map.prefetch(map.around(this.node, 5))
    map.prefetch(this.path.slice(0, 28)) // requested last = decoded first

    // Glide a point along the route, in pixels, with eased speed: fast when far from the aim,
    // slowing smoothly as it arrives. Between two neighbouring frames the picture is a blend
    // weighted by how far along the point is, so the head moves every refresh, never in hops.
    const remaining = (this.next >= 0 ? (1 - this.frac) * this.edgeLen(this.node, this.next) : 0) +
      this.path.reduce((sum, n, i) => sum + this.edgeLen(i ? this.path[i - 1] : this.next >= 0 ? this.next : this.node, n), 0)
    let travel = Math.min(GLIDE_MAX, GLIDE_MIN + remaining * GLIDE_RATE) * dt
    if (remaining < 0.3) travel = 0
    while (travel > 0) {
      if (this.next < 0) {
        if (!this.path.length) break
        if (!map.get(this.path[0])) {
          // a frame that isn't decoded yet gets one refresh to arrive, then the head moves on
          this.stallSince ||= now
          if (now - this.stallSince < STALL_MS) break
        }
        this.stallSince = 0
        this.next = this.path.shift()!
        this.frac = 0
      }
      const len = this.edgeLen(this.node, this.next)
      const left = (1 - this.frac) * len
      if (travel >= left) {
        travel -= left
        this.node = this.next
        this.next = -1
        this.frac = 0
      } else {
        this.frac += travel / len
        travel = 0
      }
      this.dirty = true
    }

    if (settling && !this.path.length && this.next < 0) {
      const f = map.frames[this.node]
      if (Math.hypot(f.dx - CENTER.x, f.dy - CENTER.y) < 8) this.enterReturning()
    }
  }

  /** Length of a step in head-offset px; a join between takes is given room to blend across. */
  private edgeLen(a: number, b: number) {
    const map = this.assets.gaze!
    const fa = map.frames[a]
    const fb = map.frames[b]
    const d = Math.max(1.5, Math.hypot(fa.dx - fb.dx, fa.dy - fb.dy))
    return map.isJoin(a, b) ? Math.max(d, JOIN_BLEND_PX) : d
  }

  /** Cursor parked on his face → he leans around it to see his screen. */
  private checkFacePark(now: number) {
    if (!this.pointerAt || this.pointerOut || !this.assets.clips.lean_around) return false
    const r = this.rect
    const dist = Math.hypot(this.pointerAt.x - (r.left + r.width * HEAD.x), this.pointerAt.y - (r.top + r.height * HEAD.y))
    if (dist > r.width * FACE_RADIUS) {
      this.onFaceSince = 0
      return false
    }
    this.onFaceSince ||= now
    if (now - this.onFaceSince < FACE_PARK_MS) return false
    this.react('lean_around', 'leaning')
    return true
  }

  /** Where he should look for a cursor at p, in the gaze map's head-offset units. */
  private target(p: { x: number; y: number }) {
    const b = this.gazeBounds()
    const r = this.rect
    const nx = shape((p.x - (r.left + r.width * HEAD.x)) / (innerWidth * 0.4))
    const ny = shape((p.y - (r.top + r.height * HEAD.y)) / (innerHeight * 0.45))
    return {
      x: CENTER.x + nx * (nx > 0 ? b.maxX - CENTER.x : CENTER.x - b.minX),
      y: CENTER.y + ny * (ny > 0 ? b.maxY - CENTER.y : CENTER.y - b.minY),
    }
  }

  private boundsCache: GazeMap['bounds'] | null = null
  private gazeBounds() {
    return (this.boundsCache ??= this.assets.gaze!.bounds)
  }

  // ─── drawing ────────────────────────────────────────────────────────────

  private setLayer(l: Layer) {
    if (l === this.layer) return
    if (this.prev && this.prev !== l) release(this.prev)
    this.prev = this.layer
    this.layer = l
    this.fadeStart = performance.now()
    this.dirty = true
    if (l instanceof HTMLVideoElement) this.watchFrames(l)
  }

  /** Redraw exactly when the video presents a new frame (24 fps), not on every refresh (60+). */
  private watchFrames(v: HTMLVideoElement) {
    if (!('requestVideoFrameCallback' in v)) return
    const onFrame = () => {
      this.dirty = true
      if (this.layer === v || this.prev === v) v.requestVideoFrameCallback(onFrame)
    }
    v.requestVideoFrameCallback(onFrame)
  }

  /** Whether the current picture can change without being told (no frame callbacks available). */
  private get alwaysDirty() {
    const isVideo = (l: Layer | null) => l instanceof HTMLVideoElement
    return !('requestVideoFrameCallback' in HTMLVideoElement.prototype) && (isVideo(this.layer) || isVideo(this.prev))
  }

  private drawLayer(l: Layer) {
    const { ctx } = this
    if (l !== 'gaze') {
      ctx.drawImage(l, 0, 0, STAGE_W, STAGE_H)
      return
    }
    const map = this.assets.gaze!
    const [x, y, w, h] = map.head
    const alpha = ctx.globalAlpha
    ctx.drawImage(map.base, 0, 0, STAGE_W, STAGE_H)
    const head = map.get(this.node) ?? this.lastHead
    if (head) {
      ctx.drawImage(head, x, y, w, h)
      this.lastHead = head
    } else {
      this.dirty = true // the frame is still decoding: draw again next refresh
    }
    // mid-step between two neighbouring frames: blend in the next one by how far along it is
    const next = this.next >= 0 && this.frac > 0.01 ? map.get(this.next) : null
    if (next) {
      ctx.globalAlpha = alpha * this.frac
      ctx.drawImage(next, x, y, w, h)
    }
    ctx.globalAlpha = alpha
  }

  private draw(now: number) {
    const k = this.prev ? Math.min(1, (now - this.fadeStart) / CLIP_FADE_MS) : 1
    if (this.prev && k >= 1) {
      if (this.prev !== this.layer) release(this.prev)
      this.prev = null
      this.dirty = true
    }
    const fading = this.prev !== null
    if (!this.dirty && !fading && !this.alwaysDirty) return
    this.dirty = false
    this.ctx.globalAlpha = 1
    if (this.prev) {
      this.drawLayer(this.prev)
      this.ctx.globalAlpha = ease(k)
    }
    this.drawLayer(this.layer)
  }

  private onVisibility = () => {
    const v = this.layer
    if (!(v instanceof HTMLVideoElement)) return
    if (document.hidden) v.pause()
    else if (!v.ended) v.play().catch(() => {})
  }
}
