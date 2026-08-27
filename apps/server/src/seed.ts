import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EspalierCore } from "@espalier/core";
import { defaultDatabasePath } from "./paths.js";
import { seedExampleFixture } from "./fixture.js";

const databasePath = process.env.ESPALIER_DATABASE ?? defaultDatabasePath();
mkdirSync(dirname(databasePath), { recursive: true });
const core = new EspalierCore(databasePath);
try {
  const result = seedExampleFixture(core);
  process.stdout.write(`${result.seeded ? "Seeded example fixture at" : "Example fixture already exists at"} revision ${result.revision}\nDatabase: ${databasePath}\n`);
} finally {
  core.close();
}
