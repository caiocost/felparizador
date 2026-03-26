/** @typedef {{ id: string; path: string; name: string }} QueuedFile */

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const queueList = document.getElementById("queueList");
const queueCount = document.getElementById("queueCount");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("previewEmpty");
const encodeBtn = document.getElementById("encodeBtn");
const clearBtn = document.getElementById("clearBtn");
const logEl = document.getElementById("log");
const ceilingMiB = document.getElementById("ceilingMiB");
const noAudio = document.getElementById("noAudio");
const audioKbps = document.getElementById("audioKbps");
const outputDir = document.getElementById("outputDir");
const pickDir = document.getElementById("pickDir");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const progressTrack = document.getElementById("progressTrack");

/** @type {QueuedFile[]} */
let queue = [];
let previewObjectUrl = null;
let batchTotalFiles = 0;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {string} inputPath
 * @param {string} outputDirVal
 */
function computeOutputPath(inputPath, outputDirVal) {
  const base = inputPath.replace(/^.*[/\\]/, "");
  const stem = base.replace(/\.[^.]+$/i, "");
  const outName = `${stem}_discord.mp4`;
  const trimmed = outputDirVal?.trim();
  if (trimmed) {
    const sep = trimmed.includes("\\") ? "\\" : "/";
    return `${trimmed.replace(/[/\\]+$/, "")}${sep}${outName}`;
  }
  const m = inputPath.match(/^(.*)[/\\]/);
  if (m) return `${m[1]}${inputPath.includes("\\") ? "\\" : "/"}${outName}`;
  return outName;
}

/**
 * @param {number} fileIndex
 * @param {number} total
 * @param {'pass1' | 'pass2'} phase
 * @param {number | null | undefined} pass2Pct
 */
function computeOverallPercent(fileIndex, total, phase, pass2Pct) {
  if (total <= 0) return 0;
  const slot = 100 / total;
  let p = fileIndex * slot;
  if (phase === "pass1") {
    p += slot * 0.25;
  } else {
    const pct = pass2Pct == null ? 0 : pass2Pct;
    p += slot * 0.5 + (pct / 100) * slot * 0.5;
  }
  return Math.min(100, p);
}

/**
 * @param {number} pct
 */
function setProgressBar(pct) {
  const v = Math.min(100, Math.max(0, pct));
  progressFill.style.width = `${v}%`;
  progressLabel.textContent = `${Math.round(v)}%`;
  progressTrack.setAttribute("aria-valuenow", String(Math.round(v)));
}

/**
 * @param {File[]} files
 */
function addFilesFromFileList(files) {
  const api = window.electronAPI;
  if (!api) return;

  for (const file of files) {
    let p;
    try {
      p = api.getPathForFile(file);
    } catch {
      continue;
    }
    const name = file.name || p.replace(/^.*[/\\]/, "");
    if (queue.some((q) => q.path === p)) continue;
    queue.push({ id: uid(), path: p, name });

    if (!preview.src && file.type.startsWith("video/")) {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(file);
      preview.src = previewObjectUrl;
      previewEmpty.classList.add("hidden");
    }
  }
  renderQueue();
}

function renderQueue() {
  queueList.innerHTML = "";
  queueCount.textContent = String(queue.length);
  encodeBtn.disabled = queue.length === 0;

  for (const item of queue) {
    const li = document.createElement("li");
    li.className = "queue-item";
    li.dataset.id = item.id;

    const name = document.createElement("span");
    name.className = "queue-item__name";
    name.textContent = item.name;
    name.title = item.path;

    const st = document.createElement("span");
    st.className = "queue-item__status";
    st.textContent = "";

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "queue-item__remove";
    rm.setAttribute("aria-label", "Remover");
    rm.textContent = "✕";
    rm.addEventListener("click", () => {
      queue = queue.filter((q) => q.id !== item.id);
      renderQueue();
    });

    li.append(name, st, rm);
    queueList.appendChild(li);
  }
}

function appendLog(html) {
  const line = document.createElement("div");
  line.innerHTML = html;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dropzone--active");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dropzone--active");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dropzone--active");
  const files = Array.from(e.dataTransfer?.files ?? []);
  addFilesFromFileList(files);
});

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files ?? []);
  addFilesFromFileList(files);
  fileInput.value = "";
});

pickDir.addEventListener("click", async () => {
  const dir = await window.electronAPI.pickOutputDir();
  if (dir) outputDir.value = dir;
});

clearBtn.addEventListener("click", () => {
  queue = [];
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
  preview.removeAttribute("src");
  previewEmpty.classList.remove("hidden");
  renderQueue();
  logEl.innerHTML = "";
  progressWrap.hidden = true;
  setProgressBar(0);
});

encodeBtn.addEventListener("click", async () => {
  if (!window.electronAPI || queue.length === 0) return;

  const outDirVal = outputDir.value.trim();
  const jobs = queue.map((q) => ({
    inputPath: q.path,
    outputPath: computeOutputPath(q.path, outDirVal),
  }));

  const opts = {
    ceilingMiB: Number.parseFloat(ceilingMiB.value) || 9.8,
    forceNoAudio: noAudio.checked,
    audioBitrateKbps: Number.parseInt(audioKbps.value, 10) || 96,
  };

  encodeBtn.disabled = true;
  logEl.innerHTML = "";
  appendLog('<span class="accent">Iniciando lote…</span>');

  batchTotalFiles = jobs.length;
  progressWrap.hidden = false;
  setProgressBar(0);

  let progressHideTimer = null;

  window.electronAPI.onEncodeProgress((data) => {
    if (data.kind === "file-start") {
      batchTotalFiles = data.total;
      appendLog(
        `<span class="accent">[${data.index + 1}/${data.total}]</span> ${escapeHtml(data.inputPath)}`,
      );
      setProgressBar(
        computeOverallPercent(data.index, data.total, "pass1", null),
      );
    }
    if (data.kind === "progress") {
      const total = data.total ?? batchTotalFiles;
      setProgressBar(
        computeOverallPercent(data.index, total, data.phase, data.percent),
      );
    }
    if (data.kind === "file-done") {
      const mib = (data.sizeBytes / 1_048_576).toFixed(2);
      const warn =
        data.warnAboveTarget === true
          ? ' <span class="warn">(um pouco acima do alvo; ainda dentro da margem segura para o Discord)</span>'
          : "";
      appendLog(
        `<span class="ok">✓</span> ${escapeHtml(data.outputPath)} <span class="ok">(${mib} MiB)</span>${warn}`,
      );
    }
    if (data.kind === "file-error") {
      appendLog(`<span class="err">✗</span> ${escapeHtml(data.message)}`);
    }
    if (data.kind === "batch-done") {
      setProgressBar(100);
      appendLog('<span class="accent">Lote concluído.</span>');
      if (progressHideTimer) clearTimeout(progressHideTimer);
      progressHideTimer = setTimeout(() => {
        progressWrap.hidden = true;
        setProgressBar(0);
      }, 2500);
    }
  });

  try {
    await window.electronAPI.encodeBatch(jobs, opts);
  } catch (e) {
    appendLog(
      `<span class="err">${escapeHtml(e instanceof Error ? e.message : String(e))}</span>`,
    );
    progressWrap.hidden = true;
  } finally {
    encodeBtn.disabled = queue.length === 0;
  }
});

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

renderQueue();
