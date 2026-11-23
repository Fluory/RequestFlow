"""Assembles PNG frames into an animated WebP that loops (needs Pillow).

    python3 docs/readme/webp.py <frame-dir> <out.webp> <fps> <quality>

Called by docs/readme/hero.mjs and docs/readme/app.record.ts. Frames are taken in file-name order.
"""
import glob
import os
import sys

from PIL import Image

src, out, fps, quality = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
files = sorted(glob.glob(os.path.join(src, "*.png")))
if not files:
    sys.exit(f"no frames in {src}")
frames = [Image.open(f).convert("RGB") for f in files]
frames[0].save(
    out,
    "WEBP",
    save_all=True,
    append_images=frames[1:],
    duration=round(1000 / fps),
    loop=0,
    quality=quality,
    method=4,
    allow_mixed=False,
)
size = os.path.getsize(out)
print(f"-> {out}: {len(frames)} frames, {frames[0].width}x{frames[0].height}, {size / 1024:.0f} KB")
