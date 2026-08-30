import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const artifactDirectory = resolve(repositoryRoot, "artifacts/managed-service");
const platformLabel = process.env.ESPALIER_CI_PLATFORM_LABEL ?? (process.platform === "darwin" ? "macos" : process.platform);
const summaryPath = resolve(artifactDirectory, `managed-service-${platformLabel}.json`);
const logReceiptPath = resolve(artifactDirectory, `managed-service-${platformLabel}.log`);
const temporaryRoot = mkdtempSync(join(tmpdir(), "espalier-managed-空 格-"));
const dataDirectory = resolve(temporaryRoot, "应用 数据");
const database = resolve(dataDirectory, "服务 数据库.sqlite");
const serviceName = `espalier-ci-${process.pid}`;
const statePath = resolve(dataDirectory, "services", serviceName, "service.json");
const isolatedHome = resolve(temporaryRoot, "home");
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: isolatedHome,
  XDG_DATA_HOME: resolve(temporaryRoot, "XDG 数据"),
  ESPALIER_DATA_DIR: dataDirectory,
  ESPALIER_DATABASE: database,
  ESPALIER_HOST: "127.0.0.1",
};
const receipt: Record<string, unknown> = {
  format: "espalier.managed-service-receipt/1",
  status: "running",
  platform: platformLabel,
  node: process.version,
  npm: execFileSync("npm", ["--version"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
  database_path_profile: { contains_space: true, contains_unicode: true },
  checks: {},
};
let firstPid: number | undefined;
let restartedPid: number | undefined;
let serviceLogPath: string | undefined;
let failure: unknown;

mkdirSync(artifactDirectory, { recursive: true });
mkdirSync(isolatedHome, { recursive: true });
try {
  if (!existsSync(resolve(repositoryRoot, "apps/web/dist/index.html"))) throw new Error("Managed-service smoke requires the built Web application");
  const port = await availablePort();
  environment.ESPALIER_PORT = String(port);
  const serviceArguments = ["--name", serviceName, "--host", "127.0.0.1", "--port", String(port), "--database", database];

  runNpm("seed");
  const started = runService("service:start", serviceArguments);
  firstPid = requiredPid(started, "service:start");
  serviceLogPath = requiredString(started, "log_path", "service:start");
  assertRunning(started, "service:start");
  const firstStatus = runService("service:status", ["--name", serviceName]);
  assertRunning(firstStatus, "service:status");
  if (requiredPid(firstStatus, "service:status") !== firstPid) throw new Error("service:status did not report the started PID");
  await assertHttpSurface(port);
  (receipt.checks as Record<string, boolean>).start_status_health_and_web = true;

  const restarted = runService("service:restart", ["--name", serviceName]);
  restartedPid = requiredPid(restarted, "service:restart");
  assertRunning(restarted, "service:restart");
  if (restartedPid === firstPid) throw new Error("service:restart did not replace the managed PID");
  const restartedStatus = runService("service:status", ["--name", serviceName]);
  assertRunning(restartedStatus, "post-restart service:status");
  if (requiredPid(restartedStatus, "post-restart service:status") !== restartedPid) throw new Error("post-restart status did not report the replacement PID");
  await assertHttpSurface(port);
  (receipt.checks as Record<string, boolean>).restart_replaces_pid_and_recovers = true;

  const stopped = runService("service:stop", ["--name", serviceName]);
  if (stopped.state !== "stopped" || stopped.ok !== true) throw new Error(`service:stop returned an unexpected receipt: ${JSON.stringify(stopped)}`);
  const stoppedStatus = runService("service:status", ["--name", serviceName], 1);
  if (stoppedStatus.state !== "stopped" || stoppedStatus.ok !== false) throw new Error(`stopped service:status returned an unexpected receipt: ${JSON.stringify(stoppedStatus)}`);
  if (existsSync(statePath)) throw new Error("Managed service state receipt remains after stop");
  if (processIsRunning(firstPid) || processIsRunning(restartedPid)) throw new Error("A managed service process remains after stop");
  await assertPortReleased(port);
  (receipt.checks as Record<string, boolean>).stop_cleans_state_process_group_and_port = true;

  receipt.status = "passed";
  receipt.first_pid = firstPid;
  receipt.restarted_pid = restartedPid;
} catch (error) {
  failure = error;
  receipt.status = "failed";
  receipt.error = error instanceof Error ? error.message : String(error);
} finally {
  if (existsSync(statePath) || processIsRunning(firstPid) || processIsRunning(restartedPid)) {
    spawnSync("npm", ["run", "--silent", "service:stop", "--", "--name", serviceName], { cwd: repositoryRoot, env: environment, encoding: "utf8" });
  }
  if (serviceLogPath && existsSync(serviceLogPath)) copyFileSync(serviceLogPath, logReceiptPath);
  writeFileSync(summaryPath, `${JSON.stringify(receipt, null, 2)}\n`);
  rmSync(temporaryRoot, { recursive: true, force: true });
}

if (failure) throw failure;

function runNpm(script: string, arguments_: string[] = [], expectedStatus = 0): string {
  const result = spawnSync("npm", ["run", "--silent", script, ...(arguments_.length ? ["--", ...arguments_] : [])], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) throw new Error(`${script} exited ${result.status ?? "without a status"}:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function runService(script: string, arguments_: string[], expectedStatus = 0): Record<string, unknown> {
  const output = runNpm(script, arguments_, expectedStatus);
  const value = JSON.parse(output) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${script} did not return a JSON object`);
  return value as Record<string, unknown>;
}

function assertRunning(value: Record<string, unknown>, label: string): void {
  if (value.ok !== true || value.state !== "running" || value.managed !== true) throw new Error(`${label} did not report a healthy managed service: ${JSON.stringify(value)}`);
}

function requiredPid(value: Record<string, unknown>, label: string): number {
  if (!Number.isInteger(value.pid) || Number(value.pid) < 1) throw new Error(`${label} did not return a valid PID`);
  return Number(value.pid);
}

function requiredString(value: Record<string, unknown>, key: string, label: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result) throw new Error(`${label} did not return '${key}'`);
  return result;
}

async function assertHttpSurface(port: number): Promise<void> {
  // A restart intentionally invalidates keep-alive sockets owned by the old
  // process. Exercise the replacement listener through a fresh user request.
  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { connection: "close" } });
  const health = await healthResponse.json() as { ok?: boolean; schema_version?: number; protocol_version?: string };
  if (!healthResponse.ok || health.ok !== true || health.schema_version !== 4 || health.protocol_version !== "0.2") throw new Error(`Managed service health is unexpected: ${JSON.stringify(health)}`);
  const pageResponse = await fetch(`http://127.0.0.1:${port}/`, { headers: { connection: "close" } });
  const page = await pageResponse.text();
  if (!pageResponse.ok || !page.includes('<div id="root"></div>')) throw new Error("Managed service did not serve the built Web application");
}

function processIsRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Unable to reserve a loopback port")); return; }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function assertPortReleased(port: number): Promise<void> {
  return new Promise((resolveReleased, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolveReleased()));
  });
}
