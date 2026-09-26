// Pausing an encode = freezing the ffmpeg process; ffmpeg has no pause command of its own.
// POSIX has SIGSTOP/SIGCONT. Windows has no signal for it, so this calls ntdll's
// NtSuspendProcess/NtResumeProcess through PowerShell (about a second, mostly Add-Type).

import { spawn } from "node:child_process";

/**
 * Suspend (true) or resume (false) a process. Windows counts suspensions, so callers
 * must pair each suspend with exactly one resume.
 * @param {number} pid
 * @param {boolean} suspended
 */
export async function setProcessSuspended(pid, suspended) {
  if (process.platform !== "win32") {
    process.kill(pid, suspended ? "SIGSTOP" : "SIGCONT");
    return;
  }

  const fn = suspended ? "NtSuspendProcess" : "NtResumeProcess";
  const script = `
Add-Type -Namespace Felpa -Name Nt -MemberDefinition '
[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'
$p = [System.Diagnostics.Process]::GetProcessById(${Number(pid)})
exit [Felpa.Nt]::${fn}($p.Handle)
`;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { stdio: "ignore", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`Não consegui ${suspended ? "pausar" : "retomar"} o ffmpeg (código ${code})`);
  }
}
