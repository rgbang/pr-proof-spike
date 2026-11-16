#!/usr/bin/env bash
# Makes a 720p MP4 and two GIF settings from the spike video, prints sizes.
# Usage: measure.sh <input.mp4> <output-dir>
set -euo pipefail

IN="${1:?input mp4}"
OUT="${2:?output dir}"
mkdir -p "$OUT"

size() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }
report() { printf '%-28s %10d bytes (%s MB)\n' "$1" "$(size "$2")" "$(awk "BEGIN{printf \"%.2f\", $(size "$2")/1048576}")"; }

# 720p MP4
ffmpeg -y -loglevel error -i "$IN" -vf "scale=-2:720" -c:v libx264 -preset medium -crf 28 \
  -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart "$OUT/preview-720p.mp4"

# GIF setting A: 640 wide, 8 fps, 128 colours
ffmpeg -y -loglevel error -i "$IN" \
  -vf "fps=8,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  -an "$OUT/preview-a-640w-8fps.gif"

# GIF setting B: 480 wide, 6 fps, 64 colours
ffmpeg -y -loglevel error -i "$IN" \
  -vf "fps=6,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
  -an "$OUT/preview-b-480w-6fps.gif"

echo "Source:"; report "source" "$IN"
echo "Outputs:"
report "preview-720p.mp4" "$OUT/preview-720p.mp4"
report "preview-a-640w-8fps.gif" "$OUT/preview-a-640w-8fps.gif"
report "preview-b-480w-6fps.gif" "$OUT/preview-b-480w-6fps.gif"
echo "Target preview size: 8 MB"
