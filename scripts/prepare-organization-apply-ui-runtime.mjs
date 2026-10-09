import { log } from "node:console";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 新規の使い捨てVaultだけ。本番plugin、既存Vault、キーを一切使わない。
const root = await mkdtemp(join(tmpdir(), "Jevault-111-Synthetic-"));
const plugin = join(root, ".obsidian/plugins/jevault-111-verification");
const cases = ["TagOnly", "MoveOnly", "Both", "SameFolder", "Keep", "Partial", "StopTag", "StopMove",
  "CloseTag", "CloseMove", "UnloadTag", "UnloadMove", "Cancel", "Esc", "X"];
for (const directory of ["Inbox", "Dest", ...cases.map(name => `Cases/${name}`), ".obsidian/plugins/jevault-111-verification"]) {
  await mkdir(join(root, directory), { recursive: true });
}
const content = "---\ntags: [keep]\nsynthetic: true\n---\nDisposable synthetic fixture.\n";
await writeFile(join(root, "Inbox/Interactive.md"), content);
for (const name of cases) for (const note of ["A", "B", "U"]) await writeFile(join(root, `Cases/${name}/${name}-${note}.md`), content);
await writeFile(join(root, "SYNTHETIC-111.marker.md"), "---\ntags: [runtime]\n---\nDisposable verification only.\n");
await writeFile(join(plugin, "manifest.json"), JSON.stringify({ id: "jevault-111-verification",
  name: "Jevault #111 isolated UI verification", version: "0.0.0", minAppVersion: "1.13.1",
  description: "Disposable synthetic Vault UI verification only", author: "Jevault", isDesktopOnly: true }, null, 2));
await writeFile(join(root, ".obsidian/community-plugins.json"), '["jevault-111-verification"]');
await build({ absWorkingDir: dirname(dirname(fileURLToPath(import.meta.url))),
  entryPoints: ["tests/helpers/organization-apply-ui-runtime-plugin.ts"], bundle: true, platform: "node", format: "cjs",
  external: ["obsidian"], footer: { js: "module.exports = module.exports.default;" }, outfile: join(plugin, "main.js") });
log(`Disposable synthetic Vault: ${root}`);
log("Explorer Inbox right-click uses production UI with injected fake analysis. No provider/key path exists.");
log("Explicit command: Run isolated #111 DOM UI verification. Evidence: evidence-111.json. Never install in a real Vault.");
