import { copyFileSync, lstatSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";

// Dockerの宣言だけでは入れ子mount消失を検出できないため、実mountを先に確認する。
const mountpoints = new Set(readFileSync("/proc/self/mountinfo", "utf8")
  .trim().split("\n").map((line) => line.split(" ")[4]));
for (const target of ["/workspaces/jevault", "/workspaces/node_modules", "/home/node/.codex"]) {
  if (!mountpoints.has(target)) throw new Error(`Required mount missing: ${target}; stop and inspect the container.`);
}

const link = "/workspaces/jevault/node_modules";
let existing;
try {
  existing = lstatSync(link);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// 既存のホスト依存を削除・置換せず、専用cloneの不一致は本人へ返す。
if (existing) {
  if (!existing.isSymbolicLink() || readlinkSync(link) !== "/workspaces/node_modules") {
    throw new Error("Existing node_modules is not the container dependency link; use a clean clone.");
  }
} else {
  symlinkSync("/workspaces/node_modules", link);
}
// npm ciはリンク自体を置換するため、公開manifestとnpm設定を親へコピーしてvolume側で実行する。
for (const manifest of ["package.json", "package-lock.json", ".npmrc"]) {
  copyFileSync(`/workspaces/jevault/${manifest}`, `/workspaces/${manifest}`);
}
console.log("PASS required workspace, dependency and Codex mounts; container dependency link");
