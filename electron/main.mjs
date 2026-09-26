import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { access, constants as fsConstants, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, "..", "dist", "index.js");

let mainWindow = null;

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
}

app.whenReady().then(() => {
  createWindow();
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

ipcMain.handle("encode-batch", async (_event, jobs, opts) => {
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

  send({ kind: "batch-done", total: jobs.length });

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
});
