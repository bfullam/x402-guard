#!/usr/bin/env bash
# Render the submission images: python3 build.py, then headless Chrome screenshots each page to ../*.png
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size="$2" --screenshot="../$1.png" "file://$PWD/$1.html" >/dev/null 2>&1; }
shot logo 512,512
shot cover 1280,720
shot pay 1280,720
shot refuse 1280,720
shot ask 1280,720
shot gap 1280,720
ls -la ../*.png
