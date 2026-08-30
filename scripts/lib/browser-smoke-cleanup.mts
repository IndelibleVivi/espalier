import { rmSync } from "node:fs";

interface StoppableProcess {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (...arguments_: unknown[]) => void): unknown;
}

export async function cleanupBrowserSmoke(
  process_: StoppableProcess | undefined,
  temporaryRoot: string,
  timeoutMs = 5_000,
): Promise<void> {
  try {
    if (process_ && process_.exitCode === null) {
      process_.kill("SIGTERM");
      await waitForExit(process_, timeoutMs);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function waitForExit(process_: StoppableProcess, timeoutMs: number): Promise<void> {
  if (process_.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      process_.kill("SIGKILL");
      reject(new Error("Browser-smoke service did not stop after SIGTERM"));
    }, timeoutMs);
    process_.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}
