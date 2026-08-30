import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("installed CLI launcher", () => {
  it("resolves its own workspace dependencies instead of the caller's tsconfig paths", () => {
    const caller = mkdtempSync(join(tmpdir(), "espalier-caller-"));
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    try {
      writeFileSync(join(caller, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@espalier/adapters": ["./fake-adapters.ts"] },
        },
      }));
      writeFileSync(join(caller, "fake-adapters.ts"), "export const negotiateCapabilities = () => ({ compatible: false });\n");

      const result = spawnSync(process.execPath, [join(repoRoot, "bin", "espalier.mjs"), "--help"], {
        cwd: caller,
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("espalier doctor");
    } finally {
      rmSync(caller, { recursive: true, force: true });
    }
  });
});
