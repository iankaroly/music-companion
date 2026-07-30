#!/bin/sh
# Re-render public/ icons and the share image from tools/icon.html.
#
# chrome-headless-shell rather than the Chrome app on purpose: the full app
# bounces into the macOS Dock for every screenshot, the shell does not.
set -eu

CHROME="${CHROME:-$HOME/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell}"
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../public"
SRC="file://$HERE/icon.html"

shot() { # variant, width, height, filename
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --window-size="$2,$3" --screenshot="$OUT/$4" "$SRC?v=$1" >/dev/null 2>&1
}

shot icon     512  512  icon-512.png
shot maskable 512  512  icon-maskable-512.png
shot og      1200  630  og.png

# The tile is drawn at a fixed 512, so the small one is a downscale of it
# rather than its own render — same art, no second set of proportions to keep.
cp "$OUT/icon-512.png" "$OUT/icon-180.png"
sips -Z 180 "$OUT/icon-180.png" >/dev/null

echo "wrote icon-512, icon-180, icon-maskable-512, og"
