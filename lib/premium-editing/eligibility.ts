import type { PromptRow } from '@/lib/prompts/repo';
import { isVideoEngine, resolveEngine } from '@/lib/images/engines';
import { isForSale } from '@/lib/twings/products';
import { templateSubscriptionQuote } from '@/lib/twings/subscription-plan';
import { videoModelFor } from '@/lib/renders/engines';
import { buildRenderPrompt } from '@/lib/renders/prompt';
import { fixedVideoReferenceUrls } from '@/lib/renders/template-references';
import { templateEditableScopes } from './guard';

/** Server-only shared admission for access previews and enqueue. The caller projects only safe
 * capabilities; this function never authorizes payment or returns a recipe.
 */
export function subscriptionTemplateEligibility(template: PromptRow) {
  if (template.status !== 'published' || template.audience === 'brand' || !isForSale(template)) return null;
  const quote = templateSubscriptionQuote(template);
  const engine = resolveEngine(template.engine, template.medium);
  const scopes = templateEditableScopes(template);
  const handles = buildRenderPrompt({ promptText: template.promptText, medium: template.medium, hasPhoto: true }).references;
  const fixed = fixedVideoReferenceUrls(template.id, 'https://twings.invalid');
  if (!quote || !Number.isSafeInteger(quote.units) || quote.units <= 0 || !isVideoEngine(engine) || !template.runtimeSeconds ||
      videoModelFor(engine, template.runtimeSeconds).model !== 'seedance-2.5' || !scopes.length || !template.promptText.trim() || template.promptText.length > 30000 ||
      handles.images.some(n => n > 1 + fixed.length) || /\b(?:video|audio)\s+\d\b/i.test(template.promptText)) return null;
  return { quote, scopes };
}
