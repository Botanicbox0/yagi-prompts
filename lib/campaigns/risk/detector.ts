import { z } from 'zod';
export const RISK_VERSION = 'campaign-risk-v1';
export const EvidenceSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    text: z.string().min(1).max(4000),
  })
  .strict();
export const ModelResultSchema = z
  .object({
    category: z.enum(['none', 'transfer_solicitation', 'off_platform_solicitation']),
    confidence: z.number().min(0).max(1),
    evidence: z.array(EvidenceSchema).max(8),
  })
  .strict();
export type RiskResult = z.infer<typeof ModelResultSchema>;
// Offsets refer to the ORIGINAL JavaScript UTF-16 string. NFC is for detection only, never offsets.
export function validateModelResult(body: string, value: unknown): RiskResult | null {
  const p = ModelResultSchema.safeParse(value);
  if (!p.success) return null;
  const r = p.data;
  if ((r.category === 'none') !== (r.evidence.length === 0)) return null;
  for (const e of r.evidence)
    if (e.end <= e.start || e.end > body.length || body.slice(e.start, e.end) !== e.text)
      return null;
  return r;
}
/** Models count offsets unreliably. Repair only a uniquely occurring, byte-for-byte JS substring;
 * never normalize, fuzzy-match, pick between duplicates, or invent evidence. Server validation
 * remains independent and strict after this adapter-side anchoring. */
export function canonicalizeUniqueEvidence(body: string, value: unknown): RiskResult | null {
  const parsed = ModelResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  for (const evidence of result.evidence) {
    if (
      evidence.end <= body.length &&
      evidence.end > evidence.start &&
      body.slice(evidence.start, evidence.end) === evidence.text
    )
      continue;
    const start = body.indexOf(evidence.text);
    if (start < 0 || body.lastIndexOf(evidence.text) !== start) return null;
    evidence.start = start;
    evidence.end = start + evidence.text.length;
  }
  return validateModelResult(body, result);
}
export function detectTransferRisk(body: string): RiskResult[] {
  const text = body.normalize('NFKC');
  const transfer = /(계좌|외부\s*결제|직거래|bank\s*account|outside\s*payment)/i;
  const request =
    /(송금해|입금해|계좌로\s*보내\s*주세요|이체해|수수료\s*없이|pay\s*(me\s*)?(directly|outside)|transfer\s*(the\s*)?(money|funds|to))/i;
  if (!transfer.test(text) || !request.test(text)) return [];
  // Whole original span preserves unicode correspondence without guessing normalized offsets.
  return [
    {
      category: 'transfer_solicitation',
      confidence: 0.7,
      evidence: [{ start: 0, end: body.length, text: body }],
    },
  ];
}
