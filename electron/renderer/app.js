/**
 * @typedef {'queued' | 'working' | 'done' | 'error'} ItemState
 * @typedef {{ id: string; path: string; name: string; file: File; state: ItemState; status: string; pct: number }} QueuedFile
 */

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const queueList = document.getElementById("queueList");
const queueEmpty = document.getElementById("queueEmpty");
const queueCount = document.getElementById("queueCount");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("previewEmpty");
const previewName = document.getElementById("previewName");
const encodeBtn = document.getElementById("encodeBtn");
const encodeLabel = document.getElementById("encodeLabel");
const clearBtn = document.getElementById("clearBtn");
const logEl = document.getElementById("log");
const ceilingMiB = document.getElementById("ceilingMiB");
const ceilingField = document.getElementById("ceilingField");
const presets = document.getElementById("presets");
const fitCeiling = document.getElementById("fitCeiling");
const noCeiling = document.getElementById("noCeiling");
const crf = document.getElementById("crf");
const crfRange = document.getElementById("crfRange");
const crfField = document.getElementById("crfField");
const noAudio = document.getElementById("noAudio");
const audioKbps = document.getElementById("audioKbps");
const audioField = document.getElementById("audioField");
const outputDir = document.getElementById("outputDir");
const pickDir = document.getElementById("pickDir");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const progressStep = document.getElementById("progressStep");
const loadingScreen = document.getElementById("loadingScreen");
const loadingStage = document.getElementById("loadingStage");
const loadingFelpa = document.getElementById("loadingFelpa");
const loadingTitle = document.getElementById("loadingTitle");
const loadingSub = document.getElementById("loadingSub");
const loadingPhase = document.getElementById("loadingPhase");
const ringFill = document.getElementById("ringFill");
const tipText = document.getElementById("tipText");
const loadingSpeech = document.getElementById("loadingSpeech");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const appVersion = document.getElementById("appVersion");
const updateBtn = document.getElementById("updateBtn");
const updateLabel = document.getElementById("updateLabel");

/** @type {QueuedFile[]} */
let queue = [];
let previewObjectUrl = null;
/** @type {string | null} */
let previewId = null;
let batchTotalFiles = 0;
let encoding = false;
let paused = false;
/** Set once stop is confirmed, so late progress events don't repaint a running state. */
let stopping = false;

const IDLE_LABEL = "Felparizar fila";

const TIPS = [
  "Vocês é que estão diminuindo esse arquivo",
  "Eu sou o que mais diminui arquivos",
];
const FLY_COLORS = ["var(--pink)", "var(--violet)", "var(--cyan)", "var(--lime)", "var(--orange)"];

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
 * Progress of the current file alone, 0–100.
 * @param {'probe' | 'pass1' | 'pass2' | 'single'} phase
 * @param {number | null | undefined} pct
 */
function computeFilePercent(phase, pct) {
  const p = pct == null ? 0 : pct;
  if (phase === "probe") return 0;
  // Single-pass has no first pass to account for, so it owns the whole slot.
  if (phase === "single") return p;
  if (phase === "pass1") return p / 2;
  return 50 + p / 2;
}

const PHASE_TEXT = {
  probe: "lendo o vídeo",
  pass1: "passo 1 de 2 · analisando",
  pass2: "passo 2 de 2 · comprimindo",
  single: "comprimindo",
};

/** @param {number} s */
function fmtEta(s) {
  const t = Math.round(s);
  if (t < 60) return `~${t}s`;
  const m = Math.floor(t / 60);
  return `~${m}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * "passo 1 de 2 · analisando · 3.7x · ~1:20" — what ffmpeg is doing right now, so a
 * long pass reads as busy rather than stuck.
 * @param {{ phase: keyof typeof PHASE_TEXT, speed?: number, etaSeconds?: number }} data
 */
function describePhase(data) {
  const parts = [PHASE_TEXT[data.phase] ?? data.phase];
  if (typeof data.speed === "number") parts.push(`${data.speed.toFixed(1)}x`);
  if (typeof data.etaSeconds === "number") parts.push(`${fmtEta(data.etaSeconds)} nesse passo`);
  return parts.join(" · ");
}

/**
 * @param {number} fileIndex
 * @param {number} total
 * @param {'probe' | 'pass1' | 'pass2' | 'single'} phase
 * @param {number | null | undefined} pct
 */
function computeOverallPercent(fileIndex, total, phase, pct) {
  if (total <= 0) return 0;
  const slot = 100 / total;
  return Math.min(100, fileIndex * slot + (computeFilePercent(phase, pct) / 100) * slot);
}

/**
 * @param {number} pct
 */
function setProgressBar(pct) {
  const v = Math.min(100, Math.max(0, pct));
  progressFill.style.width = `${v}%`;
  progressLabel.textContent = `${Math.round(v)}%`;
  progressWrap.setAttribute("aria-valuenow", String(Math.round(v)));
  ringFill.style.strokeDashoffset = String(100 - v);
  if (encoding) {
    encodeLabel.textContent = `${paused ? "Pausado" : "Felparizando"} · ${Math.round(v)}%`;
  }
}

/**
 * @param {QueuedFile} item
 */
function showPreview(item) {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = URL.createObjectURL(item.file);
  preview.src = previewObjectUrl;
  previewId = item.id;
  previewName.textContent = item.name;
  previewEmpty.classList.add("hidden");
  for (const li of queueList.children) {
    li.classList.toggle("is-selected", li.dataset.id === item.id);
  }
}

function clearPreview() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
  previewId = null;
  preview.removeAttribute("src");
  preview.load();
  previewName.textContent = "";
  previewEmpty.classList.remove("hidden");
}

/**
 * @param {File[]} files
 */
function addFilesFromFileList(files) {
  const api = window.electronAPI;
  if (!api || encoding) return;

  const before = queue.length;
  for (const file of files) {
    let p;
    try {
      p = api.getPathForFile(file);
    } catch {
      continue;
    }
    const name = file.name || p.replace(/^.*[/\\]/, "");
    if (queue.some((q) => q.path === p)) continue;
    queue.push({ id: uid(), path: p, name, file, state: "queued", status: "", pct: 0 });
  }
  renderQueue();

  if (!previewId) {
    const firstVideo = queue.find((q) => q.file.type.startsWith("video/"));
    if (firstVideo) showPreview(firstVideo);
  }
  if (queue.length > before) {
    queueCount.classList.remove("is-bump");
    void queueCount.offsetWidth;
    queueCount.classList.add("is-bump");
  }
}

function renderQueue() {
  queueList.innerHTML = "";
  queueCount.textContent = String(queue.length);
  queueEmpty.hidden = queue.length > 0;
  queueList.hidden = queue.length === 0;
  encodeBtn.disabled = encoding || queue.length === 0;
  clearBtn.disabled = encoding || queue.length === 0;

  queue.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "queue-item";
    li.dataset.id = item.id;
    li.dataset.state = item.state;
    li.classList.toggle("is-selected", item.id === previewId);
    li.title = item.path;

    const idx = document.createElement("span");
    idx.className = "queue-item__idx";
    idx.textContent = String(i + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "queue-item__name";
    name.textContent = item.name;

    const st = document.createElement("span");
    st.className = "queue-item__status";
    st.textContent = item.status;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "queue-item__remove";
    rm.setAttribute("aria-label", `Remover ${item.name}`);
    rm.textContent = "✕";
    rm.disabled = encoding;
    rm.addEventListener("click", (e) => {
      e.stopPropagation();
      queue = queue.filter((q) => q.id !== item.id);
      if (previewId === item.id) {
        clearPreview();
        const next = queue.find((q) => q.file.type.startsWith("video/"));
        if (next) showPreview(next);
      }
      renderQueue();
    });

    const bar = document.createElement("span");
    bar.className = "queue-item__bar";
    bar.style.width = `${item.pct}%`;

    li.addEventListener("click", () => showPreview(item));
    li.append(idx, name, st, rm, bar);
    queueList.appendChild(li);
  });
}

/**
 * Updates one row in place — re-rendering the whole list on every progress tick would
 * restart the entry animation and flicker.
 * @param {QueuedFile | undefined} item
 * @param {Partial<Pick<QueuedFile, 'state' | 'status' | 'pct'>>} patch
 */
function updateItem(item, patch) {
  if (!item) return;
  Object.assign(item, patch);
  const li = queueList.querySelector(`[data-id="${item.id}"]`);
  if (!li) return;
  li.dataset.state = item.state;
  li.querySelector(".queue-item__status").textContent = item.status;
  li.querySelector(".queue-item__bar").style.width = `${item.pct}%`;
  if (patch.state === "working") li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function appendLog(html) {
  const line = document.createElement("div");
  line.innerHTML = html;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function resetLog() {
  logEl.innerHTML = '<div class="log__idle">Aguardando o próximo lote…</div>';
}

function setEncoding(on) {
  encoding = on;
  document.body.classList.toggle("is-encoding", on);
  encodeBtn.classList.toggle("is-busy", on);
  if (!on) {
    encodeLabel.textContent = IDLE_LABEL;
    setPaused(false);
    stopping = false;
    disarmStop();
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
  }
  syncUpdateBtn();
  renderQueue();
}


/* ─── Loading screen: tips like a game loading screen, Felpa eating megabytes ─── */

let tipIndex = Math.floor(Math.random() * TIPS.length);
let tipTimer = null;
let typeTimer = null;
let flyTimer = null;
let loadingHideTimer = null;

function typeTip(text) {
  clearInterval(typeTimer);
  tipText.textContent = "";
  tipText.className = "loading__bubble is-typing";
  // Replay the pop-in so each line reads as a new thing he says.
  tipText.style.animation = "none";
  void tipText.offsetWidth;
  tipText.style.animation = "";
  loadingSpeech.classList.add("is-talking");
  let i = 0;
  typeTimer = setInterval(() => {
    if (paused) return;
    tipText.textContent = text.slice(0, ++i);
    if (i >= text.length) {
      clearInterval(typeTimer);
      tipText.className = "loading__bubble";
      loadingSpeech.classList.remove("is-talking");
    }
  }, 38);
}

function nextTip() {
  if (paused) return;
  tipIndex = (tipIndex + 1) % TIPS.length;
  typeTip(TIPS[tipIndex]);
}

function spawnFly() {
  const r = loadingStage.offsetHeight * (0.75 + Math.random() * 0.35);
  const a = Math.random() * Math.PI * 2;
  const el = document.createElement("span");
  el.className = "loading__fly";
  el.textContent = `${(Math.random() * 180 + 12).toFixed(0)} MB`;
  el.style.setProperty("--x", `${Math.cos(a) * r}px`);
  el.style.setProperty("--y", `${Math.sin(a) * r}px`);
  el.style.setProperty("--r", `${(Math.random() * 60 - 30).toFixed(0)}deg`);
  el.style.setProperty("--c", FLY_COLORS[Math.floor(Math.random() * FLY_COLORS.length)]);
  el.addEventListener("animationend", () => el.remove());
  loadingStage.appendChild(el);
}

/** @param {string} text @param {boolean} [isErr] */
function burst(text, isErr = false) {
  const el = document.createElement("span");
  el.className = `loading__burst${isErr ? " is-err" : ""}`;
  el.textContent = text;
  el.addEventListener("animationend", () => el.remove());
  loadingStage.appendChild(el);
  loadingFelpa.classList.remove("is-pop");
  void loadingFelpa.offsetWidth;
  loadingFelpa.classList.add("is-pop");
  loadingFelpa.addEventListener(
    "animationend",
    () => loadingFelpa.classList.remove("is-pop"),
    { once: true },
  );
}

function rainFelpas() {
  for (let i = 0; i < 22; i++) {
    const img = document.createElement("img");
    img.src = "./felpa.png";
    img.alt = "";
    img.className = "loading__rain";
    img.style.left = `${Math.random() * 96}%`;
    img.style.setProperty("--s", `${18 + Math.random() * 30}px`);
    img.style.setProperty("--d", `${1.6 + Math.random() * 1.6}s`);
    img.style.setProperty("--delay", `${Math.random() * 0.9}s`);
    img.style.setProperty("--r", `${(Math.random() * 720 - 360).toFixed(0)}deg`);
    img.addEventListener("animationend", () => img.remove());
    loadingScreen.appendChild(img);
  }
}

function startLoading() {
  clearTimeout(loadingHideTimer);
  loadingScreen.hidden = false;
  loadingScreen.classList.remove("is-done");
  loadingTitle.textContent = "Felparizando…";
  loadingSub.textContent = "";
  loadingPhase.textContent = "";
  typeTip(TIPS[tipIndex]);
  clearInterval(tipTimer);
  tipTimer = setInterval(nextTip, 4500);
  clearInterval(flyTimer);
  flyTimer = setInterval(spawnFly, 650);
}

/** @param {string} title @param {string} sub */
function finishLoading(title, sub) {
  clearInterval(flyTimer);
  clearInterval(tipTimer);
  loadingScreen.classList.add("is-done");
  loadingTitle.textContent = title;
  loadingSub.textContent = sub;
  loadingPhase.textContent = "";
  rainFelpas();
  loadingHideTimer = setTimeout(hideLoading, 7000);
}

function hideLoading() {
  clearInterval(flyTimer);
  clearInterval(tipTimer);
  clearInterval(typeTimer);
  clearTimeout(loadingHideTimer);
  loadingScreen.hidden = true;
  for (const el of loadingScreen.querySelectorAll(".loading__fly, .loading__burst, .loading__rain")) {
    el.remove();
  }
}

// Clicking the finished screen dismisses it early; while encoding it stays put.
loadingScreen.addEventListener("click", () => {
  if (!encoding) hideLoading();
});

/** @param {number} bytes */
function fmtMiB(bytes) {
  const mib = bytes / 1_048_576;
  return mib >= 100 ? `${mib.toFixed(0)} MiB` : `${mib.toFixed(1)} MiB`;
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

// Dropping anywhere on the window works; the ring lights up while dragging over it.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dropzone.classList.add("dropzone--active");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove("dropzone--active");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove("dropzone--active");
  addFilesFromFileList(Array.from(e.dataTransfer?.files ?? []));
});

fileInput.addEventListener("change", () => {
  addFilesFromFileList(Array.from(fileInput.files ?? []));
  fileInput.value = "";
});

// Sem teto: o limite alvo deixa de valer e a qualidade passa a ser escolhida pelo CRF.
function syncCeilingControls() {
  const off = noCeiling.checked;
  crfField.hidden = !off;
  ceilingField.hidden = off;
  ceilingMiB.disabled = off;
}
fitCeiling.addEventListener("change", syncCeilingControls);
noCeiling.addEventListener("change", syncCeilingControls);
syncCeilingControls();

function syncPresets() {
  const v = Number.parseFloat(ceilingMiB.value);
  for (const chip of presets.querySelectorAll(".chip")) {
    chip.classList.toggle("is-on", Number.parseFloat(chip.dataset.mib) === v);
  }
}
presets.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  ceilingMiB.value = chip.dataset.mib;
  syncPresets();
});
ceilingMiB.addEventListener("input", syncPresets);
syncPresets();

crfRange.addEventListener("input", () => {
  crf.value = crfRange.value;
});
crf.addEventListener("input", () => {
  crfRange.value = crf.value;
});

function syncAudio() {
  audioKbps.disabled = noAudio.checked;
  audioField.classList.toggle("field--disabled", noAudio.checked);
}
noAudio.addEventListener("change", syncAudio);
syncAudio();

pickDir.addEventListener("click", async () => {
  const dir = await window.electronAPI.pickOutputDir();
  if (dir) outputDir.value = dir;
});

clearBtn.addEventListener("click", () => {
  if (encoding) return;
  queue = [];
  hideLoading();
  clearPreview();
  renderQueue();
  resetLog();
  progressWrap.hidden = true;
  setProgressBar(0);
});

encodeBtn.addEventListener("click", async () => {
  if (!window.electronAPI || queue.length === 0 || encoding) return;

  const outDirVal = outputDir.value.trim();
  // Snapshot: progress events refer to jobs by index, so pin index → item now.
  const batch = queue.slice();
  const jobs = batch.map((q) => ({
    inputPath: q.path,
    outputPath: computeOutputPath(q.path, outDirVal),
  }));

  const opts = {
    ceilingMiB: Number.parseFloat(ceilingMiB.value) || 9.8,
    forceNoAudio: noAudio.checked,
    audioBitrateKbps: Number.parseInt(audioKbps.value, 10) || 96,
    noCeiling: noCeiling.checked,
    crf: Number.parseInt(crf.value, 10) || 23,
  };

  for (const item of batch) Object.assign(item, { state: "queued", status: "na fila", pct: 0 });
  setEncoding(true);
  encodeBtn.classList.remove("is-done");
  logEl.innerHTML = "";
  appendLog('<span class="accent">▸ Iniciando lote…</span>');

  batchTotalFiles = jobs.length;
  progressWrap.hidden = false;
  progressStep.textContent = "Preparando…";
  setProgressBar(0);

  let progressHideTimer = null;
  let okCount = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  startLoading();

  window.electronAPI.onEncodeProgress((data) => {
    const item = batch[data.index];
    if (data.kind === "file-start") {
      batchTotalFiles = data.total;
      progressStep.textContent = `Arquivo ${data.index + 1} de ${data.total}`;
      loadingSub.textContent = `${data.index + 1}/${data.total} · ${item?.name ?? ""}`;
      updateItem(item, { state: "working", status: "analisando", pct: 2 });
      appendLog(
        `<span class="accent">[${data.index + 1}/${data.total}]</span> ${escapeHtml(data.inputPath)}`,
      );
      setProgressBar(computeOverallPercent(data.index, data.total, "probe", null));
    }
    if (data.kind === "progress") {
      if (stopping) return;
      const total = data.total ?? batchTotalFiles;
      const filePct = computeFilePercent(data.phase, data.percent);
      const label =
        data.phase === "probe"
          ? "lendo"
          : data.phase === "pass1"
            ? `analisando ${Math.round(filePct)}%`
            : `${Math.round(filePct)}%`;
      updateItem(item, { status: label, pct: Math.max(2, filePct) });
      const phaseText = describePhase(data);
      progressStep.textContent = `Arquivo ${data.index + 1} de ${total} · ${phaseText}`;
      loadingPhase.textContent = phaseText;
      setProgressBar(computeOverallPercent(data.index, total, data.phase, data.percent));
    }
    if (data.kind === "file-done") {
      okCount++;
      const mib = (data.sizeBytes / 1_048_576).toFixed(2);
      const inSize = item?.file.size ?? 0;
      bytesIn += inSize;
      bytesOut += data.sizeBytes;
      // A tiny source can come out bigger; only brag when it actually shrank.
      burst(
        inSize > data.sizeBytes
          ? `−${Math.round((1 - data.sizeBytes / inSize) * 100)}%`
          : `${mib} MiB`,
      );
      updateItem(item, { state: "done", status: `✓ ${mib} MiB`, pct: 100 });
      const warn =
        data.warnAboveTarget === true
          ? ' <span class="warn">(um pouco acima do alvo; ainda dentro da margem segura para o Discord)</span>'
          : "";
      appendLog(
        `<span class="ok">✓</span> ${escapeHtml(data.outputPath)} <span class="ok">(${mib} MiB)</span>${warn}`,
      );
    }
    if (data.kind === "file-cancelled") {
      updateItem(item, { state: "queued", status: "parado", pct: 0 });
      appendLog('<span class="warn">■ Parado.</span> O arquivo pela metade foi apagado.');
    }
    if (data.kind === "file-error") {
      updateItem(item, { state: "error", status: "erro", pct: 0 });
      burst("deu ruim", true);
      appendLog(`<span class="err">✗</span> ${escapeHtml(data.message)}`);
    }
    if (data.kind === "batch-done" && data.cancelled) {
      progressStep.textContent = `Parado · ${okCount} de ${data.total} prontos`;
      appendLog('<span class="accent">▸ Lote interrompido.</span>');
      hideLoading();
      if (progressHideTimer) clearTimeout(progressHideTimer);
      progressHideTimer = setTimeout(() => {
        if (encoding) return;
        progressWrap.hidden = true;
        setProgressBar(0);
      }, 4000);
      return;
    }
    if (data.kind === "batch-done") {
      setProgressBar(100);
      progressStep.textContent = `${okCount} de ${data.total} prontos`;
      appendLog('<span class="accent">▸ Lote concluído.</span>');
      finishLoading(
        okCount > 0 ? "Felparizado!" : "Nada foi felparizado",
        okCount > 0
          ? `${okCount}/${data.total} prontos · ${fmtMiB(bytesIn)} → ${fmtMiB(bytesOut)}`
          : "confere o log aí embaixo",
      );
      if (progressHideTimer) clearTimeout(progressHideTimer);
      progressHideTimer = setTimeout(() => {
        if (encoding) return;
        progressWrap.hidden = true;
        setProgressBar(0);
      }, 4000);
    }
  });

  try {
    await window.electronAPI.encodeBatch(jobs, opts);
    if (!stopping) encodeBtn.classList.add("is-done");
  } catch (e) {
    appendLog(
      `<span class="err">${escapeHtml(e instanceof Error ? e.message : String(e))}</span>`,
    );
    progressWrap.hidden = true;
    hideLoading();
  } finally {
    setEncoding(false);
  }
});

/* ─── Pause / stop ─── */

/** @param {boolean} on */
function setPaused(on) {
  paused = on;
  document.body.classList.toggle("is-paused", on);
  pauseBtn.classList.toggle("is-paused", on);
  const label = on ? "Continuar" : "Pausar";
  pauseBtn.setAttribute("aria-label", label);
  pauseBtn.title = label;
  if (!encoding) return;
  loadingTitle.textContent = on ? "Pausado" : "Felparizando…";
  // Frozen ffmpeg sends nothing, so these hold until the next real progress line.
  progressStep.textContent = on ? "Pausado · clica ▶ pra continuar" : "Continuando…";
  loadingPhase.textContent = on ? "pausado" : "continuando…";
  encodeLabel.textContent = encodeLabel.textContent.replace(
    /^(Pausado|Felparizando)/,
    on ? "Pausado" : "Felparizando",
  );
}

pauseBtn.addEventListener("click", async () => {
  if (!encoding || stopping) return;
  pauseBtn.disabled = true;
  try {
    setPaused(await window.electronAPI.pauseEncode(!paused));
  } catch (e) {
    appendLog(`<span class="err">${escapeHtml(e instanceof Error ? e.message : String(e))}</span>`);
  } finally {
    pauseBtn.disabled = !encoding || stopping;
  }
});

let stopArmTimer = null;

function disarmStop() {
  clearTimeout(stopArmTimer);
  stopBtn.classList.remove("is-confirm");
  stopBtn.setAttribute("aria-label", "Parar");
  stopBtn.title = "Parar";
}

stopBtn.addEventListener("click", async () => {
  if (!encoding || stopping) return;
  if (!stopBtn.classList.contains("is-confirm")) {
    stopBtn.classList.add("is-confirm");
    stopBtn.setAttribute("aria-label", "Confirmar: parar o lote");
    stopBtn.title = "Clica de novo pra parar";
    clearTimeout(stopArmTimer);
    stopArmTimer = setTimeout(disarmStop, 3000);
    return;
  }
  disarmStop();
  stopping = true;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  setPaused(false);
  progressStep.textContent = "Parando…";
  loadingTitle.textContent = "Parando…";
  await window.electronAPI.stopEncode();
});

/* ─── Self-update: GitHub release → download → swap exe → reopen ─── */

/** @type {string | null} */
let updateVersion = null;
let updateBusy = false;

function syncUpdateBtn() {
  if (!updateVersion) return;
  updateBtn.hidden = false;
  // Main refuses mid-batch too; disabling here just makes that visible.
  updateBtn.disabled = updateBusy || encoding;
  if (!updateBusy) {
    updateBtn.classList.remove("is-error");
    updateLabel.textContent = encoding
      ? `v${updateVersion} disponível · atualiza depois do lote`
      : `v${updateVersion} disponível · atualizar`;
  }
}

if (window.electronAPI) {
  window.electronAPI.getAppVersion().then((v) => {
    appVersion.textContent = `v${v}`;
  });
  window.electronAPI.onUpdateAvailable(({ version }) => {
    updateVersion = version;
    syncUpdateBtn();
  });
  window.electronAPI.onUpdateProgress(({ percent }) => {
    updateLabel.textContent =
      // The portable exe unpacks itself before its window shows, so the gap is real.
      percent >= 100
        ? "reiniciando… reabre em uns 20s"
        : `baixando v${updateVersion} · ${percent}%`;
  });
}

updateBtn.addEventListener("click", async () => {
  if (updateBusy || encoding) return;
  updateBusy = true;
  syncUpdateBtn();
  updateLabel.textContent = `baixando v${updateVersion}…`;
  try {
    // On success the app quits and the new version opens in its place.
    await window.electronAPI.installUpdate();
  } catch (e) {
    updateBusy = false;
    syncUpdateBtn();
    updateBtn.classList.add("is-error");
    updateLabel.textContent = "falhou · tentar de novo";
    // Electron prefixes IPC errors with the channel; keep only our message.
    updateBtn.title = String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
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
