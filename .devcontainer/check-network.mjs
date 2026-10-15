import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const stages = ["outside network control", "sandbox network enabled control", "sandbox network denial", "outside network still reachable"];
let stage = "prerequisites";
const server = createServer((socket) => socket.end("JEVAULT_SYNTHETIC_ENDPOINT\n"));
server.on("error", () => {});

function run(port, networkAccess) {
  // 子のsocket型stdoutを非同期stream経由で使わず、制限中もmarkerを同期送信する。
  const script = `
    const report = (marker) => require("node:fs").writeSync(1, marker + "\\n");
    report("JEVAULT_NETWORK_CHILD_STARTED");
    const socket = require("node:net").connect({ host: "127.0.0.1", port: ${port} });
    let content = "";
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () => { report("JEVAULT_NETWORK_TIMEOUT"); socket.destroy(); process.exitCode = 25; });
    socket.on("data", (data) => { content += data; });
    socket.on("end", () => {
      if (content === "JEVAULT_SYNTHETIC_ENDPOINT\\n") report("JEVAULT_NETWORK_REACHABLE");
      else { report("JEVAULT_NETWORK_BAD_RESPONSE"); process.exitCode = 25; }
    });
    socket.on("error", (error) => {
      if (["EACCES", "EPERM", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(error.code)) {
        report("JEVAULT_NETWORK_DENIED:" + error.code); process.exitCode = 23;
      } else { report("JEVAULT_NETWORK_UNEXPECTED_ERROR"); process.exitCode = 25; }
    });
  `;
  const args = ["-e", script];
  return new Promise((resolve) => {
    const child = spawn(networkAccess === undefined ? process.execPath : "codex", networkAccess === undefined ? args : [
      "sandbox", "-c", 'sandbox_mode="workspace-write"',
      "-c", `sandbox_workspace_write.network_access=${networkAccess}`, "--", process.execPath, ...args,
    ], { cwd: workspace, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    let error;
    // 親の合成serverを動かし続け、sandbox初期化失敗やDockerの拒否を成功扱いしない。
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (data) => { if (stdout.length < 4096) stdout += data; });
    child.on("error", (cause) => { error = cause.code; });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, error, markers: stdout.split(/\r?\n/) });
    });
  });
}

function requireReachable(result) {
  if (result.status !== 0 || result.signal || result.error || !result.markers.includes("JEVAULT_NETWORK_CHILD_STARTED") || !result.markers.includes("JEVAULT_NETWORK_REACHABLE")) {
    throw new Error("synthetic endpoint control did not complete");
  }
}

try {
  if (process.argv.length !== 2 || process.platform !== "linux" || process.getuid() !== 1000 || homedir() !== "/home/node") {
    throw new Error("run without arguments in an unauthenticated Linux verification container as node");
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  stage = stages[0];
  requireReachable(await run(port));
  console.log(`PASS ${stage}`);
  stage = stages[1];
  requireReachable(await run(port, true));
  console.log(`PASS ${stage}`);
  stage = stages[2];
  const result = await run(port, false);
  const denied = result.markers.some((marker) => /^JEVAULT_NETWORK_DENIED:(EACCES|EPERM|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED)$/.test(marker));
  if (result.status !== 23 || result.signal || result.error || !result.markers.includes("JEVAULT_NETWORK_CHILD_STARTED") || !denied || result.markers.includes("JEVAULT_NETWORK_REACHABLE")) {
    throw new Error("expected an initialized sandbox child and an explicit network denial");
  }
  console.log(`PASS ${stage}`);
  stage = stages[3];
  requireReachable(await run(port));
  console.log(`PASS ${stage}`);
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${stage}: ${error.message}`);
  const remaining = stages.slice(Math.max(0, stages.indexOf(stage) + 1));
  if (remaining.length) console.error(`NOT RUN: ${remaining.join(", ")}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
