import type { CapabilityManifest, CommandEnvelope, CommandReceipt, DcaSnapshot, ProjectExport, SearchHit } from "@espalier/protocol";

export interface EspalierApiErrorDetails {
  code: string;
  message: string;
  [key: string]: unknown;
}

export class EspalierApiError extends Error {
  readonly name = "EspalierApiError";
  readonly code: string;

  constructor(readonly status: number, readonly details: EspalierApiErrorDetails) {
    super(details.message);
    this.code = details.code;
  }
}

export class EspalierClient {
  private localToken: string | undefined;

  constructor(readonly baseUrl = "http://127.0.0.1:4317", localToken?: string) {
    this.localToken = localToken;
  }

  private async mutationToken(): Promise<string> {
    if (this.localToken) return this.localToken;
    const response = await fetch(new URL("/api/session", this.baseUrl), { headers: { accept: "application/json" } });
    const body = await response.json() as { local_token?: string; error?: string };
    if (!response.ok || !body.local_token) throw new Error(body.error ?? "Espalier server did not provide a local mutation token");
    this.localToken = body.local_token;
    return body.local_token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const mutation = init?.method === "POST" && (path === "/api/commands" || path === "/api/restore");
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { "content-type": "application/json", ...(mutation ? { "x-espalier-local-token": await this.mutationToken() } : {}), ...init?.headers },
    });
    const body = await response.json() as T | { error: string | EspalierApiErrorDetails };
    if (!response.ok) {
      const error = "error" in (body as object) ? (body as { error: string | EspalierApiErrorDetails }).error : undefined;
      if (error && typeof error === "object" && typeof error.code === "string" && typeof error.message === "string") throw new EspalierApiError(response.status, error);
      throw new Error(typeof error === "string" ? error : `Espalier server returned ${response.status}`);
    }
    return body as T;
  }

  health<T = { ok: boolean; schema_version: number; protocol_version: string }>(): Promise<T> { return this.request<T>("/api/health"); }
  capabilities(): Promise<CapabilityManifest> { return this.request<CapabilityManifest>("/api/capabilities"); }
  projects<T = unknown[]>(): Promise<T> { return this.request<T>("/api/projects"); }
  search(query: string, projectId?: string, limit = 30): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (projectId) params.set("project_id", projectId);
    return this.request<SearchHit[]>(`/api/search?${params.toString()}`);
  }
  exportProject(projectId: string): Promise<ProjectExport> { return this.request<ProjectExport>(`/api/projects/${encodeURIComponent(projectId)}/export`); }
  metrics<T = Record<string, number | string>>(projectId: string): Promise<T> { return this.request<T>(`/api/projects/${encodeURIComponent(projectId)}/metrics`); }
  portfolio<T = unknown>(options: { project_budget?: number; relation_budget?: number; attention_budget?: number; response_byte_budget?: number } = {}): Promise<T> {
    const params = new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value)]));
    return this.request<T>(`/api/portfolio${params.size > 0 ? `?${params.toString()}` : ""}`);
  }
  restoreProject(project: ProjectExport, confirmation: "RESTORE_PROJECT"): Promise<{ restored: true; project_id: string; project_revision: number }> { return this.request("/api/restore", { method: "POST", body: JSON.stringify({ confirmation, project }) }); }
  dca(projectId: string, focusRef?: string): Promise<DcaSnapshot> {
    const params = new URLSearchParams({ project_id: projectId });
    if (focusRef) params.set("ref", focusRef);
    return this.request<DcaSnapshot>(`/api/dca?${params.toString()}`);
  }
  projection<T = unknown>(projectId: string, type: "live" | "decisions" | "atlas"): Promise<T> { return this.request<T>(`/api/projects/${encodeURIComponent(projectId)}/projections/${type}`); }
  humanSurface<T = unknown>(projectId: string, input: Record<string, unknown>): Promise<T> { return this.request<T>(`/api/projects/${encodeURIComponent(projectId)}/human-surface`, { method: "POST", body: JSON.stringify(input) }); }
  focus<T = unknown>(ref: string): Promise<T> { return this.request<T>(`/api/focus?ref=${encodeURIComponent(ref)}`); }
  brief<T = unknown>(projectId: string, input: Record<string, unknown>): Promise<T> { return this.request<T>(`/api/projects/${encodeURIComponent(projectId)}/brief`, { method: "POST", body: JSON.stringify(input) }); }
  changes<T = unknown>(projectId: string, since: number): Promise<T> { return this.request<T>(`/api/projects/${encodeURIComponent(projectId)}/changes?since=${since}`); }
  command(command: CommandEnvelope): Promise<CommandReceipt> { return this.request<CommandReceipt>("/api/commands", { method: "POST", body: JSON.stringify(command) }); }
}
