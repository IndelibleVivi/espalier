import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupBrowserSmoke } from "./lib/browser-smoke-cleanup.mjs";

class StubbornProcess extends EventEmitter {
  exitCode: number | null = null;
  readonly signals: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal);
    return true;
  }
}

describe("browser-smoke cleanup", () => {
  it("escalates to SIGKILL and removes the temporary root when SIGTERM times out", async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "espalier-browser-cleanup-"));
    const process_ = new StubbornProcess();

    await expect(cleanupBrowserSmoke(process_, temporaryRoot, 10)).rejects.toThrow(
      "Browser-smoke service did not stop after SIGTERM",
    );

    expect(process_.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(existsSync(temporaryRoot)).toBe(false);
  });
});
