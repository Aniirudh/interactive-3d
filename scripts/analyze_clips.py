"""Measure how each clip's framing and sharpness compare to work_loop.

Framing: a similarity transform (scale + shift) fitted with ORB features on the static parts
of the scene (laptop, desk, cup, torso), mapping each clip's first frame onto work_loop's.
Sharpness: variance of the Laplacian over the face region, averaged across the clip.
"""
from pathlib import Path
import cv2
import numpy as np

CLIPS = Path(__file__).resolve().parent.parent / "assets" / "clips"
NAMES = ["work_loop", "look_up", "back_to_work", "cheers", "turn_horizontal", "turn_vertical", "turn_circle"]
FACE = (790, 250, 1060, 560)


def frame(name, idx=0):
    cap = cv2.VideoCapture(str(CLIPS / f"{name}.mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    return cap.read()[1]


def static_mask(shape):
    m = np.full(shape[:2], 255, np.uint8)
    m[0:600, 700:1200] = 0           # head and hair move; ignore them
    m[:, 1700:] = 0                  # watermark corner
    return m


def similarity(src, ref):
    orb = cv2.ORB_create(4000)
    g1, g2 = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (src, ref))
    k1, d1 = orb.detectAndCompute(g1, static_mask(src.shape))
    k2, d2 = orb.detectAndCompute(g2, static_mask(ref.shape))
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2)
    p1 = np.float32([k1[m.queryIdx].pt for m in matches])
    p2 = np.float32([k2[m.trainIdx].pt for m in matches])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    scale = float(np.hypot(M[0, 0], M[1, 0]))
    return M, scale, int(inl.sum()), len(matches)


def sharpness(name):
    cap = cv2.VideoCapture(str(CLIPS / f"{name}.mp4"))
    vals, i = [], 0
    x0, y0, x1, y1 = FACE
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % 6 == 0:
            g = cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
            vals.append(cv2.Laplacian(g, cv2.CV_64F).var())
        i += 1
    return float(np.median(vals))


if __name__ == "__main__":
    ref = frame("work_loop", 12)  # 0.5 s: the frame the site's loop starts on
    for n in NAMES:
        M, s, inl, tot = similarity(frame(n), ref)
        print(f"{n:16s} scale={s:.4f} shift=({M[0,2]:+6.1f},{M[1,2]:+6.1f}) inliers={inl}/{tot} "
              f"face-sharpness={sharpness(n):7.1f}")
