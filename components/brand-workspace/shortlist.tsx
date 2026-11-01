"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { ShortlistCandidate } from "@/lib/brands/shortlist/service";
import type { ShortlistChoice, ShortlistMetrics } from "@/lib/brands/shortlist/schema";
import {
  SHORTLIST_SORTS, SHORTLIST_UNKNOWN, shortlistAverage, shortlistCount, shortlistDay, shortlistMedian, shortlistPercent, shortlistSortValue,
  shortlistTags, sortShortlist, type ShortlistSort,
} from "@/lib/brands/shortlist/format";

type Copy = Dictionary["brandWorkspace"]["shortlist"];
type Tab = "open" | "picked" | "passed" | "confirmed";
type View = "cards" | "list";
type Undo = Array<[ShortlistChoice, string[]]>;
const COMPARE_MAX = 4;
/** Below this the whole list fits on a screen and a search box only adds noise. */
const SEARCH_FROM = 8;
/** Labels on a card; the sheet lists them all with their rules. */
const CARD_TAGS = 2;
/** Medians mean something from three candidates on; below that the cards leave the comparison out. */
const MEDIAN_FROM = 3;
const VIEW_KEY = "twings.shortlist.view";
type Medians = { views: number | null; engagement: number | null; followers: number | null };
const choiceOf = (c: ShortlistCandidate): ShortlistChoice => (c.picked ? "picked" : c.passed ? "passed" : "none");

/**
 * The campaign's creator shortlist (docs/BRAND-SHORTLIST.md): every shared candidate as a photo card
 * or a list row with three figures and plain labels. Opening one shows the rest: where each figure
 * sits against this shortlist's median, every figure, and the marks. The brand sorts the list itself:
 * prefer, set aside or clear, one at a time or for a selection ("all on screen" included), with undo.
 * Set-aside candidates leave the main tab for their own; a confirmed booking shows as "섭외 확정".
 * Two to four selected compare side by side, and the bar says what a selection can do next. A viewer
 * who cannot mark selects for comparing only. No fee, note or recruiting detail exists in what this
 * receives.
 */
export function CampaignShortlist({ candidates, canPick, copy, locale, defaultView = "cards", manageHref }: {
  candidates: ShortlistCandidate[];
  canPick: boolean;
  copy: Copy;
  locale: string;
  /** The layout before this browser's saved choice is read. */
  defaultView?: View;
  /** The TWINGS team's view: this is what the client sees, and where the team manages it instead. */
  manageHref?: string;
}) {
  const [sort, setSort] = useState<ShortlistSort>("followers");
  const [tab, setTab] = useState<Tab>("open");
  const [view, setView] = useState<View>(defaultView);
  const [choices, setChoices] = useState(() => new Map(candidates.map((c) => [c.id, choiceOf(c)])));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: Undo } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { setChoices(new Map(candidates.map((c) => [c.id, choiceOf(c)]))); }, [candidates]);
  // The layout is a per-browser preference; the page renders cards until it is read.
  useEffect(() => {
    try { const stored = localStorage.getItem(VIEW_KEY); if (stored === "cards" || stored === "list") setView(stored); } catch { /* private mode */ }
  }, []);
  const pickView = (next: View) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode */ }
  };

  const choice = (c: ShortlistCandidate) => choices.get(c.id) ?? "none";
  const days = [...new Set(candidates.map((c) => c.measuredOn).filter((d): d is string => d !== null))].sort();
  const measured = days.at(-1) ?? null;
  const counts = { open: 0, picked: 0, passed: 0, confirmed: 0 };
  for (const c of candidates) {
    const mark = choice(c);
    if (mark !== "passed") counts.open++;
    if (mark === "picked") counts.picked++;
    if (mark === "passed") counts.passed++;
    if (c.confirmed) counts.confirmed++;
  }
  const inTab = (c: ShortlistCandidate) =>
    tab === "open" ? choice(c) !== "passed" : tab === "confirmed" ? c.confirmed : choice(c) === tab;
  const needle = query.trim().replace(/^@/, "").toLowerCase();
  const matches = (c: ShortlistCandidate) =>
    !needle || [c.handle, c.displayName, c.category].some((text) => text?.toLowerCase().includes(needle));
  const shown = sortShortlist(candidates.filter((c) => inTab(c) && matches(c)), sort);
  const known = (pick: (m: ShortlistMetrics) => number | null | undefined) =>
    candidates.map((c) => pick(c.metrics)).filter((v): v is number => v != null);
  const medians: Medians | null = candidates.length >= MEDIAN_FROM ? {
    views: shortlistMedian(known((m) => m.viewsMedian90d)),
    engagement: shortlistMedian(known((m) => shortlistSortValue(m, "engagement"))),
    followers: shortlistMedian(known((m) => m.followers)),
  } : null;

  // A selection only ever holds cards on screen, so an action never touches one a tab hid.
  const shownKey = shown.map((c) => c.id).join();
  useEffect(() => {
    const ids = new Set(shownKey ? shownKey.split(",") : []);
    setSelected((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [shownKey]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function send(ids: string[], next: ShortlistChoice): Promise<boolean> {
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "shortlist.choose", input: { candidateIds: ids, choice: next } }),
      });
      const result = await response.json().catch(() => null);
      return response.ok && result?.ok === true;
    } catch {
      return false;
    }
  }

  /** Apply one or more marks; the toast offers to put back what was there before. */
  async function apply(moves: Undo, message: string, undoable = true) {
    const ids = moves.flatMap(([, list]) => list);
    if (busy || ids.length === 0) return;
    const before = new Map(ids.map((id) => [id, choices.get(id) ?? "none"] as const));
    setBusy(true);
    const saved: Undo = [];
    for (const [next, list] of moves) {
      if (!list.length) continue;
      if (!(await send(list, next))) break;
      saved.push([next, list]);
    }
    setBusy(false);
    // Whatever the server took is shown, even when a later step failed.
    setChoices((current) => {
      const map = new Map(current);
      for (const [next, list] of saved) for (const id of list) map.set(id, next);
      return map;
    });
    if (saved.length < moves.filter(([, list]) => list.length).length) return setToast({ message: copy.failed });
    setSelected(new Set());
    const inverse = new Map<ShortlistChoice, string[]>();
    for (const [id, was] of before) inverse.set(was, [...(inverse.get(was) ?? []), id]);
    setToast({ message, undo: undoable ? [...inverse] : undefined });
  }
  const mark = (ids: string[], next: ShortlistChoice) => apply([[next, ids]], interpolate(copy.done[next], { count: ids.length }));
  const toggleOne = (c: ShortlistCandidate, target: "picked" | "passed") => mark([c.id], choice(c) === target ? "none" : target);

  const toggleSelect = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allSelected = shown.length > 0 && shown.every((c) => selected.has(c.id));
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(shown.map((c) => c.id)));
  const chosen = shown.filter((c) => selected.has(c.id));
  const compared = chosen.slice(0, COMPARE_MAX);
  const tabs: Array<[Tab, number]> = [["open", counts.open]];
  if (counts.confirmed > 0) tabs.push(["confirmed", counts.confirmed]);
  tabs.push(["picked", counts.picked], ["passed", counts.passed]);
  const cardProps = (c: ShortlistCandidate) => ({
    candidate: c, choice: choice(c), canPick, busy, selected: selected.has(c.id),
    onSelect: () => toggleSelect(c.id), onPick: () => toggleOne(c, "picked"), onPass: () => toggleOne(c, "passed"), onOpen: () => setOpenId(c.id), copy, locale,
  });

  // The open candidate stays open after a mark moves it off this tab; next and previous carry on from where it was.
  const opened = openId ? candidates.find((c) => c.id === openId) ?? null : null;
  const openedAt = useRef(0);
  const openedIndex = opened ? shown.findIndex((c) => c.id === opened.id) : -1;
  if (openedIndex >= 0) openedAt.current = openedIndex;
  const step = (by: 1 | -1) => {
    if (!shown.length) return;
    const from = openedIndex >= 0 ? openedIndex : by === 1 ? openedAt.current - 1 : openedAt.current;
    setOpenId(shown[(from + by + shown.length) % shown.length]!.id);
  };

  return (
    <section id="shortlist" className="bw-panel bw-shortlist" data-brand-shortlist={candidates.length} data-shortlist-view={view}>
      <header className="bw-shortlist-head">
        <h2>{copy.title} <span className="bw-shortlist-count">{interpolate(copy.count, { count: candidates.length })}</span></h2>
        {canPick && <p>{copy.intro}</p>}
        <p className="bw-shortlist-meta" data-shortlist-measured={measured ?? ""}>
          {measured ? `${interpolate(copy.measuredOn, { date: shortlistDay(measured, locale) })} · ` : ""}{copy.basis}
        </p>
      </header>
      {manageHref ? (
        <p className="bw-note bw-shortlist-note bw-no-print" data-shortlist-studio-note>
          {copy.studioNote} <a href={manageHref}>{copy.studioManage}</a>
        </p>
      ) : !canPick && <p className="bw-note bw-shortlist-note bw-no-print">{copy.readOnly}</p>}
      <div className="bw-shortlist-tools bw-no-print">
        <div className="bw-shortlist-sorts" role="group" aria-label={copy.tabsLabel}>
          {tabs.map(([key, count]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} data-shortlist-tab={key}>
              {copy.tabs[key]} <b>{count}</b>
            </button>
          ))}
        </div>
        <div className="bw-shortlist-tools-end">
          {candidates.length >= SEARCH_FROM && (
            <input className="bw-shortlist-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.search} aria-label={copy.search} data-shortlist-search />
          )}
          <label className="bw-shortlist-sort">
            <span className="bw-sr-only">{copy.sortLabel}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ShortlistSort)} data-shortlist-sort-select>
              {SHORTLIST_SORTS.map((key) => <option key={key} value={key}>{copy.sorts[key]}</option>)}
            </select>
          </label>
          <div className="bw-shortlist-views" role="group" aria-label={copy.viewLabel}>
            {(["cards", "list"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={view === key} aria-label={copy.views[key]} title={copy.views[key]} onClick={() => pickView(key)} data-shortlist-view-button={key}>
                {key === "cards" ? <GridIcon /> : <ListIcon />}
              </button>
            ))}
          </div>
        </div>
      </div>
      {shown.length > 0 && view === "cards" && canPick && (
        <label className="bw-shortlist-select-all bw-no-print">
          <input type="checkbox" checked={allSelected} onChange={selectAll} data-shortlist-select-all />
          {interpolate(copy.selectAll, { count: shown.length })}
        </label>
      )}
      {shown.length === 0 ? (
        <p className="bw-empty" data-shortlist-empty={needle ? "search" : tab}>{needle ? interpolate(copy.noMatch, { query: query.trim() }) : copy.empty[tab]}</p>
      ) : view === "cards" ? (
        <ol className="bw-shortlist-grid" data-selecting={chosen.length > 0 ? "true" : undefined}>
          {shown.map((c) => <ShortlistCard key={c.id} {...cardProps(c)} medians={medians} />)}
        </ol>
      ) : (
        <ShortlistList candidates={shown} rowProps={cardProps} allSelected={allSelected} onSelectAll={selectAll} sort={sort} onSort={setSort} canPick={canPick} copy={copy} locale={locale} />
      )}
      {chosen.length > 0 && (
        <div className="bw-triage-bulk bw-shortlist-bulk bw-no-print" role="region" aria-label={interpolate(copy.selected, { count: chosen.length })} data-shortlist-bulk={chosen.length}>
          <span className="bw-shortlist-bulk-who">
            <span className="bw-shortlist-bulk-faces" aria-hidden="true">
              {chosen.slice(0, COMPARE_MAX).map((c) => <Portrait key={c.id} candidate={c} size={26} />)}
            </span>
            {interpolate(copy.selected, { count: chosen.length })}
          </span>
          {canPick && chosen.some((c) => choice(c) !== "picked") && (
            <button type="button" className="bw-button bw-primary" disabled={busy} onClick={() => mark(chosen.map((c) => c.id), "picked")} data-shortlist-bulk-mark="picked">{copy.actions.picked}</button>
          )}
          {canPick && chosen.some((c) => choice(c) !== "passed") && (
            <button type="button" className="bw-button" disabled={busy} onClick={() => mark(chosen.map((c) => c.id), "passed")} data-shortlist-bulk-mark="passed">{copy.actions.passed}</button>
          )}
          {canPick && chosen.some((c) => choice(c) !== "none") && (
            <button type="button" className="bw-button" disabled={busy} onClick={() => mark(chosen.map((c) => c.id), "none")} data-shortlist-bulk-mark="none">
              {tab === "passed" ? copy.actions.restore : copy.actions.none}
            </button>
          )}
          {chosen.length > 1 && chosen.length <= COMPARE_MAX ? (
            <button type="button" className={canPick ? "bw-button" : "bw-button bw-primary"} onClick={() => setComparing(true)} data-shortlist-compare-open>
              {interpolate(copy.compareOpen, { count: chosen.length })}
            </button>
          ) : (
            <small className="bw-shortlist-bulk-hint" data-shortlist-compare-hint>
              {chosen.length === 1 ? copy.compareNeedOne : interpolate(copy.compareTooMany, { max: COMPARE_MAX })}
            </small>
          )}
          <button type="button" className="bw-triage-link" onClick={() => setSelected(new Set())}>{copy.clearSelection}</button>
        </div>
      )}
      {opened && (
        <CandidateSheet candidate={opened} choice={choice(opened)} canPick={canPick} busy={busy} medians={medians} copy={copy} locale={locale}
          position={openedIndex >= 0 ? `${openedIndex + 1} / ${shown.length}` : null}
          onPick={() => toggleOne(opened, "picked")} onPass={() => toggleOne(opened, "passed")} onClose={() => setOpenId(null)}
          onStep={shown.length > 1 ? step : null} />
      )}
      {comparing && compared.length > 1 && <CompareSheet candidates={compared} copy={copy} locale={locale} onClose={() => setComparing(false)} />}
      {toast && (
        <div className="bw-triage-toast bw-no-print" role="status" data-shortlist-toast>
          <span>{toast.message}</span>
          {toast.undo && <button type="button" className="bw-button" disabled={busy} onClick={() => apply(toast.undo!, copy.undone, false)}>{copy.undo}</button>}
        </div>
      )}
    </section>
  );
}

type ItemProps = {
  candidate: ShortlistCandidate;
  choice: ShortlistChoice;
  canPick: boolean;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onPick: () => void;
  onPass: () => void;
  onOpen: () => void;
  copy: Copy;
  locale: string;
};

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="2.5" width="5" height="5" rx="1.4" /><rect x="10.5" y="2.5" width="5" height="5" rx="1.4" />
      <rect x="2.5" y="10.5" width="5" height="5" rx="1.4" /><rect x="10.5" y="10.5" width="5" height="5" rx="1.4" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 4.5h9M6.5 9h9M6.5 13.5h9" /><path d="M2.75 4.5h.01M2.75 9h.01M2.75 13.5h.01" strokeWidth="2.2" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 15.25S2.5 11.4 2.5 6.9A3.4 3.4 0 0 1 9 5.5a3.4 3.4 0 0 1 6.5 1.4c0 4.5-6.5 8.35-6.5 8.35Z" />
    </svg>
  );
}
function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
function OutIcon() {
  return (
    <svg className="bw-shortlist-out" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8l5-5M4 3h4v4" />
    </svg>
  );
}
function ChevronIcon({ to }: { to: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={to === "left" ? "m10 3.5-4.5 4.5 4.5 4.5" : "m6 3.5 4.5 4.5L6 12.5"} />
    </svg>
  );
}

/** The marks a card or row carries: preferred, set aside, booked. */
function Badges({ choice, confirmed, copy }: { choice: ShortlistChoice; confirmed: boolean; copy: Copy }) {
  return (
    <>
      {confirmed && <span className="bw-shortlist-badge" data-tone="booked" data-shortlist-confirmed>{copy.confirmed}</span>}
      {choice === "picked" && <span className="bw-shortlist-badge" data-shortlist-picked>{copy.preferred}</span>}
      {choice === "passed" && <span className="bw-shortlist-badge" data-tone="muted" data-shortlist-passed>{copy.passed}</span>}
    </>
  );
}

/** ✕ and ♥: each toggles its own mark; pressing one clears the other. */
function Marks({ candidate: c, choice, busy, onPick, onPass, copy }: Pick<ItemProps, "candidate" | "choice" | "busy" | "onPick" | "onPass" | "copy">) {
  const pickLabel = choice === "picked" ? copy.unprefer : copy.prefer;
  const passLabel = choice === "passed" ? copy.unpass : copy.pass;
  return (
    <div className="bw-shortlist-marks bw-no-print">
      <button type="button" className="bw-shortlist-pass" aria-pressed={choice === "passed"} aria-label={busy ? copy.working : `${passLabel} · @${c.handle}`} title={passLabel} disabled={busy} onClick={onPass} data-shortlist-pass={choice === "passed" ? "on" : "off"}>
        <CrossIcon />
      </button>
      <button type="button" className="bw-shortlist-pick" aria-pressed={choice === "picked"} aria-label={busy ? copy.working : `${pickLabel} · @${c.handle}`} title={pickLabel} disabled={busy} onClick={onPick} data-shortlist-pick={choice === "picked" ? "on" : "off"}>
        <HeartIcon filled={choice === "picked"} />
      </button>
    </div>
  );
}

function Select({ handle, selected, canPick, onSelect, copy }: { handle: string; selected: boolean; canPick: boolean; onSelect: () => void; copy: Copy }) {
  const label = interpolate(canPick ? copy.select : copy.selectForCompare, { handle });
  return (
    <label className="bw-shortlist-select bw-no-print" title={label}>
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={label} data-shortlist-select={handle} />
    </label>
  );
}

/** The list layout: one row per candidate with the four figures the triage reads, sortable by its headers. */
function ShortlistList({ candidates, rowProps, allSelected, onSelectAll, sort, onSort, canPick, copy, locale }: {
  candidates: ShortlistCandidate[];
  rowProps: (c: ShortlistCandidate) => ItemProps;
  allSelected: boolean;
  onSelectAll: () => void;
  sort: ShortlistSort;
  onSort: (sort: ShortlistSort) => void;
  canPick: boolean;
  copy: Copy;
  locale: string;
}) {
  const head = (key: ShortlistSort, label: string) => (
    <th scope="col" aria-sort={sort === key ? "descending" : "none"}>
      <button type="button" onClick={() => onSort(key)} data-shortlist-sort-head={key}>{label}{sort === key ? " ↓" : ""}</button>
    </th>
  );
  return (
    <div className="bw-table-scroll">
      <table className="bw-shortlist-list" data-shortlist-list={candidates.length}>
        <thead>
          <tr>
            <th scope="col" className="bw-shortlist-list-check bw-no-print">
              {canPick && <input type="checkbox" checked={allSelected} onChange={onSelectAll} aria-label={interpolate(copy.selectAll, { count: candidates.length })} data-shortlist-select-all />}
            </th>
            <th scope="col">{copy.columns.creator}</th>
            {head("followers", copy.followers)}
            {head("views", copy.viewsMedian)}
            {head("engagement", copy.engagement)}
            <th scope="col">{copy.adShare}</th>
            {canPick && <th scope="col" className="bw-no-print"><span className="bw-sr-only">{copy.columns.marks}</span></th>}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const p = rowProps(c);
            const engagement = shortlistSortValue(c.metrics, "engagement");
            return (
              <tr key={c.id} data-shortlist-row-candidate={c.handle} data-choice={p.choice} data-selected={p.selected ? "true" : undefined}>
                <td className="bw-shortlist-list-check bw-no-print">
                  <input type="checkbox" checked={p.selected} onChange={p.onSelect} aria-label={interpolate(canPick ? copy.select : copy.selectForCompare, { handle: c.handle })} data-shortlist-select={c.handle} />
                </td>
                <td>
                  <div className="bw-shortlist-list-who">
                    <button type="button" className="bw-shortlist-list-open bw-no-print" onClick={p.onOpen} aria-label={interpolate(copy.openDetail, { handle: c.handle })} data-shortlist-open={c.handle}>
                      <Portrait candidate={c} size={36} />
                    </button>
                    <div>
                      <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noopener noreferrer" aria-label={interpolate(copy.profile, { handle: c.handle })}>@{c.handle} <OutIcon /></a>
                      {(c.displayName || c.category) && <span className="bw-muted">{[c.displayName, c.category].filter(Boolean).join(" · ")}</span>}
                    </div>
                    <span className="bw-shortlist-list-badges"><Badges choice={p.choice} confirmed={c.confirmed} copy={copy} /></span>
                  </div>
                </td>
                <td className="bw-shortlist-list-num">{shortlistCount(c.metrics.followers, locale)}</td>
                <td className="bw-shortlist-list-num">{shortlistCount(c.metrics.viewsMedian90d, locale)}</td>
                <td className="bw-shortlist-list-num">{engagement == null ? SHORTLIST_UNKNOWN : shortlistPercent(engagement, locale)}</td>
                <td className="bw-shortlist-list-num">{shortlistPercent(c.metrics.adShare, locale)}</td>
                {canPick && <td className="bw-no-print"><Marks {...p} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Portrait({ candidate: c, size }: { candidate: ShortlistCandidate; size: number }) {
  const name = c.displayName ?? c.handle;
  return c.avatarUrl
    ? <img className="bw-shortlist-avatar" src={c.avatarUrl} alt="" width={size} height={size} loading="lazy" decoding="async" style={{ width: size, height: size }} />
    : <span className="bw-shortlist-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>{Array.from(name)[0]?.toUpperCase()}</span>;
}

/** Where a figure sits against the shortlist's median: the median is the track's middle mark. */
function Relative({ label, value, median, empty }: { label: string; value: number | null | undefined; median: number | null; empty: string }) {
  if (median == null || median === 0) return null;
  if (value == null) return (
    <div className="bw-shortlist-rel-row" data-unknown="true"><span>{label}</span><span className="bw-shortlist-track"><b /></span><em>{empty}</em></div>
  );
  const ratio = value / median;
  const diff = Math.round((ratio - 1) * 100);
  return (
    <div className="bw-shortlist-rel-row" data-shortlist-rel={diff >= 0 ? "above" : "below"}>
      <span>{label}</span>
      <span className="bw-shortlist-track"><i style={{ width: `${Math.max(2, Math.min(100, ratio * 50))}%` }} /><b /></span>
      <em>{diff > 0 ? "+" : diff < 0 ? "−" : "±"}{Math.abs(diff)}%</em>
    </div>
  );
}

/** Scroll lock, focus and keys for a sheet: only the sheet scrolls, and closing returns focus to what opened it. */
function useSheet(onClose: () => void, onStep?: ((by: 1 | -1) => void) | null) {
  const root = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onClose, onStep });
  handlers.current = { onClose, onStep };
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const page = document.documentElement;
    const overflow = page.style.overflow;
    page.style.overflow = "hidden";
    root.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return handlers.current.onClose();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") return handlers.current.onStep?.(event.key === "ArrowLeft" ? -1 : 1);
      if (event.key !== "Tab" || !root.current) return;
      const stops = [...root.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
      const edge = stops[event.shiftKey ? 0 : stops.length - 1];
      if (edge && document.activeElement === edge) {
        event.preventDefault();
        stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      page.style.overflow = overflow;
      before?.focus({ preventScroll: true });
    };
  }, []);
  return root;
}

function ShortlistCard({ candidate: c, choice, canPick, busy, selected, onSelect, onPick, onPass, onOpen, medians, copy, locale }: ItemProps & { medians: Medians | null }) {
  const m = c.metrics;
  const engagement = shortlistSortValue(m, "engagement");
  const tags = shortlistTags(m, medians?.engagement ?? null).slice(0, CARD_TAGS);
  const tone = c.avatarTone ? ({ "--bw-tone": c.avatarTone } as CSSProperties) : undefined;
  return (
    <li
      className="bw-shortlist-card"
      data-shortlist-candidate={c.handle}
      data-picked={choice === "picked" ? "true" : undefined}
      data-passed={choice === "passed" ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-toned={c.avatarTone ? "true" : undefined}
      style={tone}
    >
      <div className="bw-shortlist-portrait">
        <button type="button" className="bw-shortlist-open" onClick={onOpen} aria-label={interpolate(copy.openDetail, { handle: c.handle })} data-shortlist-open={c.handle}>
          <Photo candidate={c} />
        </button>
        <Select handle={c.handle} selected={selected} canPick={canPick} onSelect={onSelect} copy={copy} />
        {canPick && <Marks candidate={c} choice={choice} busy={busy} onPick={onPick} onPass={onPass} copy={copy} />}
        <span className="bw-shortlist-photo-badges"><Badges choice={choice} confirmed={c.confirmed} copy={copy} /></span>
      </div>
      <div className="bw-shortlist-body">
        <Who candidate={c} copy={copy} />
        <dl className="bw-shortlist-headline">
          <div><dt>{copy.followers}</dt><dd>{shortlistCount(m.followers, locale)}</dd></div>
          <div title={copy.viewsMedian}><dt>{copy.relativeRows.views}</dt><dd>{shortlistCount(m.viewsMedian90d, locale)}</dd></div>
          <div><dt>{copy.engagement}</dt><dd>{engagement == null ? SHORTLIST_UNKNOWN : shortlistPercent(engagement, locale)}</dd></div>
        </dl>
        {tags.length > 0 && (
          <ul className="bw-shortlist-tags">
            {tags.map((tag) => <li key={tag} title={copy.tagHints[tag]} data-shortlist-tag={tag}>{copy.tags[tag]}</li>)}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The whole picture, or the picture's colour and an initial when none was imported. */
function Photo({ candidate: c }: { candidate: ShortlistCandidate }) {
  return c.avatarUrl
    ? <img className="bw-shortlist-photo" src={c.avatarUrl} alt="" loading="lazy" decoding="async" width={480} height={480} />
    : <span className="bw-shortlist-photo" aria-hidden="true">{Array.from(c.displayName ?? c.handle)[0]?.toUpperCase()}</span>;
}

function Who({ candidate: c, copy }: { candidate: ShortlistCandidate; copy: Copy }) {
  const profile = `https://www.instagram.com/${c.handle}/`;
  const link = (
    <a href={profile} target="_blank" rel="noopener noreferrer" aria-label={interpolate(copy.profile, { handle: c.handle })}>
      @{c.handle} <OutIcon />
    </a>
  );
  return (
    <div className="bw-shortlist-who">
      {/* Without a display name the handle is the title, not a second line repeating it. */}
      <strong>{c.displayName ?? link}</strong>
      {c.displayName && link}
      {c.category && <span className="bw-muted">{c.category}</span>}
    </div>
  );
}

/** Every figure of one candidate: the three kinds of post, then the rest. Unknown kinds leave no empty rows. */
function Figures({ candidate: c, copy, locale }: { candidate: ShortlistCandidate; copy: Copy; locale: string }) {
  const m = c.metrics;
  const rows = ([
    ["feed", m.feedPosts30d, m.feedEngagement, m.feedEngagementRate, m.feedLikes, m.feedComments],
    ["ads", m.adPosts30d, m.adEngagement, m.adEngagementRate, m.adLikes, m.adComments],
    ["reels", m.reelsPosts30d, m.reelsEngagement, m.reelsEngagementRate, m.reelsLikes, m.reelsComments],
  ] as const).filter(([, ...values]) => values.some((v) => v != null));
  const reactions = (likes?: number, comments?: number) =>
    likes == null && comments == null ? SHORTLIST_UNKNOWN : `${shortlistAverage(likes, locale)} · ${shortlistAverage(comments, locale)}`;
  const facts = ([
    [copy.viewsMax, m.viewsMax90d == null ? null : shortlistCount(m.viewsMax90d, locale)],
    [copy.adShare, m.adShare == null ? null : shortlistPercent(m.adShare, locale)],
    [copy.posts, m.posts == null ? null : shortlistCount(m.posts, locale)],
    [copy.following, m.following == null ? null : shortlistCount(m.following, locale)],
  ] as const).filter(([, value]) => value !== null);
  if (rows.length === 0 && facts.length === 0) return <p className="bw-muted">{copy.noMetrics}</p>;
  return (
    <>
      {facts.length > 0 && (
        <dl className="bw-shortlist-facts">
          {facts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      {rows.length > 0 && (
        <table className="bw-shortlist-table">
          <thead>
            <tr>
              <th scope="col">{copy.columns.kind}</th>
              <th scope="col">{copy.columns.perMonth}</th>
              <th scope="col">{copy.columns.engagement}</th>
              <th scope="col">{copy.columns.rate}</th>
              <th scope="col">{copy.columns.reactions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([kind, perMonth, engagement, rate, likes, comments]) => (
              <tr key={kind} data-shortlist-row={kind}>
                <th scope="row">{copy.rows[kind]}</th>
                <td>{shortlistAverage(perMonth, locale)}</td>
                <td>{shortlistAverage(engagement, locale)}</td>
                <td>{shortlistPercent(rate, locale)}</td>
                <td>{reactions(likes, comments)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** One candidate in full: the photo, every figure, where they sit against the others, and the marks. */
export function CandidateSheet({ candidate: c, choice, canPick, busy, medians, position, onPick, onPass, onClose, onStep, copy, locale }: {
  candidate: ShortlistCandidate;
  choice: ShortlistChoice;
  canPick: boolean;
  busy: boolean;
  medians: Medians | null;
  /** "3 / 36", or null when a mark just moved this candidate off the tab. */
  position: string | null;
  onPick: () => void;
  onPass: () => void;
  onClose: () => void;
  onStep: ((by: 1 | -1) => void) | null;
  copy: Copy;
  locale: string;
}) {
  const root = useSheet(onClose, onStep);
  const m = c.metrics;
  const engagement = shortlistSortValue(m, "engagement");
  const tags = shortlistTags(m, medians?.engagement ?? null);
  const tone = c.avatarTone ? ({ "--bw-tone": c.avatarTone } as CSSProperties) : undefined;
  return (
    <div className="bw-triage-sheet-bg bw-no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} className="bw-shortlist-sheet" role="dialog" aria-modal="true" aria-label={`@${c.handle}`} style={tone} data-toned={c.avatarTone ? "true" : undefined} data-shortlist-sheet={c.handle}>
        <div className="bw-shortlist-sheet-side">
          <div className="bw-shortlist-sheet-photo">
            <Photo candidate={c} />
            <span className="bw-shortlist-photo-badges"><Badges choice={choice} confirmed={c.confirmed} copy={copy} /></span>
          </div>
          {tags.length > 0 && (
            <ul className="bw-shortlist-tag-notes">
              {tags.map((tag) => <li key={tag} data-shortlist-tag={tag}><b>{copy.tags[tag]}</b> {copy.tagHints[tag]}</li>)}
            </ul>
          )}
        </div>
        <div className="bw-shortlist-sheet-body">
          <Who candidate={c} copy={copy} />
          <dl className="bw-shortlist-headline" data-size="large">
            <div><dt>{copy.followers}</dt><dd>{shortlistCount(m.followers, locale)}</dd></div>
            <div><dt>{copy.viewsMedian}</dt><dd>{shortlistCount(m.viewsMedian90d, locale)}</dd></div>
            <div><dt>{copy.engagement}</dt><dd>{engagement == null ? SHORTLIST_UNKNOWN : shortlistPercent(engagement, locale)}</dd></div>
          </dl>
          {medians && (
            <div className="bw-shortlist-relative" role="group" aria-label={copy.relative}>
              <p>{copy.relative}</p>
              <Relative label={copy.relativeRows.views} value={m.viewsMedian90d} median={medians.views} empty={copy.noFigure} />
              <Relative label={copy.relativeRows.engagement} value={engagement} median={medians.engagement} empty={copy.noFigure} />
              <Relative label={copy.relativeRows.followers} value={m.followers} median={medians.followers} empty={copy.noFigure} />
            </div>
          )}
          <Figures candidate={c} copy={copy} locale={locale} />
        </div>
        <div className="bw-shortlist-sheet-foot">
          {onStep && (
            <div className="bw-shortlist-sheet-step">
              <button type="button" aria-label={copy.previous} title={copy.previous} onClick={() => onStep(-1)} data-shortlist-step="previous"><ChevronIcon to="left" /></button>
              {position && <span>{position}</span>}
              <button type="button" aria-label={copy.next} title={copy.next} onClick={() => onStep(1)} data-shortlist-step="next"><ChevronIcon to="right" /></button>
            </div>
          )}
          {canPick && (
            <div className="bw-shortlist-sheet-marks">
              <button type="button" className="bw-button" aria-pressed={choice === "passed"} disabled={busy} onClick={onPass} data-shortlist-sheet-mark="passed">{choice === "passed" ? copy.unpass : copy.pass}</button>
              <button type="button" className={choice === "picked" ? "bw-button" : "bw-button bw-primary"} aria-pressed={choice === "picked"} disabled={busy} onClick={onPick} data-shortlist-sheet-mark="picked">{choice === "picked" ? copy.unprefer : copy.prefer}</button>
            </div>
          )}
        </div>
        <button type="button" className="bw-shortlist-sheet-close" aria-label={copy.close} title={copy.close} onClick={onClose} data-sheet-close><CrossIcon /></button>
      </div>
    </div>
  );
}

/** Up to four candidates side by side; the best value in each row is bold (lowest for sponsored share). */
function CompareSheet({ candidates, copy, locale, onClose }: { candidates: ShortlistCandidate[]; copy: Copy; locale: string; onClose: () => void }) {
  const root = useSheet(onClose);
  const count = (v: number | null | undefined) => shortlistCount(v ?? undefined, locale);
  const percent = (v: number | null | undefined) => shortlistPercent(v ?? undefined, locale);
  const average = (v: number | null | undefined) => shortlistAverage(v ?? undefined, locale);
  const lines: Array<[string, (m: ShortlistMetrics) => number | null | undefined, (v: number | null | undefined) => string, boolean?]> = [
    [copy.followers, (m) => m.followers, count],
    [copy.viewsMedian, (m) => m.viewsMedian90d, count],
    [copy.viewsMax, (m) => m.viewsMax90d, count],
    [copy.engagement, (m) => shortlistSortValue(m, "engagement"), percent],
    [`${copy.rows.feed} ${copy.columns.rate}`, (m) => m.feedEngagementRate, percent],
    [`${copy.rows.reels} ${copy.columns.rate}`, (m) => m.reelsEngagementRate, percent],
    [`${copy.rows.feed} ${copy.columns.perMonth}`, (m) => m.feedPosts30d, average],
    [`${copy.rows.reels} ${copy.columns.perMonth}`, (m) => m.reelsPosts30d, average],
    [copy.adShare, (m) => m.adShare, percent, true],
  ];
  return (
    <div className="bw-triage-sheet-bg bw-no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} className="bw-triage-sheet" role="dialog" aria-modal="true" aria-labelledby="shortlist-compare-title" data-shortlist-compare-sheet>
        <h3 id="shortlist-compare-title">{copy.compareTitle}</h3>
        <p className="bw-muted">{copy.compareHint}</p>
        <div className="bw-table-scroll">
          <table className="bw-shortlist-compare-table">
            <thead>
              <tr><th scope="col" />{candidates.map((c) => <th key={c.id} scope="col"><Portrait candidate={c} size={28} />@{c.handle}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map(([label, pick, show, lowBest]) => {
                const values = candidates.map((c) => pick(c.metrics));
                const knownValues = values.filter((v): v is number => v != null);
                const best = knownValues.length > 1 ? (lowBest ? Math.min(...knownValues) : Math.max(...knownValues)) : null;
                return (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {values.map((v, i) => <td key={candidates[i]!.id} data-best={v != null && v === best ? "true" : undefined}>{show(v)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bw-triage-sheet-foot">
          <span />
          <button type="button" className="bw-button" onClick={onClose} data-sheet-close>{copy.close}</button>
        </div>
      </div>
    </div>
  );
}
