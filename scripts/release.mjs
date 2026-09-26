// Builds the portable exe and publishes it as a GitHub release tagged v<package version>.
// The in-app updater compares that tag with the running version and downloads the
// asset named Felparizador.exe, so both have to line up — bump "version" first.
//
//   npm run release                       → notes generated from commits
//   npm run release -- --notes "o que mudou"

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${version}`;
const exe = "release/Felparizador.exe";

// gh is a real .exe, so it runs without a shell and multi-word args (title, notes) stay
// intact. npm is npm.cmd on Windows, which Node only spawns through a shell (execSync).
const gh = (args, stdio = "inherit") => execFileSync("gh", args, { stdio });

let tagExists = true;
try {
  gh(["release", "view", tag], "ignore");
} catch {
  tagExists = false;
}
if (tagExists) {
  console.error(`A release ${tag} já existe. Sobe o "version" no package.json antes.`);
  process.exit(1);
}

execSync("npm run dist:win", { stdio: "inherit" });
if (!existsSync(exe)) {
  console.error(`Build não gerou ${exe}`);
  process.exit(1);
}

const notesIdx = process.argv.indexOf("--notes");
const notesArgs =
  notesIdx !== -1 && process.argv[notesIdx + 1]
    ? ["--notes", process.argv[notesIdx + 1]]
    : ["--generate-notes"];

gh(["release", "create", tag, exe, "--title", `Felparizador ${tag}`, ...notesArgs]);
console.log(`\nPublicado ${tag}. Quem estiver com o app aberto vê o aviso em até 6h (ou ao abrir).`);
