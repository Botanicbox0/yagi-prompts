"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { ShortlistState, StudioShortlistCandidate } from "@/lib/brands/shortlist/service";
import type { ShortlistCriteria, ShortlistCriteriaKey, ShortlistRange } from "@/lib/brands/shortlist/schema";
import {
  SHORTLIST_DIMENSIONS, SHORTLIST_UNKNOWN, shortlistCount, shortlistDimension, shortlistFit, shortlistIsRate, shortlistPercent,
} from "@/lib/brands/shortlist/format";

type Copy = Dictionary["brandWorkspace"]["shortlistAdmin"];
type Tab = "all" | ShortlistState | "picked" | "passed" | "confirmed";
type Move = "share" | "exclude" | "wait";
type Moves = Partial<Record<Move, string[]>>;
const TARGET: Record<Move, ShortlistState> = { share: "shared", exclude: "excluded", wait: "waiting" };
const MOVE_OF: Record<ShortlistState, Move> = { shared: "share", excluded: "exclude", waiting: "wait" };

/** Where the triage posts: `/admin/do` on the admin host, the studio door on brand.twings.app. */
export interface TriageDoor {
  path: string;
  /** Extra headers a JSON call needs (the studio door's own header on the brand host). */
  headers: Record<string, string>;
  opField: string;
  backField: string;
  back: string;
  triageOp: string;
  criteriaOp: string;
}

/**
 * The studio's candidate triage (docs/BRAND-SHORTLIST.md "선별"). Every candidate is waiting, shared or
 * excluded; ranges with histograms narrow the list, a selection or the split sheet moves many at once,
 * and the last move can be undone. Biggest follower count first by default.
 *
 * Without scripting the list is still a form: each row's buttons post one move to the same door.
 */
export function ShortlistTriage({ projectId, candidates, criteria, newSince, door, copy, locale }: {
  projectId: string;
  candidates: StudioShortlistCandidate[];
  criteria: ShortlistCriteria | null;
  /** Candidates created after this moment and still waiting carry the "new" mark (set by the server, so SSR and hydration agree). */
  newSince: string;
  door: TriageDoor;
  copy: Copy;
  locale: string;
}) {
  const t = copy.triage;
  const router = useRouter();
  const [states, setStates] = useState(() => new Map(candidates.map((c) => [c.id, c.state])));
  const [saved, setSaved] = useState<ShortlistCriteria | null>(criteria);
  useEffect(() => { setStates(new Map(candidates.map((c) => [c.id, c.state]))); }, [candidates]);
  useEffect(() => { setSaved(criteria); }, [criteria]);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ShortlistCriteria>({});
  const [sort, setSort] = useState<{ key: ShortlistCriteriaKey; dir: 1 | -1 }>({ key: "followers", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState(0);
  const [openChip, setOpenChip] = useState<ShortlistCriteriaKey | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: Moves } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  /** Only a keyboard move scrolls the focused row into view; loading the page never does. */
  const keyMoved = useRef(false);

  const stateOf = useCallback((c: StudioShortlistCandidate) => states.get(c.id) ?? c.state, [states]);
  const hasFilters = Object.keys(filters).length > 0;
  const since = Date.parse(newSince);
  const isNew = (c: StudioShortlistCandidate) => stateOf(c) === "waiting" && Date.parse(c.createdAt) > since;

  const counts = useMemo(() => {
    const n = { all: candidates.length, waiting: 0, shared: 0, excluded: 0, picked: 0, passed: 0, confirmed: 0 };
    for (const c of candidates) {
      n[stateOf(c)]++;
      if (c.picked && stateOf(c) === "shared") n.picked++;
      if (c.passed && stateOf(c) === "shared") n.passed++;
      if (c.confirmed) n.confirmed++;
    }
    return n;
  }, [candidates, stateOf]);

  const visible = useMemo(() => {
    const q = query.trim().replace(/^@/, "").toLowerCase();
    const rows = candidates.filter((c) => {
      const state = stateOf(c);
      const inTab = tab === "all" ? true : tab === "confirmed" ? c.confirmed
        : tab === "picked" || tab === "passed" ? c[tab] && state === "shared" : state === tab;
      if (!inTab) return false;
      if (q && !c.handle.includes(q) && !(c.displayName ?? "").toLowerCase().includes(q)) return false;
      return !hasFilters || shortlistFit(c.metrics, filters) === "in";
    });
    return rows.sort((a, b) => {
      const x = shortlistDimension(a.metrics, sort.key), y = shortlistDimension(b.metrics, sort.key);
      if (x !== y) {
        if (x == null) return 1;
        if (y == null) return -1;
        return (x - y) * sort.dir;
      }
      return a.handle.localeCompare(b.handle);
    });
  }, [candidates, stateOf, tab, query, filters, hasFilters, sort]);

  // A selection only ever holds rows on screen, so a move never touches a row the filters hid.
  const visibleKey = visible.map((c) => c.id).join();
  useEffect(() => {
    const ids = new Set(visibleKey ? visibleKey.split(",") : []);
    setSelected((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
    setFocus((f) => Math.min(f, Math.max(0, ids.size - 1)));
  }, [visibleKey]);

  const maxOf = useMemo(() => {
    const out = {} as Record<ShortlistCriteriaKey, number>;
    for (const key of SHORTLIST_DIMENSIONS) out[key] = Math.max(0, ...candidates.map((c) => shortlistDimension(c.metrics, key) ?? 0)) || 1;
    return out;
  }, [candidates]);

  const format = (key: ShortlistCriteriaKey, value: number | null | undefined) =>
    value == null ? SHORTLIST_UNKNOWN : shortlistIsRate(key) ? shortlistPercent(value, locale) : shortlistCount(value, locale);
  const summary = (rule: ShortlistCriteria) => SHORTLIST_DIMENSIONS.filter((k) => rule[k]).map((k) => `${t.dims[k]} ${rangeText(rule[k]!, (v) => format(k, v))}`).join(" · ");

  async function post(op: string, fields: Array<[string, string]>): Promise<"ok" | "failed" | "limited"> {
    const body = new FormData();
    body.set(door.opField, op);
    body.set(door.backField, door.back);
    body.set("projectId", projectId);
    for (const [name, value] of fields) body.append(name, value);
    try {
      const response = await fetch(door.path, { method: "POST", body, credentials: "same-origin", headers: { accept: "application/json", ...door.headers } });
      const result = await response.json().catch(() => null);
      if (response.status === 429) return "limited";
      return response.ok && result?.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  }

  async function move(moves: Moves, message: string, undoable = true) {
    const ids = (Object.keys(moves) as Move[]).flatMap((m) => moves[m] ?? []);
    if (busy || ids.length === 0) return;
    const before = new Map(ids.map((id) => [id, states.get(id) ?? "waiting"] as const));
    setBusy(true);
    const outcome = await post(door.triageOp, (Object.keys(moves) as Move[]).flatMap((m) => (moves[m] ?? []).map((id) => [m, id] as [string, string])));
    setBusy(false);
    if (outcome !== "ok") {
      setToast({ message: outcome === "limited" ? t.rateLimited : t.failed });
      return;
    }
    setStates((current) => {
      const next = new Map(current);
      for (const m of Object.keys(moves) as Move[]) for (const id of moves[m] ?? []) next.set(id, TARGET[m]);
      return next;
    });
    setSelected(new Set());
    const inverse: Moves = {};
    for (const [id, state] of before) (inverse[MOVE_OF[state]] ??= []).push(id);
    setToast({ message, undo: undoable ? inverse : undefined });
    router.refresh();
  }

  const moveMessage = (m: Move, count: number) => interpolate(t.done[m], { count });
  const moveSelection = (m: Move) => move({ [m]: [...selected] }, moveMessage(m, selected.size));
  const moveOne = (m: Move, id: string) => move({ [m]: [id] }, moveMessage(m, 1));

  async function saveCriteria(rule: ShortlistCriteria | null) {
    if (busy) return;
    setBusy(true);
    const outcome = await post(door.criteriaOp, rule ? [["criteria", JSON.stringify(rule)]] : []);
    setBusy(false);
    if (outcome !== "ok") return setToast({ message: outcome === "limited" ? t.rateLimited : t.failed });
    setSaved(rule);
    setToast({ message: rule ? t.criteria.savedDone : t.criteria.clearedDone });
    router.refresh();
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Keyboard triage while focus is in this list (or nowhere in particular); typing in a field is left alone.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") { setOpenChip(null); setSplitOpen(false); return; }
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (target && target !== document.body && !sectionRef.current?.contains(target)) return;
      if (splitOpen) return;
      const key = event.key.toLowerCase();
      const row = visible[focus];
      const act = (m: Move) => {
        event.preventDefault();
        if (selected.size) moveSelection(m);
        else if (row) moveOne(m, row.id);
      };
      if (key === "j" || event.key === "ArrowDown") { event.preventDefault(); keyMoved.current = true; setFocus((f) => Math.min(visible.length - 1, f + 1)); }
      else if (key === "k" || event.key === "ArrowUp") { event.preventDefault(); keyMoved.current = true; setFocus((f) => Math.max(0, f - 1)); }
      else if (key === "x" && row) { event.preventDefault(); toggle(row.id); }
      else if (key === "s") act("share");
      else if (key === "e") act("exclude");
      else if (key === "w") act("wait");
      else if (key === "z" && toast?.undo) { event.preventDefault(); move(toast.undo, t.undone, false); }
      else if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    sectionRef.current?.querySelector(`[data-triage-row][data-focus]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const setRange = (key: ShortlistCriteriaKey, range: ShortlistRange | null) =>
    setFilters((current) => {
      const next = { ...current };
      if (range) next[key] = range;
      else delete next[key];
      return next;
    });
  const sortBy = (key: ShortlistCriteriaKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: -1 }));

  const tabs: Array<[Tab, string, number]> = [
    ["all", t.tabs.all, counts.all], ["waiting", t.tabs.waiting, counts.waiting], ["shared", t.tabs.shared, counts.shared],
    ["excluded", t.tabs.excluded, counts.excluded], ["picked", t.tabs.picked, counts.picked], ["passed", t.tabs.passed, counts.passed],
  ];
  if (counts.confirmed > 0) tabs.push(["confirmed", t.tabs.confirmed, counts.confirmed]);
  const actionsFor = (state: ShortlistState): Move[] => (["share", "exclude", "wait"] as Move[]).filter((m) => TARGET[m] !== state);

  return (
    <div className="bw-triage" ref={sectionRef} data-shortlist-triage={candidates.length}>
      <div className="bw-triage-tabs" role="group" aria-label={t.tabsLabel}>
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} data-triage-tab={key}>
            {label} <b>{count}</b>
          </button>
        ))}
      </div>

      <div className="bw-triage-tools">
        <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} className="bw-triage-search" />
        <div className="bw-triage-chips" role="group" aria-label={t.filtersLabel}>
          {SHORTLIST_DIMENSIONS.map((key) => (
            <RangeChip
              key={key}
              dimension={key}
              label={t.dims[key]}
              range={filters[key] ?? null}
              open={openChip === key}
              onOpen={(open) => setOpenChip(open ? key : null)}
              onChange={(range) => setRange(key, range)}
              candidates={candidates}
              format={(v) => format(key, v)}
              copy={t}
            />
          ))}
          {hasFilters && <button type="button" className="bw-triage-link" onClick={() => setFilters({})}>{t.clearAll}</button>}
        </div>
        <button type="button" className="bw-button" onClick={() => setSplitOpen(true)} disabled={counts.waiting === 0} data-triage-split-open>{t.split.open}</button>
      </div>

      <div className="bw-triage-criteria" data-triage-criteria={saved ? "saved" : "none"}>
        {saved ? (
          <p><strong>{t.criteria.saved}</strong> {summary(saved)} <span className="bw-muted">{t.criteria.savedHint}</span></p>
        ) : (
          <p className="bw-muted">{t.criteria.none}</p>
        )}
        <div className="bw-row">
          {hasFilters && <button type="button" className="bw-button" disabled={busy} onClick={() => saveCriteria(filters)} data-triage-criteria-save>{saved ? t.criteria.replace : t.criteria.save}</button>}
          {saved && <button type="button" className="bw-triage-link" onClick={() => setFilters(saved)}>{t.criteria.load}</button>}
          {saved && <button type="button" className="bw-triage-link" disabled={busy} onClick={() => saveCriteria(null)}>{t.criteria.clear}</button>}
        </div>
      </div>

      {allSelected && selected.size > 1 && (
        <p className="bw-triage-banner" role="status">
          {interpolate(t.allSelected, { count: selected.size })} <button type="button" className="bw-triage-link" onClick={() => setSelected(new Set())}>{t.clearSelection}</button>
        </p>
      )}

      <form method="post" action={door.path} encType="multipart/form-data">
        <input type="hidden" name={door.opField} value={door.triageOp} />
        <input type="hidden" name={door.backField} value={door.back} />
        <input type="hidden" name="projectId" value={projectId} />
        <div className="bw-table-scroll">
          <table className="bw-triage-table">
            <thead>
              <tr>
                <th scope="col" className="bw-triage-check">
                  <input type="checkbox" aria-label={t.selectAll} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((c) => c.id)))} />
                </th>
                <th scope="col">{t.columns.candidate}</th>
                {SHORTLIST_DIMENSIONS.map((key) => (
                  <th key={key} scope="col" aria-sort={sort.key === key ? (sort.dir === -1 ? "descending" : "ascending") : "none"}>
                    <button type="button" onClick={() => sortBy(key)} aria-label={interpolate(t.sortBy, { label: t.dims[key] })} data-triage-sort={key}>
                      {t.dims[key]}{sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
                <th scope="col">{t.columns.state}</th>
                <th scope="col">{t.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={SHORTLIST_DIMENSIONS.length + 4}><p className="bw-empty">{t.empty}</p></td></tr>
              ) : visible.map((c, index) => {
                const state = stateOf(c);
                const fit = state === "waiting" ? shortlistFit(c.metrics, saved) : null;
                return (
                  <tr
                    key={c.id}
                    data-triage-row={c.handle}
                    data-state={state}
                    data-focus={index === focus ? "true" : undefined}
                    data-selected={selected.has(c.id) ? "true" : undefined}
                    onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input, a")) setFocus(index); }}
                  >
                    <td className="bw-triage-check">
                      <input type="checkbox" name="candidateId" value={c.id} aria-label={interpolate(t.select, { handle: c.handle })} checked={selected.has(c.id)} onChange={() => { toggle(c.id); setFocus(index); }} />
                    </td>
                    <td>
                      <div className="bw-triage-who">
                        <Avatar candidate={c} size={32} />
                        <div>
                          <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noopener noreferrer">@{c.handle}</a>
                          <div className="bw-triage-marks">
                            {isNew(c) && <span className="bw-triage-mark" data-mark="new">{t.isNew}</span>}
                            {fit && <span className="bw-triage-mark" data-mark={`fit-${fit}`} data-triage-fit={fit}>{t.fit[fit]}</span>}
                            {c.confirmed && <span className="bw-shortlist-badge" data-tone="booked" title={t.confirmed} data-triage-confirmed>{copy.states.confirmed}</span>}
                            {c.picked && <span className="bw-shortlist-badge" title={t.picked}>{copy.states.picked}</span>}
                            {c.passed && <span className="bw-shortlist-badge" data-tone="muted" title={t.passed} data-triage-passed>{copy.states.passed}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    {SHORTLIST_DIMENSIONS.map((key) => {
                      const value = shortlistDimension(c.metrics, key);
                      return (
                        <td key={key} className="bw-triage-metric" data-unknown={value == null ? "true" : undefined}>
                          <span>{value == null ? t.unknown : format(key, value)}</span>
                          <i aria-hidden="true"><b style={{ width: `${value == null ? 0 : Math.max(3, Math.min(100, (value / maxOf[key]) * 100))}%` }} /></i>
                        </td>
                      );
                    })}
                    <td><span className="bw-triage-state" data-state={state}>{state === "shared" ? copy.states.shared : state === "excluded" ? copy.states.excluded : copy.states.hidden}</span></td>
                    <td>
                      <div className="bw-triage-acts">
                        {actionsFor(state).map((m) => (
                          <button
                            key={m}
                            type="submit"
                            name="one"
                            value={`${m}:${c.id}`}
                            className="bw-triage-act"
                            data-move={m}
                            disabled={busy}
                            onClick={(e) => { e.preventDefault(); moveOne(m, c.id); }}
                          >
                            {t.actions[m]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selected.size > 0 && (
          <div className="bw-triage-bulk" role="region" aria-label={interpolate(t.selected, { count: selected.size })} data-triage-bulk={selected.size}>
            <span>{interpolate(t.selected, { count: selected.size })}</span>
            {(["share", "exclude", "wait"] as Move[]).map((m) => (
              <button key={m} type="submit" name="action" value={m} className={m === "share" ? "bw-button bw-primary" : "bw-button"} disabled={busy} onClick={(e) => { e.preventDefault(); moveSelection(m); }} data-triage-bulk-move={m}>
                {t.actions[m]}
              </button>
            ))}
            <button type="button" className="bw-triage-link" onClick={() => setSelected(new Set())}>{t.clearSelection}</button>
          </div>
        )}
      </form>
      <p className="bw-muted bw-triage-keys">{t.keys}</p>

      {splitOpen && (
        <SplitSheet
          waiting={candidates.filter((c) => stateOf(c) === "waiting")}
          rule={hasFilters ? filters : saved}
          summary={summary}
          busy={busy}
          copy={t}
          onClose={() => setSplitOpen(false)}
          onRun={async (share, exclude) => {
            setSplitOpen(false);
            await move({ share, exclude }, interpolate(t.done.split, { share: share.length, exclude: exclude.length }));
          }}
        />
      )}

      {toast && (
        <div className="bw-triage-toast" role="status" data-triage-toast>
          <span>{toast.message}</span>
          {toast.undo && <button type="button" className="bw-button" disabled={busy} onClick={() => move(toast.undo!, t.undone, false)}>{t.undo}</button>}
        </div>
      )}
    </div>
  );
}

function Avatar({ candidate: c, size }: { candidate: StudioShortlistCandidate; size: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42), ...(c.avatarTone ? { background: c.avatarTone } : {}) };
  return c.avatarUrl
    ? <img className="bw-triage-avatar" src={c.avatarUrl} alt="" width={size} height={size} loading="lazy" decoding="async" style={style} />
    : <span className="bw-triage-avatar" aria-hidden="true" style={style}>{c.handle[0]?.toUpperCase()}</span>;
}

/**
 * One range chip: the spread of the current candidates as a histogram (log scale for counts), a
 * minimum and a maximum slider that step through the values candidates actually have.
 */
function RangeChip({ dimension, label, range, open, onOpen, onChange, candidates, format, copy }: {
  dimension: ShortlistCriteriaKey;
  label: string;
  range: ShortlistRange | null;
  open: boolean;
  onOpen: (open: boolean) => void;
  onChange: (range: ShortlistRange | null) => void;
  candidates: StudioShortlistCandidate[];
  format: (value: number) => string;
  copy: Copy["triage"];
}) {
  const known = candidates.map((c) => shortlistDimension(c.metrics, dimension)).filter((v): v is number => v != null);
  const values = [...new Set(known)].sort((a, b) => a - b);
  const missing = candidates.length - known.length;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, onOpen]);
  const lowIndex = range?.min != null ? Math.max(0, values.findIndex((v) => v >= range.min!)) : 0;
  const highFound = range?.max != null ? values.reduce((last, v, i) => (v <= range.max! ? i : last), -1) : values.length - 1;
  const highIndex = highFound < 0 ? 0 : highFound;
  const set = (low: number, high: number) => {
    if (values.length === 0) return;
    const [a, b] = low <= high ? [low, high] : [high, low];
    onChange(a === 0 && b === values.length - 1 ? null : { ...(a > 0 ? { min: values[a]! } : {}), ...(b < values.length - 1 ? { max: values[b]! } : {}) });
  };
  const bins = histogram(known, shortlistIsRate(dimension));
  const top = Math.max(1, ...bins.map((b) => b.count));
  const inRange = (v: number) => (range?.min == null || v >= range.min) && (range?.max == null || v <= range.max);
  const hits = known.filter(inRange).length;
  const active = range != null;
  return (
    <div className="bw-triage-chip" ref={ref} data-triage-chip={dimension} data-active={active ? "true" : undefined}>
      <button type="button" aria-expanded={open} onClick={() => onOpen(!open)}>
        {active ? `${label} ${rangeText(range, format)}` : label}
        <span aria-hidden="true">{active ? "" : " ▾"}</span>
      </button>
      {active && (
        <button type="button" className="bw-triage-chip-clear" aria-label={interpolate(copy.clearFilter, { label })} onClick={() => onChange(null)}>×</button>
      )}
      {open && (
        <div className="bw-triage-pop" role="dialog" aria-label={label}>
          <strong>{label}</strong>
          <p className="bw-muted">{copy.rangeHint}</p>
          <div className="bw-triage-hist" aria-hidden="true">
            {bins.map((bin, i) => <i key={i} data-in={inRange(bin.mid) ? "true" : undefined} style={{ height: `${(bin.count / top) * 100}%` }} />)}
          </div>
          {values.length > 1 ? (
            <div className="bw-triage-ranges">
              <label>
                <span>{copy.min} <b>{format(values[lowIndex]!)}</b></span>
                <input type="range" min={0} max={values.length - 1} step={1} value={lowIndex} onChange={(e) => set(Number(e.target.value), highIndex)} />
              </label>
              <label>
                <span>{copy.max} <b>{format(values[highIndex]!)}</b></span>
                <input type="range" min={0} max={values.length - 1} step={1} value={highIndex} onChange={(e) => set(lowIndex, Number(e.target.value))} />
              </label>
            </div>
          ) : null}
          {missing > 0 && <p className="bw-muted">{interpolate(copy.rangeMissing, { count: missing })}</p>}
          <div className="bw-triage-pop-foot">
            <span>{interpolate(copy.matching, { count: hits })}</span>
            <button type="button" className="bw-triage-link" onClick={() => onChange(null)}>{copy.reset}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** `1만–5만`, `≥ 3,571`, `≤ 15%`. */
function rangeText(range: ShortlistRange, format: (value: number) => string): string {
  if (range.min != null && range.max != null) return `${format(range.min)}–${format(range.max)}`;
  return range.min != null ? `≥ ${format(range.min)}` : `≤ ${format(range.max!)}`;
}

/** Twelve bins: on a log scale for counts (followers spread over orders of magnitude), linear for rates. */
function histogram(values: number[], linear: boolean): Array<{ mid: number; count: number }> {
  if (values.length === 0) return [];
  const scale = linear ? (v: number) => v : (v: number) => Math.log10(v + 1);
  const unscale = linear ? (v: number) => v : (v: number) => 10 ** v - 1;
  const lo = scale(Math.min(...values)), hi = scale(Math.max(...values));
  const n = 12, width = (hi - lo) / n || 1;
  const bins = Array.from({ length: n }, (_, i) => ({ mid: unscale(lo + width * (i + 0.5)), count: 0 }));
  for (const v of values) bins[Math.min(n - 1, Math.floor((scale(v) - lo) / width))]!.count++;
  return bins;
}

/**
 * Sort out every waiting candidate against the rule (the filters on screen, else the saved criteria):
 * inside → shared, outside → excluded or left waiting, missing figures → left waiting for a person.
 */
function SplitSheet({ waiting, rule, summary, busy, copy, onClose, onRun }: {
  waiting: StudioShortlistCandidate[];
  rule: ShortlistCriteria | null;
  summary: (rule: ShortlistCriteria) => string;
  busy: boolean;
  copy: Copy["triage"];
  onClose: () => void;
  onRun: (share: string[], exclude: string[]) => void;
}) {
  const [outside, setOutside] = useState<"exclude" | "wait">("exclude");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const groups = { in: [] as StudioShortlistCandidate[], out: [] as StudioShortlistCandidate[], unknown: [] as StudioShortlistCandidate[] };
  if (rule && Object.keys(rule).length) for (const c of waiting) groups[shortlistFit(c.metrics, rule) ?? "unknown"].push(c);
  const share = groups.in.map((c) => c.id);
  const exclude = outside === "exclude" ? groups.out.map((c) => c.id) : [];
  const label = share.length && exclude.length ? interpolate(copy.split.run, { share: share.length, exclude: exclude.length })
    : share.length ? interpolate(copy.split.runShare, { share: share.length }) : interpolate(copy.split.runExclude, { exclude: exclude.length });
  const faces = (list: StudioShortlistCandidate[]): ReactNode => list.length
    ? <ul className="bw-triage-faces">{list.map((c) => <li key={c.id}><Avatar candidate={c} size={22} />@{c.handle}</li>)}</ul>
    : <p className="bw-muted">{copy.split.none}</p>;
  const hasRule = rule != null && Object.keys(rule).length > 0;
  return (
    <div className="bw-triage-sheet-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bw-triage-sheet" role="dialog" aria-modal="true" aria-labelledby="triage-split-title" data-triage-split>
        <h3 id="triage-split-title">{copy.split.title}</h3>
        <p className="bw-muted">{interpolate(copy.split.scope, { count: waiting.length })}</p>
        {!hasRule ? <p className="bw-note">{copy.split.needRule}</p> : (
          <>
            <p>{interpolate(copy.split.rule, { summary: summary(rule) })}</p>
            <div className="bw-triage-split-cols">
              <section data-split-group="in">
                <h4>{copy.split.inside} <span>{interpolate(copy.split.people, { count: groups.in.length })}</span></h4>
                {faces(groups.in)}
              </section>
              <section data-split-group="out">
                <h4>
                  {copy.split.outside} ·{" "}
                  <select aria-label={copy.split.outsideAction} value={outside} onChange={(e) => setOutside(e.target.value as "exclude" | "wait")}>
                    <option value="exclude">{copy.split.outsideExclude}</option>
                    <option value="wait">{copy.split.outsideKeep}</option>
                  </select>{" "}
                  <span>{interpolate(copy.split.people, { count: groups.out.length })}</span>
                </h4>
                {faces(groups.out)}
              </section>
              {groups.unknown.length > 0 && (
                <section data-split-group="unknown">
                  <h4>{copy.split.unknown} <span>{interpolate(copy.split.people, { count: groups.unknown.length })}</span></h4>
                  {faces(groups.unknown)}
                </section>
              )}
            </div>
          </>
        )}
        <div className="bw-triage-sheet-foot">
          <span className="bw-muted">{copy.split.note}</span>
          <div className="bw-row">
            <button type="button" className="bw-button" ref={closeRef} onClick={onClose}>{copy.split.cancel}</button>
            {hasRule && (
              <button type="button" className="bw-button bw-primary" disabled={busy || (share.length === 0 && exclude.length === 0)} onClick={() => onRun(share, exclude)} data-triage-split-run>
                {label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
