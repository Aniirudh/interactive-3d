"""Track face feature points through each clip; report per-frame head displacement
relative to frame 0, plus how closely each clip's first/last frame matches work_loop frame 0."""
import json, sys
import cv2
import numpy as np

CLIPS = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "assets" / "clips")
NAMES = ["work_loop", "look_up", "back_to_work", "cheers",
         "turn_horizontal", "turn_vertical", "turn_circle",
         "glance_left", "glance_right", "eyebrow", "turn_lower", "turn_lower_b"]
# usage: track.py out.json [clip ...]  (listing clips re-tracks just those, merging into out.json)
FACE = (790, 250, 1060, 560)      # x0, y0, x1, y1 in 1920x1080
BODY = (560, 600, 1350, 720)      # sweater shoulders, should stay still


def frames(name):
    cap = cv2.VideoCapture(f"{CLIPS}\\{name}.mp4")
    while True:
        ok, f = cap.read()
        if not ok:
            break
        yield f


def seed(gray, box):
    m = np.zeros_like(gray)
    x0, y0, x1, y1 = box
    m[y0:y1, x0:x1] = 255
    return cv2.goodFeaturesToTrack(gray, 300, 0.01, 6, mask=m)


def track(name):
    lk = dict(winSize=(31, 31), maxLevel=4,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    out, prev, pts0, pts, bpts0, bpts = [], None, None, None, None, None
    for i, f in enumerate(frames(name)):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        if prev is None:
            pts0 = pts = seed(g, FACE)
            bpts0 = bpts = seed(g, BODY)
            out.append((0.0, 0.0, 0.0, len(pts)))
            prev = g
            continue
        res = []
        for p0, p in ((pts0, pts), (bpts0, bpts)):
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, p, None, **lk)
            back, st2, _ = cv2.calcOpticalFlowPyrLK(g, prev, nxt, None, **lk)
            good = (st.ravel() == 1) & (st2.ravel() == 1) & \
                   (np.linalg.norm((back - p).reshape(-1, 2), axis=1) < 1.0)
            res.append((p0[good], nxt[good]))
        (pts0, pts), (bpts0, bpts) = res
        d = np.median((pts - pts0).reshape(-1, 2), axis=0)
        bd = np.median((bpts - bpts0).reshape(-1, 2), axis=0) if len(bpts) else np.zeros(2)
        out.append((float(d[0]), float(d[1]), float(np.linalg.norm(bd)), len(pts)))
        prev = g
    return out


def diff(a, b):
    return float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16))))


def chained(name):
    """For clips that don't open on the working pose: follow the face frame to frame, re-seeding
    features around wherever it is now, and add up the small steps. Positions are relative to
    frame 0 until anchored (see anchor.py)."""
    lk = dict(winSize=(31, 31), maxLevel=4,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    x0, y0, x1, y1 = FACE
    out, prev, pos = [], None, np.zeros(2)
    for f in frames(name):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        if prev is not None:
            box = (int(x0 + pos[0]), int(y0 + pos[1]), int(x1 + pos[0]), int(y1 + pos[1]))
            p = seed(prev, box)
            if p is not None and len(p) > 8:
                nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, p, None, **lk)
                back, st2, _ = cv2.calcOpticalFlowPyrLK(g, prev, nxt, None, **lk)
                ok = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm((back - p).reshape(-1, 2), axis=1) < 1.0)
                if ok.sum() > 5:
                    pos += np.median((nxt - p).reshape(-1, 2)[ok], axis=0)
        out.append((float(pos[0]), float(pos[1]), 0.0, 99))
        prev = g
    return out


CHAINED = {"turn_lower", "turn_lower_b"}

ref = next(frames("work_loop"))
only = sys.argv[2:]
result = json.load(open(sys.argv[1])) if only and __import__("os").path.exists(sys.argv[1]) else {}
for n in only or NAMES:
    fs = list(frames(n))
    t = chained(n) if n in CHAINED else track(n)
    result[n] = t
    print(f"{n:16s} frames={len(fs)} first-vs-A={diff(fs[0], ref):5.2f} "
          f"last-vs-A={diff(fs[-1], ref):5.2f} face-pts-left={t[-1][3]} "
          f"max-body-drift={max(x[2] for x in t):.1f}px")
    for i in range(0, len(t), 12):
        dx, dy, bd, c = t[i]
        print(f"   t={i/24:4.1f}s dx={dx:7.1f} dy={dy:7.1f} body={bd:4.1f} pts={c}")
json.dump(result, open(sys.argv[1], "w"))
