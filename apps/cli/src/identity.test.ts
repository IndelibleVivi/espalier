import { expect, it } from "vitest";
import { harnessIdentity } from "./identity.js";

it("uses the current Codex thread as the adapter session identity when available", () => {
  expect(harnessIdentity({ CODEX_THREAD_ID: "thread-123" })).toEqual({ runtime_id: "codex-app", session_id: "thread-123" });
  expect(harnessIdentity({ CODEX_SESSION_ID: "session-456" })).toEqual({ runtime_id: "codex-app", session_id: "session-456" });
  expect(harnessIdentity({ ESPALIER_RUNTIME_ID: "custom", ESPALIER_SESSION_ID: "stable" })).toEqual({ runtime_id: "custom", session_id: "stable" });
  expect(harnessIdentity({})).toEqual({ runtime_id: "espalier-cli" });
});
