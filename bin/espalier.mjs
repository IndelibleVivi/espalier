#!/usr/bin/env node
import { URL } from "node:url";
import { tsImport } from "tsx/esm/api";

const entry = new URL("../apps/cli/src/index.ts", import.meta.url).href;
const { runCli } = await tsImport(entry, { parentURL: import.meta.url, tsconfig: false });
process.exitCode = await runCli(process.argv.slice(2));
