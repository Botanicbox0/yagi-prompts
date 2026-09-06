import { rewriteReferenceHandles, type PromptReferences } from '@/lib/ark/prompt';
import type { TemplateMedium } from '@/lib/prompts/schemas';

/**
 * Template recipe → the prompt an engine receives, with the visitor's photo wired in.
 *
 * The catalogue's prompts name their references Higgsfield-style (`@image1` = the face). Two
 * engines, two conventions:
 *   · ModelArk (films): positional prose — "Image 1" — exactly what `lib/ark/prompt.ts` produces;
 *   · the image engines (GPT Image 2 edits, Seedream): there is one reference and it is "the
 *     reference photo", so the handle becomes those words.
 *
 * One addition, and only when the recipe does not mention the photo at all: a single line that
 * says the person in the photo is the subject and their face is to be kept. A recipe that names
 * `@image1` already says what it wants and is not touched (the founder's prompts are the product).
 * Pure; tested in tests/renders/prompt.test.ts.
 */

export const IDENTITY_LOCK_IMAGE =
  'The person in the reference photo is the subject. Keep their identity, face and features exactly as photographed; change only what the scene describes.';
export const IDENTITY_LOCK_VIDEO =
  'Image 1 is the person to feature. Keep their identity, face and features exactly as photographed.';

export interface RenderPrompt {
  text: string;
  references: PromptReferences;
  /** Whether the recipe itself named the photo (so no lock line was added). */
  namesPhoto: boolean;
}

export function buildRenderPrompt(args: { promptText: string; medium: TemplateMedium; hasPhoto: boolean }): RenderPrompt {
  const rewritten = rewriteReferenceHandles(args.promptText.trim());
  const namesPhoto = rewritten.references.images.length > 0;

  if (args.medium === 'video') {
    const text = args.hasPhoto && !namesPhoto ? `${rewritten.text}\n\n${IDENTITY_LOCK_VIDEO}` : rewritten.text;
    return { text, references: rewritten.references, namesPhoto };
  }

  // Images: "Image 1" → "the reference photo"; with no photo attached the words must not appear.
  const spoken = rewritten.text.replace(/\bImage 1\b/g, args.hasPhoto ? 'the reference photo' : 'the subject');
  const text = args.hasPhoto && !namesPhoto ? `${spoken}\n\n${IDENTITY_LOCK_IMAGE}` : spoken;
  return { text, references: rewritten.references, namesPhoto };
}
