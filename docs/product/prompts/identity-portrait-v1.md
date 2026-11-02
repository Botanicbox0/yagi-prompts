# 내 얼굴 기준 사진 — 프롬프트 v1

출처: 대표 제공 원문, 2026-09-20. 아래 영문은 수정 없이 보존한다. 모델·해상도·차감 정책과 검증 범위는 [설계 문서](../../IDENTITY-PORTRAIT.md)에서 별도로 관리하며 프롬프트 안에 섞지 않는다.

```text
Using Image 1 as the sole identity reference, create one finished photorealistic front-facing studio identity portrait. Deliver a single portrait in a vertical 2:3 frame.

IDENTITY
Derive the person's appearance from Image 1. Preserve their distinctive facial proportions, eye spacing and natural eyelid shape, nose, lip contours, cheek fullness, jaw, chin, hairline, apparent age, skin undertone, and natural asymmetry. Preserve the visible hair color and hairstyle, facial hair, and identifying marks where present. Do not substitute an idealized face, beautify, slim, symmetrize, enlarge the eyes, or invent identifying details. For areas hidden or cropped in the source, use conservative completion consistent with the visible person.

COMPOSITION
Compose a new studio portrait independently of the source photograph's crop. Show the complete top and sides of the head, neck, both shoulders, and upper chest. Leave a clearly visible band of empty background above the highest part of the hair, approximately 7% of the image height. Place the bottom of the chin approximately 63% down the frame, with the shirt collar fully visible below it. Fit the head by adjusting camera distance and framing, never by changing head shape or hair volume. Keep the head centered and the entire crown inside the frame.

POSE
Face directly toward an eye-level camera, with the head upright and shoulders level and relaxed. Preserve anatomical asymmetry when bringing the face to the front. Keep the expression relaxed and close to the source; relax only an exaggerated expression. Preserve natural eyelid opening and lip shape. Use natural portrait perspective; correct obvious close-selfie distortion conservatively without redesigning facial proportions.

STUDIO
Use an evenly illuminated, very light neutral-grey background, approximately #D6D6D6: visibly light grey, close to white, with uniform brightness across the frame. Keep the background neutral independently of facial exposure. No background shadow, vignette, halo, pattern, seam, or horizon line. Illuminate the person with a broad soft frontal light slightly above eye level, retaining gentle facial modeling and a soft shadow beneath the chin. Keep face, ears, and neck under coherent lighting.

APPEARANCE
Replace the source clothing with a plain deep-charcoal crew-neck cotton t-shirt, matte fabric, ordinary collar construction, and natural folds. Remove hands and held objects from the composition. Preserve existing makeup where visible; do not add cosmetics or intensify blush. Remove obvious environmental color casts while retaining the person's individual skin undertone. Render understated skin texture at a believable photographic scale. Do not invent pores, freckles, redness, wrinkles, or extra facial detail. Avoid smoothing, artificial sharpness, and brightened irises.

FINISHED RESULT
The portrait must read as the same person photographed in this studio setup. Prioritize recognizable identity, followed by complete-head framing, then studio presentation. One natural reference photograph, without captions, borders, panels, props, or decorative elements.
```
