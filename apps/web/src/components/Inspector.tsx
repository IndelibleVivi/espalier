import { useEffect, useState } from "react";
import type { CanonicalEntity } from "@espalier/protocol";
import type { LiveCanvasLayout } from "../layout/compileLiveLayout.js";
import { canvasStatePresentation, changeReasonLabel, copy, displayRouteCaption, displayRouteTitle, stateLabel, type Locale } from "../i18n.js";
import { formatConversationContext } from "../state/liveRuntime.js";
import { useFocusDetail } from "../state/useLiveSurface.js";

interface Props {
  projectId: string;
  layout: LiveCanvasLayout;
  locale: Locale;
  selectedRef: string | null;
  projectionRevision: number;
  onSelect: (ref: string) => void;
  onClose?: () => void;
}

export function Inspector({ projectId, layout, locale, selectedRef, projectionRevision, onSelect, onClose }: Props) {
  const text = copy[locale];
  const node = layout.nodes.find((candidate) => candidate.ref === selectedRef);
  const route = layout.routes.find((candidate) => candidate.ref === selectedRef);
  const edge = layout.edges.find((candidate) => candidate.ref === selectedRef);
  const attention = selectedRef ? layout.attention_by_ref[selectedRef] ?? [] : [];
  const { detail, error } = useFocusDetail(selectedRef, projectionRevision);
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const title = route ? displayRouteTitle(route.route, locale) : node?.title ?? edge?.relation_type ?? text.inspector;
  const sourceTitle = route?.route.title ?? node?.title ?? edge?.relation_type ?? "selection";
  const state = node?.state ?? primaryState(detail?.selected);
  const statePresentation = node && state ? canvasStatePresentation(node.kind, state, locale) : null;
  const routeCaption = route ? displayRouteCaption(route.route, node?.subtitle, locale) : null;
  const sourceRefs = detail?.selected.provenance.source_refs ?? [];
  const activeClaim = node?.source?.claim && !node.source.claim.stale ? node.source.claim : null;
  const changeReasons = node?.change_reasons ?? edge?.change_reasons ?? [];
  useEffect(() => { setCopyStatus(null); }, [selectedRef]);
  const copyContext = async () => {
    if (!selectedRef) return;
    try {
      await navigator.clipboard.writeText(formatConversationContext({ project_id: projectId, as_of_revision: projectionRevision, ref: selectedRef, title: sourceTitle }));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  return (
    <aside id="espalier-inspector" className="inspector-rail" aria-label={text.inspector}>
      <div className="rail-heading"><span>{text.inspector}</span>{onClose ? <button type="button" onClick={onClose} aria-label={text.close}>×</button> : null}</div>
      {!selectedRef ? <p className="inspector-empty">{text.noSelection}</p> : (
        <div className="inspector-content">
          <div className="selection-type">{node?.kind ?? detail?.selected.type ?? (edge ? "relation" : "selection")}</div>
          <h2>{title}</h2>
          <div className="selection-context-actions"><button type="button" onClick={() => void copyContext()}>{text.copyContext}</button>{copyStatus ? <span role="status">{copyStatus === "copied" ? text.contextCopied : text.contextCopyFailed}</span> : null}</div>
          {route && routeCaption ? <section className="route-scope-section"><h3>{text.routeScope}</h3><p className="route-caption-detail">{routeCaption}</p></section> : node?.subtitle ? <p className="selection-summary">{node.subtitle}</p> : null}
          <dl className="fact-ledger">
            {state ? <div><dt>{text.state}</dt><dd>{statePresentation?.accessible ?? stateLabel(state, locale)}</dd></div> : null}
            {activeClaim ? <div><dt>{text.operator}</dt><dd><code>{activeClaim.principal_id}</code></dd></div> : null}
            {changeReasons.length ? <div><dt>{text.changes}</dt><dd>{changeReasons.map((reason) => changeReasonLabel(reason, locale)).join(" · ")}</dd></div> : null}
            <div><dt>{text.ref}</dt><dd><code>{selectedRef}</code></dd></div>
            {node?.route_key ? <div><dt>{text.route}</dt><dd><code>{node.route_key}</code></dd></div> : null}
          </dl>
          {attention.length ? <section className="attention-section"><h3>{text.attention}<b>{attention.length}</b></h3>{attention.map((item) => <article key={item.attention_ref}><strong>{stateLabel(item.severity, locale)}</strong><p>{item.summary}</p></article>)}</section> : null}
          {edge ? <section><h3>{text.relations}</h3><button type="button" className="endpoint" onClick={() => onSelect(edge.source_ref)}>{shortRef(edge.source_ref)}</button><span className="relation-verb">{edge.relation_type}</span><button type="button" className="endpoint" onClick={() => onSelect(edge.target_ref)}>{shortRef(edge.target_ref)}</button></section> : null}
          {node?.unlocated && (node.kind === "batch" || node.kind === "lane") ? <section className="gap-note"><h3>{text.projectionGap}</h3><p>{text.projectionGapBody}</p>{detail?.selected ? <StructuralDetail entity={detail.selected} /> : null}</section> : null}
          <section className="source-section">
            <h3>{text.sourceDetail}</h3>
            {error ? <p className="detail-error">{error}</p> : null}
            {!detail && !error ? <p>{text.noSourceDetail}</p> : null}
            {sourceRefs.length ? <><h4>{text.sourceRefs}</h4><ul>{sourceRefs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul></> : null}
            {detail?.anchored.length ? <><h4>{locale === "zh" ? "Anchored Evidence / Notes" : "Anchored Evidence / Notes"}</h4><ul className="anchored-list">{detail.anchored.map((entity) => <li key={`${entity.type}:${entity.id}`}><strong>{entity.title}</strong><small>{entity.type}</small></li>)}</ul></> : null}
          </section>
        </div>
      )}
    </aside>
  );
}

function StructuralDetail({ entity }: { entity: CanonicalEntity }) {
  if (entity.type === "lane") return <dl className="structural-detail"><div><dt>batch_ref</dt><dd><code>{entity.batch_ref}</code></dd></div><div><dt>authority</dt><dd>{entity.authority}</dd></div><div><dt>return</dt><dd>{entity.return_contract}</dd></div></dl>;
  if (entity.type === "batch") return <dl className="structural-detail"><div><dt>parent_work_item_ref</dt><dd><code>{entity.parent_work_item_ref}</code></dd></div><div><dt>lane_refs</dt><dd>{entity.lane_refs.map((ref) => <code key={ref}>{ref}</code>)}</dd></div></dl>;
  return null;
}

function primaryState(entity: CanonicalEntity | undefined): string | undefined {
  if (!entity) return undefined;
  if (entity.type === "work") return entity.work_state;
  if (entity.type === "decision") return entity.decision_state;
  if (entity.type === "lane" || entity.type === "batch") return entity.integration_state;
  if (entity.type === "evidence") return entity.verification_state;
  if (entity.type === "epoch") return entity.state;
  return undefined;
}

function shortRef(ref: string): string { return decodeURIComponent(ref.split("/").at(-1) ?? ref).replaceAll("-", " "); }
