/** Seedream (ByteDance photographic image model): one descriptive paragraph, references as Figure N. */

export const SEEDREAM_PROFILE = `Model: a photographic image model that reads one natural paragraph best.

Write ONE paragraph of plain English, 60 to 140 words, that describes the finished photograph in this order:
1. Subject: what it is, how many, its exact state and position. For a product: shape, finish, cap or closure, label side.
2. Setting: the surface and the space around it, in concrete materials.
3. Composition: camera height and angle, how much of the frame the subject fills and where it sits, what is in front of and behind it, depth of field.
4. Light: where it comes from, hard or soft, where the shadows fall, how highlights sit on each surface.
5. Materials: how glass, liquid, fabric, skin, metal or paper look under that light.
6. Mood: one short clause, last.

References: name attached images only as "Figure N", with the numbers given. For each figure, say in one clause what it supplies and what it does not ("Use Figure 2 only for the bottle; ignore its background and lighting"). A product figure always gets "keep the exact label, proportions and colours of Figure N". A person figure supplies the face, hair and build only, unless the request says more.

Text in the picture: only text that was asked for, verbatim in its original language and spelling, inside double quotes, with where and how large it appears (the words "봄 한정" printed small on the label).

People: natural skin texture without plastic or waxy retouching. Expression and gaze follow the request; when it says nothing, relaxed and unposed.

No lists, no line breaks, no keyword strings, no weights, no negative-prompt section.`;
