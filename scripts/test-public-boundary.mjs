import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const source = fileURLToPath(new URL("verify-public-boundary.mjs", import.meta.url));
const ignore = fileURLToPath(new URL("../.gitignore", import.meta.url));

function fixture(t, init = true) {
  const root = mkdtempSync(join(tmpdir(), "jevault-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  copyFileSync(source, join(root, "scripts/verify-public-boundary.mjs"));
  copyFileSync(ignore, join(root, ".gitignore"));
  function git(...args) {
    const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, "synthetic Git fixture command must succeed");
    return result.stdout;
  }
  if (init) git("init", "--quiet", "--template=");
  return {
    git,
    file(path) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, "synthetic boundary probe\n");
    },
    remove(path) {
      unlinkSync(join(root, path));
    },
    check() {
      return spawnSync(process.execPath, [join(root, "scripts/verify-public-boundary.mjs")], {
        cwd: root,
        encoding: "utf8",
      });
    },
  };
}

test("ordinary ignored root docs and agent files remain untracked and pass", (t) => {
  const f = fixture(t);
  for (const path of ["docs/nested/probe.md", "agent/probe.md"]) {
    f.file(path);
    assert.ok(f.git("check-ignore", "--", path).trim());
  }
  f.git("add", "--", ".");
  assert.equal(f.git("ls-files", "--", "docs", "agent"), "");
  assert.equal(f.check().status, 0);
});

for (const path of ["docs/nested/probe.md", "agent/probe.md", "docs/line\nbreak.md"]) {
  test(`force-added ${path.replaceAll("\n", "\\n")} fails, index removal restores pass`, (t) => {
    const f = fixture(t);
    f.file(path);
    f.git("add", "-f", "--", path);
    assert.equal(f.check().status, 1);
    f.git("rm", "--cached", "--", path);
    assert.equal(f.check().status, 0);
  });
}

test("tracked entries fail even when their worktree file is missing", (t) => {
  const f = fixture(t);
  f.file("agent/probe.md");
  f.git("add", "-f", "--", "agent/probe.md");
  f.remove("agent/probe.md");
  assert.equal(f.check().status, 1);
});

test("public files and similarly named or nested directories are allowed", (t) => {
  const f = fixture(t);
  for (const path of ["AGENTS.md", "README.md", "docs-public/probe.md", "agents/probe.md", "src/docs/probe.md", "src/agent/probe.md"]) f.file(path);
  f.git("add", "--", ".");
  assert.equal(f.check().status, 0);
});

test("Git failure fails closed rather than reporting a clean boundary", (t) => {
  const f = fixture(t, false);
  const result = f.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not verify the Git index/);
});
