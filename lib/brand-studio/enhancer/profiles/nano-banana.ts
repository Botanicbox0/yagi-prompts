/** Nano Banana (Gemini image models): direct positive instructions, the change first, then what stays. */
import type { ModelBlock, ProfileHeader } from './meta';

const GOOGLE_DOCS = 'https://aistudio.google.com/docs/image-generation';
const GOOGLE_GUIDE = 'https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana';

export const NANO_BANANA_HEADER: ProfileHeader = {
  id: 'nano-banana',
  version: '2026-11-19.1',
  models: ['nano-banana-pro', 'nano-banana-2.1'],
  sources: [
    { url: GOOGLE_DOCS, seen: '2026-11-19', claim: 'be hyper-specific; give context and intent; step-by-step for complex scenes; "semantic negative prompts" (say what is there, positively); edit template "Using the provided image, change only … Keep everything else … exactly the same" [official]' },
    { url: GOOGLE_GUIDE, seen: '2026-11-19', claim: 'narrative description, not keyword lists; quote exact text and name its style; assign each reference its role in the instruction (guide dated 2026-03-06) [official]' },
    { url: 'docs/design/IDENTITY.md#6-1', seen: '2026-11-19', claim: 'no lighting gear names even where Google suggests them ("three-point softbox setup"): gear shows up in the picture [house]' },
  ],
  lastVerified: '2026-11-19',
};

export const NANO_BANANA_PROFILE = `Model: an image model that follows direct instructions and edits pictures precisely. Describe everything as what is there, in positive words: say "an empty street", not "no cars".

Write direct instructions in plain English: two to six sentences, up to eight when three or more images are attached. Start with one short phrase on what the picture is for (a product photo for a shop page, a campaign visual).
- When images are attached, open with "Using image 1" (and name the others by number: "image 2", "image 3") and state the change first: what to add, replace or recolour, exactly where, and how it must look when done. To take something away, say what fills its place.
- Then a keep-list, starting "Keep": everything that stays exactly as it is, chosen for this request, such as the subject's shape and proportions, the camera angle and perspective, the framing, the light direction and colour, the shadows, the texture and grain.
- A logo, label or product mark: "reproduce the mark from image N exactly as drawn: the same letterforms, orientation, proportions and colours, at the size it has now".
- With no image attached, describe the picture to create in this order: subject, action, setting, composition, light, materials, mood.

References: name images only as "image N", with the numbers given. Each image's job is one clause ("image 2 supplies the bottle"), and reflections and contact shadows are made to agree across images.

Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with position, size and type style ("a clean bold sans-serif"), and the rest of the picture free of lettering.`;
// [official] positive framing, intent phrase, "Using … change only … Keep", quotes + style, role per image;
// [house] the logo sentence (was "do not redraw, mirror …", rewritten positively 2026-11-19).

/** Nano Banana Pro (`gemini-3-pro-image`). */
export const NANO_BANANA_PRO_BLOCK: ModelBlock = {
  header: {
    id: 'nano-banana-pro',
    version: '2026-11-19.1',
    models: ['nano-banana-pro'],
    sources: [{ url: GOOGLE_DOCS, seen: '2026-11-19', claim: 'Pro mixes up to 14 references: up to 6 object images, up to 5 character images and up to 3 style references; it reasons ("Thinking") before drawing complex scenes [official]' }],
    lastVerified: '2026-11-19',
  },
  text: `This model: keeps the look of up to five people steady across a picture and takes up to three style pictures. With several people, give each person image one clause on who they are in the scene; with a style picture, take only its light, palette and texture. For a complex scene, give the steps in order (first the setting, then the people, then the product).`,
};

/** Nano Banana 2.1 (`gemini-nano-banana-2.1`). */
export const NANO_BANANA_21_BLOCK: ModelBlock = {
  header: {
    id: 'nano-banana-2.1',
    version: '2026-11-19.1',
    models: ['nano-banana-2.1'],
    sources: [
      { url: GOOGLE_DOCS, seen: '2026-11-19', claim: '2.1 takes up to 10 object images and up to 4 character images, no separate style category; Google recommends 2.1 for new projects [official]' },
      { url: 'https://api.sunra.ai/v1/models?limit=300', seen: '2026-11-19', claim: 'Sunra lists 2.1 with sharper detail, better text and infographic rendering, up to 14 reference images [aggregator]' },
    ],
    lastVerified: '2026-11-19',
  },
  text: `This model: renders dense text and small type well and keeps up to four people and up to ten objects consistent. With more than four person images, name the four that matter most for the faces; a picture used only for its mood is described as setting, light and palette for this model, since it has no separate style input.`,
};
