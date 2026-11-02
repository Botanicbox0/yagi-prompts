# Virtual beauty ad template

Published with founder authorization on 2026-09-26 at `/ko/t/star-in-a-virtual-beauty-ad`.
Template ID: `4db3c5d0-2f36-4e05-b43f-4c7c25f86b6c`.

The customer supplies one selfie. The existing identity checks still run; the verified
identity is Image 1. `lib/renders/template-references.ts` adds the approved, checked-in
lip-gloss product as Image 2. The manifest uses the immutable template ID, so renaming
the title or slug does not break its reference order. The sample model portrait is
not stored in the repository or reused for customer generation. Other templates have
no additional references. No database migration or public-generation flag change.

Product source: founder-provided `e0fb5fbc-c790-47d3-bce7-a7dc0d89f728.jpg`.
SHA256: `b932708328ee9964b7308339fce6b60c8d227277d2c97aa7d85b4e1b607e5b8e`.
The public product path must remain available for ModelArk to fetch it.

The catalog recipe separates customer identity from pink organza/beauty styling and
product geometry. Its sample was generated through the official Higgsfield Python SDK
with Seedance 2.5, both founder images, 15 seconds, 720p and 16:9. Actual output is
1280 x 720, 15.041667 seconds, with an audio stream. The opening was changed to show
the face before the product montage; the remainder preserves the supplied recipe.
Sample generation and reference wiring tests do not establish identity fidelity for
all future selfies or verify the separate live ModelArk customer pipeline.
