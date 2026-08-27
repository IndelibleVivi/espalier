#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDirectory, defaultDatabasePath, isLoopbackHost } from "../apps/server/src/paths.js";

type Action = "start" | "status" | "stop" | "restart";

interface Options {
  action: Action;
  name: string;
  entry: string;
  host: string;
  port: number;
  database: string;
}

interface ServiceState {
  schema_version: 1;
  name: string;
  pid: number;
  started_at: string;
  repo_root: string;
  entry: string;
  url: string;
  database: string;
  log_path: string;
}

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  if (options.action === "restart") {
    const existing = readState(options.name);
    const restartOptions = existing ? optionsFromState(options, existing) : options;
    await stop(options, false);
    return start(restartOptions);
  }
  if (options.action === "start") return start(options);
  if (options.action === "stop") return stop(options, true);
  return status(options);
}

function optionsFromState(options: Options, state: ServiceState): Options {
  if (resolve(state.repo_root) !== resolve(repoRoot)) {
    throw new Error(`Managed service '${state.name}' belongs to ${state.repo_root}; restart it from that repository`);
  }
  const url = new URL(state.url);
  return {
    ...options,
    entry: resolve(state.repo_root, state.entry),
    host: url.hostname,
    port: Number(url.port),
    database: state.database,
  };
}

function parseOptions(argv: string[]): Options {
  const action = argv[0] as Action | undefined;
  if (!action || !["start", "status", "stop", "restart"].includes(action)) {
    throw new Error("Usage: tsx scripts/local-service.mts <start|status|stop|restart> [--name espalier] [--entry apps/server/src/index.ts] [--host 127.0.0.1] [--port 4317] [--database <path>]");
  }
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`Expected a value after ${key ?? "option"}`);
    flags.set(key.slice(2), value);
    index += 1;
  }
  const name = flags.get("name") ?? "espalier";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("--name must use lowercase letters, digits, and hyphens");
  const host = flags.get("host") ?? process.env.ESPALIER_HOST ?? "127.0.0.1";
  if (!isLoopbackHost(host)) throw new Error("Local service management refuses non-loopback binding");
  const port = Number(flags.get("port") ?? process.env.ESPALIER_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be an integer between 1 and 65535");
  const entry = resolve(repoRoot, flags.get("entry") ?? "apps/server/src/index.ts");
  const relativeEntry = relative(repoRoot, entry);
  if (relativeEntry.startsWith("..") || relativeEntry === "") throw new Error("--entry must name a file inside this repository");
  const database = resolve(flags.get("database") ?? process.env.ESPALIER_DATABASE ?? defaultDatabasePath());
  return { action, name, entry, host, port, database };
}

function serviceDirectory(name: string): string {
  return join(defaultDataDirectory(), "services", name);
}

function statePath(name: string): string {
  return join(serviceDirectory(name), "service.json");
}

function readState(name: string): ServiceState | undefined {
  const path = statePath(name);
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as ServiceState;
    return value.schema_version === 1 && value.name === name && Number.isInteger(value.pid) ? value : undefined;
  } catch {
    return undefined;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function health(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const value = await response.json() as { ok?: boolean };
    return value.ok === true;
  } catch {
    return false;
  }
}

async function start(options: Options): Promise<number> {
  const existing = readState(options.name);
  if (existing && processIsRunning(existing.pid)) {
    if (await health(existing.url)) {
      print({ ok: true, state: "running", managed: true, ...existing });
      return 0;
    }
    throw new Error(`Managed process ${existing.pid} is running but ${existing.url}/api/health is unavailable; inspect ${existing.log_path}`);
  }

  const url = `http://${options.host}:${options.port}`;
  if (await health(url)) throw new Error(`${url} is already served by an unmanaged healthy process; stop it explicitly or choose another port`);

  const directory = serviceDirectory(options.name);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const logPath = join(directory, "service.log");
  const log = openSync(logPath, "a", 0o600);
  const tsx = resolve(repoRoot, "node_modules", ".bin", "tsx");
  if (!existsSync(tsx)) {
    closeSync(log);
    throw new Error("Missing node_modules/.bin/tsx; run npm ci first");
  }
  const child = spawn(tsx, [options.entry], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      ESPALIER_HOST: options.host,
      ESPALIER_PORT: String(options.port),
      ESPALIER_DATABASE: options.database,
    },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  if (!child.pid) throw new Error("The local service process did not return a PID");
  child.unref();

  const state: ServiceState = {
    schema_version: 1,
    name: options.name,
    pid: child.pid,
    started_at: new Date().toISOString(),
    repo_root: repoRoot,
    entry: relative(repoRoot, options.entry),
    url,
    database: options.database,
    log_path: logPath,
  };
  writeFileSync(statePath(options.name), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await health(url)) {
      print({ ok: true, state: "running", managed: true, ...state });
      return 0;
    }
    if (!processIsRunning(child.pid)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (processIsRunning(child.pid)) signalManagedTree(child.pid, "SIGTERM");
  rmSync(statePath(options.name), { force: true });
  throw new Error(`Local service did not become healthy at ${url}; inspect ${logPath}`);
}

async function status(options: Options): Promise<number> {
  const state = readState(options.name);
  if (!state) {
    const url = `http://${options.host}:${options.port}`;
    const healthy = await health(url);
    print({ ok: healthy, state: healthy ? "running" : "stopped", managed: false, url });
    return healthy ? 0 : 1;
  }
  const running = processIsRunning(state.pid);
  const healthy = running && await health(state.url);
  print({ ok: healthy, state: healthy ? "running" : running ? "unhealthy" : "stopped", managed: true, ...state });
  return healthy ? 0 : 1;
}

async function stop(options: Options, report: boolean): Promise<number> {
  const state = readState(options.name);
  if (!state) {
    if (report) print({ ok: true, state: "stopped", managed: false, name: options.name });
    return 0;
  }
  if (processIsRunning(state.pid)) {
    signalManagedTree(state.pid, "SIGTERM");
    for (let attempt = 0; attempt < 50 && processIsRunning(state.pid); attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (processIsRunning(state.pid)) throw new Error(`Process ${state.pid} did not stop after SIGTERM; inspect it before taking a stronger action`);
  }
  rmSync(statePath(options.name), { force: true });
  if (report) print({ ok: true, state: "stopped", managed: true, name: options.name, log_path: state.log_path });
  return 0;
}

function signalManagedTree(pid: number, signal: NodeJS.Signals): void {
  // start() launches a detached session so the recorded PID is also the
  // process-group leader. Signalling the group stops both the tsx launcher and
  // its Node child; signalling only the launcher can leave the listening child
  // alive and make restart fail nondeterministically.
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
