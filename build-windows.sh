#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f resources/ffmpeg/ffmpeg.exe ]]; then
  echo "Missing resources/ffmpeg/ffmpeg.exe. Restore the bundled FFmpeg executable before building."
  exit 1
fi
npm install
npm run dist:win
printf '\nInstaller is in the release/ folder.\n'
