import type { ChangeReason, HumanSurfaceProjection, RouteProjection, SurfaceEntity } from "@espalier/projections";

export interface LayoutPoint { x: number; y: number }
export type ShelfLane = "workfront" | "owner" | "evidence";

export interface LayoutNode extends LayoutPoint {
  ref: string;
  route_key?: string;
  kind: SurfaceEntity["kind"] | "route";
  title: string;
  subtitle?: string;
  state: string;
  width: number;
  height: number;
  unlocated: boolean;
  shelf_lane?: ShelfLane;
  operator?: { principal_id: string; claim_ref: string };
  change_reasons?: ChangeReason[];
  source?: SurfaceEntity;
}

export interface LayoutShelfLane {
  role: ShelfLane;
  label_y: number;
  node_refs: string[];
}

export interface LayoutRoute {
  route: RouteProjection;
  ref: string;
  x: number;
  y: number;
  rail_x: number;
  rail_y: number;
  direction: -1 | 1;
  node: LayoutNode;
}

export interface LayoutEdge {
  ref: string;
  source_ref: string;
  target_ref: string;
  relation_type: string;
  criticality: string;
  change_reasons: ChangeReason[];
  path: string;
  label_x: number;
  label_y: number;
}

export interface LiveCanvasLayout {
  width: number;
  height: number;
  rail_y: number;
  routes: LayoutRoute[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  shelf_lanes: LayoutShelfLane[];
  attention_by_ref: Record<string, HumanSurfaceProjection["attention"]>;
  home_anchor_route: LayoutRoute | null;
  suggested_entry_route: LayoutRoute | null;
  diagnostics: {
    unlocated_refs: string[];
    lane_count: number;
    owner_attention_count: number;
    unlocated_workfront_count: number;
    programme_signal_count: number;
    unlocated_owner_call_count: number;
    unlocated_verified_evidence_count: number;
    unlocated_unverified_evidence_count: number;
    has_verified_evidence: boolean;
    source_projection_revision: string;
  };
}

const routeWidth = 236;
const routeHeight = 136;
const workHeight = 142;
const evidenceHeight = 142;

export function compileLiveLayout(projection: HumanSurfaceProjection): LiveCanvasLayout {
  const orderedRoutes = [...projection.routes].sort((left, right) => (left.programme_order_index ?? 999) - (right.programme_order_index ?? 999) || left.route_key.localeCompare(right.route_key));
  const width = Math.max(1500, 250 + Math.max(1, orderedRoutes.length - 1) * 300 + 260);
  const railY = 600;
  const entityByRef = new Map(projection.entities.map((entity) => [entity.ref, entity]));
  const routes: LayoutRoute[] = orderedRoutes.map((route, index) => {
    const x = 220 + index * 300;
    const direction: -1 | 1 = index % 2 === 0 ? -1 : 1;
    const y = railY + direction * 185;
    const rootRef = route.root_refs[0] ?? route.route_key;
    const root = entityByRef.get(rootRef);
    const operator = activeWorkOperator(root);
    return {
      route,
      ref: rootRef,
      x,
      y,
      rail_x: x,
      rail_y: railY,
      direction,
      node: {
        ref: rootRef,
        route_key: route.route_key,
        kind: "route",
        title: route.title,
        ...(root?.subtitle ? { subtitle: root.subtitle } : {}),
        state: root?.primary_state ?? route.branch_role,
        x,
        y,
        width: routeWidth,
        height: routeHeight,
        unlocated: false,
        ...(operator ? { operator } : {}),
        ...(root?.change_reasons.length ? { change_reasons: root.change_reasons } : {}),
        ...(root ? { source: root } : {}),
      },
    };
  });

  const routeByKey = new Map(routes.map((route) => [route.route.route_key, route]));
  const nodeByRef = new Map<string, LayoutNode>();
  for (const route of routes) nodeByRef.set(route.ref, route.node);

  for (const route of routes) {
    const members = projection.entities.filter((entity) => entity.kind === "work" && entity.route_key === route.route.route_key && entity.ref !== route.ref)
      .sort((left, right) => (left.programme_order_key ?? left.ref).localeCompare(right.programme_order_key ?? right.ref));
    members.forEach((entity, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const operator = activeWorkOperator(entity);
      const node: LayoutNode = {
        ref: entity.ref,
        route_key: route.route.route_key,
        kind: entity.kind,
        title: entity.title,
        ...(entity.subtitle ? { subtitle: entity.subtitle } : {}),
        state: entity.primary_state,
        x: route.x + (column === 0 ? -110 : 110),
        y: route.y + route.direction * (166 + row * 158),
        width: 198,
        height: workHeight,
        unlocated: false,
        ...(operator ? { operator } : {}),
        ...(entity.change_reasons.length ? { change_reasons: entity.change_reasons } : {}),
        source: entity,
      };
      nodeByRef.set(node.ref, node);
    });
  }

  const evidenceToRoute = new Map<string, LayoutRoute>();
  for (const route of routes) {
    const work = route.node.source;
    for (const ref of work?.receipt_summary?.evidence_refs ?? []) evidenceToRoute.set(ref, route);
  }
  let evidenceIndex = 0;
  for (const entity of projection.entities.filter((candidate) => candidate.kind === "evidence")) {
    const route = evidenceToRoute.get(entity.ref);
    if (!route) continue;
    const node: LayoutNode = {
      ref: entity.ref,
      route_key: route.route.route_key,
      kind: entity.kind,
      title: entity.title,
      ...(entity.subtitle ? { subtitle: entity.subtitle } : {}),
      state: entity.primary_state,
      x: route.x + (evidenceIndex % 2 === 0 ? 228 : -228),
      y: route.y,
      width: 200,
      height: evidenceHeight,
        unlocated: false,
        ...(entity.change_reasons.length ? { change_reasons: entity.change_reasons } : {}),
        source: entity,
    };
    nodeByRef.set(node.ref, node);
    evidenceIndex += 1;
  }

  const retainedUnlocated = projection.entities.filter((entity) => !nodeByRef.has(entity.ref));
  const kindOrder: Record<string, number> = { batch: 0, lane: 1, decision: 2, evidence: 3, claim: 4, hypothesis: 5 };
  retainedUnlocated.sort((left, right) => (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9) || left.ref.localeCompare(right.ref));
  const shelfGroups: Array<{ role: ShelfLane; entities: SurfaceEntity[] }> = [
    { role: "workfront", entities: retainedUnlocated.filter((entity) => entity.kind === "batch" || entity.kind === "lane" || (entity.kind !== "decision" && entity.kind !== "evidence")) },
    { role: "owner", entities: retainedUnlocated.filter((entity) => entity.kind === "decision") },
    { role: "evidence", entities: retainedUnlocated.filter((entity) => entity.kind === "evidence") },
  ];
  const shelfLanes: LayoutShelfLane[] = [];
  const columns = Math.max(1, Math.floor((width - 160) / 292));
  let shelfY = 1200;
  for (const group of shelfGroups) {
    if (group.entities.length === 0) continue;
    const rowHeight = group.role === "owner" ? 150 : group.role === "evidence" ? 118 : 142;
    const rowCount = Math.ceil(group.entities.length / columns);
    const refs: string[] = [];
    group.entities.forEach((entity, index) => {
      const verifiedReceipt = group.role === "evidence" && entity.primary_state === "verified";
      const node: LayoutNode = {
        ref: entity.ref,
        kind: entity.kind,
        title: entity.title,
        ...(entity.subtitle ? { subtitle: entity.subtitle } : {}),
        state: entity.primary_state,
        x: 190 + (index % columns) * 292,
        y: shelfY + Math.floor(index / columns) * (rowHeight + 26),
        width: group.role === "owner" ? 264 : group.role === "evidence" ? 246 : entity.kind === "lane" ? 246 : 224,
        height: verifiedReceipt ? 84 : rowHeight,
        unlocated: true,
        shelf_lane: group.role,
        ...(entity.change_reasons.length ? { change_reasons: entity.change_reasons } : {}),
        source: entity,
      };
      refs.push(node.ref);
      nodeByRef.set(node.ref, node);
    });
    shelfLanes.push({ role: group.role, label_y: shelfY - rowHeight / 2 - 28, node_refs: refs });
    shelfY += rowCount * (rowHeight + 26) + 62;
  }
  const height = Math.max(1440, shelfY - 22);

  const routeNodeForRef = new Map(routes.flatMap((route) => route.route.member_refs.map((ref) => [ref, route.node] as const)));
  const pointFor = (ref: string) => nodeByRef.get(ref) ?? routeNodeForRef.get(ref);
  const edges = projection.relations.flatMap((relation): LayoutEdge[] => {
    const source = pointFor(relation.source_ref);
    const target = pointFor(relation.target_ref);
    if (!source || !target) return [];
    return [{
      ref: relation.ref,
      source_ref: relation.source_ref,
      target_ref: relation.target_ref,
      relation_type: relation.relation_type,
      criticality: relation.criticality,
      change_reasons: relation.change_reasons,
      path: relationPath(source, target),
      label_x: (source.x + target.x) / 2,
      label_y: (source.y + target.y) / 2 - 11,
    }];
  });
  const attentionByRef: Record<string, HumanSurfaceProjection["attention"]> = {};
  for (const item of projection.attention) for (const ref of new Set([item.attention_ref, ...item.anchor_refs])) attentionByRef[ref] = [...(attentionByRef[ref] ?? []), item];
  const suggestedEntryRoute = null;
  const homeAnchorRoute = routes.find((route) => route.route.programme_order_index !== undefined) ?? routes[0] ?? null;
  return {
    width,
    height,
    rail_y: railY,
    routes,
    nodes: [...nodeByRef.values()],
    edges,
    shelf_lanes: shelfLanes,
    attention_by_ref: attentionByRef,
    home_anchor_route: homeAnchorRoute,
    suggested_entry_route: suggestedEntryRoute,
    diagnostics: {
      unlocated_refs: retainedUnlocated.map((entity) => entity.ref),
      lane_count: projection.entities.filter((entity) => entity.kind === "lane").length,
      owner_attention_count: projection.attention.filter((item) => item.severity === "owner-action").length,
      unlocated_workfront_count: retainedUnlocated.filter((entity) => entity.kind === "batch" || entity.kind === "lane").length,
      programme_signal_count: retainedUnlocated.filter((entity) => entity.kind !== "batch" && entity.kind !== "lane").length,
      unlocated_owner_call_count: retainedUnlocated.filter((entity) => entity.kind === "decision").length,
      unlocated_verified_evidence_count: retainedUnlocated.filter((entity) => entity.kind === "evidence" && entity.primary_state === "verified").length,
      unlocated_unverified_evidence_count: retainedUnlocated.filter((entity) => entity.kind === "evidence" && entity.primary_state !== "verified").length,
      has_verified_evidence: projection.entities.some((entity) => entity.kind === "evidence" && entity.primary_state === "verified"),
      source_projection_revision: projection.projection_revision,
    },
  };
}

function activeWorkOperator(entity: SurfaceEntity | undefined): LayoutNode["operator"] {
  if (entity?.kind !== "work" || !entity.claim || entity.claim.stale || entity.claim.mode !== "primary") return undefined;
  return { principal_id: entity.claim.principal_id, claim_ref: entity.claim.ref };
}

export type NodeDisclosure = "contour" | "identity" | "full";

export function cameraForNodes(
  nodes: Array<Pick<LayoutNode, "x" | "y" | "width" | "height">>,
  viewport: { width: number; height: number },
  options: { padding?: number; minimumScale?: number; maximumScale?: number } = {},
): { x: number; y: number; k: number } {
  const padding = options.padding ?? 48;
  const minimumScale = options.minimumScale ?? 0.28;
  const maximumScale = options.maximumScale ?? 0.9;
  if (!nodes.length || viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0, k: maximumScale };

  const left = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const right = Math.max(...nodes.map((node) => node.x + node.width / 2));
  const top = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height / 2));
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const fitScale = Math.min(availableWidth / Math.max(1, right - left), availableHeight / Math.max(1, bottom - top));
  const k = Math.max(minimumScale, Math.min(maximumScale, fitScale));
  return {
    x: viewport.width / 2 - ((left + right) / 2) * k,
    y: viewport.height / 2 - ((top + bottom) / 2) * k,
    k,
  };
}

export function cameraWithNodeVisible(
  node: Pick<LayoutNode, "x" | "y" | "width" | "height">,
  camera: { x: number; y: number; k: number },
  viewport: { width: number; height: number },
  padding = 28,
): { x: number; y: number; k: number } {
  if (viewport.width <= 0 || viewport.height <= 0) return camera;
  const width = node.width * camera.k;
  const height = node.height * camera.k;
  const left = camera.x + (node.x - node.width / 2) * camera.k;
  const right = left + width;
  const top = camera.y + (node.y - node.height / 2) * camera.k;
  const bottom = top + height;
  let x = camera.x;
  let y = camera.y;

  if (width > viewport.width - padding * 2) x = viewport.width / 2 - node.x * camera.k;
  else if (left < padding) x += padding - left;
  else if (right > viewport.width - padding) x -= right - (viewport.width - padding);

  if (height > viewport.height - padding * 2) y = viewport.height / 2 - node.y * camera.k;
  else if (top < padding) y += padding - top;
  else if (bottom > viewport.height - padding) y -= bottom - (viewport.height - padding);

  return x === camera.x && y === camera.y ? camera : { x, y, k: camera.k };
}

export function nodeDisclosureLevel(
  node: Pick<LayoutNode, "x" | "y" | "width" | "height">,
  camera: { x: number; y: number; k: number },
  viewport: { width: number; height: number },
): NodeDisclosure {
  if (viewport.width <= 0 || viewport.height <= 0) return "full";
  const left = camera.x + (node.x - node.width / 2) * camera.k;
  const top = camera.y + (node.y - node.height / 2) * camera.k;
  const width = node.width * camera.k;
  const height = node.height * camera.k;
  const visibleWidth = Math.max(0, Math.min(viewport.width, left + width) - Math.max(0, left));
  const visibleHeight = Math.max(0, Math.min(viewport.height, top + height) - Math.max(0, top));
  const visibleRatio = Math.min(visibleWidth / width, visibleHeight / height);
  if (camera.k < 0.62 || visibleRatio < 0.88) return "contour";
  if (camera.k < 0.8 || visibleRatio < 0.98) return "identity";
  return "full";
}

export function cameraShowsAnyNode(
  nodes: Array<Pick<LayoutNode, "x" | "y" | "width" | "height">>,
  camera: { x: number; y: number; k: number },
  viewport: { width: number; height: number },
  minimumVisiblePixels = 24,
): boolean {
  return nodes.some((node) => {
    const left = camera.x + (node.x - node.width / 2) * camera.k;
    const top = camera.y + (node.y - node.height / 2) * camera.k;
    const right = left + node.width * camera.k;
    const bottom = top + node.height * camera.k;
    const visibleWidth = Math.max(0, Math.min(viewport.width, right) - Math.max(0, left));
    const visibleHeight = Math.max(0, Math.min(viewport.height, bottom) - Math.max(0, top));
    return visibleWidth >= minimumVisiblePixels && visibleHeight >= minimumVisiblePixels;
  });
}

function relationPath(source: LayoutPoint, target: LayoutPoint): string {
  const middle = (source.x + target.x) / 2;
  return `M ${source.x} ${source.y} C ${middle} ${source.y} ${middle} ${target.y} ${target.x} ${target.y}`;
}

export function boxesOverlap(left: Pick<LayoutNode, "x" | "y" | "width" | "height">, right: Pick<LayoutNode, "x" | "y" | "width" | "height">, gap = 10): boolean {
  return Math.abs(left.x - right.x) < (left.width + right.width) / 2 + gap
    && Math.abs(left.y - right.y) < (left.height + right.height) / 2 + gap;
}
