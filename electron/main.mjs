import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { access, constants as fsConstants, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  checkForUpdate,
  downloadUpdate,
  installAndRelaunch,
  portableExePath,
} from "./updater.mjs";
import { setProcessSuspended } from "./process-suspend.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "dist", "index.js");

let mainWindow = null;
/**
 * The running batch — what stop and pause act on. `pid` is the current ffmpeg,
 * `suspendedPid` the one we actually froze (they differ briefly around each spawn).
 * @type {{ abort: AbortController, paused: boolean, pid: number | null, suspendedPid: number | null } | null}
 */
let activeBatch = null;
/** Suspend/resume calls run one at a time: Windows counts suspensions, so they must pair up. */
let suspendChain = Promise.resolve();
/** @type {import("./updater.mjs").UpdateInfo | null} */
let pendingUpdate = null;
let installing = false;

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function loadLib() {
  return import(pathToFileURL(distIndex).href);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 960,
    minWidth: 960,
    minHeight: 720,
    title: "Felparizador",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#07070b",
    // Frameless look: the renderer draws the title bar, Windows keeps its caption buttons.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#f1f0f7",
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingUpdate) sendToRenderer("update-available", { version: pendingUpdate.version });
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Only the portable exe can replace itself; dev runs never check. */
const canSelfUpdate = () => app.isPackaged && portableExePath() !== null;

async function pollForUpdate() {
  try {
    const info = await checkForUpdate();
    if (!info || info.version === pendingUpdate?.version) return;
    pendingUpdate = info;
    sendToRenderer("update-available", { version: info.version });
  } catch (err) {
    // Offline or rate-limited: nothing to show, the next poll tries again.
    console.warn("update check failed:", err);
  }
}

app.whenReady().then(() => {
  createWindow();
  if (canSelfUpdate()) {
    pollForUpdate();
    setInterval(pollForUpdate, UPDATE_CHECK_INTERVAL_MS);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("pick-output-dir", async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
    title: "Pasta de saída dos arquivos codificados",
  });
  if (canceled || !filePaths[0]) return null;
  return filePaths[0];
});

// Launched as `electron ./electron/main.mjs`, app.getVersion() reports Electron's own
// version; only the packaged app reads ours from package.json.
ipcMain.handle("get-app-version", async () =>
  app.isPackaged
    ? app.getVersion()
    : JSON.parse(await readFile(path.join(__dirname, "..", "package.json"), "utf8")).version,
);

ipcMain.handle("update-install", async () => {
  if (!pendingUpdate) throw new Error("Nenhuma atualização disponível");
  if (activeBatch) throw new Error("Espera o lote terminar pra atualizar");
  if (installing) return;
  installing = true;
  try {
    const file = await downloadUpdate(pendingUpdate, (percent) =>
      sendToRenderer("update-progress", { percent }),
    );
    if (activeBatch) throw new Error("Espera o lote terminar pra atualizar");
    await installAndRelaunch(file);
    app.quit();
  } catch (err) {
    installing = false;
    throw err;
  }
});

/**
 * Brings the frozen state of ffmpeg in line with `batch.paused`. Also runs on every new
 * ffmpeg process, so a pass that starts while paused (pass 2, the next file) is frozen too.
 * @param {NonNullable<typeof activeBatch>} batch
 */
function syncSuspension(batch) {
  suspendChain = suspendChain.then(async () => {
    const want = batch.paused ? batch.pid : null;
    if (batch.suspendedPid === want) return;
    if (batch.suspendedPid !== null) {
      // May have exited meanwhile; resuming a gone process is harmless to skip.
      await setProcessSuspended(batch.suspendedPid, false).catch(() => {});
      batch.suspendedPid = null;
    }
    if (want !== null) {
      try {
        await setProcessSuspended(want, true);
        batch.suspendedPid = want;
      } catch {
        // The pass ended just as we paused; the next spawn gets frozen instead.
      }
    }
  });
  return suspendChain;
}

ipcMain.handle("encode-pause", async (_event, paused) => {
  if (!activeBatch || activeBatch.abort.signal.aborted) return false;
  activeBatch.paused = paused === true;
  await syncSuspension(activeBatch);
  return activeBatch.paused;
});

ipcMain.handle("encode-stop", async () => {
  const batch = activeBatch;
  if (!batch || batch.abort.signal.aborted) return;
  // Thaw first: a stopped POSIX process ignores SIGTERM until continued.
  batch.paused = false;
  await syncSuspension(batch);
  batch.abort.abort();
});

ipcMain.handle("encode-batch", async (_event, jobs, opts) => {
  if (installing) throw new Error("Atualizando o Felparizador — tenta de novo depois que ele reabrir");
  if (activeBatch) throw new Error("Já tem um lote rodando");
  const batch = { abort: new AbortController(), paused: false, pid: null, suspendedPid: null };
  activeBatch = batch;
  try {
    return await runBatch(jobs, opts, batch);
  } finally {
    batch.paused = false;
    await syncSuspension(batch);
    activeBatch = null;
  }
});

/**
 * @param {NonNullable<typeof activeBatch>} batch
 */
async function runBatch(jobs, opts, batch) {
  const { encodeVideo, verifyOutput, targetBytesFromCeilingMiB, MIB_TO_BYTES } =
    await loadLib();

  const ceilingMiB =
    typeof opts?.ceilingMiB === "number" && !Number.isNaN(opts.ceilingMiB)
      ? opts.ceilingMiB
      : 9.8;
  const { effectiveBytes, ceilingBytes } =
    targetBytesFromCeilingMiB(ceilingMiB);
  /** Two-pass x264 can exceed target by ~0.5–1 MiB; accept up to this hard max without failing. */
  const flexibleCeilingBytes = Math.floor((ceilingMiB + 0.7) * MIB_TO_BYTES);
  // encodeVideo applies its own duration-aware overshoot margin; no extra shaving here.
  const encodeTargetBytes = effectiveBytes;
  const forceNoAudio = opts?.forceNoAudio === true;
  const audioBitrateKbps =
    typeof opts?.audioBitrateKbps === "number" ? opts.audioBitrateKbps : 96;
  /** "Só converter": CRF por qualidade, sem alvo de tamanho e sem checagem de teto. */
  const noCeiling = opts?.noCeiling === true;
  const crf = typeof opts?.crf === "number" ? opts.crf : 23;

  const results = [];
  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("encode-progress", payload);
    }
  };

  for (let i = 0; i < jobs.length; i++) {
    if (batch.abort.signal.aborted) break;
    const { inputPath, outputPath } = jobs[i];
    send({
      kind: "file-start",
      index: i,
      total: jobs.length,
      inputPath,
      outputPath,
    });

    try {
      let outExists = false;
      try {
        await access(outputPath, fsConstants.F_OK);
        outExists = true;
      } catch (e) {
        if (e && typeof e === "object" && "code" in e && e.code !== "ENOENT") {
          throw e;
        }
      }
      if (outExists) {
        throw new Error(
          `O arquivo de saída já existe (não sobrescrevemos): ${outputPath}`,
        );
      }

      await encodeVideo(inputPath, outputPath, {
        quiet: true,
        targetEffectiveBytes: encodeTargetBytes,
        forceNoAudio,
        audioBitrateKbps,
        noCeiling,
        crf,
        signal: batch.abort.signal,
        onSpawn: (pid) => {
          batch.pid = pid;
          if (batch.paused) syncSuspension(batch);
        },
        onProgress: (evt) => {
          send({
            kind: "progress",
            index: i,
            total: jobs.length,
            inputPath,
            ...evt,
          });
        },
      });

      // Sem teto não há tamanho a validar — apenas reportamos o resultado.
      const { sizeBytes, warnAboveTarget } = noCeiling
        ? { sizeBytes: (await stat(outputPath)).size, warnAboveTarget: false }
        : await verifyOutput(outputPath, {
            ceilingBytes,
            ceilingMiB,
            flexibleCeilingBytes,
          });

      send({
        kind: "file-done",
        index: i,
        inputPath,
        outputPath,
        sizeBytes,
        warnAboveTarget: warnAboveTarget === true,
      });
      results.push({
        ok: true,
        index: i,
        inputPath,
        outputPath,
        sizeBytes,
        warnAboveTarget: warnAboveTarget === true,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "EncodingCancelledError") {
        // We checked above that nothing was at outputPath, so this is our partial file.
        await rm(outputPath, { force: true });
        send({ kind: "file-cancelled", index: i, inputPath, outputPath });
        results.push({ ok: false, cancelled: true, index: i, inputPath, outputPath });
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      send({
        kind: "file-error",
        index: i,
        inputPath,
        outputPath,
        message,
      });
      results.push({
        ok: false,
        index: i,
        inputPath,
        outputPath,
        message,
      });
    }
  }

  const cancelled = batch.abort.signal.aborted;
  send({ kind: "batch-done", total: jobs.length, cancelled });
  // A stopped batch was the user's call; popping folders open on top of that is noise.
  if (cancelled) return results;

  const openedDirs = new Set();
  for (const r of results) {
    if (r.ok && r.outputPath) {
      openedDirs.add(path.dirname(r.outputPath));
    }
  }
  for (const dirPath of openedDirs) {
    await shell.openPath(dirPath);
  }

  return results;
}
