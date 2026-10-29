"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { ShortlistCandidate } from "@/lib/brands/shortlist/service";
import type { ShortlistMetrics } from "@/lib/brands/shortlist/schema";
import {
  SHORTLIST_SORTS, SHORTLIST_UNKNOWN, shortlistAverage, shortlistCount, shortlistDay, shortlistMedian, shortlistPercent, shortlistSortValue,
  shortlistTags, sortShortlist, type ShortlistSort,
} from "@/lib/brands/shortlist/format";

type Copy = Dictionary["brandWorkspace"]["shortlist"];
const COMPARE_MAX = 4;
/** Medians mean something from three candidates on; below that the cards leave the comparison out. */
const MEDIAN_FROM = 3;
type Medians = { views: number | null; engagement: number | null; followers: number | null };

/**
 * The campaign's creator shortlist (docs/BRAND-SHORTLIST.md): one card per shared candidate. A
 * portrait washed in the picture's own colour, three headline figures, where each sits against this
 * shortlist's median, plain labels the brand can check against the figures, and every figure behind
 * "all figures". Sort (followers first by default), "preferred only", compare up to four, and the
 * brand's one control, the preference mark. No fee, note or recruiting detail exists in what this receives.
 */
export function CampaignShortlist({ candidates, canPick, copy, locale }: {
  candidates: ShortlistCandidate[];
  canPick: boolean;
  copy: Copy;
  locale: string;
}) {
  const [sort, setSort] = useState<ShortlistSort>("followers");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [picked, setPicked] = useState(() => new Set(candidates.filter((c) => c.picked).map((c) => c.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const days = [...new Set(candidates.map((c) => c.measuredOn).filter((d): d is string => d !== null))].sort();
  const measured = days.at(-1) ?? null;
  const shown = sortShortlist(onlyPicked ? candidates.filter((c) => picked.has(c.id)) : candidates, sort);
  const known = (pick: (m: ShortlistMetrics) => number | null | undefined) =>
    candidates.map((c) => pick(c.metrics)).filter((v): v is number => v != null);
  const medians: Medians | null = candidates.length >= MEDIAN_FROM ? {
    views: shortlistMedian(known((m) => m.viewsMedian90d)),
    engagement: shortlistMedian(known((m) => shortlistSortValue(m, "engagement"))),
    followers: shortlistMedian(known((m) => m.followers)),
  } : null;

  async function toggle(id: string) {
    if (busy) return;
    const next = !picked.has(id);
    setBusy(id);
    setFailed(null);
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "shortlist.pick", input: { candidateId: id, picked: next } }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(String(result.code));
      setPicked((current) => {
        const copy = new Set(current);
        if (next) copy.add(id);
        else copy.delete(id);
        return copy;
      });
    } catch {
      setFailed(id);
    } finally {
      setBusy(null);
    }
  }
  const toggleCompare = (id: string) =>
    setCompare((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length < COMPARE_MAX ? [...current, id] : current));
  const compared = compare.map((id) => candidates.find((c) => c.id === id)).filter((c): c is ShortlistCandidate => c !== undefined);

  return (
    <section id="shortlist" className="bw-panel bw-shortlist" data-brand-shortlist={candidates.length}>
      <header className="bw-shortlist-head">
        <div>
          <h2>{copy.title} <span className="bw-shortlist-count">{interpolate(copy.count, { count: candidates.length })}</span></h2>
          <p>{copy.intro}</p>
        </div>
        <p className="bw-muted" data-shortlist-measured={measured ?? ""}>
          {measured ? `${interpolate(copy.measuredOn, { date: shortlistDay(measured, locale) })} · ` : ""}{copy.basis}
        </p>
      </header>
      <div className="bw-shortlist-tools bw-no-print">
        <div className="bw-shortlist-sorts" role="group" aria-label={copy.sortLabel}>
          {SHORTLIST_SORTS.map((key) => (
            <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)} data-shortlist-sort={key}>
              {copy.sorts[key]}
            </button>
          ))}
        </div>
        <button type="button" className="bw-shortlist-filter" aria-pressed={onlyPicked} onClick={() => setOnlyPicked((v) => !v)} data-shortlist-filter={onlyPicked ? "picked" : "all"}>
          {onlyPicked ? copy.showAll : interpolate(copy.showPicked, { count: picked.size })}
        </button>
      </div>
      {!canPick && <p className="bw-note bw-no-print">{copy.readOnly}</p>}
      {shown.length === 0 ? (
        <p className="bw-empty" data-shortlist-empty>{copy.nonePicked}</p>
      ) : (
        <ol className="bw-shortlist-grid">
          {shown.map((c) => (
            <ShortlistCard
              key={c.id}
              candidate={c}
              medians={medians}
              picked={picked.has(c.id)}
              canPick={canPick}
              busy={busy === c.id}
              failed={failed === c.id}
              onToggle={() => toggle(c.id)}
              compared={compare.includes(c.id)}
              compareFull={compare.length >= COMPARE_MAX}
              onCompare={() => toggleCompare(c.id)}
              copy={copy}
              locale={locale}
            />
          ))}
        </ol>
      )}
      {compared.length > 0 && (
        <div className="bw-shortlist-tray bw-no-print" role="region" aria-label={copy.compareTitle} data-shortlist-tray={compared.length}>
          <ul>
            {compared.map((c) => <li key={c.id}><Portrait candidate={c} size={24} />@{c.handle}</li>)}
          </ul>
          <button type="button" className="bw-button bw-primary" disabled={compared.length < 2} onClick={() => setComparing(true)} data-shortlist-compare-open>
            {interpolate(copy.compareOpen, { count: compared.length })}
          </button>
          <button type="button" className="bw-button" onClick={() => setCompare([])}>{copy.compareClear}</button>
        </div>
      )}
      {comparing && compared.length > 1 && <CompareSheet candidates={compared} copy={copy} locale={locale} onClose={() => setComparing(false)} />}
    </section>
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

function ShortlistCard({ candidate: c, medians, picked, canPick, busy, failed, onToggle, compared, compareFull, onCompare, copy, locale }: {
  candidate: ShortlistCandidate;
  medians: Medians | null;
  picked: boolean;
  canPick: boolean;
  busy: boolean;
  failed: boolean;
  onToggle: () => void;
  compared: boolean;
  compareFull: boolean;
  onCompare: () => void;
  copy: Copy;
  locale: string;
}) {
  const m = c.metrics;
  const engagement = shortlistSortValue(m, "engagement");
  const tags = shortlistTags(m, medians?.engagement ?? null);
  const rows = ([
    ["feed", m.feedPosts30d, m.feedEngagement, m.feedEngagementRate, m.feedLikes, m.feedComments],
    ["ads", m.adPosts30d, m.adEngagement, m.adEngagementRate, m.adLikes, m.adComments],
    ["reels", m.reelsPosts30d, m.reelsEngagement, m.reelsEngagementRate, m.reelsLikes, m.reelsComments],
  ] as const).filter(([, ...values]) => values.some((v) => v != null));
  const reactions = (likes?: number, comments?: number) =>
    likes == null && comments == null ? SHORTLIST_UNKNOWN : `${shortlistAverage(likes, locale)} · ${shortlistAverage(comments, locale)}`;
  const facts = ([
    [copy.viewsMedian, m.viewsMedian90d == null ? null : shortlistCount(m.viewsMedian90d, locale)],
    [copy.viewsMax, m.viewsMax90d == null ? null : shortlistCount(m.viewsMax90d, locale)],
    [copy.adShare, m.adShare == null ? null : shortlistPercent(m.adShare, locale)],
  ] as const).filter(([, value]) => value !== null);
  const profile = `https://www.instagram.com/${c.handle}/`;
  const tone = c.avatarTone ? ({ "--bw-tone": c.avatarTone } as CSSProperties) : undefined;
  const pickLabel = picked ? copy.unprefer : copy.prefer;
  return (
    <li className="bw-shortlist-card" data-shortlist-candidate={c.handle} data-picked={picked ? "true" : undefined} data-toned={c.avatarTone ? "true" : undefined} style={tone}>
      <div className="bw-shortlist-portrait">
        {tags.length > 0 && (
          <ul className="bw-shortlist-tags">
            {tags.map((tag) => <li key={tag} title={copy.tagHints[tag]} data-shortlist-tag={tag}>{copy.tags[tag]}</li>)}
          </ul>
        )}
        <Portrait candidate={c} size={144} />
        {canPick && (
          <button
            type="button"
            className="bw-shortlist-pick bw-no-print"
            aria-pressed={picked}
            aria-label={busy ? copy.working : `${pickLabel} · @${c.handle}`}
            title={pickLabel}
            disabled={busy}
            onClick={onToggle}
            data-shortlist-pick={picked ? "on" : "off"}
          >
            <span aria-hidden="true">{picked ? "♥" : "♡"}</span>
          </button>
        )}
      </div>
      <div className="bw-shortlist-body">
        <div className="bw-shortlist-who">
          {/* Without a display name the handle is the title, not a second line repeating it. */}
          <strong>
            {c.displayName ?? (
              <a href={profile} target="_blank" rel="noopener noreferrer" aria-label={interpolate(copy.profile, { handle: c.handle })}>
                @{c.handle} <span aria-hidden="true">↗</span>
              </a>
            )}
            {picked && <span className="bw-shortlist-badge" data-shortlist-picked>{copy.preferred}</span>}
          </strong>
          {c.displayName && (
            <a href={profile} target="_blank" rel="noopener noreferrer" aria-label={interpolate(copy.profile, { handle: c.handle })}>
              @{c.handle} <span aria-hidden="true">↗</span>
            </a>
          )}
          {c.category && <span className="bw-muted">{c.category}</span>}
        </div>
        <dl className="bw-shortlist-headline">
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
        {rows.length === 0 && facts.length === 0 ? (
          <p className="bw-muted">{copy.noMetrics}</p>
        ) : (
          <details className="bw-shortlist-more">
            <summary>{copy.details}</summary>
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
            {facts.length > 0 && (
              <dl className="bw-shortlist-facts">
                {facts.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
          </details>
        )}
        <div className="bw-shortlist-foot">
          <span className="bw-muted">
            {copy.posts} {shortlistCount(m.posts, locale)} · {copy.following} {shortlistCount(m.following, locale)}
          </span>
          <label className="bw-shortlist-compare bw-no-print" title={!compared && compareFull ? copy.compareFull : undefined}>
            <input type="checkbox" checked={compared} disabled={!compared && compareFull} onChange={onCompare} data-shortlist-compare={c.handle} />
            {copy.compare}
          </label>
        </div>
        {failed && <p role="alert" className="bw-error">{copy.failed}</p>}
      </div>
    </li>
  );
}

/** Up to four candidates side by side; the best value in each row is bold (lowest for sponsored share). */
function CompareSheet({ candidates, copy, locale, onClose }: { candidates: ShortlistCandidate[]; copy: Copy; locale: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
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
      <div className="bw-triage-sheet" role="dialog" aria-modal="true" aria-labelledby="shortlist-compare-title" data-shortlist-compare-sheet>
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
          <button type="button" className="bw-button" ref={closeRef} onClick={onClose}>{copy.close}</button>
        </div>
      </div>
    </div>
  );
}
