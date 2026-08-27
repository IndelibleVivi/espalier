import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EspalierCore } from "@espalier/core";
import { createEspalierServer } from "./server.js";
import { defaultDatabasePath, isLoopbackHost } from "./paths.js";

const databasePath = process.env.ESPALIER_DATABASE ?? defaultDatabasePath();
mkdirSync(dirname(databasePath), { recursive: true });
const core = new EspalierCore(databasePath);
const port = Number(process.env.ESPALIER_PORT ?? 4317);
const host = process.env.ESPALIER_HOST ?? "127.0.0.1";
if (!isLoopbackHost(host)) throw new Error("This Espalier candidate has no remote authentication boundary and refuses non-loopback binding");
const server = createEspalierServer({ core });
server.listen(port, host, () => {
  process.stdout.write(`Espalier canonical service listening at http://${host}:${port}\nDatabase: ${databasePath}\n`);
});

const shutdown = () => server.close(() => { core.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
