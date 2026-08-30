import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from "d3-zoom";
import { cameraForNodes, cameraShowsAnyNode, cameraWithNodeVisible, nodeDisclosureLevel, type LiveCanvasLayout } from "../layout/compileLiveLayout.js";
import { canvasStatePresentation, changeReasonLabel, copy, displayRouteCaption, displayRouteTitle, stateLabel, type Locale } from "../i18n.js";

export interface Camera { x: number; y: number; k: number }

interface Props {
  layout: LiveCanvasLayout;
  locale: Locale;
  selectedRef: string | null;
  initialCamera: Camera | null;
  onCamera: (camera: Camera) => void;
  onSelect: (ref: string | null) => void;
}

export function ProgrammeCanvas({ layout, locale, selectedRef, initialCamera, onCamera, onSelect }: Props) {
  const text = copy[locale];
  const rootRef = useRef<HTMLDivElement>(null);
  const behaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [camera, setCamera] = useState<Camera>(initialCamera ?? { x: 0, y: 0, k: 0.82 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const homeRef = useRef<Camera | null>(null);
  const previousViewportRef = useRef({ width: 0, height: 0 });
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      setViewport({ width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const homeCamera = useCallback((): Camera => {
    const root = rootRef.current;
    const bounds = root?.getBoundingClientRect();
    if (!bounds || !layout.routes.length) return { x: 0, y: 0, k: 0.82 };
    return cameraForNodes(layout.routes.map((route) => route.node), { width: bounds.width, height: bounds.height }, {
      padding: bounds.width < 760 ? 24 : 54,
      minimumScale: 0.28,
      maximumScale: 0.9,
    });
  }, [layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const behavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.28, 1.55])
      .filter((event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, input, a")) return false;
        return !event.ctrlKey || event.type === "wheel";
      })
      .on("zoom", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        const next = { x: event.transform.x, y: event.transform.y, k: event.transform.k };
        cameraRef.current = next;
        setCamera(next);
        onCamera(next);
      });
    behaviorRef.current = behavior;
    const selection = select(root).call(behavior);
    const initial = initialCamera && cameraShowsAnyNode(layout.nodes, initialCamera, { width: root.clientWidth, height: root.clientHeight }) ? initialCamera : homeCamera();
    homeRef.current = homeCamera();
    selection.call(behavior.transform, zoomIdentity.translate(initial.x, initial.y).scale(initial.k));
    return () => { selection.on(".zoom", null); };
  }, [homeCamera, initialCamera, onCamera]);

  const transformBy = useCallback((next: Camera) => {
    const root = rootRef.current;
    const behavior = behaviorRef.current;
    if (!root || !behavior) return;
    select(root).call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.k));
  }, []);
  const zoomBy = useCallback((factor: number) => {
    const root = rootRef.current;
    const behavior = behaviorRef.current;
    if (root && behavior) select(root).call(behavior.scaleBy, factor);
  }, []);
  const reset = useCallback(() => transformBy(homeRef.current ?? homeCamera()), [homeCamera, transformBy]);

  useEffect(() => {
    const previous = previousViewportRef.current;
    previousViewportRef.current = viewport;
    if (previous.width <= 0 || previous.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return;
    if (previous.width === viewport.width && previous.height === viewport.height) return;
    if (!cameraShowsAnyNode(layout.nodes, cameraRef.current, viewport)) reset();
  }, [layout.nodes, reset, viewport]);

  useEffect(() => {
    if (!selectedRef || viewport.width <= 0 || viewport.height <= 0) return;
    const selected = layout.nodes.find((node) => node.ref === selectedRef);
    if (!selected) return;
    const next = cameraWithNodeVisible(selected, cameraRef.current, viewport);
    if (next !== cameraRef.current) transformBy(next);
  }, [layout.nodes, selectedRef, transformBy, viewport]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const current = cameraRef.current;
    if (event.key === "ArrowLeft") transformBy({ ...current, x: current.x + 64 });
    else if (event.key === "ArrowRight") transformBy({ ...current, x: current.x - 64 });
    else if (event.key === "ArrowUp") transformBy({ ...current, y: current.y + 64 });
    else if (event.key === "ArrowDown") transformBy({ ...current, y: current.y - 64 });
    else if (event.key === "+" || event.key === "=") zoomBy(1.16);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / 1.16);
    else if (event.key === "0") reset();
    else return;
    event.preventDefault();
  };
  const onPointerDown = (event: ReactMouseEvent<HTMLDivElement>) => { pointerOrigin.current = { x: event.clientX, y: event.clientY }; };
  const onSurfaceClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains("canvas-world")) return;
    const origin = pointerOrigin.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) onSelect(null);
  };
  const routeByRef = useMemo(() => new Map(layout.routes.map((route) => [route.ref, route])), [layout.routes]);

  return (
    <section className="programme-canvas" data-testid="programme-canvas" aria-label={text.canvas}>
      <div
        ref={rootRef}
        className="canvas-viewport"
        tabIndex={0}
        role="region"
        aria-label={`${text.canvas}. ${text.cameraHint}`}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - 0"
        onKeyDown={onKeyDown}
        onMouseDown={onPointerDown}
        onClick={onSurfaceClick}
      >
        <div className="canvas-world" style={{ width: layout.width, height: layout.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}>
          <svg className="topology-layer" width={layout.width} height={layout.height} aria-hidden="true">
            <path className="programme-rail" d={`M 80 ${layout.rail_y} H ${layout.width - 100}`} />
            {layout.routes.map((route) => (
              <g key={route.route.route_key} className={`route-stem role-${route.route.branch_role}`}>
                <path d={`M ${route.rail_x} ${route.rail_y} C ${route.rail_x} ${(route.rail_y + route.y) / 2} ${route.x} ${(route.rail_y + route.y) / 2} ${route.x} ${route.y}`} />
                <circle cx={route.rail_x} cy={route.rail_y} r="4" />
              </g>
            ))}
            {layout.edges.map((edge) => (
              <g key={edge.ref} className={`semantic-edge criticality-${edge.criticality}${edge.change_reasons.length ? " meaningfully-changed" : ""}${selectedRef === edge.ref ? " selected" : ""}`}>
                <path className="edge-hit" d={edge.path} onClick={() => onSelect(edge.ref)} />
                <path className="edge-line" d={edge.path} />
              </g>
            ))}
            <path className="workfront-deck-rule" d={`M 60 ${layout.rail_y + 450} H ${layout.width - 80}`} />
          </svg>

          {layout.edges.map((edge) => (
            <button
              type="button"
              key={`${edge.ref}:label`}
              className={`relation-tag${selectedRef === edge.ref ? " selected" : ""}`}
              data-testid="canvas-relation"
              style={{ left: edge.label_x, top: edge.label_y }}
              onClick={(event) => { event.stopPropagation(); onSelect(edge.ref); }}
              aria-label={`${text.relations}: ${text.relationLabel(edge.relation_type)}${edge.change_reasons.length ? `, ${edge.change_reasons.map((reason) => changeReasonLabel(reason, locale)).join(", ")}` : ""}`}
            >{edge.change_reasons.length ? "Δ " : ""}{text.relationLabel(edge.relation_type)}</button>
          ))}

          <div className="rail-origin" style={{ top: layout.rail_y - 32 }}><span>OWNER-APPROVED PROGRAMME</span><b>{layout.routes.length} stages</b></div>
          {layout.routes.map((route) => (
            <span key={`${route.ref}:rank`} className={`rank-label${route === layout.suggested_entry_route ? " suggested" : ""}`} style={{ left: route.rail_x, top: route.rail_y }}>
              {route.route.programme_order_index === undefined ? "·" : String(route.route.programme_order_index + 1).padStart(2, "0")}
            </span>
          ))}
          {layout.suggested_entry_route ? <span className="suggested-entry-label" style={{ left: layout.suggested_entry_route.rail_x, top: layout.suggested_entry_route.rail_y + 23 }}>{text.proposedNextSlice}</span> : null}
          <div className="workfront-deck-heading" style={{ left: 70, top: layout.rail_y + 400 }}>
            <strong>{text.unlocated}</strong><span>{text.unlocatedNote(
              layout.diagnostics.unlocated_verified_evidence_count,
              layout.diagnostics.unlocated_unverified_evidence_count,
              layout.diagnostics.unlocated_owner_call_count,
              layout.diagnostics.unlocated_workfront_count,
            )}</span>
          </div>
          {layout.shelf_lanes.map((lane) => (
            <div key={lane.role} className={`signal-lane-label role-${lane.role}`} style={{ left: 70, top: lane.label_y }}>
              <strong>{text.shelfLaneLabel(lane.role)}</strong>
              <span>{text.shelfLanePurpose(lane.role)}</span>
            </div>
          ))}

          {layout.nodes.map((node) => {
            const route = routeByRef.get(node.ref);
            const attention = layout.attention_by_ref[node.ref] ?? [];
            const label = route ? displayRouteTitle(route.route, locale) : node.title;
            const state = route ? null : canvasStatePresentation(node.kind, node.state, locale);
            const changes = node.change_reasons ?? [];
            const proofReceipt = node.shelf_lane === "evidence" && node.state === "verified";
            const changeSignal = node.shelf_lane === "evidence" && node.state !== "verified";
            const disclosure = nodeDisclosureLevel(node, camera, viewport);
            const routeHasVisibleWork = route ? layout.nodes.some((candidate) => candidate.route_key === route.route.route_key && candidate.ref !== route.ref && candidate.kind === "work") : false;
            const routeCaption = route && !routeHasVisibleWork ? displayRouteCaption(route.route, node.subtitle, locale) : null;
            return (
              <button
                type="button"
                key={node.ref}
                className={`canvas-node kind-${node.kind} state-${node.state} disclosure-${disclosure}${route && !routeCaption ? " captionless-route" : ""}${node.unlocated ? " unlocated" : ""}${node.shelf_lane ? ` shelf-${node.shelf_lane}` : ""}${proofReceipt ? " role-proof-receipt" : ""}${changeSignal ? " role-change-signal" : ""}${node.operator ? " has-operator" : ""}${changes.length ? " meaningfully-changed" : ""}${selectedRef === node.ref ? " selected" : ""}${route === layout.suggested_entry_route ? " suggested-entry" : ""}`}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                onClick={(event) => { event.stopPropagation(); onSelect(node.ref); }}
                data-ref={node.ref}
                data-located={node.unlocated ? "false" : "true"}
                data-disclosure={disclosure}
                aria-label={`${label}, ${state?.accessible ?? stateLabel(node.state, locale)}${node.operator ? `, ${text.operator}: ${node.operator.principal_id}` : ""}${changes.length ? `, ${changes.map((reason) => changeReasonLabel(reason, locale)).join(", ")}` : ""}${attention.length ? `, ${text.attention} ${attention.length}` : ""}`}
                title={node.title}
              >
                {!route ? <span className="node-kicker">{node.kind}</span> : null}
                {state || node.operator || changes.length ? <span className="node-meta">
                  {node.operator ? <span className="operator-mark" title={`${text.operator}: ${node.operator.principal_id}`}><i aria-hidden="true" />{node.operator.principal_id}</span> : null}
                  {changes.length ? <span className="change-mark" title={changes.map((reason) => changeReasonLabel(reason, locale)).join(" · ")} aria-label={changes.map((reason) => changeReasonLabel(reason, locale)).join(" · ")}>Δ</span> : null}
                  {state ? <span className="node-state" data-state={node.state} title={state.accessible} aria-hidden="true">{state.visual}</span> : null}
                </span> : null}
                <strong>{label}</strong>
                {routeCaption ? <span className="route-caption">{routeCaption}</span> : node.subtitle && !route && !proofReceipt ? <span className="node-summary">{node.subtitle}</span> : null}
                {attention.length ? <i className="attention-pip" aria-hidden="true">{attention.length}</i> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="camera-controls" aria-label={text.cameraHint}>
        <button type="button" onClick={() => zoomBy(1 / 1.16)} aria-label={text.zoomOut}>−</button>
        <button type="button" onClick={reset} aria-label={text.reset}>0</button>
        <button type="button" onClick={() => zoomBy(1.16)} aria-label={text.zoomIn}>+</button>
        <span>{Math.round(camera.k * 100)}%</span>
        <small>{text.cameraHint}</small>
      </div>
    </section>
  );
}
