import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const artifactDirectory = resolve(process.env.BROWSER_SMOKE_ARTIFACT_DIR ?? "artifacts/browser-smoke");

interface BrowserSummary {
  format: "espalier.browser-smoke-receipt/1";
  status: "running" | "passed" | "failed";
  browser: "chromium";
  project_id: "orchard";
  viewport: { width: 1280; height: 720 };
  retry: number;
  initial_revision: number | null;
  mutation_revision: number | null;
  node_count: number;
  relation_count: number;
  page_error_count: number;
  console_error_count: number;
  assertions: Record<string, boolean>;
}

test("real service renders Orchard and refreshes through SSE", async ({ page }, testInfo) => {
  mkdirSync(artifactDirectory, { recursive: true });
  const pageErrors: string[] = [];
  const consoleEntries: Array<{ type: string; text: string }> = [];
  const summary: BrowserSummary = {
    format: "espalier.browser-smoke-receipt/1",
    status: "running",
    browser: "chromium",
    project_id: "orchard",
    viewport: { width: 1280, height: 720 },
    retry: testInfo.retry,
    initial_revision: null,
    mutation_revision: null,
    node_count: 0,
    relation_count: 0,
    page_error_count: 0,
    console_error_count: 0,
    assertions: {},
  };
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => consoleEntries.push({ type: message.type(), text: message.text() }));

  try {
    await page.goto("/?lang=en");
    await expect(page.getByTestId("live-shell")).toBeVisible();
    await expect(page).toHaveTitle(/Espalier · Orchard/);
    await expect(page.getByTestId("programme-canvas")).toBeVisible();
    summary.assertions.meaningful_root = true;

    const nodes = page.locator("[data-ref]");
    const relations = page.getByTestId("canvas-relation");
    summary.node_count = await nodes.count();
    summary.relation_count = await relations.count();
    expect(summary.node_count).toBeGreaterThanOrEqual(5);
    expect(summary.relation_count).toBeGreaterThanOrEqual(1);
    summary.assertions.nodes_and_relations = true;

    const selectedNode = page.locator('[data-ref="espalier://orchard/work/reader-onboarding"]');
    const sourceAuthoredTitle = await selectedNode.locator("strong").innerText();
    await selectedNode.click();
    await expect(page.getByTestId("inspector").getByRole("heading", { level: 2 })).toHaveText(sourceAuthoredTitle);
    summary.assertions.inspector_selection = true;

    await page.getByRole("button", { name: "中文", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByText("Orchard programme 侧翼", { exact: true })).toBeVisible();
    await expect(selectedNode.locator("strong")).toHaveText(sourceAuthoredTitle);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    summary.assertions.locale_preserves_source_content = true;

    const connection = page.locator(".connection");
    await expect(page.getByTestId("live-shell")).toHaveAttribute("data-connection", "live");
    summary.initial_revision = revisionFrom(await connection.innerText());
    const mutation = await page.evaluate(async () => {
      const sessionResponse = await fetch("/api/session");
      const session = await sessionResponse.json() as { local_token: string };
      const projectsResponse = await fetch("/api/projects");
      const projects = await projectsResponse.json() as Array<{ id: string; project_revision: number }>;
      const project = projects.find((candidate) => candidate.id === "orchard");
      if (!project) throw new Error("Orchard project is missing before the SSE mutation");
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "x-espalier-local-token": session.local_token },
        body: JSON.stringify({
          command_id: crypto.randomUUID(),
          project_id: "orchard",
          actor: {
            principal_id: "browser-smoke-agent",
            runtime_id: "playwright",
            device_id: "github-runner",
            session_id: "browser-smoke",
            role: "worker",
            capabilities: ["read", "write", "claim", "evidence"],
          },
          base_project_revision: project.project_revision,
          base_entity_versions: {},
          type: "evidence.attach",
          occurred_at: new Date().toISOString(),
          payload: {
            id: "browser-smoke-sse",
            target_refs: ["esp:orchard/work/release-package"],
            kind: "browser-smoke",
            origin: "observed",
            ref: "ci:browser-smoke",
            summary: "The required browser smoke emitted this neutral synthetic update",
            verification_state: "unverified",
          },
        }),
      });
      const receipt = await response.json() as { accepted?: boolean; new_project_revision?: number; reason?: string };
      if (!response.ok || !receipt.accepted || !receipt.new_project_revision) throw new Error(`Browser mutation failed: ${JSON.stringify(receipt)}`);
      return receipt.new_project_revision;
    });
    summary.mutation_revision = mutation;
    await expect(connection).toContainText(`r${mutation}`);
    await expect(page.locator('[data-ref="espalier://orchard/evidence/browser-smoke-sse"]')).toBeVisible();
    summary.assertions.sse_mutation_refresh = true;

    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.locator("#root")).not.toContainText("Discovering the local authority domain");
    await expect(page.locator("#root")).not.toContainText("Reading the live session");
    summary.assertions.no_framework_overlay_or_loading_loop = true;

    const consoleErrors = consoleEntries.filter((entry) => entry.type === "error");
    summary.page_error_count = pageErrors.length;
    summary.console_error_count = consoleErrors.length;
    expect(pageErrors, "pageerror events").toEqual([]);
    expect(consoleErrors, "browser console errors").toEqual([]);
    summary.assertions.console_and_page_health = true;
    summary.status = "passed";
  } finally {
    if (summary.status !== "passed") summary.status = "failed";
    summary.page_error_count = pageErrors.length;
    summary.console_error_count = consoleEntries.filter((entry) => entry.type === "error").length;
    writeFileSync(resolve(artifactDirectory, "browser-console.json"), `${JSON.stringify(consoleEntries, null, 2)}\n`);
    writeFileSync(resolve(artifactDirectory, "browser-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
});

function revisionFrom(value: string): number {
  const revision = /\br(\d+)\b/.exec(value)?.[1];
  if (!revision) throw new Error(`Unable to read a revision from '${value}'`);
  return Number(revision);
}
