#!/usr/bin/env bash
# Render public/og-badge.png: the "sksat gallery" pill that the image Worker's
# `og` preset draws onto social cards (cf.image.draw). The text is baked in
# here because the Worker cannot render text within its CPU budget.
# Cards are cached per photo (Cache-Control in workers/image/src/index.ts), so
# a new badge shows up only after those caches expire or are purged.
#
# Requires ImageMagick 7 and Roboto Bold. Run from the repository root:
#   workers/image/og-badge.sh
set -euo pipefail

FONT="${FONT:-/usr/share/fonts/TTF/Roboto-Bold.ttf}"
OUT="public/og-badge.png"
H=96 # pill height in card pixels (the card is 1200x630)
A=80 # avatar size
P=8  # avatar inset

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The avatar is 8x pixel art (50x50 grid); sample it back to the grid and
# scale with nearest-neighbour so the pixels stay crisp.
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
  -depth 8 -strip -define png:compression-level=9 "$OUT"

magick identify "$OUT"
