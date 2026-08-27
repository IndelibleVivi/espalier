import type { ChangeReason, RouteProjection, SurfaceEntity } from "@espalier/projections";

export type Locale = "en" | "zh";

export const copy = {
  en: {
    title: "programme sidewing",
    subtitle: "Programme orientation · relations · evidence · owner judgment",
    now: "CURRENT PROGRAMME",
    lanes: "formal lanes",
    verifiedEvidence: "verified evidence present",
    ownerCalls: "owner attention",
    changes: "meaningful changes",
    markSeen: "mark seen",
    operator: "Current operator",
    copyContext: "Copy context for conversation",
    contextCopied: "Context copied",
    contextCopyFailed: "Could not copy context",
    live: "live",
    stale: "stale",
    outline: "Programme + workfronts",
    inspector: "Inspector",
    canvas: "Programme Canvas",
    search: "Find work, lane, evidence…",
    noSelection: "Select a Route, Work, Lane, Evidence, Relation, or owner call.",
    unlocated: "Programme signal register",
    unlocatedNote: (verified: number, unverified: number, owner: number, workfronts: number) => `${verified} quiet proof receipt${verified === 1 ? "" : "s"} · ${unverified} unverified change signal${unverified === 1 ? "" : "s"} · ${owner} owner judgment${owner === 1 ? "" : "s"}${workfronts ? ` · ${workfronts} unanchored workfront${workfronts === 1 ? "" : "s"}` : ""}. Select one for full Inspector detail.`,
    shelfLaneLabel: (role: "workfront" | "owner" | "evidence") => role === "owner" ? "OWNER JUDGMENT" : role === "evidence" ? "PROOF + CHANGE SIGNALS" : "UNANCHORED WORKFRONTS",
    shelfLanePurpose: (role: "workfront" | "owner" | "evidence") => role === "owner" ? "Needs a human call" : role === "evidence" ? "What this claim establishes · what changed" : "Visible without an invented Route",
    routeScope: "Route scope",
    proposedNextSlice: "CURRENT PROGRAMME",
    sourceDetail: "Source / authority detail",
    noSourceDetail: "No bounded detail loaded.",
    ref: "Stable ref",
    state: "State",
    route: "Route",
    attention: "Attention",
    relations: "Relations",
    sourceRefs: "Source refs",
    projectionGap: "Projection gap",
    projectionGapBody: "HumanSurfaceProjection retains this object but does not expose the Batch/Lane parent pointer needed for semantic placement. It remains visible here rather than being attached to an invented Route.",
    outlineOpen: "Open programme outline",
    outlineClose: "Collapse programme outline",
    detailsOpen: "Open details",
    detailsClose: "Collapse details",
    close: "Close",
    reset: "Reset camera",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    cameraHint: "Drag background · wheel/pinch · arrows · + − 0",
    lastUpdated: "updated",
    readOnly: "read-only",
    noResults: "No retained result",
    relationLabel: (type: string) => type === "provides_capability_to" ? "capability →" : type === "depends_on" ? "depends on →" : type === "relates_to" ? "related" : type.replaceAll("_", " "),
    routeSummary: (active: number, verified: number, owner: number) => [[active, "active"], [verified, "verified"], [owner, "owner"]].filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}`).join(" · "),
  },
  zh: {
    title: "programme 侧翼",
    subtitle: "programme 定位 · Relations · Evidence · owner 判断",
    now: "当前 programme",
    lanes: "条 formal lanes",
    verifiedEvidence: "已有 verified Evidence",
    ownerCalls: "项 owner attention",
    changes: "项重要变化",
    markSeen: "标为已读",
    operator: "当前 operator",
    copyContext: "复制对话上下文",
    contextCopied: "上下文已复制",
    contextCopyFailed: "未能复制上下文",
    live: "实时",
    stale: "陈旧",
    outline: "Programme + 工作侧翼",
    inspector: "详情 Inspector",
    canvas: "Programme Canvas",
    search: "查找 Work、Lane、Evidence…",
    noSelection: "选择一条 Route、Work、Lane、Evidence、Relation 或 owner 判断。",
    unlocated: "Programme 信号台",
    unlocatedNote: (verified: number, unverified: number, owner: number, workfronts: number) => `${verified} 条安静的 proof receipt · ${unverified} 条未验证变化 · ${owner} 项 owner 判断${workfronts ? ` · ${workfronts} 个尚未锚定的工作侧翼` : ""}。点选任一 signal，在 Inspector 阅读全文。`,
    shelfLaneLabel: (role: "workfront" | "owner" | "evidence") => role === "owner" ? "OWNER 判断" : role === "evidence" ? "证明回执 + 变化信号" : "尚未锚定的工作侧翼",
    shelfLanePurpose: (role: "workfront" | "owner" | "evidence") => role === "owner" ? "需要人类作出判断" : role === "evidence" ? "这条 claim 证明了什么 · 发生了什么变化" : "不发明 Route，也不让它消失",
    routeScope: "Route 范围",
    proposedNextSlice: "当前 programme",
    sourceDetail: "来源 / 权限详情",
    noSourceDetail: "尚未载入 bounded detail。",
    ref: "稳定 ref",
    state: "状态",
    route: "Route",
    attention: "需要注意",
    relations: "Relations",
    sourceRefs: "来源 refs",
    projectionGap: "Projection 缺口",
    projectionGapBody: "HumanSurfaceProjection 保留了这个对象，却没有暴露 Batch/Lane 语义定位所需的 parent pointer。这里让它诚实可见，不把它硬接到虚构 Route。",
    outlineOpen: "打开 programme 大纲",
    outlineClose: "收起 programme 大纲",
    detailsOpen: "打开详情",
    detailsClose: "收起详情",
    close: "关闭",
    reset: "重置镜头",
    zoomIn: "放大",
    zoomOut: "缩小",
    cameraHint: "拖动背景 · 滚轮/捏合 · 方向键 · + − 0",
    lastUpdated: "更新于",
    readOnly: "只读",
    noResults: "当前 retained projection 无结果",
    relationLabel: (type: string) => type === "provides_capability_to" ? "供给能力 →" : type === "depends_on" ? "依赖 →" : type === "relates_to" ? "相关" : type.replaceAll("_", " "),
    routeSummary: (active: number, verified: number, owner: number) => [[active, "active"], [verified, "verified"], [owner, "owner"]].filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}`).join(" · "),
  },
} as const;

export function displayRouteTitle(route: RouteProjection, _locale: Locale): string {
  return route.title;
}

export function displayRouteCaption(_route: RouteProjection, sourceSubtitle: string | undefined, _locale: Locale): string | null {
  return sourceSubtitle ?? null;
}

export function stateLabel(state: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    active: ["active", "进行中"], proposed: ["proposed", "拟议中"], implemented: ["implemented", "已实现"], closed: ["closed", "已关闭"],
    verified: ["verified", "已验证"], unverified: ["unverified", "未验证"], isolated: ["isolated", "隔离中"], ready: ["ready", "已返回"],
    "needs-integration": ["needs integration", "待集成"], "owner-action": ["owner action", "owner 判断"], notable: ["notable", "需留意"], conflict: ["conflict", "冲突"],
  };
  return labels[state]?.[locale === "zh" ? 1 : 0] ?? state;
}

export function changeReasonLabel(reason: ChangeReason, locale: Locale): string {
  const labels: Record<ChangeReason, [string, string]> = {
    created: ["created", "新建"],
    "work-state-changed": ["Work state changed", "Work 状态已变化"],
    "evidence-threshold-crossed": ["Evidence threshold crossed", "Evidence 已跨过验证阈值"],
    "verification-reopened": ["verification reopened", "验证已重新打开"],
    "authority-changed": ["authority changed", "权限状态已变化"],
    "goal-integrity-changed": ["goal integrity changed", "Goal integrity 已变化"],
    "integration-changed": ["integration changed", "集成状态已变化"],
    "relation-materially-changed": ["Relation materially changed", "Relation 已实质变化"],
    "attention-created": ["Attention opened", "Attention 已出现"],
    "attention-resolved": ["Attention resolved", "Attention 已解决"],
    "annotation-created": ["annotation added", "Annotation 已添加"],
    "annotation-stale": ["annotation stale", "Annotation 已陈旧"],
    "claim-conflict": ["Claim conflict", "Claim 冲突"],
    "claim-stale": ["Claim stale", "Claim 已陈旧"],
    "owner-decision": ["owner decision changed", "owner 判断已变化"],
  };
  return labels[reason][locale === "zh" ? 1 : 0];
}

export interface CanvasStatePresentation {
  visual: string;
  accessible: string;
}

export function canvasStatePresentation(kind: SurfaceEntity["kind"] | "route", state: string, locale: Locale): CanvasStatePresentation | null {
  if ((kind === "route" || kind === "work") && state === "proposed") return null;
  if (kind === "evidence" && state === "verified") return { visual: "✓", accessible: stateLabel(state, locale) };
  if (kind === "decision" && state === "proposed") return locale === "zh"
    ? { visual: "待判断", accessible: "待 owner 判断" }
    : { visual: "owner call", accessible: "owner judgment pending" };
  const label = stateLabel(state, locale);
  return { visual: label, accessible: label };
}
