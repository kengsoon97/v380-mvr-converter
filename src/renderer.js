'use strict';

const byId = (id) => document.getElementById(id);
const ui = {
  dropZone: byId('drop-zone'), chooseFile: byId('choose-file'), queueCard: byId('queue-card'),
  queueSummary: byId('queue-summary'), queueList: byId('queue-list'), addFiles: byId('add-files'),
  clearQueue: byId('clear-queue'), quality: byId('quality'), qualityDescription: byId('quality-description'),
  inputFps: byId('input-fps'), fpsRow: byId('fps-row'), convertButton: byId('convert-button'),
  convertLabel: byId('convert-label'), cancelButton: byId('cancel-button'), progressCard: byId('progress-card'),
  statusDot: byId('status-dot'), statusTitle: byId('status-title'), progressDetail: byId('progress-detail'),
  progressFill: byId('progress-fill'), statusMessage: byId('status-message'), resultRow: byId('result-row'),
  resultName: byId('result-name'), resultSize: byId('result-size'), openFolder: byId('open-folder'),
  warningNote: byId('warning-note'), errorBanner: byId('error-banner')
};

let queue = [];
let nextItemId = 1;
let isRunning = false;
let cancelRequested = false;
let currentJobResolve = null;
let activeQueueIndex = -1;
let activeQueueTotal = 0;
let latestOutputPath = '';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatElapsed(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function pathKey(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function baseName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || filePath;
}

function clearError() {
  ui.errorBanner.textContent = '';
  ui.errorBanner.classList.add('hidden');
}

function showError(message) {
  ui.errorBanner.textContent = message;
  ui.errorBanner.classList.remove('hidden');
}

function resetProgress() {
  ui.progressCard.classList.add('hidden');
  ui.progressFill.classList.remove('indeterminate');
  ui.progressFill.style.width = '0%';
  ui.resultRow.classList.add('hidden');
  ui.warningNote.classList.add('hidden');
  ui.statusDot.className = 'status-dot';
  ui.statusTitle.textContent = 'Ready';
  ui.progressDetail.textContent = '';
  ui.statusMessage.textContent = 'Your recordings will be converted one at a time.';
}

function statusLabel(status) {
  return ({ queued: 'Queued', converting: 'Converting', done: 'Done', skipped: 'Skipped', failed: 'Failed', cancelled: 'Cancelled' })[status] || 'Queued';
}

function renderQueue() {
  const hasItems = queue.length > 0;
  ui.dropZone.classList.toggle('hidden', hasItems);
  ui.queueCard.classList.toggle('hidden', !hasItems);
  ui.fpsRow.classList.toggle('hidden', !queue.some((item) => item.rawH264));
  ui.queueList.replaceChildren();

  const doneCount = queue.filter((item) => item.status === 'done').length;
  ui.queueSummary.textContent = `${queue.length} recording${queue.length === 1 ? '' : 's'} · ${doneCount} converted`;
  ui.convertLabel.textContent = queue.length > 1 ? `Convert ${queue.length} recordings` : 'Convert to MP4';
  ui.convertButton.disabled = !hasItems || isRunning;
  ui.addFiles.disabled = isRunning;
  ui.clearQueue.disabled = isRunning;
  ui.quality.disabled = isRunning;
  ui.inputFps.disabled = isRunning;

  for (const item of queue) {
    const row = document.createElement('article');
    row.className = `queue-item status-${item.status}`;

    const source = document.createElement('div');
    source.className = 'queue-source';
    const badge = document.createElement('div');
    badge.className = 'file-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = 'VID';

    const copy = document.createElement('div');
    copy.className = 'queue-copy';
    const name = document.createElement('strong');
    name.textContent = item.name;
    name.title = item.inputPath;
    const meta = document.createElement('span');
    meta.className = 'queue-meta';
    meta.textContent = `${formatBytes(item.size)} · ${item.rawH264 ? 'Raw MVR/H.264' : 'Source recording'}`;
    const destination = document.createElement('span');
    destination.className = 'queue-destination';
    destination.textContent = `MP4: ${baseName(item.outputPath)}`;
    destination.title = item.outputPath;
    copy.append(name, meta, destination);
    if (item.message) {
      const message = document.createElement('span');
      message.className = 'queue-message';
      message.textContent = item.message;
      copy.append(message);
    }
    source.append(badge, copy);

    const controls = document.createElement('div');
    controls.className = 'queue-controls';
    const status = document.createElement('span');
    status.className = `queue-status status-pill-${item.status}`;
    status.textContent = statusLabel(item.status);
    controls.append(status);

    const buttons = document.createElement('div');
    buttons.className = 'queue-buttons';
    const change = document.createElement('button');
    change.className = 'queue-action';
    change.type = 'button';
    change.textContent = 'Change';
    change.title = 'Choose this recording’s MP4 destination';
    change.disabled = isRunning;
    change.addEventListener('click', () => changeOutput(item));
    buttons.append(change);

    if (item.status === 'done') {
      const open = document.createElement('button');
      open.className = 'queue-action';
      open.type = 'button';
      open.textContent = 'Open folder';
      open.addEventListener('click', () => window.converter.openOutputFolder(item.outputPath));
      buttons.append(open);
    }

    const remove = document.createElement('button');
    remove.className = 'icon-button queue-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove from queue';
    remove.setAttribute('aria-label', `Remove ${item.name} from queue`);
    remove.disabled = isRunning;
    remove.addEventListener('click', () => removeItem(item.id));
    buttons.append(remove);

    controls.append(buttons);
    row.append(source, controls);
    ui.queueList.append(row);
  }
}

async function addFiles(paths) {
  if (isRunning) return;
  clearError();
  const candidates = [...new Set((Array.isArray(paths) ? paths : [paths])
    .filter((filePath) => typeof filePath === 'string' && filePath.trim()))];
  if (!candidates.length) return;

  let added = 0;
  let duplicates = 0;
  const failed = [];
  for (const filePath of candidates) {
    if (queue.some((item) => pathKey(item.inputPath) === pathKey(filePath))) {
      duplicates += 1;
      continue;
    }
    const info = await window.converter.getFileInfo(filePath);
    if (!info) {
      failed.push(baseName(filePath));
      continue;
    }

    const suggested = await window.converter.suggestOutputPath(info.path);
    const reserved = new Set(queue.map((item) => pathKey(item.outputPath)));
    const root = suggested.replace(/\.mp4$/i, '');
    let outputPath = suggested;
    let suffix = 2;
    while (reserved.has(pathKey(outputPath))) outputPath = `${root}_${suffix++}.mp4`;

    queue.push({
      id: nextItemId++, inputPath: info.path, name: info.name, size: info.size,
      rawH264: Boolean(info.rawH264), outputPath, status: 'queued', message: '',
      warningCount: 0, outputSize: 0
    });
    added += 1;
  }

  if (added) {
    latestOutputPath = '';
    resetProgress();
    renderQueue();
  }
  if (failed.length) showError(`Could not read ${failed.length} file${failed.length === 1 ? '' : 's'}: ${failed.join(', ')}`);
  else if (duplicates && !added) showError('Those recordings are already in the queue.');
  else if (duplicates) showError(`${duplicates} duplicate file${duplicates === 1 ? ' was' : 's were'} already in the queue and skipped.`);
}

async function browseFiles() {
  try {
    const paths = await window.converter.openInputFiles();
    if (paths && paths.length) await addFiles(paths);
  } catch (error) {
    showError(`Could not open the file picker: ${error.message}`);
  }
}

async function changeOutput(item) {
  if (isRunning) return;
  const chosen = await window.converter.chooseOutputFile(item.outputPath);
  if (!chosen) return;
  const outputPath = chosen.toLowerCase().endsWith('.mp4') ? chosen : `${chosen}.mp4`;
  if (queue.some((other) => other.id !== item.id && pathKey(other.outputPath) === pathKey(outputPath))) {
    showError('Another recording in the queue is already set to save to that filename.');
    return;
  }
  item.outputPath = outputPath;
  clearError();
  renderQueue();
}

function removeItem(id) {
  if (isRunning) return;
  queue = queue.filter((item) => item.id !== id);
  latestOutputPath = '';
  resetProgress();
  renderQueue();
}

function clearQueue() {
  if (isRunning) return;
  queue = [];
  latestOutputPath = '';
  resetProgress();
  clearError();
  renderQueue();
}

async function handleDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files || []);
  const paths = files.map((file) => window.converter.getDroppedFilePath(file)).filter(Boolean);
  if (paths.length) await addFiles(paths);
}

for (const target of [ui.dropZone, ui.queueCard]) {
  target.addEventListener('dragover', (event) => {
    event.preventDefault();
    target.classList.add('drag-over');
  });
  target.addEventListener('dragleave', (event) => {
    if (!target.contains(event.relatedTarget)) target.classList.remove('drag-over');
  });
  target.addEventListener('drop', handleDrop);
}

ui.chooseFile.addEventListener('click', browseFiles);
ui.addFiles.addEventListener('click', browseFiles);
ui.clearQueue.addEventListener('click', clearQueue);
ui.quality.addEventListener('change', () => {
  const descriptions = {
    '22': 'Sharper detail with a larger output file.',
    '25': 'Good quality with a balanced file size.',
    '28': 'Smaller output file; some fine detail may be lost.'
  };
  ui.qualityDescription.textContent = descriptions[ui.quality.value] || descriptions['25'];
});

async function convertQueue() {
  if (isRunning || queue.length === 0) return;
  clearError();
  resetProgress();
  isRunning = true;
  cancelRequested = false;
  latestOutputPath = '';
  const total = queue.length;
  let converted = 0;
  let failed = 0;
  let skipped = 0;
  let warnings = 0;
  let cancelled = false;
  let lastOutputSize = 0;
  queue.forEach((item) => { item.status = 'queued'; item.message = ''; item.warningCount = 0; });

  ui.progressCard.classList.remove('hidden');
  ui.progressFill.classList.add('indeterminate');
  ui.statusDot.className = 'status-dot running';
  ui.cancelButton.classList.remove('hidden');
  ui.cancelButton.disabled = false;
  ui.cancelButton.textContent = 'Cancel batch';
  renderQueue();

  for (let index = 0; index < total; index += 1) {
    if (cancelRequested) { cancelled = true; break; }
    const item = queue[index];
    activeQueueIndex = index;
    activeQueueTotal = total;
    item.status = 'converting';
    item.message = '';
    renderQueue();
    ui.statusTitle.textContent = `Converting ${index + 1} of ${total}`;
    ui.statusMessage.textContent = `${item.name} is converting. The next queued recording will start automatically.`;
    ui.progressDetail.textContent = `File ${index + 1} of ${total}`;

    let resolveTerminal;
    const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
    currentJobResolve = resolveTerminal;
    let startResult;
    try {
      startResult = await window.converter.startConversion({
        inputPath: item.inputPath,
        outputPath: item.outputPath,
        quality: Number(ui.quality.value),
        inputFps: Number(ui.inputFps.value)
      });
    } catch (error) {
      startResult = { ok: false, message: error.message };
    }

    if (!startResult || !startResult.ok) {
      currentJobResolve = null;
      if (cancelRequested) {
        item.status = 'cancelled';
        item.message = 'Cancelled before this recording started.';
        cancelled = true;
        renderQueue();
        break;
      }
      item.status = /Conversion cancelled/i.test(startResult && startResult.message || '') ? 'skipped' : 'failed';
      item.message = startResult && startResult.message ? startResult.message : 'Could not start this conversion.';
      if (item.status === 'skipped') skipped += 1;
      else failed += 1;
      renderQueue();
      continue;
    }

    const result = await terminal;
    currentJobResolve = null;
    if (result && result.state === 'completed') {
      item.status = 'done';
      item.outputSize = result.outputSize;
      item.warningCount = result.warningCount || 0;
      item.message = item.warningCount ? `${item.warningCount} source warning${item.warningCount === 1 ? '' : 's'}; check the MP4.` : '';
      latestOutputPath = result.outputPath;
      lastOutputSize = result.outputSize;
      warnings += item.warningCount;
      converted += 1;
    } else if (result && result.state === 'cancelled') {
      item.status = 'cancelled';
      item.message = result.message || 'Conversion cancelled.';
      cancelled = true;
    } else {
      item.status = 'failed';
      item.message = result && result.message ? result.message : 'FFmpeg could not convert this recording.';
      failed += 1;
    }
    renderQueue();
    if (cancelled) break;
  }

  isRunning = false;
  currentJobResolve = null;
  ui.cancelButton.disabled = false;
  ui.cancelButton.textContent = 'Cancel batch';
  ui.cancelButton.classList.add('hidden');
  ui.progressFill.classList.remove('indeterminate');
  ui.progressFill.style.width = cancelled ? `${Math.round((converted / total) * 100)}%` : '100%';
  ui.statusDot.className = failed > 0 && converted === 0 ? 'status-dot error' : 'status-dot done';
  ui.statusTitle.textContent = cancelled ? 'Batch cancelled' : 'Batch finished';
  const stillQueued = queue.filter((item) => item.status === 'queued').length;
  ui.statusMessage.textContent = `${converted} converted · ${failed} failed · ${skipped} skipped${cancelled ? ` · ${stillQueued} remain queued` : ''}.`;
  ui.progressDetail.textContent = `${total} selected`;
  ui.warningNote.classList.toggle('hidden', warnings === 0);
  if (latestOutputPath) {
    ui.resultName.textContent = baseName(latestOutputPath);
    ui.resultSize.textContent = formatBytes(lastOutputSize);
    ui.resultRow.classList.remove('hidden');
  }
  renderQueue();
}

ui.convertButton.addEventListener('click', convertQueue);
ui.cancelButton.addEventListener('click', async () => {
  if (!isRunning) return;
  cancelRequested = true;
  ui.cancelButton.disabled = true;
  ui.cancelButton.textContent = 'Cancelling…';
  await window.converter.cancelConversion();
});
ui.openFolder.addEventListener('click', async () => {
  if (latestOutputPath) await window.converter.openOutputFolder(latestOutputPath);
});

window.converter.onProgress((progress) => {
  if (progress.state === 'running') {
    const filePart = activeQueueIndex >= 0 ? `File ${activeQueueIndex + 1} of ${activeQueueTotal} · ` : '';
    ui.progressDetail.textContent = `${filePart}Frame ${progress.frame.toLocaleString()} · ${formatElapsed(progress.elapsedSeconds)} elapsed${progress.speed ? ` · ${progress.speed}` : ''}`;
    return;
  }
  if (currentJobResolve) currentJobResolve(progress);
});

renderQueue();
