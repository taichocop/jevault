import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("[verify] Run this command through npm run verify.");
  process.exit(1);
}

// npmのCLIを同じNodeで起動し、shellやOS別のnpmラッパーに依存しない。
const stages = [
  { label: "public repository boundary", command: process.execPath, args: ["scripts/verify-public-boundary.mjs"] },
  { label: "public boundary regression tests", command: process.execPath, args: ["--test", "scripts/test-public-boundary.mjs"] },
  { label: "unit/regression tests", command: process.execPath, args: [npmCli, "test"] },
  { label: "lint", command: process.execPath, args: [npmCli, "run", "lint"] },
  {
    label: "production build (typecheck + bundle + licenses)",
    command: process.execPath,
    args: [npmCli, "run", "build"],
  },
  { label: "working diff whitespace", command: "git", args: ["diff", "--check"] },
  { label: "staged diff whitespace", command: "git", args: ["diff", "--cached", "--check"] },
];

for (const { label, command, args } of stages) {
  console.log(`[verify] START ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error || result.signal || result.status !== 0) {
    const reason = result.error?.code ?? result.signal ?? `exit ${result.status}`;
    console.error(`[verify] FAILED ${label}: ${reason}`);
    process.exit(result.status || 1);
  }
  console.log(`[verify] PASS ${label}`);
}

console.log("[verify] All required checks passed.");
