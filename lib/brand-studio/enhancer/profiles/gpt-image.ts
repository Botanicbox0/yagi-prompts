/** GPT Image (OpenAI image models): a plain-language brief it follows instruction by instruction, references as image N. */
import type { ModelBlock, ProfileHeader } from './meta';

const OPENAI_GUIDE = 'https://developers.openai.com/api/docs/guides/image-prompting';

export const GPT_IMAGE_HEADER: ProfileHeader = {
  id: 'gpt-image',
  version: '2026-11-19.1',
  models: ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'],
  sources: [
    { url: OPENAI_GUIDE, seen: '2026-11-19', claim: 'define the result and its use; describe visible details; ask for "photorealistic" or "real photograph" when that is the goal; describe body framing, gaze and interaction; quote exact text with position and typography, spell unusual words; number each input with its purpose; for edits say what changes and what stays [official]' },
    { url: 'docs/design/IDENTITY.md#6-1', seen: '2026-11-19', claim: 'people with GPT Image are allowed; the old ban was about GPT Image 2.0 for fashion lookbooks [founder: 2026-11-19]' },
  ],
  lastVerified: '2026-11-19',
};

export const GPT_IMAGE_FORMAT_LIST = 'a product shot, a poster, a feed post';
export const GPT_IMAGE_PHOTO_PHRASE = 'a photorealistic photograph';
export const GPT_IMAGE_FRAMING_LIST = 'head and shoulders, waist up, full body with feet in frame';
export const GPT_IMAGE_PRODUCT_KEEP_FORMULA = 'keep the exact label, proportions and colours of image N';
export const GPT_IMAGE_LOGO_FORMULA =
  'reproduce the mark from image N exactly as drawn, without redrawing, mirroring or restyling it, at its current size';
export const GPT_IMAGE_INTEGRATION_PHRASE = 'light direction, colour temperature, reflections and contact shadows';
export const GPT_IMAGE_MARKUP_AREA_PHRASE = 'the area inside the red outline';
export const GPT_IMAGE_MARKUP_CLOSER = 'Remove the red outline from the finished picture.';

export function gptImageAllowPhrases(markup = false): string[] {
  const out = [
    GPT_IMAGE_FORMAT_LIST,
    GPT_IMAGE_FRAMING_LIST,
    GPT_IMAGE_PRODUCT_KEEP_FORMULA,
    GPT_IMAGE_LOGO_FORMULA,
    GPT_IMAGE_INTEGRATION_PHRASE,
  ];
  if (markup) out.push(GPT_IMAGE_MARKUP_AREA_PHRASE, GPT_IMAGE_MARKUP_CLOSER);
  return out;
}

export const GPT_IMAGE_PROFILE = `Model: an image model that follows written instructions closely and reads a plain-language brief best.

Write a short brief in plain English (three to eight sentences; up to ten when people or many references are involved), each sentence one instruction, in this order:
1. What the picture is: the subject, how many, its exact state and position, and the format it is for (${GPT_IMAGE_FORMAT_LIST}). For a photograph, call it ${GPT_IMAGE_PHOTO_PHRASE}.
2. Setting: the surface and the space around it, in concrete materials.
3. Composition: camera height and angle, how much of the frame the subject fills and where it sits, what is in front of and behind it.
4. People, when there are any: how each one is framed (${GPT_IMAGE_FRAMING_LIST}), where they look, what their hands do and what they touch.
5. Light and colour: where the light comes from, hard or soft, where the shadows fall, the dominant colours named in words.
6. Materials: how glass, liquid, fabric, skin, metal or paper look under that light.
7. Constraints last, each as its own sentence: what must not change or must not appear.

When images are attached, open with what each one is for, naming them only as "image 1", "image 2" with the numbers given, each with its purpose ("Use the frosted bottle from image 1 only; leave out its background and lighting"). A product image always gets "${GPT_IMAGE_PRODUCT_KEEP_FORMULA}". A logo: "${GPT_IMAGE_LOGO_FORMULA}". Unify ${GPT_IMAGE_INTEGRATION_PHRASE} across all attached images. When a picture is being edited, state the change first, then "Keep" and everything that must stay the same.

Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with where it sits, how large it is and its typeface style ("봄 한정" set small in a clean sans-serif on the lower label); spell an unusual word or brand name letter by letter once. Never add other words, numbers or watermarks.

No keyword lists, no weights, no negative-prompt section, no camera or lighting equipment brand names.`;
// [official] result + use, "photorealistic", framing/gaze/interaction, quotes + typography + spelling, image N + purpose,
// change then keep; [founder: 2026-11-19] people allowed.

/**
 * GPT Image 2.6 Flare / Sunburst (Images 2.6, 2026-11). The API lane also takes `reasoning_effort` (planning
 * depth, sent by lib/brand-studio/provider/complexity.ts, not written in the prompt) and `markup` (a transparent
 * overlay that marks where to edit; no studio path sends one yet, see provider/requests.ts `gptMarkupEdit`).
 */
export const GPT_IMAGE_26_BLOCK: ModelBlock = {
  header: {
    id: 'gpt-image-2.6',
    version: '2026-11-19.1',
    models: ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'],
    sources: [
      { url: OPENAI_GUIDE, seen: '2026-11-19', claim: '2.6 Flare for speed, Sunburst for demanding detail, layout and edit accuracy; `complexity` controls planning; markup = a drawn overlay on the first input, referred to in the prompt, then removed [official]' },
      { url: 'https://oapi.sunra.ai/main/openai/gpt-image-2.6-flare/b2346d45f2ad57d9b001f1ec26837294fd8c60f1.json', seen: '2026-11-19', claim: 'the API lane exposes `reasoning_effort` low|medium|high (default high) and `markup` (mutually exclusive with `mask`); the account lane exposes `reasoning_effort` only [aggregator]' },
    ],
    lastVerified: '2026-11-19',
  },
  text: `This model plans a layout before it renders: give the hierarchy plainly (what is largest, what sits where, what reads first) for posters, cards and anything with several lines of text.`,
};

/** Only when a markup overlay is sent with the edit (no studio path does today). */
export const GPT_IMAGE_MARKUP_RULE =
  `A red outline is drawn on image 1 to mark the area to change. Refer to it as "${GPT_IMAGE_MARKUP_AREA_PHRASE}", change only what is inside it, and end with "${GPT_IMAGE_MARKUP_CLOSER}"`;
