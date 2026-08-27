import { createReadStream, existsSync, statSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextBudgetError, ContextCompiler, type BriefInput } from "@espalier/context-compiler";
import type { EspalierCore } from "@espalier/core";
import { HumanPortfolioBudgetError, HumanSurfaceBudgetError, Projector } from "@espalier/projections";
import type { HumanSurfaceOptions } from "@espalier/projections";
import { COMMAND_TYPES, PROTOCOL_VERSION, SCHEMA_VERSION, type CapabilityManifest, type CommandEnvelope, type ProjectExport } from "@espalier/protocol";
import { isLoopbackHost } from "./paths.js";

export interface ServerOptions {
  core: EspalierCore;
  webDist?: string;
  localToken?: string;
}

class HttpBoundaryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function eventMatchesProject(projectFilter: string | undefined, eventProjectId: string): boolean {
  return projectFilter === undefined || projectFilter === eventProjectId;
}

export function capabilityManifest(): CapabilityManifest {
  return {
    schema_version: SCHEMA_VERSION,
    protocol_version: PROTOCOL_VERSION,
    compatible_protocol_versions: [PROTOCOL_VERSION],
    commands: [...COMMAND_TYPES],
    projections: ["human-surface", "live", "focus", "decisions", "atlas", "portfolio"],
    transports: ["http-json", "sse"],
    features: ["bounded-brief", "stable-refs", "multi-owner-approval", "batch-lanes", "repo-overlap-warnings", "consistent-backup", "fts-cjk-search", "epoch-compaction", "portable-export-restore", "portfolio", "dca-snapshot", "observability-metrics", "human-surface@0", "projection-only-routes", "meaningful-delta", "personal-view-state-boundary"],
    deployment_boundary: "localhost-local-token",
  };
}

export function createEspalierServer(options: ServerOptions): Server {
  const projector = new Projector(options.core);
  const compiler = new ContextCompiler(options.core);
  const localToken = options.localToken ?? randomBytes(32).toString("base64url");
  if (localToken.length < 32) throw new Error("Espalier local token must contain at least 32 characters");
  const webDist = options.webDist ?? fileURLToPath(new URL("../../web/dist", import.meta.url));
  const streams = new Map<ServerResponse, string | undefined>();
  const stopEvents = options.core.onEvent((event) => {
    const payload = `id: ${event.event_sequence}\nevent: project-event\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [stream, projectId] of streams) {
      if (eventMatchesProject(projectId, event.project_id)) stream.write(payload);
    }
  });
  const heartbeat = setInterval(() => {
    for (const stream of streams.keys()) stream.write(": keep-alive\n\n");
  }, 20_000);
  heartbeat.unref();

  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) validateRequestBoundary(request);
      if (request.method === "POST") requireJsonContentType(request);
      if (request.method === "POST" && (url.pathname === "/api/commands" || url.pathname === "/api/restore")) requireLocalToken(request, localToken);
      if (request.method === "GET" && url.pathname === "/api/session") {
        return json(response, 200, { local_token: localToken, scope: "mutation-and-restore", deployment_boundary: "localhost-local-token" });
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, { ok: true, schema_version: SCHEMA_VERSION, protocol_version: PROTOCOL_VERSION, canonical_writer: true });
      }
      if (request.method === "GET" && url.pathname === "/api/capabilities") {
        return json(response, 200, capabilityManifest());
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        return json(response, 200, options.core.listProjects());
      }
      if (request.method === "GET" && url.pathname === "/api/search") {
        const query = requiredParam(url, "q");
        const projectId = url.searchParams.get("project_id") ?? undefined;
        const requestedLimit = Number(url.searchParams.get("limit") ?? 30);
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error("Search limit must be a positive integer");
        const limit = Math.min(100, requestedLimit);
        return json(response, 200, options.core.search(query, projectId, limit));
      }
      const exportMatch = /^\/api\/projects\/([^/]+)\/export$/.exec(url.pathname);
      if (request.method === "GET" && exportMatch) {
        return json(response, 200, options.core.exportProject(decodeURIComponent(exportMatch[1]!)));
      }
      const metricsMatch = /^\/api\/projects\/([^/]+)\/metrics$/.exec(url.pathname);
      if (request.method === "GET" && metricsMatch) {
        return json(response, 200, projector.metrics(decodeURIComponent(metricsMatch[1]!)));
      }
      if (request.method === "POST" && url.pathname === "/api/restore") {
        const body = await readJson<{ confirmation: string; project: ProjectExport }>(request);
        if (body.confirmation !== "RESTORE_PROJECT") return json(response, 400, { error: "Restore requires confirmation RESTORE_PROJECT" });
        options.core.restoreProject(body.project);
        return json(response, 201, { restored: true, project_id: body.project.project_id, project_revision: body.project.project_revision });
      }
      if (request.method === "POST" && url.pathname === "/api/commands") {
        const command = await readJson<CommandEnvelope>(request);
        const receipt = options.core.execute(command);
        return json(response, receipt.accepted ? 200 : conflictStatus(receipt.code), receipt);
      }
      if (request.method === "GET" && url.pathname === "/api/focus") {
        const ref = requiredParam(url, "ref");
        return json(response, 200, projector.focus(ref));
      }
      if (request.method === "GET" && url.pathname === "/api/portfolio") {
        const projectBudget = optionalPositiveInteger(url, "project_budget");
        const portfolioRelationBudget = optionalPositiveInteger(url, "relation_budget");
        const attentionBudget = optionalPositiveInteger(url, "attention_budget");
        const responseByteBudget = optionalPositiveInteger(url, "response_byte_budget");
        return json(response, 200, projector.portfolio({
          ...(projectBudget ? { project_budget: projectBudget } : {}),
          ...(portfolioRelationBudget ? { relation_budget: portfolioRelationBudget } : {}),
          ...(attentionBudget ? { attention_budget: attentionBudget } : {}),
          ...(responseByteBudget ? { response_byte_budget: responseByteBudget } : {}),
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/dca") {
        const projectId = requiredParam(url, "project_id");
        const focusRef = url.searchParams.get("ref") ?? undefined;
        return json(response, 200, projector.dca(projectId, focusRef));
      }
      if (request.method === "GET" && url.pathname === "/api/inspect") {
        const ref = requiredParam(url, "ref");
        return json(response, 200, projector.focus(ref));
      }
      const projectionMatch = /^\/api\/projects\/([^/]+)\/projections\/(live|decisions|atlas)$/.exec(url.pathname);
      if (request.method === "GET" && projectionMatch) {
        const projectId = decodeURIComponent(projectionMatch[1]!);
        const projection = projectionMatch[2]!;
        if (projection === "live") {
          const nodeBudget = optionalPositiveInteger(url, "node_budget");
          const relationBudget = optionalPositiveInteger(url, "relation_budget");
          return json(response, 200, projector.live(projectId, {
            ...(nodeBudget ? { visible_node_budget: nodeBudget } : {}),
            ...(relationBudget ? { relation_budget: relationBudget } : {}),
          }));
        }
        if (projection === "decisions") return json(response, 200, projector.decisions(projectId));
        return json(response, 200, projector.atlas(projectId));
      }
      const humanSurfaceMatch = /^\/api\/projects\/([^/]+)\/human-surface$/.exec(url.pathname);
      if (request.method === "POST" && humanSurfaceMatch) {
        const projectId = decodeURIComponent(humanSurfaceMatch[1]!);
        const body = await readJson<HumanSurfaceOptions>(request);
        return json(response, 200, projector.humanSurface(projectId, body));
      }
      const briefMatch = /^\/api\/projects\/([^/]+)\/brief$/.exec(url.pathname);
      if (request.method === "POST" && briefMatch) {
        const projectId = decodeURIComponent(briefMatch[1]!);
        const body = await readJson<Omit<BriefInput, "project_id">>(request);
        return json(response, 200, compiler.compile({ ...body, project_id: projectId }));
      }
      const changesMatch = /^\/api\/projects\/([^/]+)\/changes$/.exec(url.pathname);
      if (request.method === "GET" && changesMatch) {
        const projectId = decodeURIComponent(changesMatch[1]!);
        const since = Number(url.searchParams.get("since") ?? 0);
        return json(response, 200, options.core.listEvents(projectId, Number.isFinite(since) ? since : 0));
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        response.write(`event: ready\ndata: ${JSON.stringify({ project_id: url.searchParams.get("project_id") })}\n\n`);
        streams.set(response, url.searchParams.get("project_id") ?? undefined);
        request.on("close", () => streams.delete(response));
        return;
      }
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveStatic(response, webDist, url.pathname);
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      const budgetError = budgetErrorBody(error);
      if (budgetError) return json(response, 422, { error: budgetError });
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof HttpBoundaryError ? error.status : message.startsWith("Missing") || message.startsWith("Unknown") ? 404 : 400;
      return json(response, status, { error: message });
    }
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error(String(error))));
  });

  let cleanupStarted = false;
  const cleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    clearInterval(heartbeat);
    stopEvents();
    for (const stream of streams.keys()) stream.end();
    streams.clear();
  };
  server.on("close", cleanup);
  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    // End the long-lived SSE responses before asking Node to wait for active
    // connections. Cleaning them only from the eventual `close` event creates
    // a shutdown deadlock whenever a live Human Surface is connected.
    cleanup();
    return close(callback);
  }) as Server["close"];
  const listen = server.listen.bind(server);
  server.listen = ((...args: unknown[]) => {
    const first = args[0];
    const host = typeof first === "object" && first !== null
      ? (first as { host?: unknown }).host
      : typeof first === "number" && typeof args[1] === "string"
        ? args[1]
        : undefined;
    if (typeof host !== "string" || !isLoopbackHost(host)) throw new Error("This Espalier candidate has no remote authentication boundary and refuses non-loopback binding");
    return (listen as (...listenArgs: unknown[]) => Server)(...args);
  }) as Server["listen"];
  return server;
}

function budgetErrorBody(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof HumanSurfaceBudgetError || error instanceof HumanPortfolioBudgetError || error instanceof ContextBudgetError)) return undefined;
  return { code: error.code, message: error.message, ...error.toJSON() };
}

function validateRequestBoundary(request: IncomingMessage): void {
  const hostHeader = request.headers.host;
  if (!hostHeader) throw new HttpBoundaryError(403, "Local API requires a Host header");
  let hostname: string;
  try { hostname = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, ""); }
  catch { throw new HttpBoundaryError(403, "Local API Host header is malformed"); }
  if (!isLoopbackHost(hostname)) throw new HttpBoundaryError(403, "Local API rejects non-loopback Host headers");
  if (request.headers["sec-fetch-site"] === "cross-site") throw new HttpBoundaryError(403, "Local API rejects cross-site browser requests");
  const origin = request.headers.origin;
  if (!origin) return;
  let originUrl: URL;
  try { originUrl = new URL(origin); }
  catch { throw new HttpBoundaryError(403, "Local API Origin header is malformed"); }
  if (originUrl.protocol !== "http:" || originUrl.host !== hostHeader) throw new HttpBoundaryError(403, "Local API rejects cross-origin browser requests");
}

function requireJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpBoundaryError(415, "POST requests require Content-Type application/json");
}

function requireLocalToken(request: IncomingMessage, expected: string): void {
  const supplied = request.headers["x-espalier-local-token"];
  if (typeof supplied !== "string") throw new HttpBoundaryError(403, "Mutation and restore require the local Espalier token");
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) throw new HttpBoundaryError(403, "Local Espalier token is invalid");
}

function conflictStatus(code: string): number {
  if (code === "authority" || code === "capability") return 403;
  if (code === "not-found") return 404;
  if (code === "stale" || code === "claim-conflict") return 409;
  return 422;
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`Missing query parameter ${name}`);
  return value;
}

function optionalPositiveInteger(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_048_576) throw new Error("Request body exceeds 1 MiB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error("Request body is required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function serveStatic(response: ServerResponse, webDist: string, pathname: string): void {
  if (!existsSync(webDist)) return json(response, 404, { error: "Web application is not built" });
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filename = resolve(webDist, relative);
  if (!filename.startsWith(resolve(webDist))) return json(response, 404, { error: "Not found" });
  if (!existsSync(filename) || statSync(filename).isDirectory()) filename = resolve(webDist, "index.html");
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
  response.writeHead(200, { "content-type": types[extname(filename)] ?? "application/octet-stream", "cache-control": extname(filename) === ".html" ? "no-cache" : "public, max-age=31536000, immutable" });
  createReadStream(filename).pipe(response);
}
