'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;
let activeJob = null;

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 820,
    minHeight: 700,
    minWidth: 760,
    show: false,
    title: 'V380 MVR Converter',
    backgroundColor: '#f4f6fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getFfmpegPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  }
  if (process.platform === 'win32') {
    return path.join(__dirname, '..', 'resources', 'ffmpeg', 'ffmpeg.exe');
  }
  return 'ffmpeg';
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('conversion:progress', payload);
  }
}

function isStandardContainer(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);
    return header.subarray(0, 4).toString('ascii') === 'RIFF'
      || header.subarray(4, 8).toString('ascii') === 'ftyp'
      || (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3)
      || header.subarray(0, 4).toString('ascii') === 'OggS'
      || header.subarray(0, 3).toString('ascii') === 'FLV';
  } catch {
    return false;
  }
}

function rawH264Likely(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mvr', '.h264', '.264', '.264x'].includes(ext) && !isStandardContainer(filePath);
}

function removePartial(outputPath) {
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch { /* Do not replace the original FFmpeg error with cleanup noise. */ }
}

function commitOutput(tempPath, outputPath) {
  const backupPath = `${outputPath}.backup-${Date.now()}`;
  let movedExisting = false;
  try {
    if (fs.existsSync(outputPath)) {
      fs.renameSync(outputPath, backupPath);
      movedExisting = true;
    }
    fs.renameSync(tempPath, outputPath);
    if (movedExisting) fs.unlinkSync(backupPath);
  } catch (error) {
    if (movedExisting && fs.existsSync(backupPath) && !fs.existsSync(outputPath)) {
      try { fs.renameSync(backupPath, outputPath); } catch { /* Keep the backup if restore fails. */ }
    }
    throw error;
  }
}

ipcMain.handle('dialog:open-input', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose V380 recordings',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Camera recordings', extensions: ['mvr', 'h264', '264', 'avi', 'mp4', 'mov', 'mkv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:save-output', async (_event, suggestedPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save converted MP4',
    defaultPath: suggestedPath,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('file:info', async (_event, inputPath) => {
  if (typeof inputPath !== 'string' || !fs.existsSync(inputPath)) return null;
  const stat = fs.statSync(inputPath);
  return { name: path.basename(inputPath), size: stat.size, path: inputPath, rawH264: rawH264Likely(inputPath) };
});

ipcMain.handle('path:suggest-output', async (_event, inputPath) => {
  if (typeof inputPath !== 'string') return '';
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}_converted.mp4`);
});

ipcMain.handle('conversion:start', async (_event, request) => {
  if (activeJob) return { ok: false, message: 'A conversion is already running.' };
  const inputPath = request && request.inputPath;
  const outputPath = request && request.outputPath;
  const crfValue = Number(request && request.quality);
  const crf = [22, 25, 28].includes(crfValue) ? crfValue : 25;
  const fpsValue = Number(request && request.inputFps);
  const inputFps = [10, 12, 14, 15, 20, 24, 25, 30].includes(fpsValue) ? fpsValue : 25;

  if (typeof inputPath !== 'string' || !fs.existsSync(inputPath)) {
    return { ok: false, message: 'Select an existing recording file first.' };
  }
  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    return { ok: false, message: 'Choose where to save the MP4 file.' };
  }
  if (path.resolve(inputPath).toLowerCase() === path.resolve(outputPath).toLowerCase()) {
    return { ok: false, message: 'The output file must be different from the source file.' };
  }
  if (path.extname(outputPath).toLowerCase() !== '.mp4') {
    return { ok: false, message: 'The output filename must end in .mp4.' };
  }

  if (fs.existsSync(outputPath)) {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Replace file', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Replace existing MP4?',
      message: 'A file with that name already exists.',
      detail: 'Replace it with the new conversion?'
    });
    if (answer.response !== 0) return { ok: false, message: 'Conversion cancelled; the existing file was kept.' };
  }

  const parsedOutput = path.parse(outputPath);
  const tempOutputPath = path.join(parsedOutput.dir, `.${parsedOutput.name}.in-progress-${process.pid}-${Date.now()}.mp4`);
  const ffmpeg = getFfmpegPath();
  if (app.isPackaged && !fs.existsSync(ffmpeg)) {
    return { ok: false, message: 'The bundled FFmpeg component is missing. Reinstall the converter.' };
  }

  const args = [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'warning',
    '-stats_period', '0.5', '-progress', 'pipe:1',
    '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err'
  ];

  // Raw H.264/MVR can have no container timestamps. The selected rate is a
  // user-adjustable hint; FFmpeg can still honor timing embedded in the stream.
  // Force the H.264 demuxer: some V380 .mvr headers are misdetected by FFmpeg
  // as low-confidence ea_cdata, which does not accept the framerate option.
  if (rawH264Likely(inputPath)) args.push('-f', 'h264', '-framerate', String(inputFps));
  args.push(
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
    tempOutputPath
  );

  let child;
  try {
    child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return { ok: false, message: `Could not start FFmpeg: ${error.message}` };
  }

  const startedAt = Date.now();
  let stdoutBuffer = '';
  let stderrText = '';
  let progressFields = {};
  let wasCancelled = false;
  activeJob = { child, outputPath, tempOutputPath, cancel: () => { wasCancelled = true; child.kill(); } };

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const sep = line.indexOf('=');
      if (sep < 1) continue;
      progressFields[line.slice(0, sep)] = line.slice(sep + 1);
      if (line.startsWith('progress=')) {
        sendProgress({
          state: 'running',
          frame: Number(progressFields.frame || 0),
          time: progressFields.out_time || '00:00:00.000',
          speed: progressFields.speed || '',
          elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000)
        });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrText += chunk.toString('utf8');
    if (stderrText.length > 16000) stderrText = stderrText.slice(-16000);
  });

  child.on('error', (error) => {
    if (activeJob && activeJob.child === child) activeJob = null;
    removePartial(tempOutputPath);
    sendProgress({ state: 'failed', message: `FFmpeg could not run: ${error.message}` });
  });

  child.on('close', (code) => {
    if (activeJob && activeJob.child === child) activeJob = null;
    if (wasCancelled) {
      removePartial(tempOutputPath);
      sendProgress({ state: 'cancelled', message: 'Conversion cancelled. The unfinished MP4 was removed.' });
      return;
    }
    if (code === 0 && fs.existsSync(tempOutputPath) && fs.statSync(tempOutputPath).size > 0) {
      try {
        commitOutput(tempOutputPath, outputPath);
      } catch (error) {
        removePartial(tempOutputPath);
        sendProgress({ state: 'failed', message: `The MP4 was created but could not be moved into place: ${error.message}` });
        return;
      }
      const stat = fs.statSync(outputPath);
      const warningCount = (stderrText.match(/\b(warning|error|invalid nal|corrupt)\b/gi) || []).length;
      sendProgress({
        state: 'completed',
        outputPath,
        outputName: path.basename(outputPath),
        outputSize: stat.size,
        warningCount
      });
    } else {
      removePartial(tempOutputPath);
      const detail = stderrText.trim().split(/\r?\n/).slice(-5).join('\n');
      sendProgress({
        state: 'failed',
        message: detail || `FFmpeg stopped with code ${code}. Check that this file contains a supported video stream.`
      });
    }
  });

  return { ok: true };
});

ipcMain.handle('conversion:cancel', async () => {
  if (!activeJob) return false;
  activeJob.cancel();
  return true;
});

ipcMain.handle('path:open-folder', async (_event, filePath) => {
  if (typeof filePath !== 'string') return;
  const folder = path.dirname(filePath);
  if (fs.existsSync(folder)) await shell.openPath(folder);
});

app.on('before-quit', () => {
  if (activeJob) activeJob.cancel();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
