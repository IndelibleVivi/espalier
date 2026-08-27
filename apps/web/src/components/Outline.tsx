import type { LiveCanvasLayout } from "../layout/compileLiveLayout.js";
import { copy, displayRouteTitle, stateLabel, type Locale } from "../i18n.js";

interface Props {
  layout: LiveCanvasLayout;
  locale: Locale;
  selectedRef: string | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (ref: string) => void;
  onClose?: () => void;
}

export function Outline({ layout, locale, selectedRef, query, onQuery, onSelect, onClose }: Props) {
  const text = copy[locale];
  const normalized = query.trim().toLocaleLowerCase();
  const unlocated = layout.nodes.filter((node) => node.unlocated && (!normalized || `${node.title} ${node.kind} ${node.ref}`.toLocaleLowerCase().includes(normalized)));
  const shelfGroups = layout.shelf_lanes.map((lane) => ({ lane, nodes: unlocated.filter((node) => node.shelf_lane === lane.role) })).filter((group) => group.nodes.length > 0);
  const routes = layout.routes.filter((route) => !normalized || `${route.route.title} ${route.ref}`.toLocaleLowerCase().includes(normalized) || layout.nodes.some((node) => node.route_key === route.route.route_key && `${node.title} ${node.ref}`.toLocaleLowerCase().includes(normalized)));
  return (
    <aside id="espalier-outline" className="outline-rail" aria-label={text.outline}>
      <div className="rail-heading"><span>{text.outline}</span>{onClose ? <button type="button" onClick={onClose} aria-label={text.close}>×</button> : null}</div>
      <label className="outline-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={text.search} /></label>
      <div className="outline-routes">
        {routes.map((route) => {
          const members = layout.nodes.filter((node) => node.route_key === route.route.route_key && node.ref !== route.ref && (!normalized || `${node.title} ${node.ref}`.toLocaleLowerCase().includes(normalized)));
          return (
            <section key={route.ref} className={route === layout.suggested_entry_route ? "suggested" : ""}>
              <button type="button" className={selectedRef === route.ref ? "selected" : ""} onClick={() => onSelect(route.ref)}>
                <i aria-hidden="true">{route.route.programme_order_index === undefined ? "·" : String(route.route.programme_order_index + 1).padStart(2, "0")}</i>
                <span><strong>{displayRouteTitle(route.route, locale)}</strong><small>{stateLabel(route.node.state, locale)} · {route.route.summary.member_count} work</small></span>
                {route.route.summary.owner_question_count ? <b>{route.route.summary.owner_question_count}</b> : null}
              </button>
              {members.length ? <div className="outline-members">{members.map((member) => <button type="button" key={member.ref} className={selectedRef === member.ref ? "selected" : ""} onClick={() => onSelect(member.ref)}><span>{member.title}</span><small>{member.kind} · {stateLabel(member.state, locale)}</small></button>)}</div> : null}
            </section>
          );
        })}
        {unlocated.length ? (
          <section className="unlocated-outline">
            <h3>{text.unlocated}<b>{unlocated.length}</b></h3>
            <p>{text.unlocatedNote(
              layout.diagnostics.unlocated_verified_evidence_count,
              layout.diagnostics.unlocated_unverified_evidence_count,
              layout.diagnostics.unlocated_owner_call_count,
              layout.diagnostics.unlocated_workfront_count,
            )}</p>
            {shelfGroups.map(({ lane, nodes }) => (
              <div key={lane.role} className={`outline-signal-group role-${lane.role}`}>
                <h4><span>{text.shelfLaneLabel(lane.role)}</span><b>{nodes.length}</b></h4>
                <small className="signal-purpose">{text.shelfLanePurpose(lane.role)}</small>
                {nodes.map((node) => <button type="button" key={node.ref} className={selectedRef === node.ref ? "selected" : ""} onClick={() => onSelect(node.ref)}><i>{node.state === "verified" ? "✓" : node.kind === "decision" ? "?" : "!"}</i><span><strong>{node.title}</strong><small>{node.kind} · {stateLabel(node.state, locale)}</small></span></button>)}
              </div>
            ))}
          </section>
        ) : null}
        {routes.length === 0 && unlocated.length === 0 ? <p className="empty-results">{text.noResults}</p> : null}
      </div>
    </aside>
  );
}
