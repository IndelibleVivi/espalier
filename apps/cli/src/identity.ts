export interface HarnessIdentity {
  runtime_id: string;
  session_id?: string;
}

export function harnessIdentity(env: NodeJS.ProcessEnv): HarnessIdentity {
  const codexSession = env.CODEX_THREAD_ID ?? env.CODEX_SESSION_ID;
  const runtimeId = env.ESPALIER_RUNTIME_ID ?? (codexSession ? "codex-app" : "espalier-cli");
  const sessionId = env.ESPALIER_SESSION_ID ?? codexSession;
  return { runtime_id: runtimeId, ...(sessionId ? { session_id: sessionId } : {}) };
}
