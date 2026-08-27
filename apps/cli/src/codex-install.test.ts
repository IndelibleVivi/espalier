import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installCodexSkill } from "./codex-install.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("installs the canonical skill atomically and preserves the replaced copy", () => {
  const root = mkdtempSync(join(tmpdir(), "espalier-codex-install-"));
  roots.push(root);
  const source = join(root, "source", "espalier");
  const codexHome = join(root, "codex-home");
  const target = join(codexHome, "skills", "espalier");
  mkdirSync(join(source, "agents"), { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "---\nname: espalier\ndescription: test\n---\n\n# Espalier\n");
  writeFileSync(join(source, "agents", "openai.yaml"), "interface:\n  display_name: \"Espalier\"\n");
  writeFileSync(join(target, "SKILL.md"), "old skill\n");

  const result = installCodexSkill({
    source,
    codexHome,
    installedAt: "2026-08-27T12:00:00.000Z",
    nonce: "test",
  });

  expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain("name: espalier");
  expect(readFileSync(join(target, "agents", "openai.yaml"), "utf8")).toContain("display_name");
  expect(result.backup_path).toBeTruthy();
  expect(readFileSync(join(result.backup_path!, "SKILL.md"), "utf8")).toBe("old skill\n");
  const manifest = JSON.parse(readFileSync(join(codexHome, "skills", ".espalier-current-manifest.json"), "utf8")) as {
    schema_version: number;
    skill: string;
    files: Array<{ path: string; sha256: string }>;
  };
  expect(manifest.schema_version).toBe(1);
  expect(manifest.skill).toBe("espalier");
  expect(manifest.files.map((item) => item.path)).toEqual(["SKILL.md", "agents/openai.yaml"]);
  expect(manifest.files.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);
});
