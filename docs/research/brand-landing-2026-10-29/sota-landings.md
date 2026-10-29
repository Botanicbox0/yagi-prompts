# SOTA brand landings: research for twings.app/ko/brands

Captured 2026-10-29 in headless Chromium at a 1440×900 viewport. "Screens" means scroll height divided by 900px. Colours and CTA shapes come from computed styles. Headlines are paraphrased, except one Photoroom quote. Screenshots were captured locally and are not kept in the repo.
## 1. Hero and length

| Page | What the hero claims (paraphrased) | What the hero visual demonstrates | Screens / sections |
|---|---|---|---|
| **Visie** (quality bar) | The greatest creative directory | A slow, dimmed video wall of real editorial work, credited by name and role. Vogue, BBDO, Canva and Calvin Klein logos sit inside the hero | **6.7 / 5** |
| Photoroom Enterprise | "Every image you publish, held to one standard" | Messy raw warehouse photos (heels_01.jpg…) dropping into an upload card. **Input is the hero, and the standard is implied** | 14.8 / 12 |
| Botika | AI fashion models trusted by top brands | Scattered cut-out models on a light grid, all lit and framed the same way | 14.2 / 12 |
| Claid | Product and fashion photos that look real | The same perfume bottle and look placed in several scenes with the label intact | 12.4 / 10 |
| Flair | Design tool for product photoshoots and videos (rotating word) | A laptop showing the canvas UI | 10.9 / 8 |
| Higgsfield Marketing Studio | Turn any product into post-ready content | A carousel of output tiles with format chips (TikTok, UGC, Product shot, Motion, Ads), over a prompt bar with **Avatar and Product slots** and a GENERATE button | 1 (app shell) |
| Arcads | Winning ads with AI actors | Floating vertical UGC video cards | 12.6 / 10 |
| Creatify | AI ads that win | A prompt box on a purple gradient, then agent tabs (Research, Create, Analyze) | 11.2 / 9 |
| Runway Enterprise | Production-ready AI for enterprise | A full-bleed product film: a frosted "Lumina" bottle in fur | 12.8 / 10 |
| Pencil | Marketing's AI operating system | A yellow field with a typed headline | 9.8 / 8 |
| Superside | Your creative team's creative team | A green field next to a mosaic of client packaging | 18 / 14 |
| Typeface (contrast) | Agentic AI for enterprise marketing | A stock collage next to a webinar pop-up | 7.2 / 8 |

## 2. How each page proves its claims

| Page | Brand consistency | Image and video | Scale |
|---|---|---|---|
| Visie | Real published covers with real brand names, crediting the whole team | Video wall in the hero, stills below | Logos in the hero; 397 brands on /brands |
| Photoroom | Shows the problem first (AI altering a polo shirt), then one master image fanned out to every channel, and the same cap in 12 colourways | Stills; video only in the promo bar | A row of four stats (4x, 2x, $80K, 99% accuracy) |
| Botika | **One model, the same light and framing across the whole collection**; flat lay turned into an on-model shot; product-page grid | Mostly stills | 500K+ images and videos a month for 3,000+ brands; 150+ models |
| Claid | States that logos and product shapes are preserved, then shows the bottle across scenes | A tool tile plus a video banner | 10k+ customers, 200M+ images |
| Flair | Tabs by output type; a comparison table against competitors | A Product Videos tab | Logo strip |
| Higgsfield | You attach your own product and avatar | Image/Video toggle; every tile loops | A gallery of templates |
| Arcads | An AI actor holding your product | A wall of 36 autoplay vertical ads | **1B+ views, with a wall of real ad cards, each carrying its views and revenue change** |
| Creatify | One small tile: logo, colours and fonts | A carousel of formats | 15M+ ads, $1B+ ad spend; a 10-to-1,000-ads-a-month pitch |
| Runway | A creative-control bullet plus named films (Salomon, Sonos) | Hero film and case films | Stat cards (2 weeks, 80%) |
| Pencil | Governance badges (SOC 2, no-train, IP ownership, brand safety) | A node graph | **One metric under each logo** (L'Oréal 46K assets, Unilever 2x speed) |
| Superside | Case cards by brand | Case videos | Animated counters, Forrester ROI |
| Pomelli | A "Business DNA" card (palette, fonts, tone, images) pulled from the brand's URL before any outputs | Stills | — |

## 3. Craft: CTA, accent colour, premium versus cheap

| Page | Primary CTA | Accent on light or dark | Premium signals / cheap signals |
|---|---|---|---|
| **Visie** | White pill on dark (52px, fully rounded), black pill on white; only "Create free account" | **None.** The imagery is the colour | One typeface (Suisse), credits, whitespace / nothing cheap |
| Botika | Zinc pill "Get started →" with a white "Book a call" pill | None | A calm grey grid, the same lighting everywhere / long |
| Photoroom | Violet #492FFB, 10px radius, "Contact sales →" | Violet only on the CTA, small eyebrow labels and one closing band | A problem-first narrative / promo bar, 15 screens |
| Runway | Dark translucent, 8px, "Contact Sales" | Almost none | The film carries the hero / form placed high |
| Stripe | Blurple #533AFD, 4px radius | Accent sits in gradient art; the headline fades from ink to grey | Precise type, stat band / dense |
| Linear | A small light-grey pill | Monochrome, with pastels inside the product UI | Real UI as the hero / — |
| Superside | Lime #D8FF85 pill on dark green | Lime plus an italic serif | Editorial italics / 18 screens of agency sprawl |
| Pencil | Black pill on yellow #FFF310 | Yellow as the whole field | A bold system / cookie bars, mono body text |
| Flair | Lime #84CC16, 8px | Lime everywhere | — / generic dark SaaS, competitor table |
| Creatify | Black uppercase "BOOK DEMO" | Purple and orange gradient blobs | — / uppercase CTA, gradient wallpaper |
| Arcads | Outlined dark, 16px radius | Green #00DA7F on stats | Real ad cards / promo countdown bar |
| **Typeface** | **Red #FD243E, 6px rectangle, "Get a demo"** | Red on the logo, eyebrows, CTA and collage | — / **red button fill, stock collage, webinar pop-up**. This is the "first-generation" look |

What the current live /ko/brands page shows: 10.5 screens and about eight black/white band switches. Its most frequent coloured element is `rgb(0,0,238)`, the browser's default link blue, on 12 elements. That is a leaking unstyled link and can be fixed right away.

## 4. Ten principles

1. **One promise, with the offers as proof modules.** The headline states one outcome. Asset studio and creator campaigns appear as two proofs of that outcome, not as two pitches. The production service is a quiet third tier.
2. **The hero has to show the moat moving.** Photoroom shows raw input turning into one standard; Botika shows a flat lay becoming an on-model shot. TWINGS's moat is that **the brand stays intact while faces and contexts multiply**. Orbiting bottles show quantity, not intactness.
3. **Prove consistency by holding one thing fixed.** Keep the product, label, light and ad format fixed and vary the scene, face or channel (Botika's single model, Photoroom's 12 caps, Claid's bottle). Show the constant and the variable side by side.
4. **Attach numbers to artefacts.** Arcads puts views on each ad card; Pencil puts one metric under each logo. TWINGS should pin its approved totals (9 films · 2M+ views · 300+ posts) to the actual creator mosaic, not a separate stat strip. Per-tile numbers need approval.
5. **The imagery is the colour and the UI stays monochrome.** Visie and Botika use no accent at all. If an accent is used, keep it to one hue in at most three places (Photoroom).
6. **Never use red as a button fill.** A saturated red rectangle is exactly Typeface's dated look, and it reads as a sale. Use a black pill on white and a white pill on dark, 48–52px tall, sentence case, with one label repeated. Keep YAGI red for a 6px "live" dot, a counter tick or a cursor.
7. **Six to eight screens.** Visie manages it in 6.7 screens. Pages past 12 screens (Superside 18, Photoroom 15) feel like brochures. Cut the process steps and FAQ to the minimum.
8. **Put image and video in one frame.** A still should start moving: Higgsfield's format chips, Runway's bottle film. Use an "이미지 · 영상" label on the same tile and play the poster frame as a loop when it comes into view.
9. **Credit the work.** Visie labels every tile with name and role, which reads as curation rather than stock. TWINGS can label tiles with format · channel · market, with no creator handles, per AGENTS.md §5.
10. **Remove the noise.** No promo bars, pop-ups, competitor tables, uppercase CTAs or logo walls of unapproved clients. Show one named case (Morphic) and one anonymous case ("글로벌 AI 플랫폼").

## 5. Recommended outline (6 sections, about 7 screens)

| # | Section | Purpose | Visual mechanic | Proof |
|---|---|---|---|---|
| 1 | **Hero** (1.2 screens) | One promise: the brand's asset, at creator scale, intact | Concept A below | Morphic logo + "글로벌 AI 플랫폼" + 9편 · 200만 뷰+ · 300건+ |
| 2 | **Asset studio** (1.5) | "The simplest way to get top-quality on-brand assets" | A constant/variable scrubber: the original product stays pinned on the left while a drag on the right cycles product shot → scene → VTO → the same frame as video | The original "Yagi" script bottle label stays legible in every output; an output-type list |
| 3 | **Creator campaign** (1.5) | "One ad format, many real faces" | The master ad on the left; a mosaic of vertical creator versions on the right that fills in as you scroll, with counters tied to the mosaic | The Morphic case (named) and the global AI platform case (anonymous), approved numbers only |
| 4 | **How it works + safety** (1) | Make it look easy and safe | Three steps shown as product UI: brand kit card (Pomelli-style) → choose format → approve and publish. One line on consent and face checks, using the wording of 약관 §5.3 | The UI itself |
| 5 | **Production service** (0.6) | The third offer, kept quiet | One horizontal band with a reel thumbnail and a text link ("직접 제작이 필요하다면") | YAGI studio reel |
| 6 | **CTA + 3 FAQs** (1) | Convert | A white band with one black pill CTA (the same label as the hero) and three short FAQs | — |

## 6. Hero concepts, ranked

1. **"Locked product, living grid" (my pick).** The brand's product, or the master ad, sits as one fixed tile in the centre. Around it, a grid resolves step by step: product shot → VTO → scene → a video loop → creator-face versions of the same ad. A small red live dot and a counter tick up to the approved totals. Why: one mechanic proves both offers, consistency (the centre never changes) and scale (the grid multiplies). It also works as a still for OG and reduced motion, and it fixes the orbit's flaw by showing what stays the same.
2. **"One ad, many faces" scrubber.** One vertical ad plays while dragging or scrolling swaps the creator's face, with product, copy and framing fixed. It is the strongest emotional demonstration of the campaign moat, but it undersells the asset studio and needs consent-cleared faces for every frame.
3. **"Brand DNA → outputs".** A brand kit card (logo, palette, product) streams on-brand outputs, as Pomelli and Photoroom do. It is clear, but it is the category's default and says nothing about creators, so the moat would not show.

Sources: the home or enterprise pages of every site above, plus linear.app, stripe.com, krea.ai, weavy.ai (craft only) and twings.app/ko/brands. Pomelli: [Search Engine Journal](https://www.searchenginejournal.com/google-labs-deepmind-launch-pomelli-ai-marketing-tool/559569/), [TechRadar](https://www.techradar.com/pro/google-has-a-new-experimental-gemini-ai-tool-to-help-your-smb-scale-marketing-fast).

## 추가 분석 (2026-10-29 오전): riverflow.ai, magnific.com

대표가 "논리 구조가 나쁘지 않다"(riverflow), "기능이 많아도 잘 정돈해서 전달한다"(magnific)고 짚은 두 곳이다. 비주얼이 아니라 순서와 묶는 방식을 본다.

**riverflow.ai**
- 순서: 입력창 히어로("무엇을 만들까요?") → 브랜드 실적 한 줄 → "한 플랫폼, 모든 워크플로" 카드 8개(카탈로그 가져오기, 브랜드 설정, 촬영, 광고, 영상, 일괄 편집, 에이전트, 레이어 편집) → 채널 로고 → 워크플로 상세 → 워크플로 탭 → **"빠르다고 흔해지지 않는다"**(제품 디테일 유지, 브랜드 규칙 유지, 편집, 내보내기 전 검토 + 원본 대 생성 비교) → 수치 → 후기 → 요금 → FAQ.
- 배울 점: 입력(제품·브랜드) → 출력(워크플로) → 보증(흔한 AI가 아님) 순서가 분명하다. 보증 섹션이 우리 "미디어를 이해하는 AI"와 같은 자리다. 카드는 제목 + 한 문장이다.

**magnific.com**
- 순서: 전면 영상 히어로 + 한 줄 약속 + 로고 → "시작점을 고르세요"(제품군 탭) → 엔드투엔드 제작 → 모델 마키 → "작게 시작해 키우기" → 도구 탭(Featured/Image/Video/Audio/3D) → 활용처 4개(광고, 제품 컷, 브랜드 캠페인, 필름) → 자체 제작물(Originals) → 팀 요금 → 기업 기능 → 후기 → FAQ.
- 배울 점: 도구가 30개여도 사용자는 한 번에 한 층만 본다. 시작점 → 도구(매체별 탭) → 활용처 → 제작물 순서로 묶는다. 제작물(Originals)은 맨 뒤에서 품질 증거로 쓴다. 히어로는 정지 이미지가 아니라 영상이다.

**TWINGS 랜딩 v6에 반영한 것**
1. 히어로를 영상 한 편으로 바꿨다. 제품 사진 한 장이 들어가서, 마크·색·빛을 읽고 고정한 뒤, 제품 컷 → 광고 영상 → 여러 얼굴의 크리에이터 버전으로 나오는 과정을 18초 루프로 보여 준다.
2. 영상 아래에 문 세 개(에셋 스튜디오, 크리에이터 캠페인, 프로덕션)를 둔다. riverflow의 카드와 magnific의 시작점처럼 첫 화면에서 서비스 셋이 다 보인다.
3. 비교 섹션은 riverflow의 "흔해지지 않는다" 자리에 그대로 둔다(같은 제품, 같은 엔진의 실제 결과).
4. 에셋 스튜디오는 magnific처럼 매체별 탭 하나로 묶는다(제품 8종 / 장면 / 착용 / 영상). 늘 펼쳐 있던 제품 줄을 첫 탭으로 넣어 길이를 줄였다.
5. 프로덕션은 magnific의 Originals처럼 뒤에서 품질 증거 역할을 한다.
