"""Writes a raw RGBA copy of test/fixtures/grinch-raster.jpg for the palette
regression test (test/fixturePalette.test.ts). Run once from the repo root:

    python scripts/make-fixture-rgba.py [longest_side]

Without an argument the image keeps its native size (995x1283), which is what
the app itself analyses (it only downsizes beyond 2400 px). Downscaled copies
(LANCZOS) smooth away the anti-aliasing seams the test is about, so they are
not representative. Output is gzip-compressed (Node reads it via node:zlib):
test/fixtures/grinch-<w>x<h>.rgba.gz. Requires Pillow.
"""
import gzip
import sys
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
img = Image.open(root / "test" / "fixtures" / "grinch-raster.jpg").convert("RGBA")
if len(sys.argv) > 1:
    scale = int(sys.argv[1]) / max(img.size)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
raw = img.tobytes()
out = root / "test" / "fixtures" / f"grinch-{img.width}x{img.height}.rgba.gz"
out.write_bytes(gzip.compress(raw, 9, mtime=0))
print(out, len(raw), "raw bytes,", out.stat().st_size, "compressed")
