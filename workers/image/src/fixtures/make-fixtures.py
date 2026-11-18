# Tiny images in the formats Image Transformations returns, for the
# container-edit tests (exif-embed.spec.ts). Written by Pillow, without
# any metadata:
#   python3 make-fixtures.py <this directory>
import sys

from PIL import Image

out = sys.argv[1]
rgb = Image.new("RGB", (6, 4), (200, 120, 40))
rgba = Image.new("RGBA", (5, 3), (10, 20, 30, 128))
rgb.save(f"{out}/plain.jpg", "JPEG", quality=50)
rgb.save(f"{out}/lossy.webp", "WEBP", quality=50)
rgba.save(f"{out}/lossless-alpha.webp", "WEBP", lossless=True)
# Lossy with alpha needs the extended format (VP8X + ALPH + VP8).
rgba.save(f"{out}/lossy-alpha.webp", "WEBP", quality=50)
