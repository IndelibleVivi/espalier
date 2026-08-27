import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "espalier-进程-smoke-"));
let child: ChildProcess | undefined;
try {
  const port = await availablePort();
  const database = join(root, "带 空格", "espalier.sqlite");
  child = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
    env: { ...process.env, ESPALIER_DATABASE: database, ESPALIER_HOST: "127.0.0.1", ESPALIER_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const health = await waitForHealth(port, child);
  if (health.ok !== true || health.schema_version !== 4 || health.protocol_version !== "0.2") throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
  if (!stdout.includes("Espalier canonical service listening")) throw new Error(`server readiness line missing; stdout=${stdout}; stderr=${stderr}`);

  // Keep one real event stream open while terminating the process. A server
  // that waits for SSE clients before closing will deadlock here; cleanup must
  // end the streams before Node's HTTP close barrier.
  const streamAbort = new AbortController();
  try {
    const stream = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: streamAbort.signal });
    if (!stream.ok || !stream.body) throw new Error(`event stream did not open: HTTP ${stream.status}`);
    const firstChunk = await stream.body.getReader().read();
    if (firstChunk.done || !Buffer.from(firstChunk.value).toString("utf8").includes("event: ready")) throw new Error("event stream did not send its initial ready frame");
    child.kill("SIGTERM");
    await waitForExit(child, 5_000);
  } finally {
    streamAbort.abort();
  }
  process.stdout.write(`Real-process smoke passed on loopback with schema ${health.schema_version} / protocol ${health.protocol_version}, including shutdown with an active SSE client.\n`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await waitForExit(child, 5_000);
  }
  rmSync(root, { recursive: true, force: true });
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("unable to reserve a loopback port")); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(port: number, process_: ChildProcess): Promise<{ ok?: boolean; schema_version?: number; protocol_version?: string }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process_.exitCode !== null) throw new Error(`server process exited before readiness with code ${process_.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return await response.json() as { ok?: boolean; schema_version?: number; protocol_version?: string };
    } catch {
      // The child has not bound its loopback socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server process did not become healthy within 10 seconds");
}

function waitForExit(process_: ChildProcess, timeoutMs: number): Promise<void> {
  if (process_.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { process_.kill("SIGKILL"); reject(new Error("server process did not stop after SIGTERM")); }, timeoutMs);
    process_.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
