import { access, constants, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { calculateVideoBitrate, targetBytesFromCeilingMiB } from "./bitrate.js";
import { encodeVideo } from "./encode.js";
import {
  EncodingFailedError,
  FfmpegToolError,
  InputValidationError,
} from "./errors.js";
import { probeVideo } from "./probe.js";
import { verifyOutput } from "./verify.js";

function printHelp(): void {
  console.log(`felparizador — compress video to ~9.8 MiB MP4 for Discord

Usage:
  node --import tsx/esm src/cli.ts [options] <input> [output]

Options:
  -h, --help              Show this help
  -o, --output <path>     Output file (default: <input_stem>_discord.mp4)
      --no-audio          Strip audio from output
      --target <MiB>      Size ceiling in binary MiB (default: 9.8)
      --no-ceiling        Convert only: quality-driven CRF, no size limit
      --crf <n>           Quality for --no-ceiling, 0-51 (default: 23; lower = better)
      --audio-bitrate <k> AAC bitrate when source has audio (default: 96)
      --dry-run           Show probe + projected video bitrate; no encode

Examples:
  node --import tsx/esm src/cli.ts video.mp4
  node --import tsx/esm src/cli.ts -o out.mp4 --no-audio clip.mov
  node --import tsx/esm src/cli.ts --no-ceiling recording.webm
  node --import tsx/esm src/cli.ts --no-ceiling --crf 18 recording.webm
  node --import tsx/esm src/cli.ts --dry-run clip.mov
`);
}

function defaultOutputPath(inputPath: string): string {
  const stem = inputPath.replace(/\.[^.\\/]+$/i, "");
  return `${stem}_discord.mp4`;
}

function humanizeEncodingError(message: string): string {
  const s = message.toLowerCase();
  if (s.includes("permission denied")) {
    return "Permission denied — check that the output path is writable.";
  }
  if (s.includes("no such file") || s.includes("invalid data")) {
    return "Could not read input or write output — check paths and that the file is valid media.";
  }
  if (s.includes("codec") && s.includes("not found")) {
    return "A required codec was not found in this FFmpeg build.";
  }
  return message;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", short: "o" },
      "no-audio": { type: "boolean", default: false },
      target: { type: "string" },
      "no-ceiling": { type: "boolean", default: false },
      crf: { type: "string" },
      "audio-bitrate": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const inputPath = positionals[0];
  if (!inputPath) {
    console.error("Error: missing input file. Use --help for usage.");
    process.exit(1);
  }

  const ac = new AbortController();
  const onSignal = (): void => {
    ac.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const outputFlag =
      typeof values.output === "string" ? values.output : undefined;
    const outputPath =
      outputFlag ?? positionals[1] ?? defaultOutputPath(inputPath);

    const targetStr =
      typeof values.target === "string" ? values.target : undefined;
    const ceilingMiB = parseFloat(targetStr ?? "9.8");
    if (Number.isNaN(ceilingMiB) || ceilingMiB <= 0.2) {
      throw new InputValidationError(
        `--target must be a number greater than 0.2 (got ${targetStr ?? "undefined"})`,
      );
    }

    const { effectiveBytes, ceilingBytes } =
      targetBytesFromCeilingMiB(ceilingMiB);
    const audioBrStr =
      typeof values["audio-bitrate"] === "string"
        ? values["audio-bitrate"]
        : undefined;
    const audioBitrateKbps = parseInt(audioBrStr ?? "96", 10);
    if (Number.isNaN(audioBitrateKbps) || audioBitrateKbps < 0) {
      throw new InputValidationError(
        `--audio-bitrate must be a non-negative integer (got ${audioBrStr ?? "default"})`,
      );
    }

    const dryRun = values["dry-run"] === true;
    const noAudio = values["no-audio"] === true;
    const noCeiling = values["no-ceiling"] === true;

    const crfStr = typeof values.crf === "string" ? values.crf : undefined;
    const crf = parseInt(crfStr ?? "23", 10);
    if (Number.isNaN(crf) || crf < 0 || crf > 51) {
      throw new InputValidationError(
        `--crf must be an integer between 0 and 51 (got ${crfStr ?? "default"})`,
      );
    }

    if (!dryRun) {
      try {
        await access(outputPath, constants.F_OK);
        throw new InputValidationError(
          `Output file already exists (refusing to overwrite): ${outputPath}`,
        );
      } catch (e) {
        if (e instanceof InputValidationError) throw e;
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw e;
      }
    }

    const probe = await probeVideo(inputPath);
    console.log(
      `Input: ${probe.durationSeconds.toFixed(1)}s, audio: ${probe.hasAudio}, ${probe.widthPx}x${probe.heightPx}`,
    );

    if (dryRun && noCeiling) {
      const audioKbps = probe.hasAudio && !noAudio ? audioBitrateKbps : 0;
      console.log(
        `Dry-run: no ceiling → CRF ${crf} single-pass (audio ${audioKbps} kbps), output size unbounded`,
      );
      return;
    }

    if (dryRun) {
      const useAudio = probe.hasAudio && !noAudio;
      const audioKbps = useAudio ? audioBitrateKbps : 0;
      const videoKbps = calculateVideoBitrate(
        effectiveBytes,
        probe.durationSeconds,
        audioKbps,
      );
      console.log(
        `Dry-run: ceiling ${ceilingMiB} MiB → projected video ${videoKbps} kbps (audio ${audioKbps} kbps)`,
      );
      return;
    }

    await encodeVideo(inputPath, outputPath, {
      signal: ac.signal,
      targetEffectiveBytes: effectiveBytes,
      forceNoAudio: noAudio,
      audioBitrateKbps,
      noCeiling,
      crf,
    });

    // With --no-ceiling there is no size target to enforce; just report what came out.
    const { sizeBytes } = noCeiling
      ? { sizeBytes: (await stat(outputPath)).size }
      : await verifyOutput(outputPath, { ceilingBytes, ceilingMiB });
    const orig = probe.fileSizeBytes;
    console.log(
      `Done: ${outputPath} — ${(sizeBytes / 1_048_576).toFixed(2)} MiB (was ${(orig / 1_048_576).toFixed(2)} MiB)`,
    );
  } catch (err) {
    if (err instanceof InputValidationError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    if (err instanceof EncodingFailedError) {
      console.error(humanizeEncodingError(err.message));
      process.exit(err.exitCode);
    }
    if (err instanceof FfmpegToolError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
