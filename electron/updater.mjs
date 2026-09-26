// Self-update for the portable build. electron-updater does not support the "portable"
// target, so this checks GitHub Releases directly, downloads the new Felparizador.exe,
// and hands the file swap to a detached PowerShell process: the running .exe stays
// locked until the portable launcher exits, so the swap can only happen after we quit.

import { app, net } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const REPO = "caiocost/felparizador";
const ASSET_NAME = "Felparizador.exe";

/**
 * The .exe the user double-clicked. The portable launcher sets this before starting the
 * app it unpacked to a temp dir; absent in dev and in unpacked builds, where there is
 * no single file to replace.
 */
export function portableExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}

/** @param {string} v */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

/** @param {string} latest @param {string} current */
export function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * @typedef {{ version: string, url: string, size: number, sha256: string | null, pageUrl: string }} UpdateInfo
 * @returns {Promise<UpdateInfo | null>} null when already on the latest release
 */
export async function checkForUpdate() {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Felparizador" },
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const release = await res.json();
  if (!isNewerVersion(release.tag_name ?? "", app.getVersion())) return null;

  const asset = release.assets?.find((a) => a.name === ASSET_NAME);
  if (!asset) return null;
  const digest = typeof asset.digest === "string" ? asset.digest : "";
  return {
    version: release.tag_name.replace(/^v/, ""),
    url: asset.browser_download_url,
    size: asset.size,
    sha256: digest.startsWith("sha256:") ? digest.slice(7).toLowerCase() : null,
    pageUrl: release.html_url,
  };
}

/**
 * Downloads the release asset to the temp dir, checking size and SHA-256 (GitHub
 * publishes a digest per asset), so a truncated or tampered download never replaces
 * a working exe.
 * @param {UpdateInfo} info
 * @param {(percent: number) => void} onProgress
 * @returns {Promise<string>} path of the verified download
 */
export async function downloadUpdate(info, onProgress) {
  const dest = path.join(app.getPath("temp"), `Felparizador-${info.version}-${randomUUID()}.exe`);
  const res = await net.fetch(info.url, { headers: { "User-Agent": "Felparizador" } });
  if (!res.ok || !res.body) throw new Error(`Download falhou (${res.status})`);

  const hash = createHash("sha256");
  const out = createWriteStream(dest);
  let received = 0;
  let lastPct = -1;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.byteLength;
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      const pct = Math.floor((received / info.size) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress(Math.min(100, pct));
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

    if (received !== info.size) {
      throw new Error(`Download incompleto (${received} de ${info.size} bytes)`);
    }
    if (info.sha256 && hash.digest("hex") !== info.sha256) {
      throw new Error("O arquivo baixado não bate com o hash da release");
    }
    return dest;
  } catch (err) {
    out.destroy();
    await rm(dest, { force: true });
    throw err;
  }
}

/** Where the swap helper records what it did — the only trace once the app has quit. */
export function updateLogPath() {
  return path.join(app.getPath("temp"), "felparizador-update.log");
}

/** @param {string} s */
const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;

/** @param {string} script */
const psEncode = (script) => Buffer.from(script, "utf16le").toString("base64");

/**
 * Starts a background PowerShell that waits for this exe to unlock, copies the download
 * over it and relaunches it; the caller must quit once this resolves. If the swap never
 * succeeds (e.g. the exe lives somewhere read-only), the old version is relaunched so
 * the user is not left with nothing running.
 *
 * The helper is created through WMI rather than as our child: a plain child — even a
 * `detached` one — dies with us whenever we run inside a job object that kills on close,
 * and a detached (console-less) powershell.exe exits 0 without running its script.
 * @param {string} downloadedPath
 */
export async function installAndRelaunch(downloadedPath) {
  const target = portableExePath();
  if (!target) throw new Error("Atualização automática só funciona no Felparizador.exe");

  const swap = `
$src = ${psQuote(downloadedPath)}
$dst = ${psQuote(target)}
$log = ${psQuote(updateLogPath())}
function Log($m) { Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $m) }
Log "swap $src -> $dst"
for ($i = 0; $i -lt 240; $i++) {
  try {
    Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop
    Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
    Log "swapped after $i retries; relaunching"
    Start-Process -FilePath $dst
    exit 0
  } catch {
    if ($i -eq 0) { Log "waiting for exe to unlock: $($_.Exception.Message)" }
    Start-Sleep -Milliseconds 500
  }
}
Log "gave up; relaunching the old version"
Start-Process -FilePath $dst
`;
  // -EncodedCommand takes UTF-16LE base64, which keeps accented/space-laden paths intact.
  const launcher = `
$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${psEncode(swap)}'
  ProcessStartupInformation = $si
}
exit $r.ReturnValue
`;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", psEncode(launcher)],
      { stdio: "ignore", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Não consegui iniciar o instalador (código ${code})`);
}
