"""Turns the raw Flow clips in assets/clips into the site's media in public/media.

Every clip other than work_loop is:
  1. aligned to work_loop (Flow framed each clip ~3.5% larger and shifted, which showed as a
     visible jump in scale whenever the site switched clips),
  2. colour-matched to work_loop over the static parts of the scene,
  3. sharpened (these clips are softer than work_loop straight out of Flow),
then cropped to the hero framing at native resolution and encoded as WebM + MP4.

Cursor tracking uses one continuous left→right head turn from turn_horizontal, motion-
interpolated to 48 fps and stored as head-only frames (feathered alpha) drawn over a shared
body frame. Consecutive frames of one movement are what make the tracking smooth.

Clips that don't exist yet are skipped, so new reaction clips can be added one at a time.

    .venv/Scripts/python scripts/track.py scripts/track.json      # only when clips change
    .venv/Scripts/python scripts/process_clips.py scripts/track.json
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from analyze_clips import frame, similarity, static_mask  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CLIPS = ROOT / "assets" / "clips"
OUT = ROOT / "public" / "media"
# AI restoration (Real-ESRGAN) for the head region of every non-work_loop frame. Slow on an
# integrated GPU (~5 s per head), so results are cached per clip/frame and reused across runs.
REALESRGAN = ROOT / "tools" / "realesrgan" / "realesrgan-ncnn-vulkan.exe"
RESTORE_CACHE = ROOT / "assets" / ".restore-cache"
RESTORE_MODEL = "realesrgan-x4plus-anime"
TEXTURE_BACK = 0.45  # how much of the original's fine texture (beard strands) is blended back
X, Y, W, H = 330, 40, 1360, 1040  # hero crop: keeps character + cup, drops the Flow watermark
FPS = 24

# one-shot clips: (start, end) seconds kept. Reaction clips run working → action → working;
# their action happens in the first seconds, so the tail of plain typing is trimmed off.
TRIMS = {
    "look_up": (0, 2.4),
    "back_to_work": (0, 2.8),
    "cheers": (0, 9.5),
    "glance_left": (0, 3.0),
    "glance_right": (0, 4.0),
    "lean_around": (0, 5.0),  # guess; check once the clip exists
    "eyebrow": (0, 4.0),
    "headphones_on": (0, 6.0),
    "headphones_off": (0, 5.0),
}
LOOPS = ["work_loop", "headphones_loop"]  # get a cross-faded seamless loop point

HEAD = (250, 0, 700, 620)  # x, y, w, h in hero-crop coordinates
BASE_FRAME = ("look_up", 72)  # body under the tracking head: holding eye contact, settled

# Head-direction map: continuous stretches of real head movement (clip, start s, end s). Each
# stretch becomes a chain of consecutive frames; stretches are joined where two frames look
# nearly the same. The site walks the head along this map toward the cursor.
# Only long, continuous head movements: smoothness comes from walking along one take. Short
# fragments from reaction clips (glances, eyebrow, cheers, typing) made the head hop between
# takes constantly, and every hop blends two slightly different renders of his hair and light.
GAZE_PATHS = [
    ("look_up", 0.9, 5.0),  # lifts the head from the laptop to eye contact (down → centre), holds
    ("turn_circle", 0.4, 1.25),  # up (stops before the green-lens glitch)
    ("turn_circle", 2.7, 9.6),  # upper right → right → across → left → upper left → top → centre
    # (the green-lens glitch runs to 2.62 s; the review sheet caught what 2.15 s let through)
    ("turn_horizontal", 2.8, 6.3),  # one full sweep, far left → far right
    ("turn_vertical", 0.4, 3.3),  # centre → up
    ("turn_vertical", 5.3, 9.9),  # down and back (skips a sideways head-roll at 3.3-5.3 s)
    ("turn_lower", 0.0, 8.0),  # the lower half: down-right → down → down-left and back
    ("turn_lower_b", 0.0, 9.9),  # down-left → down → down-right → eye contact
    ("back_to_work", 0.0, 2.8),  # eye contact → down to the laptop
]
# blinks / closed eyes, reviewed by eye on contact sheets (scripts/gaze_blinks.json):
# the head may pass through these frames but never comes to rest on them
BLINKS_FILE = Path(__file__).parent / "gaze_blinks.json"
DEDUPE_PX = 3.5  # within a stretch: skip frames that barely moved since the last one kept
COVERED_PX = 0  # 0 = keep every take whole (splitting takes to avoid overlap fragmented them)
CHAIN_GAP = 6  # kept frames of a stretch this close in source frames stay linked as neighbours
JOIN_PX = 5  # frames from different stretches this close in head direction...
JOIN_DIFF = 8.0  # ...and this similar (mean abs pixel diff, 0-255) may be joined
JOIN_COST = 6  # a join costs as much as 6 steps along a take, so routes stay on one take
JOIN_SPACING = 10  # between the same two takes, joins are at least this many frames apart


def usm(img, sigma, amount):
    blur = cv2.GaussianBlur(img, (0, 0), sigma)
    return cv2.addWeighted(img, 1 + amount, blur, -amount, 0)


def feather_mask(w, h, side=70, top=24, bottom=110):
    ramp = lambda n, size: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / size, 0, 1)
    ys = np.clip(np.arange(h) / top, 0, 1) * np.clip((h - 1 - np.arange(h)) / bottom, 0, 1)
    a = np.outer(ys, ramp(w, side))
    return (a * a * (3 - 2 * a) * 255).astype(np.uint8)  # smoothstep edges


def restore_heads(clip, heads, tmp):
    """AI-restores head crops {frame: 700x620 BGR} → {frame: restored}, using the cache.

    Each head runs at half size through Real-ESRGAN (these models rebuild clean edges best from
    a small, soft input), comes back down to full size, and gets a little of the original's
    fine texture blended back so the beard doesn't turn into a flat mass.
    """
    stat = (CLIPS / f"{clip}.mp4").stat()
    cache = RESTORE_CACHE / f"{clip}-{stat.st_size}-{int(stat.st_mtime)}"  # a re-generated clip gets a fresh cache
    cache.mkdir(parents=True, exist_ok=True)
    todo = [i for i in heads if not (cache / f"{i:03d}.png").exists()]
    if todo:
        src, dst = Path(tmp) / f"sr_in_{clip}", Path(tmp) / f"sr_out_{clip}"
        src.mkdir()
        dst.mkdir()
        for i in todo:
            half = cv2.resize(heads[i], (heads[i].shape[1] // 2, heads[i].shape[0] // 2), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(src / f"{i:03d}.png"), half)
        print(f"  restoring {len(todo)} heads (~{len(todo) * 5.3 / 60:.0f} min)...", flush=True)
        subprocess.run([str(REALESRGAN), "-i", str(src), "-o", str(dst), "-n", RESTORE_MODEL, "-s", "4"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for i in todo:
            h, w = heads[i].shape[:2]
            up = cv2.resize(cv2.imread(str(dst / f"{i:03d}.png")), (w, h), interpolation=cv2.INTER_AREA)
            orig = heads[i].astype(np.float32)
            texture = usm(heads[i], 1.0, 0.6).astype(np.float32) - cv2.GaussianBlur(orig, (0, 0), 2.0)
            out = np.clip(up.astype(np.float32) + TEXTURE_BACK * texture, 0, 255).astype(np.uint8)
            cv2.imwrite(str(cache / f"{i:03d}.png"), out)
        shutil.rmtree(src)
        shutil.rmtree(dst)
    return {i: cv2.imread(str(cache / f"{i:03d}.png")) for i in heads}


class Corrector:
    """Aligns, colour-matches and sharpens one clip's frames to match work_loop."""

    def __init__(self, name, ref):
        self.identity = name == "work_loop"
        if self.identity:
            return
        first = frame(name)
        self.M, scale, *_ = similarity(first, ref)
        warped = self.warp(first)
        m = static_mask(ref.shape) > 0
        self.gain = (ref[m].reshape(-1, 3).mean(0) / warped[m].reshape(-1, 3).mean(0)).astype(np.float32)
        print(f"  aligned: scale {scale:.4f}, colour gain {np.round(self.gain, 3)}")

    def warp(self, f):
        return cv2.warpAffine(f, self.M, (f.shape[1], f.shape[0]), flags=cv2.INTER_LANCZOS4,
                              borderMode=cv2.BORDER_REPLICATE)

    def prep(self, f):
        """Aligned, colour-matched, cropped; not yet sharpened (restoration works from this)."""
        if not self.identity:
            f = self.warp(f)
            f = np.clip(f.astype(np.float32) * self.gain, 0, 255).astype(np.uint8)
        return f[Y:Y + H, X:X + W]

    def __call__(self, f):
        f = self.prep(f)
        return f if self.identity else usm(usm(f, 1.0, 0.6), 2.2, 0.7)


def frames(name):
    cap = cv2.VideoCapture(str(CLIPS / f"{name}.mp4"))
    while True:
        ok, f = cap.read()
        if not ok:
            return
        yield f


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def encode(src, name, extra_in=(), filter_complex=None):
    inp = [*extra_in, "-i", str(src)]
    filt = ["-filter_complex", filter_complex, "-map", "[v]"] if filter_complex else []
    ffmpeg(*inp, *filt, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1",
           "-pix_fmt", "yuv420p", str(OUT / f"{name}.webm"))
    ffmpeg(*inp, *filt, "-an", "-c:v", "libx264", "-crf", "20", "-preset", "slow",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT / f"{name}.mp4"))


def fit_colour(src, ref):
    """3x4 colour matrix mapping `src` onto `ref` (same pose, pixel for pixel), robust to the
    parts that differ between the two (a moved hand, a blink): those are fitted out as outliers.

    The background-only gain in Corrector can't see this: Flow lit the *character* differently
    in each clip (skin up to ~10 L* lighter and less red), and restoration and sharpening add
    contrast on top. Fitting on the finished frame catches all of it at once.
    """
    s = cv2.resize(src, (W // 4, H // 4), interpolation=cv2.INTER_AREA).reshape(-1, 3).astype(np.float64)
    r = cv2.resize(ref, (W // 4, H // 4), interpolation=cv2.INTER_AREA).reshape(-1, 3).astype(np.float64)
    # fit on the character only: the near-white backdrop is most of the frame and would
    # otherwise dominate the fit (and it's already matched by the background gain)
    use = (s.mean(1) < 215) & (r.mean(1) < 215)
    X = np.hstack([s, np.ones((len(s), 1))])
    for _ in range(4):
        A, *_ = np.linalg.lstsq(X[use], r[use], rcond=None)
        err = np.linalg.norm(X @ A - r, axis=1)
        use &= err < np.percentile(err[use], 75)
    return A.T.astype(np.float32)  # 3x4, for cv2.transform


def skin_weight(lab):
    """Soft mask of skin-toned pixels (warm, mid-bright) from an OpenCV LAB image (0-255 scale)."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    w = np.clip((a - 138) / 6, 0, 1) * np.clip((b - 136) / 6, 0, 1) * np.clip((L - 60) / 20, 0, 1) * np.clip((215 - L) / 20, 0, 1)
    return cv2.GaussianBlur(w.astype(np.float32), (0, 0), 2)


def skin_shift(src, ref):
    """LAB offset that brings the face's skin in `src` to the work loop's (both at the working pose)."""
    hx, hy, hw, hh = HEAD
    means = []
    for img in (src, ref):
        lab = cv2.cvtColor(img[hy:hy + hh, hx:hx + hw], cv2.COLOR_BGR2LAB).astype(np.float32)
        w = skin_weight(lab)[..., None]
        means.append((lab * w).reshape(-1, 3).sum(0) / max(1.0, float(w.sum())))
    return (means[1] - means[0]).astype(np.float32)


def apply_colour(frame_bgr, colour, skin=None):
    """Apply the character colour fit (fading out over the near-white backdrop), then nudge
    skin-toned pixels onto the work loop's skin tone."""
    f = frame_bgr.astype(np.float32)
    fixed = cv2.transform(f, colour)
    lum = cv2.GaussianBlur(f.mean(2), (0, 0), 3)
    w = np.clip((238 - lum) / 28, 0, 1)[..., None]  # 1 on the character, 0 on the backdrop
    out = np.clip(fixed * w + f * (1 - w), 0, 255).astype(np.uint8)
    if skin is None:
        return out
    lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab += skin_weight(lab)[..., None] * skin
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


COLOUR_FIT_FRAME = {"headphones_off": -1}  # these clips end (not start) on the working pose


def write_lossless(name, fix, tmp, keep, restore=(), ref=None):
    """Processed full-length clip as lossless FFV1 for the encoders; returns frames listed in `keep`.

    Frames in `restore` get their head region replaced by the AI-restored version, feathered
    into the (sharpened) rest of the frame. Every finished frame is then colour-matched to the
    work loop (`ref`, the hero-cropped working pose).
    """
    hx, hy, hw, hh = HEAD
    restored = {}
    if restore and not fix.identity:
        heads = {i: fix.prep(f)[hy:hy + hh, hx:hx + hw] for i, f in enumerate(frames(name)) if i in restore}
        restored = restore_heads(name, heads, tmp)
    alpha = (feather_mask(hw, hh).astype(np.float32) / 255)[..., None]

    def finish(i, f):
        out = fix(f)
        if i in restored:
            region = out[hy:hy + hh, hx:hx + hw].astype(np.float32)
            out[hy:hy + hh, hx:hx + hw] = (restored[i] * alpha + region * (1 - alpha)).astype(np.uint8)
        return out

    colour = skin = None
    if ref is not None and not fix.identity:
        all_frames = list(frames(name))
        k = COLOUR_FIT_FRAME.get(name, 0) % len(all_frames)
        sample = finish(k, all_frames[k])
        colour = fit_colour(sample, ref)
        skin = skin_shift(apply_colour(sample, colour), ref)
        del all_frames

    path = Path(tmp) / f"{name}.mkv"
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
                          "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "ffv1", str(path)],
                         stdin=subprocess.PIPE)
    kept = {}
    for i, f in enumerate(frames(name)):
        out = finish(i, f)
        if colour is not None:
            out = apply_colour(out, colour, skin)
        p.stdin.write(out.tobytes())
        if i in keep:
            kept[i] = out
    p.stdin.close()
    p.wait()
    return path, kept


def loop_filter(duration):
    """Play 0.5s..end, cross-fading the last 0.5s into the clip's first 0.5s."""
    return ("[0:v]split[a][b];[a]trim=start=0.5,setpts=PTS-STARTPTS[main];"
            "[b]trim=end=0.5,setpts=PTS-STARTPTS[head];"
            f"[main][head]xfade=transition=fade:duration=0.5:offset={duration - 1.0:.3f}[v]")


def gaze_nodes(track):
    """Frames along each GAZE_PATHS stretch: [(clip, frame, dx, dy, rests, path_id, chain_prev)].

    Within a stretch, frames that barely moved are skipped. A lower-priority stretch also skips
    frames whose look is already in the map, so each stretch mostly adds new directions.
    chain_prev links a frame to the previous kept frame of its stretch (-1 = starts a chain).
    """
    blinks = json.load(open(BLINKS_FILE)) if BLINKS_FILE.exists() else {}
    nodes = []
    for pid, (clip, t0, t1) in enumerate(GAZE_PATHS):
        t = track[clip]
        placed = np.array([(n[2], n[3]) for n in nodes]) if nodes else np.zeros((0, 2))
        last, last_i, last_node = None, -99, -1
        for i in range(int(t0 * FPS), min(int(t1 * FPS), len(t))):
            dx, dy = t[i][0], t[i][1]
            if last and np.hypot(dx - last[0], dy - last[1]) < DEDUPE_PX:
                continue
            if COVERED_PX and len(placed) and np.hypot(*(placed - (dx, dy)).T).min() < COVERED_PX:
                continue  # an earlier stretch already shows this look
            rests = i not in blinks.get(clip, [])
            prev = last_node if i - last_i <= CHAIN_GAP else -1
            nodes.append((clip, i, dx, dy, rests, pid, prev))
            last, last_i, last_node = (dx, dy), i, len(nodes) - 1
    return nodes


def gaze_edges(nodes, thumbs):
    """Consecutive frames of a stretch are neighbours; lookalike frames across stretches are joined."""
    edges = [[n[6], k, 1, 0] for k, n in enumerate(nodes) if n[6] >= 0]
    xy = np.array([(n[2], n[3]) for n in nodes])
    candidates = []
    for a in range(len(nodes)):
        for b in range(a + 1, len(nodes)):
            same_run = nodes[a][5] == nodes[b][5] and abs(nodes[a][1] - nodes[b][1]) < 12
            if same_run or np.hypot(*(xy[a] - xy[b])) > JOIN_PX:
                continue
            diff = float(np.mean(np.abs(thumbs[a] - thumbs[b])))
            if diff < JOIN_DIFF:
                candidates.append((diff, a, b))
    # best-matching joins first; between any two takes keep only well-spaced ones
    accepted = {}
    for diff, a, b in sorted(candidates):
        key = (nodes[a][5], nodes[b][5])
        near = any(abs(nodes[a][1] - nodes[a2][1]) < JOIN_SPACING or abs(nodes[b][1] - nodes[b2][1]) < JOIN_SPACING
                   for a2, b2 in accepted.get(key, []))
        if not near:
            accepted.setdefault(key, []).append((a, b))
            edges.append([a, b, JOIN_COST, 1])  # a join cross-fades briefly between two takes
    # any stretch that found no lookalike gets joined at its best-matching nearby frame
    while len(groups := components(len(nodes), edges)) > 1:
        small = min(groups, key=len)
        rest = [i for g in groups if g is not small for i in g]
        best = min(((a, b) for a in small for b in rest if np.hypot(*(xy[a] - xy[b])) < JOIN_PX * 2),
                   key=lambda p: float(np.mean(np.abs(thumbs[p[0]] - thumbs[p[1]]))), default=None)
        if best is None:
            best = min(((a, b) for a in small for b in rest), key=lambda p: np.hypot(*(xy[p[0]] - xy[p[1]])))
        edges.append([*best, JOIN_COST, 1])
    return edges


def components(n, edges):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x

    for a, b, *_ in edges:
        parent[find(a)] = find(b)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def export_gaze(heads, nodes):
    hx, hy, hw, hh = HEAD
    out_dir = OUT / "gaze"
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    alpha = feather_mask(hw, hh)
    thumbs = []
    for k, (clip, i, *_rest) in enumerate(nodes):
        head = heads[(clip, i)]
        cv2.imwrite(str(out_dir / f"{k:03d}.webp"), np.dstack([head, alpha]), [cv2.IMWRITE_WEBP_QUALITY, 80])
        thumbs.append(cv2.resize(cv2.cvtColor(head, cv2.COLOR_BGR2GRAY), (88, 78), interpolation=cv2.INTER_AREA)
                      .astype(np.float32))
    edges = gaze_edges(nodes, thumbs)
    joins = sum(e[3] for e in edges)
    print(f"gaze map: {len(nodes)} frames, {len(edges) - joins} steps, {joins} joins, "
          f"{len(components(len(nodes), edges))} connected piece(s)")
    return {
        "frames": [{"src": f"{k:03d}.webp", "dx": round(n[2], 1), "dy": round(n[3], 1), "rest": n[4]}
                   for k, n in enumerate(nodes)],
        "edges": edges,
    }


# Reaction clips all open on the working pose, but the work loop's head is wherever it happens
# to be when a reaction fires. Starting every clip at frame 0 made that switch read as a jolt.
# So the site gets each clip's head position over its lead-in, and the loop's over its length,
# and starts the clip at the lead-in frame closest to where the head is right now.
ENTRY_WINDOWS = {  # seconds of lead-in (before the action starts) the site may start from
    "look_up": 1.2,
    "glance_left": 1.2,
    "glance_right": 1.8,
    "eyebrow": 0.9,
    "cheers": 1.4,
    "headphones_on": 1.2,
}


def export_entries(track):
    loop = track["work_loop"]
    # work_loop.webm plays source 0.5 s … 9.5 s (then a cross-fade back to 0.5 s)
    loop_heads = [[round(loop[min(len(loop) - 1, k + 12)][0], 1), round(loop[min(len(loop) - 1, k + 12)][1], 1)]
                  for k in range(int(9.5 * FPS))]
    entries = {}
    for clip, window in ENTRY_WINDOWS.items():
        if clip in track and (CLIPS / f"{clip}.mp4").exists():
            entries[clip] = [[round(p[0], 1), round(p[1], 1)] for p in track[clip][: int(window * FPS)]]
    json.dump({"fps": FPS, "work_loop": loop_heads, "entries": entries}, open(OUT / "clips.json", "w"))


def encode_loader():
    """The loading screen's own shot (assets/loader.mp4): portrait, full body, from the side."""
    src = ROOT / "assets" / "loader.mp4"
    if not src.exists():
        return
    ffmpeg("-i", str(src), "-an", "-vf", "scale=720:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "33",
           "-row-mt", "1", "-pix_fmt", "yuv420p", str(OUT / "loader.webm"))
    ffmpeg("-i", str(src), "-an", "-vf", "scale=720:-2", "-c:v", "libx264", "-crf", "24", "-preset", "slow",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT / "loader.mp4"))
    ffmpeg("-i", str(src), "-vf", "scale=720:-2", "-frames:v", "1", "-c:v", "libwebp", "-quality", "82",
           str(OUT / "loader-poster.webp"))


def main():
    track = json.load(open(sys.argv[1]))
    encode_loader()
    export_entries(track)
    ref = frame("work_loop", 12)
    nodes = gaze_nodes(track)
    names = [n for n in [*LOOPS, *TRIMS, *(p[0] for p in GAZE_PATHS)] if (CLIPS / f"{n}.mp4").exists()]
    hx, hy, hw, hh = HEAD
    heads = {}
    with tempfile.TemporaryDirectory() as tmp:
        for name in dict.fromkeys(names):
            print(f"processing {name}")
            keep = {i for clip, i, *_ in nodes if clip == name}
            if name == "work_loop":
                keep.add(12)
            if name == BASE_FRAME[0]:
                keep.add(BASE_FRAME[1])
            restore = set(keep)  # every frame the site shows from this clip gets its head restored
            if name in TRIMS:
                a, b = TRIMS[name]
                restore |= set(range(int(a * FPS), int(b * FPS) + 1))
            elif name in LOOPS:
                restore |= set(range(int(10.5 * FPS)))  # whole clip (work_loop itself is never restored)
            src, kept = write_lossless(name, Corrector(name, ref), tmp, keep, restore, ref[Y:Y + H, X:X + W])
            for i, f in kept.items():
                heads[(name, i)] = f[hy:hy + hh, hx:hx + hw]
            if name in LOOPS:
                dur = float(subprocess.check_output(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)]))
                encode(src, name, filter_complex=loop_filter(dur))
            elif name in TRIMS:
                a, b = TRIMS[name]
                encode(src, name, extra_in=("-ss", str(a), "-t", str(b - a)))
            if name == "work_loop":
                cv2.imwrite(str(OUT / "poster.webp"), kept[12], [cv2.IMWRITE_WEBP_QUALITY, 90])
            if name == BASE_FRAME[0]:
                base = kept[BASE_FRAME[1]]
    gaze = export_gaze(heads, nodes)
    cv2.imwrite(str(OUT / "gaze" / "base.webp"), base, [cv2.IMWRITE_WEBP_QUALITY, 90])
    manifest = {"size": [W, H], "head": list(HEAD), "base": "base.webp", **gaze}
    json.dump(manifest, open(OUT / "gaze" / "gaze.json", "w"))
    for old in ("poses", "sweep"):
        shutil.rmtree(OUT / old, ignore_errors=True)
    size = sum(os.path.getsize(OUT / "gaze" / f["src"]) for f in gaze["frames"])
    print(f"gaze frames: {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
