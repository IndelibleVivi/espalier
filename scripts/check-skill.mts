import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSkillMarkdown } from "./lib/ci-foundation.mjs";

const skillPath = resolve(process.argv[2] ?? "skills/espalier/SKILL.md");
const result = validateSkillMarkdown(skillPath, readFileSync(skillPath, "utf8"));
if (result.errors.length > 0) {
  process.stderr.write(`Skill validation failed for ${skillPath}:\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Skill validation passed: ${skillPath}\n`);
}
