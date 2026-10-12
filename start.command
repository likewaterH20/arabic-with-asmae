#!/bin/zsh
# Double-click to start the app. Closes when you close this window.
cd "$(dirname "$0")"
open "http://localhost:8765" &
sleep 0.6
python3 serve.py 8765
