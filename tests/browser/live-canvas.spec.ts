import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const artifactDirectory = resolve(process.env.BROWSER_SMOKE_ARTIFACT_DIR ?? "artifacts/browser-smoke");

type BrowserProfile = "desktop" | "mobile";

interface BrowserProfileSummary {
  format: "espalier.browser-smoke-profile-receipt/1";
  status: "running" | "passed" | "failed";
  browser: "chromium";
  profile: BrowserProfile;
  project_id: "orchard";
  viewport: { width: number; height: number };
  retry: number;
  initial_revision: number | null;
  mutation_revision: number | null;
  node_count: number;
  relation_count: number;
  page_error_count: number;
  console_error_count: number;
  assertions: Record<string, boolean | number>;
}

test("@desktop real service renders Orchard and refreshes through SSE", async ({ page }, testInfo) => {
  const evidence = beginProfile("desktop", { width: 1280, height: 720 }, testInfo, page);
  const { summary, pageErrors, consoleEntries } = evidence;

  try {
    await page.goto("/?lang=en");
    await expect(page.getByTestId("live-shell")).toBeVisible();
    await expect(page).toHaveTitle(/Espalier · Orchard/);
    await expect(page.getByTestId("programme-canvas")).toBeVisible();
    expect(page.viewportSize()).toEqual(summary.viewport);
    summary.assertions.meaningful_root = true;
    summary.assertions.desktop_viewport = true;

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
    await expect(selectedNode).toHaveAttribute("aria-pressed", "true");
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
    await expect(connection).toHaveAttribute("role", "status");
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

    await assertBrowserHealth(page, evidence);
    summary.assertions.no_framework_overlay_or_loading_loop = true;
    summary.assertions.console_and_page_health = true;
    summary.status = "passed";
  } finally {
    writeProfile(evidence);
  }
});

test("@mobile mobile Chromium exposes a keyboard and non-color semantic path", async ({ page }, testInfo) => {
  const evidence = beginProfile("mobile", { width: 390, height: 844 }, testInfo, page);
  const { summary } = evidence;

  try {
    await page.goto("/?lang=en");
    await expect(page.getByTestId("live-shell")).toBeVisible();
    await expect(page.getByTestId("programme-canvas")).toBeVisible();
    expect(page.viewportSize()).toEqual(summary.viewport);
    summary.assertions.meaningful_root = true;
    summary.assertions.mobile_viewport = true;

    const nodes = page.locator("[data-ref]");
    const relations = page.getByTestId("canvas-relation");
    summary.node_count = await nodes.count();
    summary.relation_count = await relations.count();
    expect(summary.node_count).toBeGreaterThanOrEqual(5);
    expect(summary.relation_count).toBeGreaterThanOrEqual(1);
    summary.assertions.nodes_and_relations = true;

    const connection = page.locator(".connection");
    await expect(page.getByTestId("live-shell")).toHaveAttribute("data-connection", "live");
    await expect(connection).toHaveAttribute("role", "status");
    await expect(connection).toContainText(/live · r\d+/i);
    summary.initial_revision = revisionFrom(await connection.innerText());
    summary.assertions.connection_has_text_and_status_semantics = true;

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const chineseControl = page.getByRole("button", { name: "中文", exact: true });
    summary.assertions.tabs_to_locale_control = await focusByTab(page, chineseControl);
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.keyboard.press("Shift+Tab");
    const englishControl = page.getByRole("button", { name: "EN", exact: true });
    await expect(englishControl).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    summary.assertions.locale_controls_work_from_keyboard = true;

    const selectedNode = page.locator('[data-ref="espalier://orchard/work/reader-onboarding"]');
    await expect(selectedNode).toHaveAttribute("aria-pressed", "false");
    summary.assertions.tabs_to_canvas_node = await focusByTab(page, selectedNode, 160);
    await page.keyboard.press("Enter");
    await expect(selectedNode).toHaveAttribute("aria-pressed", "true");
    await expect(selectedNode).toHaveAttribute("aria-label", /.+, .+/);
    await expect(page.getByTestId("inspector")).toBeVisible();
    summary.assertions.selected_state_has_aria_semantics = true;

    const inspectorClose = page.getByTestId("inspector").getByRole("button", { name: "Close", exact: true });
    summary.assertions.tabs_to_inspector_close = await focusByTab(page, inspectorClose, 160);
    await page.keyboard.press("Enter");
    await expect(page.locator(".inspector-slot")).not.toHaveClass(/mobile-open/);
    summary.assertions.inspector_closes_from_keyboard = true;

    await assertBrowserHealth(page, evidence);
    summary.assertions.no_framework_overlay_or_loading_loop = true;
    summary.assertions.console_and_page_health = true;
    summary.status = "passed";
  } finally {
    writeProfile(evidence);
  }
});

function beginProfile(profile: BrowserProfile, viewport: { width: number; height: number }, testInfo: TestInfo, page: Page) {
  mkdirSync(artifactDirectory, { recursive: true });
  const pageErrors: string[] = [];
  const consoleEntries: Array<{ type: string; text: string }> = [];
  const summary: BrowserProfileSummary = {
    format: "espalier.browser-smoke-profile-receipt/1",
    status: "running",
    browser: "chromium",
    profile,
    project_id: "orchard",
    viewport,
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
  return { summary, pageErrors, consoleEntries };
}

async function assertBrowserHealth(page: Page, evidence: ReturnType<typeof beginProfile>): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("#root")).not.toContainText("Discovering the local authority domain");
  await expect(page.locator("#root")).not.toContainText("Reading the live session");
  const consoleErrors = evidence.consoleEntries.filter((entry) => entry.type === "error");
  expect(evidence.pageErrors, "pageerror events").toEqual([]);
  expect(consoleErrors, "browser console errors").toEqual([]);
}

function writeProfile(evidence: ReturnType<typeof beginProfile>): void {
  if (evidence.summary.status !== "passed") evidence.summary.status = "failed";
  evidence.summary.page_error_count = evidence.pageErrors.length;
  evidence.summary.console_error_count = evidence.consoleEntries.filter((entry) => entry.type === "error").length;
  writeFileSync(resolve(artifactDirectory, `browser-console-${evidence.summary.profile}.json`), `${JSON.stringify(evidence.consoleEntries, null, 2)}\n`);
  writeFileSync(resolve(artifactDirectory, `browser-${evidence.summary.profile}-summary.json`), `${JSON.stringify(evidence.summary, null, 2)}\n`);
}

async function focusByTab(page: Page, target: Locator, maximumSteps = 40): Promise<number> {
  await expect(target).toHaveCount(1);
  for (let step = 1; step <= maximumSteps; step += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return step;
  }
  const active = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    label: document.activeElement?.getAttribute("aria-label") ?? null,
    text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
  }));
  throw new Error(`Target did not receive focus within ${maximumSteps} Tab presses; active=${JSON.stringify(active)}`);
}

function revisionFrom(value: string): number {
  const revision = /\br(\d+)\b/.exec(value)?.[1];
  if (!revision) throw new Error(`Unable to read a revision from '${value}'`);
  return Number(revision);
}
