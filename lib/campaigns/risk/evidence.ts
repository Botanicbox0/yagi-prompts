/** Render original text as escaped React text nodes; never render markup or auto-link evidence. */
export function riskEvidenceSegments(
  body: string,
  evidence: Array<{ start: number; end: number }>,
) {
  const spans = evidence
    .filter(
      (e) =>
        Number.isInteger(e.start) &&
        Number.isInteger(e.end) &&
        e.start >= 0 &&
        e.end > e.start &&
        e.end <= body.length,
    )
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const result: Array<{ text: string; highlight: boolean }> = [];
  let at = 0;
  for (const s of merged) {
    if (s.start > at) result.push({ text: body.slice(at, s.start), highlight: false });
    result.push({ text: body.slice(s.start, s.end), highlight: true });
    at = s.end;
  }
  if (at < body.length) result.push({ text: body.slice(at), highlight: false });
  return result;
}
