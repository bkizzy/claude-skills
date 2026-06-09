#!/usr/bin/env bash
# thumb.sh — emit read-optimized, cached thumbnails for the images whose paths
# arrive on stdin (one per line, as printed by find_screenshots.sh).
#
# Why: Claude's vision API downscales anything over ~1568px on its long edge
# before processing, so reading a full-res Retina screenshot uploads more bytes
# for zero extra detail. We resample to 1568px max edge as JPEG q80 once, cache
# by source mtime, and print the cache path to Read instead of the original.
#
# Prints one cache path per line, in the same order as input. If sips (macOS)
# isn't available or a resize fails, it falls back to printing the ORIGINAL
# path so the Read step always has something valid.
#
# Usage:  find_screenshots.sh 5 | thumb.sh

set -euo pipefail

MAX=1568
CACHE="$HOME/.claude/skills/screenshotr/preview/.thumbs"
mkdir -p "$CACHE"

while IFS= read -r src; do
  [ -z "$src" ] && continue
  if [ ! -f "$src" ]; then
    printf '%s\n' "$src"   # let the Read step surface the missing-file error
    continue
  fi

  # If the image is already within the vision API's sweet spot, reading the
  # original is strictly better than a resampled (and possibly upscaled) copy.
  longedge="$(sips -g pixelWidth -g pixelHeight "$src" 2>/dev/null \
    | awk '/pixelWidth|pixelHeight/{print $2}' | sort -rn | head -1)"
  if [ -n "$longedge" ] && [ "$longedge" -le "$MAX" ]; then
    printf '%s\n' "$src"
    continue
  fi

  # Cache key: basename + source mtime, so a re-captured file re-thumbnails.
  base="${src##*/}"
  mtime="$(stat -f '%m' "$src" 2>/dev/null || echo 0)"
  out="$CACHE/${mtime}-${base%.*}.jpg"

  if [ -f "$out" ]; then
    printf '%s\n' "$out"
    continue
  fi

  if command -v sips >/dev/null 2>&1 \
     && sips -s format jpeg -s formatOptions 80 -Z "$MAX" "$src" --out "$out" >/dev/null 2>&1 \
     && [ -s "$out" ]; then
    printf '%s\n' "$out"
  else
    printf '%s\n' "$src"   # fallback: original still works, just larger
  fi
done

# Opportunistic cleanup: drop stale thumbs from older mtimes (keep cache small).
# Only runs if there are more than 40 cached files.
count="$(ls -1 "$CACHE" 2>/dev/null | wc -l | tr -d ' ')"
if [ "${count:-0}" -gt 40 ]; then
  ls -1t "$CACHE" | tail -n +41 | while IFS= read -r old; do
    rm -f "$CACHE/$old" 2>/dev/null || true
  done
fi
