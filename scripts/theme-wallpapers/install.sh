#!/bin/bash
# Install generated 4K wallpapers into public/lite-bg (shared by LITE + PRO).
# Usage: ./install.sh <dir-with-downloaded-images>
#   Input files must be named <id>.<ext> per manifest.json (e.g. p-comic.png).
#   Output: 3840w JPEG (quality 78, target <= 1.5MB) as public/lite-bg/<id>.jpg
# After install: bump the ?v= in lite-backdrops.js bgAsset() (immutable CDN cache!)
set -e
SRC="${1:?usage: install.sh <dir>}"
DST="$(cd "$(dirname "$0")/../.." && pwd)/apps/research/public/lite-bg"
for f in "$SRC"/*.{png,jpg,jpeg,webp}; do
  [ -e "$f" ] || continue
  id=$(basename "$f" | sed 's/\.[^.]*$//')
  out="$DST/$id.jpg"
  sips -Z 3840 -s format jpeg -s formatOptions 78 "$f" --out "$out" >/dev/null
  sz=$(stat -f%z "$out")
  if [ "$sz" -gt 1500000 ]; then
    sips -s format jpeg -s formatOptions 65 "$out" --out "$out" >/dev/null
    sz=$(stat -f%z "$out")
  fi
  echo "$id.jpg -> $((sz/1024))KB"
done
echo "DONE. Now bump ?v= in lite-backdrops.js (bgAsset) or clients keep year-cached old pixels."
