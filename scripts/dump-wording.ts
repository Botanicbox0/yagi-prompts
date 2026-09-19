import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { en } from '../messages/en';
import { ko } from '../messages/ko';
import { analyzeSources, csv, flattenStrings } from './wording/inventory';
import { triage, validateReviews, type Review } from './wording/audit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const output = path.join(root, 'docs/wording');
const enMap = flattenStrings(en);
const koMap = flattenStrings(ko);
if (JSON.stringify([...enMap.keys()].sort()) !== JSON.stringify([...koMap.keys()].sort())) throw new Error('Dictionary key sets differ');
const reviews = JSON.parse(fs.readFileSync(path.join(output, 'reviews.json'), 'utf8')) as Record<string, Review>;
validateReviews(reviews, koMap, enMap);
const inventory = analyzeSources(root);
const rows: Array<Array<string | number>> = [];
let referenced = 0;
let flagged = 0;
const sections: Record<string, number> = {};
for (const key of [...enMap.keys()].sort()) {
  const koText = koMap.get(key)!;
  const enText = enMap.get(key)!;
  const uses = inventory.uses.get(key) ?? [];
  const routes = [...new Set(uses.flatMap((use) => inventory.routesByFile.get(use.file) ?? []))].sort();
  const koTriage = triage(key, koText, 'ko');
  const enTriage = triage(key, enText, 'en');
  const review = reviews[key];
  const koScore = review?.ko ?? koTriage.scores;
  const enScore = review?.en ?? enTriage.scores;
  const flags = [...new Set([...koTriage.flags, ...enTriage.flags])];
  const min = Math.min(...Object.values(koScore), ...Object.values(enScore));
  if (uses.length) referenced++;
  if (min <= 2) flagged++;
  const section = key.split('.')[0]!;
  sections[section] = (sections[section] ?? 0) + 1;
  rows.push([
    key, koText, enText, section,
    uses.length ? 'source-reference' : 'no-static-reference-candidate',
    uses.map((use) => `${use.file}:${use.line} [${use.kind}]`).join('\n'),
    routes.join('\n'),
    /(^|\.)(email|notify)(\.|$)/.test(key) || uses.some((use) => /notify|mailer|announce/.test(use.file)) ? 'email-or-shared; approval required for outbound copy' : 'ui-or-metadata; visibility depends on route/state',
    review ? 'context-reviewed-candidate' : 'rule-triage; context-review-pending',
    koScore.clarity, koScore.specificity, koScore.naturalness,
    enScore.clarity, enScore.specificity, enScore.naturalness,
    min <= 2 ? 'review-priority' : 'no-low-score; not-an-approval',
    flags.join(' | '), review?.decision ?? 'review-pending',
    review?.proposed_ko ?? '', review?.proposed_en ?? '',
    review?.reason ?? (flags.length ? '규칙 기반 예비 진단. 화면·문맥 확인 후 채점과 수정안을 확정한다.' : '규칙상 경고 없음. 3점은 수동 검토 전 중립값이며 적합 판정이 아니다.'),
    review?.evidence ?? '', review?.topic ?? '',
  ]);
}
const headers = ['key', 'ko', 'en', 'section', 'reference_status', 'source_locations', 'candidate_routes', 'surface_note', 'review_basis', 'ko_clarity', 'ko_specificity', 'ko_naturalness', 'en_clarity', 'en_specificity', 'en_naturalness', 'priority', 'triage_flags', 'decision', 'proposed_ko', 'proposed_en', 'reason', 'evidence', 'topic'];
const routeRows = inventory.routeFiles.map(({ file, route }) => {
  const keys = [...inventory.uses].filter(([, uses]) => uses.some((use) => inventory.routesByFile.get(use.file)?.includes(route))).map(([key]) => key).sort();
  return [route, file, keys.length, keys.join('\n')];
});
const summary = {
  source: { en_sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'messages/en.ts'))).digest('hex'), ko_sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'messages/ko.ts'))).digest('hex') },
  dictionaryKeys: enMap.size, stringValues: enMap.size + koMap.size,
  referencedKeys: referenced, noStaticReferenceCandidates: enMap.size - referenced,
  contextReviewedKeys: Object.keys(reviews).length, ruleTriageOnlyKeys: enMap.size - Object.keys(reviews).length,
  changedProposalKeys: Object.values(reviews).filter((review) => review.source_ko !== review.proposed_ko || review.source_en !== review.proposed_en).length,
  reviewPriorityKeys: flagged, routeEntries: inventory.routeFiles.length,
  hardcodedCandidates: inventory.literals.length, sections,
  limits: ['Import reachability is conservative, not runtime visibility.', 'No static reference is a removal candidate, not proof of dead code.', 'Rule scores default to 3 (unassessed), not an editorial quality grade.', 'CMS content, provider widgets and legal bodies are outside dictionary inventory; see README.'],
};
const md = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/\r?\n/g, '<br>');
const proposals = Object.entries(reviews).filter(([, review]) => review.source_ko !== review.proposed_ko || review.source_en !== review.proposed_en);
const proposalDocument = [
  '# 문안 비교표 — 적용 전 후보', '',
  '자동 생성 파일. 수정 원본은 `reviews.json`, 생성 명령은 `npx tsx scripts/dump-wording.ts`입니다.', '',
  '점수는 **현재 원문**의 명확성 / 구체성 / 자연스러움 순서입니다. `owner-decision`은 대표 결정 전 적용하지 않습니다. 메일 문구는 decision 값과 관계없이 발송 전 별도 승인이 필요합니다. 변경 없는 검토 항목은 inventory.csv에서 확인합니다.', '',
  ...proposals.flatMap(([key, review]) => [
    `## ${key}`, '',
    `분류: **${review.decision}** · 주제: ${md(review.topic)} · 현재 KO ${Object.values(review.ko).join('/')} · EN ${Object.values(review.en).join('/')}`, '',
    '| 언어 | 현재 | 후보 |', '|---|---|---|',
    `| KO | ${md(review.source_ko)} | ${md(review.proposed_ko)} |`,
    `| EN | ${md(review.source_en)} | ${md(review.proposed_en)} |`, '',
    `이유: ${md(review.reason)}`, '', `근거: ${md(review.evidence)}`, '',
  ]),
].join('\n');
const artifacts: Record<string, string> = {
  'inventory.csv': csv(headers, rows),
  'routes.csv': csv(['route', 'entry_file', 'candidate_key_count', 'candidate_keys'], routeRows),
  'hardcoded-candidates.csv': csv(['file', 'line', 'kind', 'text', 'candidate_routes', 'review_status'], inventory.literals.map((literal) => [literal.file, literal.line, literal.kind, literal.text, literal.routes.join('\n'), 'candidate; may be internal/non-rendered; do not mass-replace'])),
  'summary.json': JSON.stringify(summary, null, 2) + '\n',
  'proposals.md': proposalDocument,
};
for (const [name, contents] of Object.entries(artifacts)) {
  const target = path.join(output, name);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== contents) throw new Error(`Stale audit artifact: ${name}; run npx tsx scripts/dump-wording.ts`);
  } else fs.writeFileSync(target, contents, 'utf8');
}
console.log(JSON.stringify({ mode: check ? 'verified' : 'generated', ...summary }));
