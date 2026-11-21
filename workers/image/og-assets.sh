#!/usr/bin/env bash
# Render the assets that the image Worker's card presets (`og`, `og-site`)
# draw onto social cards with cf.image.draw (see OG_ASSETS in src/request.ts):
#
#   public/og-badge.png                    avatar + "sksat gallery" pill
#   public/og-shade.png                    gradient behind the caption
#   public/fonts/Roboto-Bold-subset.ttf    font for the caption text
#
# and the card the Worker serves when a card cannot be made:
#
#   workers/image/src/og-fallback.jpg      the badge on the site background
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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Badge at scale $1 (1: 96 px tall, as drawn on a 1200x630 card) into $2.
# The avatar is 8x pixel art (50x50 grid); sample it back to the grid and
# scale with nearest-neighbour so the pixels stay crisp.
badge() {
  local s="$1" out="$2"
  local H=$((96 * s)) A=$((80 * s)) P=$((8 * s)) # pill, avatar, inset
  magick src/media/sksat-round.png -sample 50x50 -filter point \
    -resize "${A}x${A}" "$tmp/avatar.png"
  magick -background none -fill white -font "$FONT" -pointsize $((40 * s)) \
    label:"sksat gallery" "$tmp/text.png"

  local tw th w
  tw="$(magick identify -format %w "$tmp/text.png")"
  th="$(magick identify -format %h "$tmp/text.png")"
  w=$((P + A + 16 * s + tw + 32 * s))

  magick -size "${w}x${H}" xc:none \
    -fill "rgba(16,20,48,0.72)" \
    -draw "roundrectangle 0,0 $((w - 1)),$((H - 1)) $((H / 2)),$((H / 2))" \
    "$tmp/avatar.png" -geometry "+${P}+$(((H - A) / 2))" -composite \
    "$tmp/text.png" -geometry "+$((P + A + 16 * s))+$(((H - th) / 2))" -composite \
    -depth 8 -strip -define png:compression-level=9 "$out"
}

badge 1 public/og-badge.png

# Fallback card: the badge at twice the size on the site's background
# (--color-bg), served by the Worker itself when a card cannot be made
# (src/index.ts). Bundled into the Worker, not drawn by a transformation.
badge 2 "$tmp/badge2.png"
magick -size 1200x630 xc:"#151934" "$tmp/badge2.png" -gravity center \
  -composite -strip -quality 90 workers/image/src/og-fallback.jpg

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

# The admin draws the same cards in the browser and stores them
# (admin/src/lib/og-card.ts): it serves its own copies (admin/src/lib/
# og-card.spec.ts checks they are the same bytes).
mkdir -p admin/public/og
cp public/og-badge.png public/og-shade.png public/fonts/Roboto-Bold-subset.ttf \
  public/fonts/Roboto-OFL.txt admin/public/og/

magick identify public/og-badge.png public/og-shade.png
ls -l public/fonts
