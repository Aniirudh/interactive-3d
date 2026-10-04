"""Anchor clips that don't open on the working pose (track.CHAINED) to the shared head-offset scale.

Their tracked positions are relative to their own first frame. For each such clip, find the
frames that look most like frames of the reference clips (whose offsets are known, measured
from the working pose), and shift the whole clip by the median difference.

    .venv/Scripts/python scripts/anchor.py scripts/track.json
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import process_clips as pc  # noqa: E402
from track import CHAINED  # noqa: E402

REFERENCE = ["turn_circle", "turn_horizontal", "turn_vertical", "look_up", "back_to_work", "work_loop"]
TOP = 8  # best-matching frame pairs used for the offset


def thumbs(clip, ref, step):
    """Grey 88x78 thumbnails of the (aligned) head region, every `step` frames."""
    fix = pc.Corrector(clip, ref)
    hx, hy, hw, hh = pc.HEAD
    out = {}
    for i, f in enumerate(pc.frames(clip)):
        if i % step == 0:
            head = cv2.cvtColor(fix.prep(f)[hy:hy + hh, hx:hx + hw], cv2.COLOR_BGR2GRAY)
            out[i] = cv2.resize(head, (88, 78), interpolation=cv2.INTER_AREA).astype(np.float32)
    return out


def main():
    track = json.load(open(sys.argv[1]))
    ref = pc.frame("work_loop", 12)
    refs = [(clip, i, t) for clip in REFERENCE for i, t in thumbs(clip, ref, 3).items()]
    ref_stack = np.stack([t for *_, t in refs])
    for clip in CHAINED:
        if clip not in track:
            continue
        pairs = []
        for i, t in thumbs(clip, ref, 2).items():
            d = np.abs(ref_stack - t).mean(axis=(1, 2))
            k = int(d.argmin())
            pairs.append((float(d[k]), i, refs[k][0], refs[k][1]))
        pairs.sort()
        offsets = np.array([np.subtract(track[rc][ri][:2], track[clip][i][:2]) for _, i, rc, ri in pairs[:TOP]])
        off = np.median(offsets, axis=0)
        spread = np.abs(offsets - off).mean(axis=0)
        for p in track[clip]:
            p[0] += float(off[0])
            p[1] += float(off[1])
        best = ", ".join(f"{i / 24:.1f}s~{rc}@{ri / 24:.1f}s" for _, i, rc, ri in pairs[:3])
        print(f"{clip}: offset ({off[0]:+.1f},{off[1]:+.1f}), agreement ±({spread[0]:.1f},{spread[1]:.1f})px; {best}")
    json.dump(track, open(sys.argv[1], "w"))


if __name__ == "__main__":
    main()
