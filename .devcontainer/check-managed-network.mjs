import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const stages = ["outside HTTP control", "managed proxy allowed control", "managed direct network denial", "managed proxy deny-all", "outside HTTP still reachable"];
const server = createServer((_request, response) => response.end("JEVAULT_SYNTHETIC_HTTP\n"));
server.on("error", () => {});
let stage = "prerequisites";

function run(port, managed, proxy, allow = false) {
  const script = `
    const report = (marker) => require("node:fs").writeSync(1, marker + "\\n");
    report("JEVAULT_MANAGED_CHILD_STARTED");
    const proxy = ${proxy} ? new URL(process.env.HTTP_PROXY) : undefined;
    const socket = require("node:net").connect({ host: proxy ? proxy.hostname : "127.0.0.1", port: proxy ? Number(proxy.port) : ${port} });
    let content = "";
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () => { report("JEVAULT_MANAGED_TIMEOUT"); socket.destroy(); process.exitCode = 25; });
    socket.on("connect", () => socket.write("GET " + (proxy ? "http://127.0.0.1:${port}/" : "/") + " HTTP/1.1\\r\\nHost: 127.0.0.1:${port}\\r\\nConnection: close\\r\\n\\r\\n"));
    socket.on("data", (data) => { content += data; });
    socket.on("end", () => {
      if (/^HTTP\\/1\\.[01] 200 /.test(content) && content.includes("JEVAULT_SYNTHETIC_HTTP\\n")) report("JEVAULT_MANAGED_REACHABLE");
      else if (/^HTTP\\/1\\.[01] 403 /.test(content) && /x-proxy-error: blocked-by-allowlist/i.test(content)) {
        report("JEVAULT_MANAGED_PROXY_DENIED"); process.exitCode = 23;
      } else { report("JEVAULT_MANAGED_BAD_RESPONSE"); process.exitCode = 25; }
    });
    socket.on("error", (error) => {
      if (["EACCES", "EPERM", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(error.code)) {
        report("JEVAULT_MANAGED_DIRECT_DENIED"); process.exitCode = 23;
      } else { report("JEVAULT_MANAGED_UNEXPECTED_ERROR"); process.exitCode = 25; }
    });
  `;
  const args = ["-e", script];
  // 合成endpointの許可controlだけでdomainを追加し、既定の空リストを別プロセスで検証する。
  const overrides = allow ? ["--synthetic-loopback-control"] : [];
  return new Promise((resolve) => {
    const child = spawn(managed ? "sh" : process.execPath, managed
      ? [join(workspace, ".devcontainer/sandbox/codex.sh"), ...overrides, "sandbox", "--", process.execPath, ...args] : args,
    { cwd: workspace, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    let error;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (data) => { if (stdout.length < 4096) stdout += data; });
    child.on("error", (cause) => { error = cause.code; });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, error, markers: stdout.split(/\r?\n/) });
    });
  });
}

function requireResult(result, status, marker) {
  // proxy未起動・接続不能・timeoutを、proxy policyによる拒否と取り違えない。
  if (result.error || result.signal || result.status !== status || !result.markers.includes("JEVAULT_MANAGED_CHILD_STARTED") || !result.markers.includes(marker)) {
    throw new Error("expected an initialized child and the explicit endpoint/policy result");
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
  const checks = [
    [false, false, false, 0, "JEVAULT_MANAGED_REACHABLE"],
    [true, true, true, 0, "JEVAULT_MANAGED_REACHABLE"],
    [true, false, false, 23, "JEVAULT_MANAGED_DIRECT_DENIED"],
    [true, true, false, 23, "JEVAULT_MANAGED_PROXY_DENIED"],
    [false, false, false, 0, "JEVAULT_MANAGED_REACHABLE"],
  ];
  for (const [index, [managed, proxy, allow, status, marker]] of checks.entries()) {
    stage = stages[index];
    requireResult(await run(port, managed, proxy, allow), status, marker);
    console.log(`PASS ${stage}`);
  }
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${stage}: ${error.message}`);
  const remaining = stages.slice(Math.max(0, stages.indexOf(stage) + 1));
  if (remaining.length) console.error(`NOT RUN: ${remaining.join(", ")}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
