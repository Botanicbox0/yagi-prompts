/** Seedream (ByteDance photographic image model): one descriptive paragraph, references as "Image N". */
import type { ProfileHeader } from './meta';

export const SEEDREAM_HEADER: ProfileHeader = {
  id: 'seedream',
  version: '2026-11-19.1',
  models: ['seedream-5.5', 'seedream-5-flash'],
  sources: [
    {
      url: 'https://docs.byteplus.com/en/docs/ModelArk/seedream-4-0-5-0-prompt-guide',
      seen: '2026-11-19',
      claim: 'coherent natural language (subject + action + environment, then style, colour, light, composition); state the use case; text in double quotes; say what stays unchanged; "Image 1 / Image 2" for several inputs; concise beats ornate (page updated 2026-09-28) [official]',
    },
    {
      url: 'https://runware.ai/docs/models/bytedance-seedream-5-5/guides/multi-reference-composition',
      seen: '2026-11-19',
      claim: 'name each input by number and noun; name the parts of a product to keep by category instead of re-describing its colours and shapes; ByteDance keeps prompts under ~600 words; end quoted copy with "no other text" [aggregator]',
    },
    {
      url: 'docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt',
      seen: '2026-11-19',
      claim: 'the edit endpoint takes up to 10 images, aspect_ratio + resolution as parameters (the prompt never states them) [aggregator]',
    },
  ],
  lastVerified: '2026-11-19',
};

export const SEEDREAM_USE_CASE_LIST = 'a product photo for a feed post, a lookbook page, a campaign poster';
export const SEEDREAM_INTEGRATION_PHRASE = 'match the key-light direction, reflections and contact shadows';
export const SEEDREAM_NO_OTHER_TEXT_CLOSER = 'no other text';

export function seedreamAllowPhrases(): string[] {
  return [SEEDREAM_USE_CASE_LIST, SEEDREAM_INTEGRATION_PHRASE];
}

export const SEEDREAM_PROFILE = `Model: a photographic image model that reads one natural paragraph best.

Write ONE paragraph of plain English that describes the finished photograph. Keep it to 60 to 140 words; up to 200 words when there are three or more references, or when a person's skin is described in detail (the task says when). In this order:
1. Subject and use: what it is, how many, its exact state and position, and in a short phrase what the picture is for (${SEEDREAM_USE_CASE_LIST}). For a product: shape, finish, cap or closure, label side.
2. Setting: the surface and the space around it, in concrete materials.
3. Composition: camera height and angle, how much of the frame the subject fills and where it sits, what is in front of and behind it, depth of field.
4. Light: where it comes from, hard or soft, where the shadows fall, how highlights sit on each surface.
5. Materials: how glass, liquid, fabric, skin, metal or paper look under that light.
6. Mood: one short clause, last.

References: name attached images only as "Image N" (a capital I, then the number given), each with a noun ("the bottle in Image 1"). One clause per reference says what it supplies and what it does not. When combining several references, ${SEEDREAM_INTEGRATION_PHRASE} across them so they read as one photograph.

Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with where and how large it appears (the words "봄 한정" printed small on the label), followed by "${SEEDREAM_NO_OTHER_TEXT_CLOSER}".

No lists, no line breaks, no keyword strings, no weights, no negative-prompt section; at most one short clause on what must not appear.`;
// [official] paragraph, order, use case, quotes, "Image N"; [aggregator] noun per reference, "no other text",
// word ceiling (well under the ~600 ByteDance allows); [house] 60–140 words held since 2026-11-10, raised to 200 for
// many references / the skin rule [founder: 2026-11-19 "Image N 방식으로 가자"].
