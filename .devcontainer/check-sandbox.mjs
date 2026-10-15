import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const managed = process.argv[2] === "--managed";
const workspace = fileURLToPath(new URL("../", import.meta.url));
const stages = ["outside write control", "sandbox simple command", "sandbox workspace write", "sandbox outside write denial", "outside content unchanged"];
const baseline = "synthetic outside control\n";
const workspaceContent = "synthetic workspace sandbox write\n";
const fixtures = [];
let stage = "prerequisites";

function run(script, file, sandbox = false) {
  // ネットワーク制限下のsocket型stdoutでも、成功markerを同期writeで確実に渡す。
  const args = ["-e", `const report = (marker) => require("node:fs").writeSync(1, marker + "\\n");\n${script}`, ...(file ? [file] : [])];
  if (sandbox && managed) {
    return spawnSync("sh", [join(workspace, ".devcontainer/sandbox/codex.sh"), "sandbox", "--", process.execPath, ...args],
      { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 64 * 1024 });
  }
  return spawnSync(sandbox ? "codex" : process.execPath, sandbox
    ? ["sandbox", "-c", 'sandbox_mode="workspace-write"', "--", process.execPath, ...args]
    : args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 64 * 1024 });
}

function hasMarker(result, marker) {
  return (result.stdout ?? "").split(/\r?\n/).includes(marker);
}

function commandFailure(result) {
  // Codexの設定・認証ログを表示せず、合成コマンドの終了状態だけを報告する。
  const status = result.status ?? "none";
  const error = result.error?.code ?? "none";
  const namespace = /No permissions to create new namespace|creating new namespace failed/i.test(result.stderr ?? "")
    ? "; namespace creation failed" : "";
  return `exit=${status}; signal=${result.signal ?? "none"}; error=${error}${namespace}`;
}

function requireSuccess(result, marker) {
  if (result.error || result.signal || result.status !== 0 || !hasMarker(result, marker)) {
    throw new Error(`synthetic command did not complete (${commandFailure(result)})`);
  }
}

function pass() {
  console.log(`PASS ${stage}`);
}

try {
  if ((process.argv.length !== 2 && !(process.argv.length === 3 && managed)) || process.platform !== "linux" || process.getuid() !== 1000 || homedir() !== "/home/node") {
    throw new Error("run without arguments inside the Linux Dev Container as node (UID 1000, HOME=/home/node)");
  }

  stage = "fixture setup";
  const workspaceFixture = mkdtempSync(join(workspace, ".jevault-sandbox-workspace-"));
  fixtures.push(workspaceFixture);
  const outsideFixture = mkdtempSync(join(homedir(), ".jevault-sandbox-outside-"));
  fixtures.push(outsideFixture);
  const insideFile = join(workspaceFixture, "synthetic.txt");
  const outsideFile = join(outsideFixture, "synthetic.txt");
  writeFileSync(insideFile, "synthetic workspace initial\n");
  writeFileSync(outsideFile, "synthetic outside initial\n");

  stage = stages[0];
  requireSuccess(run(`
    require("node:fs").writeFileSync(process.argv[1], ${JSON.stringify(baseline)});
    report("JEVAULT_OUTSIDE_CONTROL_OK");
  `, outsideFile), "JEVAULT_OUTSIDE_CONTROL_OK");
  if (readFileSync(outsideFile, "utf8") !== baseline) throw new Error("direct node write did not update the outside fixture");
  pass();

  stage = stages[1];
  requireSuccess(run('report("JEVAULT_SIMPLE_OK");', undefined, true), "JEVAULT_SIMPLE_OK");
  pass();

  stage = stages[2];
  requireSuccess(run(`
    require("node:fs").writeFileSync(process.argv[1], ${JSON.stringify(workspaceContent)});
    report("JEVAULT_WORKSPACE_OK");
  `, insideFile, true), "JEVAULT_WORKSPACE_OK");
  if (readFileSync(insideFile, "utf8") !== workspaceContent) throw new Error("sandbox write did not update the workspace fixture");
  pass();

  stage = stages[3];
  const denied = run(`
    report("JEVAULT_OUTSIDE_CHILD_STARTED");
    try {
      require("node:fs").writeFileSync(process.argv[1], "synthetic unexpected outside write\\n");
      report("JEVAULT_OUTSIDE_WRITE_SUCCEEDED");
      process.exitCode = 24;
    } catch (error) {
      if (["EACCES", "EPERM", "EROFS"].includes(error.code)) {
        report("JEVAULT_OUTSIDE_DENIED:" + error.code);
        process.exitCode = 23;
      } else {
        report("JEVAULT_OUTSIDE_UNEXPECTED_ERROR");
        process.exitCode = 25;
      }
    }
  `, outsideFile, true);
  // namespace初期化失敗や子プロセス未起動を、書き込み拒否の成功と取り違えない。
  const deniedByPolicy = ["EACCES", "EPERM", "EROFS"].some((code) => hasMarker(denied, `JEVAULT_OUTSIDE_DENIED:${code}`));
  if (denied.error || denied.signal || denied.status !== 23 || !hasMarker(denied, "JEVAULT_OUTSIDE_CHILD_STARTED") || !deniedByPolicy) {
    throw new Error(`expected an initialized child and a filesystem permission denial (${commandFailure(denied)})`);
  }
  pass();

  stage = stages[4];
  if (readFileSync(outsideFile, "utf8") !== baseline) throw new Error("outside fixture content changed");
  pass();
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${stage}: ${error.message}`);
  const remaining = stages.slice(stages.indexOf(stage) + 1);
  if (remaining.length) console.error(`NOT RUN: ${remaining.join(", ")}`);
} finally {
  // この実行で生成した専用fixtureだけを削除し、既存の状態やvolumeに触れない。
  for (const fixture of fixtures) {
    try {
      rmSync(fixture, { recursive: true, force: true });
    } catch (error) {
      process.exitCode = 1;
      console.error(`FAIL fixture cleanup: ${error.code ?? "unknown error"}`);
    }
  }
}
