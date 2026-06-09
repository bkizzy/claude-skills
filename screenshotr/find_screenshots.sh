#!/usr/bin/env bash
# find_screenshots.sh — print the N most-recent screenshot/image paths from the
# macOS screenshot folder, newest first, one absolute path per line.
#
# Usage: find_screenshots.sh [N] [--open]
#   N       number of images to return (default: 1)
#   --open  also open the matched image(s) in the default viewer (Preview)
#
# Note: macOS screenshot filenames use a narrow no-break space (U+202F) before
# AM/PM, so a hand-typed path won't match. Always use the paths this prints
# verbatim, or pass --open to let this script open them for you.
#
# Folder resolution order:
#   1. SCREENSHOTR_DIR env var, if set
#   2. macOS `defaults read com.apple.screencapture location`
#   3. ~/Desktop  (the macOS default when no location is configured)

set -euo pipefail

N=1
OPEN=0
for arg in "$@"; do
  case "$arg" in
    --open) OPEN=1 ;;
    ''|*[!0-9]*) : ;;   # ignore non-numeric junk
    *) N="$arg" ;;
  esac
done

# Resolve the screenshot directory.
dir="${SCREENSHOTR_DIR:-}"
if [ -z "$dir" ]; then
  dir="$(defaults read com.apple.screencapture location 2>/dev/null || true)"
fi
if [ -z "$dir" ]; then
  dir="$HOME/Desktop"
fi
# Expand a leading ~ if the stored location used one.
dir="${dir/#\~/$HOME}"

if [ ! -d "$dir" ]; then
  echo "screenshotr: folder not found: $dir" >&2
  exit 1
fi

# List image files by modification time, newest first. Null-delimited so paths
# with spaces (macOS screenshots always contain spaces) survive intact.
matches="$(
  find "$dir" -maxdepth 1 -type f \
    \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \
       -o -iname '*.gif' -o -iname '*.heic' -o -iname '*.webp' \) \
    -print0 2>/dev/null \
  | xargs -0 stat -f '%m%t%N' 2>/dev/null \
  | sort -rn \
  | head -n "$N" \
  | cut -f2-
)"

if [ -z "$matches" ]; then
  echo "screenshotr: no images found in $dir" >&2
  exit 2
fi

printf '%s\n' "$matches"

if [ "$OPEN" -eq 1 ]; then
  # Open each matched path in the default viewer. Read with -d '' so paths
  # containing spaces / narrow no-break spaces survive intact.
  while IFS= read -r p; do
    [ -n "$p" ] && /usr/bin/open "$p" 2>/dev/null || true
  done <<< "$matches"
fi
