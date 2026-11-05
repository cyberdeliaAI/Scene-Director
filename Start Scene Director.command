#!/bin/zsh
# macOS launcher: double-click in Finder.
cd -- "$(dirname -- "$0")" || exit 1
exec python3 scene_director.py "$@"
