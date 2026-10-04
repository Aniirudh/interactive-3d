export type Rect = [number, number, number, number]

export interface GazeFrame {
  dx: number // tracked face offset: + = toward frame right
  dy: number // + = down
  rest: boolean // false for blink frames: passed through, never stopped on
}

/** [a, b, cost, join]: join = the two frames come from different takes and cross-fade briefly. */
export type GazeEdge = [number, number, number, 0 | 1]

const CACHE_SIZE = 110 // decoded frames kept (~1.7 MB each); the rest stay as compressed blobs
const DECODES_AT_ONCE = 4 // a fast cursor sweep shouldn't start dozens of decodes in one go
const DETOUR_COST = 0.6 // px of aim a frame may give up per step saved getting there
// px: how much better a look on another take must be before the head leaves its current take.
// Within a take the target slides freely (that's what keeps motion continuous); only hopping
// between takes, which blends two renders, is held back.
const TAKE_STICKINESS = 12
// the current take only counts as following if it gets within this. Measured on simulated
// cursor paths, any finite limit traded a little responsiveness on tiny moves for many more
// take hops and direction reversals (the jitter), so it's off
const TAKE_FOLLOW_PX = Infinity

/**
 * A map of real head positions: chains of consecutive frames from continuous head movements,
 * joined wherever two takes pass through the same look. The head only ever steps between
 * neighbouring frames, which is what keeps movement in every direction smooth.
 */
export class GazeMap {
  /** Route tuning (a static object so it can be adjusted live while testing). */
  static tuning = { stickiness: TAKE_STICKINESS, followPx: TAKE_FOLLOW_PX }

  private readonly adj: { to: number; cost: number; join: boolean }[][]
  private readonly bitmaps = new Map<number, ImageBitmap>() // insertion order = LRU order
  private readonly pending = new Set<number>() // decoding right now
  private queue: number[] = [] // waiting to decode, most urgent first

  constructor(
    readonly base: ImageBitmap,
    readonly head: Rect,
    readonly frames: GazeFrame[],
    edges: GazeEdge[],
    private readonly blobs: Blob[],
  ) {
    this.adj = frames.map(() => [])
    for (const [a, b, cost, join] of edges) {
      this.adj[a].push({ to: b, cost, join: !!join })
      this.adj[b].push({ to: a, cost, join: !!join })
    }
    // which continuous take each frame belongs to: frames linked by plain steps, no joins
    this.take = new Int32Array(frames.length).fill(-1)
    let id = 0
    for (let s = 0; s < frames.length; s++) {
      if (this.take[s] >= 0) continue
      const stack = [s]
      this.take[s] = id
      while (stack.length) {
        const u = stack.pop()!
        for (const e of this.adj[u]) if (!e.join && this.take[e.to] < 0) (this.take[e.to] = id), stack.push(e.to)
      }
      id++
    }
    this.warmUp()
  }

  private readonly take: Int32Array

  /** While the browser is idle, pre-decode frames outward from straight-ahead until the cache is full. */
  private warmUp() {
    const order = this.frames.map((_, i) => i)
    const ahead = (i: number) => Math.hypot(this.frames[i].dx - 16, this.frames[i].dy + 22)
    order.sort((a, b) => ahead(a) - ahead(b))
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 50))
    let next = 0
    const step = () => {
      if (next >= Math.min(order.length, CACHE_SIZE - 10)) return
      if (this.pending.size + this.queue.length < DECODES_AT_ONCE) this.request([order[next++]], false)
      idle(step)
    }
    idle(step)
  }

  get bounds() {
    const xs = this.frames.map((f) => f.dx)
    const ys = this.frames.map((f) => f.dy)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  }

  nearest(x: number, y: number) {
    let best = 0
    let bestD = Infinity
    this.frames.forEach((f, i) => {
      const d = Math.hypot(f.dx - x, f.dy - y)
      if (f.rest && d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  isJoin(a: number, b: number) {
    return this.adj[a].some((e) => e.to === b && e.join)
  }

  /**
   * Route from frame `from` toward look (x, y): picks the frame that best balances "looks where
   * the cursor is" against "reachable without a long detour", and returns the steps to get there.
   */
  plan(from: number, x: number, y: number, keep = -1): { path: number[]; goal: number } {
    const n = this.frames.length
    const dist = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const done = new Uint8Array(n)
    dist[from] = 0
    for (;;) {
      let u = -1
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
      if (u < 0) break
      done[u] = 1
      for (const e of this.adj[u]) {
        const d = dist[u] + e.cost
        if (d < dist[e.to]) {
          dist[e.to] = d
          prev[e.to] = u
        }
      }
    }
    const scoreOf = (i: number) => Math.hypot(this.frames[i].dx - x, this.frames[i].dy - y) + DETOUR_COST * dist[i]
    // best look anywhere, and best look on the take the head is already on
    let best = from
    let bestScore = Infinity
    let own = -1
    let ownScore = Infinity
    for (let i = 0; i < n; i++) {
      if (!this.frames[i].rest || dist[i] === Infinity) continue
      const score = scoreOf(i)
      if (score < bestScore) {
        bestScore = score
        best = i
      }
      if (this.take[i] === this.take[from] && score < ownScore) {
        ownScore = score
        own = i
      }
    }
    // stay on this take unless another is clearly better; when already heading to another
    // take, keep going there unless this one wins by the same margin (no flip-flopping)
    // ...but only while this take can actually follow the cursor: a short take (like the held
    // eye contact) must not trap the head just because hopping costs something
    const target = keep >= 0 && keep < n ? this.take[keep] : this.take[from]
    const ownFollows = own >= 0 && Math.hypot(this.frames[own].dx - x, this.frames[own].dy - y) < GazeMap.tuning.followPx
    let goal = best
    if (ownFollows && ownScore - bestScore < GazeMap.tuning.stickiness && (target === this.take[from] || this.take[best] !== target))
      goal = own
    const path: number[] = []
    for (let i = goal; i !== from && i >= 0; i = prev[i]) path.push(i)
    return { path: path.reverse(), goal }
  }

  /** Decoded frame `i`, or null while it's still decoding (it's queued either way). */
  get(i: number): ImageBitmap | null {
    const b = this.bitmaps.get(i)
    if (b) {
      this.bitmaps.delete(i) // refresh LRU position
      this.bitmaps.set(i, b)
      return b
    }
    this.request([i], true)
    return null
  }

  /** Queue frames that are about to be needed (in order of urgency). */
  prefetch(ids: Iterable<number>) {
    this.request([...ids], false)
  }

  private request(ids: number[], urgent: boolean) {
    const fresh = ids.filter((i) => i >= 0 && i < this.blobs.length && !this.bitmaps.has(i) && !this.pending.has(i))
    if (!fresh.length) return
    // newest requests go first: the head's current route matters more than an old one, and
    // stale prefetches fall off the end
    const rest = this.queue.filter((i) => !fresh.includes(i))
    this.queue = [...fresh, ...rest].slice(0, urgent ? 49 : 48)
    this.pump()
  }

  private pump() {
    while (this.pending.size < DECODES_AT_ONCE && this.queue.length) this.decode(this.queue.shift()!)
  }

  /** Frames within `hops` steps of `i`. */
  around(i: number, hops = 3) {
    const seen = new Set([i])
    let ring = [i]
    for (let h = 0; h < hops; h++) {
      ring = ring.flatMap((u) => this.adj[u].map((e) => e.to)).filter((v) => !seen.has(v) && seen.add(v))
    }
    return seen
  }

  private decode(i: number) {
    if (this.pending.has(i) || this.bitmaps.has(i)) return
    this.pending.add(i)
    createImageBitmap(this.blobs[i])
      .then((b) => {
        this.bitmaps.set(i, b)
        while (this.bitmaps.size > CACHE_SIZE) {
          const [oldest, bmp] = this.bitmaps.entries().next().value!
          this.bitmaps.delete(oldest)
          bmp.close()
        }
      })
      .finally(() => {
        this.pending.delete(i)
        this.pump()
      })
  }
}
