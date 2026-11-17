# V380 MVR Converter

A Windows desktop utility that converts V380 Pro `.mvr` recordings and other common camera video files to MP4. It supports selecting or dragging in several recordings and converting the queue sequentially in one run. Conversion uses FFmpeg locally; recordings are not uploaded.

## Windows use

Two Windows 10/11 x64 options are provided:

- **Installer:** run `V380-MVR-Converter-Setup-1.1.1.exe` and follow setup. It creates Start-menu and desktop shortcuts.
- **Portable:** run `V380-MVR-Converter-Portable-1.1.1.exe` directly. It does not install the app, but—as is normal for Electron portable apps—it unpacks the app into a temporary folder while running. Keep the portable file in a convenient folder or on a USB drive.

The installer is unsigned; Windows may show a SmartScreen prompt because it has no publisher certificate.

## Convert multiple files at once

Click **Browse recordings** and select multiple `.mvr`/video files using Ctrl or Shift, or drag several files into the app. The queue shows each source, output destination, and status. Click **Convert N recordings** to process them one at a time; a failure on one file does not stop the rest. By default, each MP4 is saved next to its source as `<name>_converted.mp4`. Use **Change** on a queue row to choose another output filename for that item. Existing outputs are confirmed before replacement. You can cancel the current conversion; remaining queue items stay unconverted.

For raw `.mvr` or H.264 files, the app offers a frame-rate hint for recordings with missing timing metadata. The default is 25 fps; embedded stream timing can still determine the actual playback rate. If an output plays too fast or too slowly, try the camera's recording rate.

## Recovery behavior

The app re-encodes to H.264 in an MP4 container so unusual or damaged camera files are easier to play in ordinary software. If FFmpeg can recover frames around invalid data, it keeps those frames and skips data it cannot decode. It never changes the original recording. No converter can recreate footage that is missing or unrecoverable in the source.

## Developer build

Requirements: Node.js 22 or later, npm, and Wine on Linux if building Windows binaries from Linux. From this directory run:

```sh
npm install
npm run dist:win
npm run dist:win:portable
```

The installer and portable executable are written to `release/`. On Windows, the commands can be used without Wine.

The build expects the Windows FFmpeg binary at `resources/ffmpeg/ffmpeg.exe`. Because that executable is over GitHub's 100 MB Git-file limit, it is not tracked in the repository. The **Source ZIP** asset on the latest GitHub release includes the binary; alternatively, obtain an FFmpeg Windows essentials build from gyan.dev (linked by FFmpeg's official download page) and place `ffmpeg.exe` at the expected path. FFmpeg is built under GPLv3 in that distribution; see `resources/ffmpeg/FFMPEG-NOTICE.txt` and `resources/ffmpeg/COPYING.GPLv3`.

## Project license

The converter application source is MIT-licensed; see `LICENSE`. FFmpeg is a separate third-party component and has its own license and notices.
