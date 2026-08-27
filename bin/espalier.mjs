#!/usr/bin/env node
import { tsImport } from "tsx/esm/api";

const { runCli } = await tsImport("../apps/cli/src/index.ts", import.meta.url);
process.exitCode = await runCli(process.argv.slice(2));
