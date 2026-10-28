"use client";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { ShortlistCandidate } from "@/lib/brands/shortlist/service";
import {
  SHORTLIST_SORTS, shortlistAverage, shortlistCount, shortlistDay, shortlistPercent, sortShortlist, type ShortlistSort,
} from "@/lib/brands/shortlist/format";

type Copy = Dictionary["brandWorkspace"]["shortlist"];

/**
 * The campaign's creator shortlist (docs/BRAND-SHORTLIST.md): one card per shared candidate with the
 * public profile figures the brand compares them by, a sort, a "preferred only" view and the brand's
 * one control, the preference mark. No fee, note or recruiting detail exists in what this receives.
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
  const days = [...new Set(candidates.map((c) => c.measuredOn).filter((d): d is string => d !== null))].sort();
  const measured = days.at(-1) ?? null;
  const shown = sortShortlist(onlyPicked ? candidates.filter((c) => picked.has(c.id)) : candidates, sort);

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
              picked={picked.has(c.id)}
              canPick={canPick}
              busy={busy === c.id}
              failed={failed === c.id}
              onToggle={() => toggle(c.id)}
              copy={copy}
              locale={locale}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ShortlistCard({ candidate: c, picked, canPick, busy, failed, onToggle, copy, locale }: {
  candidate: ShortlistCandidate;
  picked: boolean;
  canPick: boolean;
  busy: boolean;
  failed: boolean;
  onToggle: () => void;
  copy: Copy;
  locale: string;
}) {
  const m = c.metrics;
  const name = c.displayName ?? c.handle;
  const rows = ([
    ["feed", m.feedPosts30d, m.feedEngagement, m.feedEngagementRate, m.feedLikes, m.feedComments],
    ["ads", m.adPosts30d, m.adEngagement, m.adEngagementRate, m.adLikes, m.adComments],
    ["reels", m.reelsPosts30d, m.reelsEngagement, m.reelsEngagementRate, m.reelsLikes, m.reelsComments],
  ] as const).filter(([, ...values]) => values.some((v) => v != null));
  const reactions = (likes?: number, comments?: number) =>
    likes == null && comments == null ? "—" : `${shortlistAverage(likes, locale)} · ${shortlistAverage(comments, locale)}`;
  const facts = ([
    [copy.viewsMedian, m.viewsMedian90d == null ? null : shortlistCount(m.viewsMedian90d, locale)],
    [copy.viewsMax, m.viewsMax90d == null ? null : shortlistCount(m.viewsMax90d, locale)],
    [copy.adShare, m.adShare == null ? null : shortlistPercent(m.adShare, locale)],
  ] as const).filter(([, value]) => value !== null);
  const profile = `https://www.instagram.com/${c.handle}/`;
  return (
    <li className="bw-shortlist-card" data-shortlist-candidate={c.handle} data-picked={picked ? "true" : undefined}>
      <div className="bw-shortlist-id">
        {c.avatarUrl ? (
          <img className="bw-shortlist-avatar" src={c.avatarUrl} alt="" width={52} height={52} loading="lazy" decoding="async" />
        ) : (
          <span className="bw-shortlist-avatar" aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>
        )}
        <div className="bw-shortlist-who">
          <strong>
            {name}
            {picked && <span className="bw-shortlist-badge" data-shortlist-picked>{copy.preferred}</span>}
          </strong>
          <a href={profile} target="_blank" rel="noopener noreferrer" aria-label={interpolate(copy.profile, { handle: c.handle })}>
            @{c.handle} <span aria-hidden="true">↗</span>
          </a>
          {c.category && <span className="bw-muted">{c.category}</span>}
        </div>
        <div className="bw-shortlist-followers">
          <strong>{shortlistCount(m.followers, locale)}</strong>
          <span>{copy.followers}</span>
        </div>
      </div>
      {rows.length === 0 && facts.length === 0 ? (
        <p className="bw-muted">{copy.noMetrics}</p>
      ) : (
        <>
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
        </>
      )}
      <div className="bw-shortlist-foot">
        <span className="bw-muted">
          {copy.posts} {shortlistCount(m.posts, locale)} · {copy.following} {shortlistCount(m.following, locale)}
        </span>
        {canPick && (
          <button type="button" className="bw-shortlist-pick bw-no-print" aria-pressed={picked} disabled={busy} onClick={onToggle} data-shortlist-pick={picked ? "on" : "off"}>
            <span aria-hidden="true">{picked ? "★" : "☆"}</span> {busy ? copy.working : picked ? copy.unprefer : copy.prefer}
          </button>
        )}
      </div>
      {failed && <p role="alert" className="bw-error">{copy.failed}</p>}
    </li>
  );
}
