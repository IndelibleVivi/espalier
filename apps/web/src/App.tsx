import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EspalierClient } from "@espalier/client";
import type { Project } from "@espalier/protocol";
import { ProgrammeCanvas, type Camera } from "./components/ProgrammeCanvas.js";
import { Inspector } from "./components/Inspector.js";
import { Outline } from "./components/Outline.js";
import { compileLiveLayout } from "./layout/compileLiveLayout.js";
import { copy, displayRouteTitle, type Locale } from "./i18n.js";
import { loadLiveViewState, saveLiveViewState, type LiveViewState } from "./state/liveRuntime.js";
import { useLiveSurface } from "./state/useLiveSurface.js";

function params(): URLSearchParams { return new URLSearchParams(window.location.search); }
function initialViewState(projectId: string): LiveViewState {
  const stored = loadLiveViewState(localStorage, projectId);
  const input = params();
  const values = [input.get("x"), input.get("y"), input.get("k")].map(Number);
  const camera = values.every(Number.isFinite) && values[2]! > 0 ? { x: values[0]!, y: values[1]!, k: values[2]! } : stored.camera;
  const locale = input.get("lang") === "en" ? "en" : input.get("lang") === "zh" ? "zh" : stored.locale;
  const selectedRef = input.has("selected") ? input.get("selected") || null : stored.selected_ref;
  return { ...stored, camera, locale, selected_ref: selectedRef };
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const requestedProject = params().get("project");
    new EspalierClient(window.location.origin).projects<Project[]>().then((projects) => {
      if (!active) return;
      const selected = requestedProject
        ? projects.find((candidate) => candidate.id === requestedProject)
        : projects.length === 1 ? projects[0] : undefined;
      if (selected) setProject(selected);
      else if (requestedProject) setDiscoveryError(`Project '${requestedProject}' is not present in this service.`);
      else if (projects.length === 0) setDiscoveryError("No Espalier Project is present. Link or seed one, then reload.");
      else setDiscoveryError(`This service owns ${projects.length} Projects. Open the surface with ?project=<id>.`);
    }).catch((caught) => {
      if (active) setDiscoveryError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { active = false; };
  }, []);
  if (!project) return <div className="boot-screen"><div className="brand-lockup"><span>Espalier</span><b>LIVE</b></div><p>{discoveryError ?? "Discovering the local authority domain…"}</p></div>;
  return <LiveProjectSurface key={project.id} projectId={project.id} displayName={project.display_name} />;
}

function LiveProjectSurface({ projectId, displayName }: { projectId: string; displayName: string }) {
  const [viewState, setViewState] = useState<LiveViewState>(() => initialViewState(projectId));
  const { projection, connection, error, updatedAt, refresh } = useLiveSurface(projectId, viewState);
  const { locale, selected_ref: selectedRef } = viewState;
  const [query, setQuery] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 900 && Boolean(viewState.selected_ref));
  const cameraFrame = useRef<number | null>(null);
  const pendingCamera = useRef<Camera | null>(null);
  const startupCamera = useRef<Camera | null>(viewState.camera);
  const layout = useMemo(() => projection ? compileLiveLayout(projection) : null, [projection]);
  const text = copy[locale];

  useEffect(() => { saveLiveViewState(localStorage, viewState); }, [viewState]);
  useEffect(() => {
    const revision = projection?.projection_revision;
    if (revision && revision !== viewState.based_on_projection_revision) {
      setViewState((current) => ({ ...current, based_on_projection_revision: revision }));
    }
  }, [projection?.projection_revision, viewState.based_on_projection_revision]);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = `Espalier · ${displayName} ${locale === "zh" ? "programme 侧翼" : "programme sidewing"}`;
  }, [displayName, locale]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setOutlineOpen(true);
        window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".outline-search input")?.focus());
      }
      if (event.key === "Escape") { setOutlineOpen(false); setInspectorOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const selectRef = useCallback((ref: string | null) => {
    setViewState((current) => ({ ...current, selected_ref: ref }));
    updateUrl({ selected: ref });
    if (ref) setInspectorOpen(true);
  }, [updateUrl]);
  const toggleOutline = useCallback(() => {
    setOutlineOpen((open) => {
      const next = !open;
      if (next && window.innerWidth < 900) setInspectorOpen(false);
      return next;
    });
  }, []);
  const toggleInspector = useCallback(() => {
    setInspectorOpen((open) => {
      const next = !open;
      if (next && window.innerWidth < 900) setOutlineOpen(false);
      return next;
    });
  }, []);
  const changeLocale = useCallback((next: Locale) => { setViewState((current) => ({ ...current, locale: next })); updateUrl({ lang: next }); }, [updateUrl]);
  const onCamera = useCallback((camera: Camera) => {
    pendingCamera.current = camera;
    if (cameraFrame.current !== null) return;
    cameraFrame.current = window.requestAnimationFrame(() => {
      const next = pendingCamera.current;
      cameraFrame.current = null;
      if (next) {
        setViewState((current) => ({ ...current, camera: next }));
        updateUrl({ x: next.x.toFixed(1), y: next.y.toFixed(1), k: next.k.toFixed(3) });
      }
    });
  }, [updateUrl]);
  const markSeen = useCallback(() => {
    if (!projection) return;
    setViewState((current) => ({ ...current, last_seen_revision: projection.as_of_revision }));
  }, [projection]);

  if (!projection || !layout) return <div className="boot-screen"><div className="brand-lockup"><span>Espalier</span><b>{projectId.toUpperCase()}</b></div><p>{error ?? (locale === "zh" ? "正在读取 live session…" : "Reading the live session…")}</p>{error ? <button type="button" onClick={() => void refresh()}>{locale === "zh" ? "重试" : "Retry"}</button> : null}</div>;
  const programmeAnchorTitle = layout.home_anchor_route ? displayRouteTitle(layout.home_anchor_route.route, locale) : "—";
  return (
    <div className="live-shell" data-locale={locale} data-connection={connection}>
      <header className="flight-bar">
        <div className="brand-lockup"><span>Espalier</span><b>{projectId.toUpperCase()}</b></div>
        <div className="flight-purpose"><strong>{displayName} {text.title}</strong><span>{text.subtitle}</span></div>
        <div className="now-readout"><small>{text.now}</small><strong>{programmeAnchorTitle}</strong></div>
        <div className="live-facts" aria-label={text.subtitle}>
          {layout.diagnostics.has_verified_evidence ? <span><b>✓</b> {text.verifiedEvidence}</span> : null}
          <span><b>{layout.diagnostics.lane_count}</b> {text.lanes}</span>
          <span><b>{layout.diagnostics.owner_attention_count}</b> {text.ownerCalls}</span>
          {projection.delta.changed_refs.length > 0 && projection.delta.mark_seen_capability?.allowed ? <button type="button" className="mark-seen" onClick={markSeen}><b>{projection.delta.changed_refs.length}</b> {text.changes} · {text.markSeen}</button> : null}
          <span className={`connection ${connection}`}><i aria-hidden="true" />{connection === "live" ? text.live : text.stale} · r{projection.as_of_revision}</span>
        </div>
        <div className="flight-actions">
          <button
            type="button"
            className="outline-action"
            onClick={toggleOutline}
            aria-controls="espalier-outline"
            aria-expanded={outlineOpen}
            aria-label={outlineOpen ? text.outlineClose : text.outlineOpen}
          >☷</button>
          <div className="locale-switch" role="group" aria-label="Language"><button type="button" aria-pressed={locale === "en"} onClick={() => changeLocale("en")}>EN</button><span>/</span><button type="button" aria-pressed={locale === "zh"} onClick={() => changeLocale("zh")}>中文</button></div>
          <button
            type="button"
            className="inspector-action"
            onClick={toggleInspector}
            aria-controls="espalier-inspector"
            aria-expanded={inspectorOpen}
            aria-label={inspectorOpen ? text.detailsClose : text.detailsOpen}
          >◎</button>
        </div>
      </header>
      {connection !== "live" ? <div className="stale-strip" role="status"><span>{error ?? "Live update disconnected"}</span><span>{updatedAt ? `${text.lastUpdated} ${new Date(updatedAt).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en")}` : ""}</span><b>{text.readOnly}</b><button type="button" onClick={() => void refresh()}>{locale === "zh" ? "刷新" : "Refresh"}</button></div> : null}
      <div className={`workspace-grid${outlineOpen ? "" : " outline-collapsed"}${inspectorOpen ? "" : " inspector-collapsed"}`}>
        <div className={`mobile-scrim${outlineOpen || inspectorOpen ? " visible" : ""}`} onClick={() => { setOutlineOpen(false); setInspectorOpen(false); }} />
        <div className={`outline-slot${outlineOpen ? " mobile-open" : ""}`}><Outline layout={layout} locale={locale} selectedRef={selectedRef} query={query} onQuery={setQuery} onSelect={(ref) => { selectRef(ref); if (window.innerWidth < 900) setOutlineOpen(false); }} onClose={() => setOutlineOpen(false)} /></div>
        <main className="canvas-slot"><ProgrammeCanvas layout={layout} locale={locale} selectedRef={selectedRef} initialCamera={startupCamera.current} onCamera={onCamera} onSelect={selectRef} /></main>
        <div className={`inspector-slot${inspectorOpen ? " mobile-open" : ""}`}><Inspector projectId={projectId} layout={layout} locale={locale} selectedRef={selectedRef} projectionRevision={projection.as_of_revision} onSelect={selectRef} onClose={() => setInspectorOpen(false)} /></div>
      </div>
    </div>
  );
}
