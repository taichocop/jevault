import { log } from "node:console";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 毎回新しい使い捨てfixtureだけを作り、既存Vaultや本番pluginへinstallしない。
const root = await mkdtemp(join(tmpdir(), "Jevault-107-Synthetic-"));
const plugin = join(root, ".obsidian/plugins/jevault-107-verification");
for (const directory of ["Inbox", "Other", "Dest", "FailDest", ".obsidian/plugins/jevault-107-verification"]) {
  await mkdir(join(root, directory), { recursive: true });
}
for (const name of "ABCDEFGHI") {
  await writeFile(join(root, `Inbox/${name}.md`), "---\ntags: [keep]\nsynthetic: true\n---\nDisposable synthetic fixture.\n");
}
await writeFile(join(root, "Other/J.md"), "Disposable unrelated fixture.\n");
await writeFile(join(root, "Dest/F.md"), "Synthetic collision; retain.\n");
// Reviewで選ぶruntime Tagは、事前にsynthetic Vault内に存在する既存表記。
await writeFile(join(root, "SYNTHETIC-107.marker.md"), "---\ntags: [runtime]\n---\nDisposable verification only.\n");
await writeFile(join(plugin, "manifest.json"), JSON.stringify({
  id: "jevault-107-verification", name: "Jevault #107 isolated verification", version: "0.0.0",
  minAppVersion: "1.13.1", description: "Disposable synthetic Vault verification only", author: "Jevault", isDesktopOnly: true,
}, null, 2));
await writeFile(join(root, ".obsidian/community-plugins.json"), '["jevault-107-verification"]');
await build({
  absWorkingDir: dirname(dirname(fileURLToPath(import.meta.url))),
  entryPoints: ["tests/helpers/organization-apply-runtime-plugin.ts"], bundle: true, platform: "node", format: "cjs",
  external: ["obsidian"], footer: { js: "module.exports = module.exports.default;" }, outfile: join(plugin, "main.js"),
});
log(`Disposable synthetic Vault: ${root}`);
log("Open this folder in Obsidian, enable only its verification plugin, then explicitly run: Run isolated #107 A–J verification");
log("Evidence: evidence-107.json in that synthetic Vault. Do not install this helper in a real user Vault.");
