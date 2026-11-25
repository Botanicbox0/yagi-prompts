/**
 * Non-blocking guide[] token checker for TWINGS MCP (Batch 2 §A.2).
 *
 * `recipe.guide[]` prompts are display-only, so `lib/recipes/schema.ts` intentionally does not reject
 * unknown `{{name}}` tokens there. However, `displayStepPrompt` only knows slot names (`slots`) and
 * earlier/declared step ids (`steps[].id`), so any other `{{name}}` renders as a broken step badge
 * (`[0단계 결과]` / `[Step 0]`) on the buyer screen. Pure, never modifies schema validation.
 */

export interface GuideTokenWarning {
  code: 'unknown_guide_token' | 'malformed_guide_token';
  clip: number;
  token?: string;
  message: string;
}

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function guideTokenWarnings(raw: unknown): GuideTokenWarning[] {
  let obj: { slots?: unknown; steps?: unknown; guide?: unknown } | null = null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as { slots?: unknown; steps?: unknown; guide?: unknown };
      }
    } catch {
      return [];
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as { slots?: unknown; steps?: unknown; guide?: unknown };
  }
  if (!obj || !Array.isArray(obj.guide)) return [];

  const known = new Set<string>();
  if (obj.slots && typeof obj.slots === 'object' && !Array.isArray(obj.slots)) {
    for (const key of Object.keys(obj.slots)) {
      if (key) known.add(key);
    }
  }
  if (Array.isArray(obj.steps)) {
    for (const step of obj.steps) {
      if (step && typeof step === 'object' && typeof (step as { id?: unknown }).id === 'string') {
        const id = (step as { id: string }).id;
        if (id) known.add(id);
      }
    }
  }

  const warnings: GuideTokenWarning[] = [];
  obj.guide.forEach((entry, index) => {
    const clip = index + 1;
    if (!entry || typeof entry !== 'object') return;
    const prompt = (entry as { prompt?: unknown }).prompt;
    if (typeof prompt !== 'string') return;

    const seenTokens = new Set<string>();
    for (const match of prompt.matchAll(TOKEN)) {
      const name = (match[1] ?? '').trim();
      if (!name || !known.has(name)) {
        if (!seenTokens.has(name)) {
          seenTokens.add(name);
          warnings.push({
            code: 'unknown_guide_token',
            clip,
            token: name,
            message: `Clip ${clip} uses "{{${name}}}", which is not in slots or steps[].id. Buyers will see a broken placeholder; use only declared slot names or step ids.`,
          });
        }
      }
    }

    if (/\{\{|\}\}/.test(prompt.replace(TOKEN, ''))) {
      warnings.push({
        code: 'malformed_guide_token',
        clip,
        message: `Clip ${clip} contains an unmatched "{{" or "}}" brace.`,
      });
    }
  });

  return warnings;
}
