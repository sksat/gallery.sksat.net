#!/usr/bin/env bash
# Render the assets that the image Worker's card presets (`og`, `og-site`)
# draw onto social cards with cf.image.draw (see OG_ASSETS in src/request.ts):
#
#   public/og-badge.png                    avatar + "sksat gallery" pill
#   public/og-shade.png                    gradient behind the caption
#   public/fonts/Roboto-Bold-subset.ttf    font for the caption text
#
# The badge text is baked in here; the caption is drawn by Cloudflare from
# the font. Cards are cached per photo (Cache-Control in src/index.ts), so
# changed assets show up only after those caches expire or are purged.
#
# Requires ImageMagick 7, fonttools (pyftsubset) and Roboto Bold (OFL).
# Run from the repository root:
#   workers/image/og-assets.sh
set -euo pipefail

FONT="${FONT:-/usr/share/fonts/TTF/Roboto-Bold.ttf}"
H=96 # pill height in card pixels (the card is 1200x630)
A=80 # avatar size
P=8  # avatar inset

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Badge. The avatar is 8x pixel art (50x50 grid); sample it back to the grid
# and scale with nearest-neighbour so the pixels stay crisp.
magick src/media/sksat-round.png -sample 50x50 -filter point \
  -resize "${A}x${A}" "$tmp/avatar.png"
magick -background none -fill white -font "$FONT" -pointsize 40 \
  label:"sksat gallery" "$tmp/text.png"

tw="$(magick identify -format %w "$tmp/text.png")"
th="$(magick identify -format %h "$tmp/text.png")"
w=$((P + A + 16 + tw + 32))

magick -size "${w}x${H}" xc:none \
  -fill "rgba(16,20,48,0.72)" \
  -draw "roundrectangle 0,0 $((w - 1)),$((H - 1)) $((H / 2)),$((H / 2))" \
  "$tmp/avatar.png" -geometry "+${P}+$(((H - A) / 2))" -composite \
  "$tmp/text.png" -geometry "+$((P + A + 16))+$(((H - th) / 2))" -composite \
  -depth 8 -strip -define png:compression-level=9 public/og-badge.png

# Shade: transparent at the top to 70% black at the bottom, so white caption
# text stays readable on bright photos.
magick -size 1200x240 gradient:"rgba(0,0,0,0)-rgba(0,0,0,0.7)" \
  -depth 8 -strip -define png:compression-level=9 public/og-shade.png

# Font: printable ASCII plus "·" and "…" (the caption is ASCII-only, see
# src/caption.ts), so the transformation fetches a few KB instead of ~450KB.
mkdir -p public/fonts
pyftsubset "$FONT" --unicodes="U+0020-007E,U+00B7,U+2026" \
  --layout-features='kern' --no-hinting \
  --output-file=public/fonts/Roboto-Bold-subset.ttf
cp /usr/share/licenses/ttf-roboto/OFL.txt public/fonts/Roboto-OFL.txt

magick identify public/og-badge.png public/og-shade.png
ls -l public/fonts
