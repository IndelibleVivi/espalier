import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const artifactDirectory = resolve(repositoryRoot, "artifacts/browser-smoke");
const summaryPath = resolve(artifactDirectory, "browser-summary.json");
const serviceLogPath = resolve(artifactDirectory, "service.log");
const temporaryRoot = mkdtempSync(join(tmpdir(), "espalier-browser-空 格-"));
const playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? defaultPlaywrightBrowsersPath();
let service: ChildProcess | undefined;

mkdirSync(artifactDirectory, { recursive: true });
rmSync(summaryPath, { force: true });
try {
  const port = await availablePort();
  const dataDirectory = resolve(temporaryRoot, "应用 数据");
  const database = resolve(dataDirectory, "Orchard 数据库.sqlite");
  const isolatedHome = resolve(temporaryRoot, "home");
  mkdirSync(isolatedHome, { recursive: true });
  const environment = {
    ...process.env,
    HOME: isolatedHome,
    XDG_DATA_HOME: resolve(temporaryRoot, "XDG 数据"),
    ESPALIER_DATA_DIR: dataDirectory,
    ESPALIER_DATABASE: database,
    ESPALIER_HOST: "127.0.0.1",
    ESPALIER_PORT: String(port),
    ESPALIER_BROWSER_BASE_URL: `http://127.0.0.1:${port}`,
    BROWSER_SMOKE_ARTIFACT_DIR: artifactDirectory,
    PLAYWRIGHT_OUTPUT_DIR: resolve(artifactDirectory, "test-results"),
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath,
  };

  const seed = spawnSync(process.execPath, ["--import", "tsx", "apps/server/src/seed.ts"], {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
  });
  if (seed.status !== 0) throw new Error(`Neutral Orchard seed failed:\n${seed.stderr || seed.stdout}`);

  const serviceLog = openSync(serviceLogPath, "w", 0o600);
  service = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", serviceLog, serviceLog],
  });
  closeSync(serviceLog);
  await waitForHealth(port, service);

  const playwright = spawnSync(resolve(repositoryRoot, "node_modules/.bin/playwright"), ["test", "--config", "playwright.config.ts"], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (playwright.error) throw playwright.error;
  if (playwright.status !== 0) throw new Error(`Playwright browser smoke failed with exit code ${playwright.status ?? "unknown"}`);
  if (!existsSync(summaryPath)) throw new Error("Playwright completed without a browser-summary receipt");
} catch (error) {
  if (!existsSync(summaryPath)) {
    writeFileSync(summaryPath, `${JSON.stringify({
      format: "espalier.browser-smoke-receipt/1",
      status: "failed",
      browser: "chromium",
      project_id: "orchard",
      harness_error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
  }
  throw error;
} finally {
  if (service && service.exitCode === null) {
    service.kill("SIGTERM");
    await waitForExit(service, 5_000);
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function defaultPlaywrightBrowsersPath(): string {
  if (process.platform === "darwin") return resolve(homedir(), "Library/Caches/ms-playwright");
  if (process.platform === "win32") return resolve(process.env.LOCALAPPDATA ?? homedir(), "ms-playwright");
  return resolve(homedir(), ".cache/ms-playwright");
}

async function waitForHealth(port: number, process_: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process_.exitCode !== null) throw new Error(`Browser-smoke service exited before readiness with code ${process_.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const health = await response.json() as { ok?: boolean; schema_version?: number; protocol_version?: string };
      if (response.ok && health.ok === true && health.schema_version === 4 && health.protocol_version === "0.2") return;
    } catch {
      // The isolated service has not bound its loopback socket yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Browser-smoke service did not become healthy within 15 seconds");
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

function waitForExit(process_: ChildProcess, timeoutMs: number): Promise<void> {
  if (process_.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browser-smoke service did not stop after SIGTERM")), timeoutMs);
    process_.once("exit", () => { clearTimeout(timeout); resolveExit(); });
  });
}
