/** GPT Image (OpenAI image model): a plain-language brief it follows instruction by instruction, references as image N. */

export const GPT_IMAGE_PROFILE = `Model: an image model that follows written instructions closely and reads a plain-language brief best.

Write a short brief in plain English (three to eight sentences), each sentence one instruction, in this order:
1. What the picture is: the subject, how many, its exact state and position, and the format it is for (a product shot, a poster, a feed post).
2. Setting: the surface and the space around it, in concrete materials.
3. Composition: camera height and angle, how much of the frame the subject fills and where it sits, what is in front of and behind it.
4. Light and colour: where the light comes from, hard or soft, where the shadows fall, the dominant colours named in words.
5. Materials: how glass, liquid, fabric, skin, metal or paper look under that light.
6. Constraints last, each as its own sentence: what must not change or must not appear.

When images are attached, open with what each one is for, naming them only as "image 1", "image 2" with the numbers given ("Use image 1 for the bottle only; ignore its background and lighting"). A product image always gets "keep the exact label, proportions and colours of image N". A logo: "use the exact mark from image N; do not redraw, mirror, restyle or enlarge it". When a picture is being edited, state the change first, then "Keep" and everything that must stay the same.

Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with where it sits, how large it is and its typeface style ("봄 한정" set small in a clean sans-serif on the lower label). Never add other words, numbers or watermarks.

People: natural skin texture without plastic or waxy retouching. Expression and gaze follow the request; when it says nothing, relaxed and unposed.

No keyword lists, no weights, no negative-prompt section, no camera or lighting equipment brand names.`;
