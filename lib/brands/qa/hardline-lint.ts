/**
 * S5 Customer / Public Surface Hardline Linter (`knowhow-corpus.md` §12.6, `IDENTITY.md` §7).
 *
 * Prevents internal engine/tool names, internal benchmark ratios, private provenance fields,
 * and commercial reference song titles from ever leaking onto customer-facing or public brand surfaces.
 */

export type PublicSurfaceLeakCategory =
  | 'engine_name_leak'
  | 'internal_benchmark_leak'
  | 'private_provenance_leak'
  | 'commercial_audio_title_leak';

export interface PublicSurfaceLeakViolation {
  category: PublicSurfaceLeakCategory;
  matched: string;
  rule: string;
}

const FORBIDDEN_SURFACE_PATTERNS: ReadonlyArray<{
  category: PublicSurfaceLeakCategory;
  pattern: RegExp;
  rule: string;
}> = [
  {
    category: 'engine_name_leak',
    pattern:
      /\b(Seedream|Seedance|Nano\s*Banana|SeedVR2|YuE2|SheetSage2?|earshot|HyperFrames|ComfyUI|ModelArk|Genjutsu|Kling|Hailuo|Wan\s*2)\b/i,
    rule: 'IDENTITY.md §7 & knowhow-corpus §12.6: Never expose internal engine/tool names on customer or public brand surfaces.'
  },
  {
    category: 'internal_benchmark_leak',
    pattern: /(?:^|[^\d])(8\/8|6\/8|\+165%|\+175%)(?!\d)/,
    rule: 'knowhow-corpus §12.6: Internal benchmark figures (8/8, 6/8, +165%, +175%) must not be used in customer-facing copy.'
  },
  {
    category: 'private_provenance_leak',
    pattern: /\b(source_path|sha256|reference_id)\b/i,
    rule: 'knowhow-corpus §12.6: Internal file paths, SHA256 hashes, and reference IDs must be stripped before customer output.'
  },
  {
    category: 'commercial_audio_title_leak',
    pattern:
      /\b(Grimes|Hiroshi\s+Yoshimura|Instupendo|Comfort\s+Chain|Memo\s+Boy)\b/i,
    rule: 'knowhow-corpus §12.6 & f14: Commercial reference artist/track names must never appear in customer deliverables or presets.'
  }
];

export interface PublicSurfaceLintResult {
  clean: boolean;
  violations: PublicSurfaceLeakViolation[];
}

/**
 * Scans a customer-facing text, HTML, or serialized JSON payload for forbidden internal leaks.
 */
export function lintPublicBrandSurface(text: string): PublicSurfaceLintResult {
  const violations: PublicSurfaceLeakViolation[] = [];

  for (const entry of FORBIDDEN_SURFACE_PATTERNS) {
    const match = entry.pattern.exec(text);
    if (match) {
      violations.push({
        category: entry.category,
        matched: (match[1] ?? match[0]).trim(),
        rule: entry.rule
      });
    }
  }

  return {
    clean: violations.length === 0,
    violations
  };
}
