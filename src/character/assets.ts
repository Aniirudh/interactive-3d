import { GazeMap, type GazeEdge, type GazeFrame, type Rect } from './gaze'

export type ClipName =
  | 'work_loop'
  | 'look_up'
  | 'back_to_work'
  | 'cheers'
  // reactions: each runs working → action → working. Missing ones are simply skipped.
  | 'glance_left'
  | 'glance_right'
  | 'lean_around'
  | 'eyebrow'
  | 'headphones_on'
  | 'headphones_loop'
  | 'headphones_off'

const DEFERRED_CLIPS: ClipName[] = [
  'cheers',
  'glance_left',
  'glance_right',
  'eyebrow',
  'lean_around',
  'headphones_on',
  'headphones_loop',
  'headphones_off',
]

/** Head positions per frame, so a reaction can start where the work loop's head already is. */
export interface ClipHeads {
  fps: number
  work_loop: [number, number][]
  entries: Partial<Record<ClipName, [number, number][]>>
}

export interface CharacterAssets {
  poster: HTMLImageElement
  clips: Partial<Record<ClipName, HTMLVideoElement>>
  heads: ClipHeads | null
  gaze: GazeMap | null // arrives after the reveal (never on touch screens); until then he holds the end of look_up
}

const MEDIA = `${import.meta.env.BASE_URL}media/`
const FORMAT = document.createElement('video').canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'

// Rough byte sizes that weight the loader bar until real Content-Length headers arrive.
const ESTIMATE = {
  fonts: 60e3,
  poster: 70e3,
  work_loop: 1.8e6,
  look_up: 550e3,
  back_to_work: 600e3,
}
type Item = keyof typeof ESTIMATE

class Progress {
  private items = new Map<Item, { loaded: number; total: number }>()

  constructor(
    keys: Item[],
    private readonly onChange: (p: number) => void,
  ) {
    for (const k of keys) this.items.set(k, { loaded: 0, total: ESTIMATE[k] })
  }

  update(key: Item, loaded: number, total?: number) {
    const item = this.items.get(key)!
    item.loaded = loaded
    if (total) item.total = total
    this.emit()
  }

  done(key: Item) {
    const item = this.items.get(key)!
    item.loaded = item.total
    this.emit()
  }

  private emit() {
    let loaded = 0
    let total = 0
    for (const i of this.items.values()) {
      loaded += Math.min(i.loaded, i.total)
      total += i.total
    }
    this.onChange(total ? loaded / total : 0)
  }
}

async function fetchBlob(
  url: string,
  onBytes?: (loaded: number, total?: number) => void,
  expect?: string,
): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  // dev servers answer missing files with index.html; treat that as missing too
  if (expect && !res.headers.get('content-type')?.startsWith(expect)) throw new Error(`not found: ${url}`)
  const total = Number(res.headers.get('content-length')) || undefined
  if (!res.body || !onBytes) return res.blob()

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onBytes(loaded, total)
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  return img.decode().then(() => img)
}

/** Fully downloads a clip into memory so playback and seeking are instant. */
async function loadClip(name: ClipName, progress?: Progress): Promise<HTMLVideoElement> {
  const blob = await fetchBlob(
    `${MEDIA}${name}.${FORMAT}`,
    progress && ((loaded, total) => progress.update(name as Item, loaded, total)),
    'video/',
  )
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  video.preload = 'auto'
  video.src = URL.createObjectURL(blob)
  if (video.readyState < 2)
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', resolve, { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })
  progress?.done(name as Item)
  return video
}

interface GazeManifest {
  head: Rect
  base: string
  frames: (GazeFrame & { src: string })[]
  edges: GazeEdge[]
}

async function loadGaze(): Promise<GazeMap> {
  const dir = `${MEDIA}gaze/`
  const manifest: GazeManifest = await fetch(`${dir}gaze.json`).then((r) => r.json())
  const base = await createImageBitmap(await fetchBlob(dir + manifest.base))
  const blobs: Blob[] = new Array(manifest.frames.length)
  // fetch the looks closest to straight-ahead first, so tracking works before the rest arrive
  const order = manifest.frames.map((_, i) => i)
  const ahead = (i: number) => Math.hypot(manifest.frames[i].dx - 16, manifest.frames[i].dy + 22)
  order.sort((a, b) => ahead(a) - ahead(b))
  let next = 0
  const worker = async () => {
    while (next < order.length) {
      const i = order[next++]
      blobs[i] = await fetchBlob(dir + manifest.frames[i].src)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return new GazeMap(base, manifest.head, manifest.frames, manifest.edges, blobs)
}

function settle<T>(p: Promise<T>, what: string): Promise<T | undefined> {
  return p.catch((err) => {
    console.warn(`[character] failed to load ${what}`, err)
    return undefined
  })
}

/**
 * Loads everything the hero needs. `onLoopReady` fires as soon as the working loop can play,
 * so the loader can show him at work while the rest downloads.
 */
export async function loadCharacter(
  onProgress: (p: number) => void,
  onLoopReady: (assets: CharacterAssets) => void,
): Promise<CharacterAssets> {
  const progress = new Progress(['fonts', 'poster', 'work_loop', 'look_up', 'back_to_work'], onProgress)
  const fonts = document.fonts.ready.then(() => progress.done('fonts'))

  const assets: CharacterAssets = { poster: await loadImage(`${MEDIA}poster.webp`), clips: {}, gaze: null, heads: null }
  fetch(`${MEDIA}clips.json`)
    .then((r) => r.json())
    .then((h: ClipHeads) => (assets.heads = h))
    .catch(() => {}) // without it, reactions just start at their first frame
  progress.done('poster')

  const loop = await settle(loadClip('work_loop', progress), 'work_loop')
  if (loop) assets.clips.work_loop = loop
  else progress.done('work_loop')
  onLoopReady(assets)

  await Promise.all([
    fonts,
    settle(loadClip('look_up', progress), 'look_up').then((v) => {
      if (v) assets.clips.look_up = v
      progress.done('look_up')
    }),
    settle(loadClip('back_to_work', progress), 'back_to_work').then((v) => {
      if (v) assets.clips.back_to_work = v
      progress.done('back_to_work')
    }),
  ])
  return assets
}

/**
 * The gaze map and reaction clips aren't needed for the first impression; fetch them after the
 * reveal. Touch screens have no cursor to follow, so they skip the gaze map (~5 MB) entirely.
 */
export async function loadDeferred(assets: CharacterAssets) {
  if (matchMedia('(hover: hover)').matches) {
    const gaze = await settle(loadGaze(), 'gaze map')
    if (gaze) assets.gaze = gaze
  }
  for (const name of DEFERRED_CLIPS) await loadLazyClip(assets, name)
}

/** Reduced-motion path: only the still frame and fonts. */
export async function loadStill(onProgress: (p: number) => void): Promise<void> {
  const progress = new Progress(['fonts', 'poster'], onProgress)
  await Promise.all([
    document.fonts.ready.then(() => progress.done('fonts')),
    settle(loadImage(`${MEDIA}poster.webp`), 'poster').then(() => progress.done('poster')),
  ])
}

/** Clips that aren't needed for the first impression load after the reveal. */
export async function loadLazyClip(assets: CharacterAssets, name: ClipName) {
  if (assets.clips[name]) return
  // reaction clips are optional: a missing one just means that reaction is skipped
  const v = await loadClip(name).catch(() => undefined)
  if (v) assets.clips[name] = v
}
