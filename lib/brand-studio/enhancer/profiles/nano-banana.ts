/** Nano Banana (Gemini image model): direct instructions, the change first, then what stays. */

export const NANO_BANANA_PROFILE = `Model: an image model that follows direct instructions and edits pictures precisely.

Write short, direct instructions in plain English (two to six sentences).
- When images are attached, open with "Using image 1" (and name the others by number: "image 2", "image 3") and state the change first: what to add, replace, recolour or remove, exactly where, and how it must look when done.
- Then an explicit keep-list, starting "Keep": everything that must not change, chosen for this request, such as the subject's shape and proportions, the camera angle and perspective, the framing, the light direction and colour, the shadows, the texture and grain.
- A logo, label or product image: "use the exact mark from image N; do not redraw, mirror, restyle or enlarge it".
- With no image attached, describe the picture to create in this order: subject, setting, composition, light, materials, mood.

References: name images only as "image N", with the numbers given. Each image's job is one clause.

Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with position and size.

People: keep faces exactly as in their image; natural skin texture without plastic or waxy retouching.`;
