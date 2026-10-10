import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// ignoreや作業ツリーの有無ではなくindexを検査し、force-addや未コミットの追加も拒否する。
const result = spawnSync(
  "git",
  ["ls-files", "--cached", "--full-name", "-z", "--", ":(top,literal)docs", ":(top,literal)agent"],
  { cwd: root, encoding: "utf8" },
);

if (result.error || result.signal || result.status !== 0) {
  console.error("[public-boundary] FAILED: could not verify the Git index.");
  process.exit(1);
}

const count = result.stdout.split("\0").filter(Boolean).length;
if (count > 0) {
  // 内部資料の内容や環境情報をCIログへ転載せず、境界違反の件数だけを示す。
  console.error(`[public-boundary] FAILED: ${count} tracked entry/entries under root docs or agent.`);
  process.exit(1);
}

console.log("[public-boundary] PASS: no tracked root docs or agent entries.");
