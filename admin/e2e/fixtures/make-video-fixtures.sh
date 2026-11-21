#!/usr/bin/env bash
# Regenerates the tiny playable videos used by the upload E2E and by
# src/lib/video-meta.spec.ts. VP9 (not H.264, which Playwright's Chromium
# cannot decode), 320x180, 2 s at 10 fps, a fixed test pattern, bit-exact
# muxing so the output does not depend on the ffmpeg build's version string.
#
# clip.webm:     no metadata at all (the `testsrc` pattern).
# clip-meta.mp4: QuickTime metadata keys (moov/meta: keys + ilst) with a
#                position, a time, a make and a model, which the playback
#                copy must not carry (video-meta.ts neutralises them). The
#                `testsrc2` pattern: its frames, and so the posters the
#                browser draws, differ from clip.webm's.
set -euo pipefail
cd "$(dirname "$0")"

common=(-hide_banner -loglevel error -y
  -c:v libvpx-vp9 -b:v 100k -deadline good -cpu-used 4 -row-mt 0 -threads 1
  -pix_fmt yuv420p -an
  -fflags +bitexact -flags:v +bitexact -map_metadata -1)

ffmpeg -f lavfi -i testsrc=size=320x180:rate=10:duration=2 \
  "${common[@]}" clip.webm

ffmpeg -f lavfi -i testsrc2=size=320x180:rate=10:duration=2 \
  "${common[@]}" \
  -movflags +faststart+use_metadata_tags \
  -metadata "com.apple.quicktime.location.ISO6709=+35.6895+139.6917+040.000/" \
  -metadata "com.apple.quicktime.creationdate=2026-11-18T10:20:30+0900" \
  -metadata "com.apple.quicktime.make=TestMake" \
  -metadata "com.apple.quicktime.model=TestModel" \
  clip-meta.mp4
