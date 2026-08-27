import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDataDirectory(platform = process.platform): string {
  if (process.env.ESPALIER_DATA_DIR) return process.env.ESPALIER_DATA_DIR;
  return platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Espalier")
    : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "espalier");
}

export function defaultDatabasePath(): string {
  return join(defaultDataDirectory(), "espalier.sqlite");
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
