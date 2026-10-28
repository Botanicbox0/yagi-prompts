# 브랜드 랜딩 워딩 원칙 (2026-10-29)

## 지금 문구가 AI처럼 읽히는 이유 (진단)
1. **짝 맞춘 구문**: "X에서 Y까지"가 히어로에만 두 번("에셋에서 피드까지", "첫 파일부터 마지막 게시물까지").
2. **명령 + 약속 공식**: "올리기만 하세요. 정리는 스튜디오가 합니다." "한 번만 설명하세요. 나머지는 스튜디오가 기억합니다." 같은 틀이 섹션마다 반복된다.
3. **셋씩 나열**: "정리하고, 말로 찾고, 새로 만들어", "사물, 색, 빛, 구도, 무드".
4. **의인화**: 스튜디오가 정리하고, 기억하고, 판단한다.
5. **대비 공식**: "더해질 뿐, 바꾸지는 못합니다", "다 있고, 없습니다".
6. **추상 명사**: "브랜드 톤이 무너집니다", "브랜드답게".
7. **모든 섹션이 같은 모양**: 눈썹 문구 + 두 줄 제목(강제 줄바꿈과 마침표) + 회색 설명 + 칩.

## 잘 만든 제품이 쓰는 방식
- **Linear**: 제목은 범주와 대상을 그대로 말한다("The product development system for teams and agents"). 설득은 화면 속 실물이 한다(이슈 번호, 사람 이름, "2 min ago").
- **Stripe·Apple**: 짧은 평서문. 형용사 대신 숫자와 고유명사를 쓴다.
- **토스**: 군더더기를 걷어낸다. 핵심 행동과 정보가 먼저 오고, 한 사람이 말하듯 톤이 일정하다.
- **Aesop·Le Labo**: 제품 문구는 재료와 감각으로 쓴다(앰버, 월넛, 연기). 과장이 없다.

## 이 페이지의 규칙
1. 한 문장에는 한 가지만 쓴다. 나열은 둘까지만 한다.
2. 주어는 사람(브랜드 팀, 크리에이터)이거나 화면 속 사물이다. 스튜디오를 사람처럼 쓰지 않는다.
3. 추상 명사보다 실물을 쓴다: 파일명, 색상 코드, 컷 수, 병 캡.
4. 제목은 한 줄로 끝나도 된다. 억지로 두 줄을 만들지 않는다. 마침표는 꼭 필요할 때만 찍는다.
5. 같은 문형(명령 + 약속, X에서 Y까지, A뿐 B는 못함)은 페이지 전체에서 한 번만 쓴다.
6. 없는 기능은 "얼리 액세스"로, 예시는 "예시"로 적는다. 하지 않은 일을 했다고 쓰지 않는다.
7. 합니다체를 유지하되 딱딱한 한자어는 쉬운 말로 바꾼다("파악합니다" → "읽습니다").

## 검토 기록 (2026-10-29)

- 검토자: Opus 4.6 (`claude -p --model claude-opus-4-6`), 로컬 Gemma 4 (`yagi-crm-gemma4:31b-q8_0`, gpu-arbiter 경유). 같은 원칙과 같은 문구를 줬다.
- 반영: Opus 4.6 지적은 KO 17줄, EN 20줄을 고쳤다(셋씩 나열, 한 문장에 두 생각, 명령 + 약속, 의인화, 겹말). Gemma 4 지적은 EN 1줄(뒷면 문장)만 반영했다. Gemma는 '자연어 검색', '계층별 브랜드 규칙 적용' 같은 건조한 매뉴얼 톤으로 바꾸는 경향이 있었다.
- 레거시 확산 장 문구: '크리에이터로 무한 확장되는 브랜드 캠페인.' → '광고 한 편을 수십 명의 얼굴로'. 대표 결정 기록이 없는 과장 문구라서 고쳤다. 사실(포맷 1편, 크리에이터 버전, 한·일 게시)은 그대로다.

### Opus 4.6 — 한국어

## 라인별 검수

패스한 줄(UI 라벨, 규칙 칩, 정보 공시 등)은 생략합니다. 문제가 있는 줄만 아래에 적습니다.

| key | 문제 | 리라이트 |
|---|---|---|
| **moods.body** | 셋 나열 "빛과 색, 질감" (원칙 #1) | 빛과 색감이 비슷한 컷끼리 묶습니다. 무드를 누르면 같은 병을 그 무드로 찍은 컷이 맨 앞에 옵니다. |
| **moods.note** | "구성했습니다" 딱딱한 한자어 (원칙 #7) | 예시 화면입니다. YAGI가 만든 향수 캠페인 라이브러리 일부를 담았습니다. |
| **heroBody** | 셋 나열 "드라이브와 생성 툴, 디자인 툴" + "한곳에서 합니다" 막연 (원칙 #1, #3) | 에셋 정리와 제작을 한 화면에서 합니다. 완성된 컷은 실제 크리에이터가 자기 피드에 올립니다. |
| **earlyNote** | 넷 나열 "분류·검색·생성·착용" (원칙 #1 — 둘까지) | 크리에이터 캠페인은 지금 진행할 수 있습니다. 나머지 기능은 얼리 액세스입니다. |
| **pipelineBody** | 두 번째 문장에 두 생각 — 검색 + 생성 (원칙 #1) | 컷마다 색상 코드와 빛 방향까지 태그가 붙습니다. 찾는 장면은 문장으로 적으면 됩니다. 없는 컷은 가진 제품 사진으로 새로 만듭니다. |
| **tabs.1.body** | "A가 아니라 B" 대비 공식, tabs.2.title 대비와 중복 (원칙 #5) | 사진 속 장면과 물건으로 찾습니다. |
| **memoryTitle** | "두 번 하지 않습니다" = 약속 공식 (원칙 #2, #5) | 규칙은 한 번만 적습니다 |
| **memoryBody** | 셋 나열 + "쌓입니다" 의인화 + "덮어쓰지는 못합니다" 대비 (원칙 #1, #4, #5) | 규칙은 브랜드 → 캠페인 → 개인 순서입니다. 캠페인 규칙은 브랜드 규칙을 바꾸지 않습니다. |
| **memory.0.body** | 넷 나열 "로고, 서체, 팔레트, 말투" (원칙 #1) | 로고와 팔레트, 말투. 바뀌면 안 되는 것들. |
| **memory.1.body** | 셋 나열 + "지난주에 정한 것" 허공에 뜸 (원칙 #1) | 무드보드와 핵심 문장. 지난 회의에서 정한 것. |
| **memory.2.body** | "자주" 두 번 반복 | 자주 고르는 비율과 구도, 남기는 피드백. |
| **memoryLoop.body** | "들어갑니다" 의인화 — 데이터가 스스로 걸어 들어감 (원칙 #4) | 캠페인이 끝나면 반응이 좋았던 컷과 문장을 다음 캠페인 메모리에 남깁니다. |
| **vto.title** | "원하는 장면" 막연 (원칙 #3) | 옷 한 벌을 여러 장면에 |
| **vto.body** | 두 번째 문장: "룩북은… 자유 모드는…" 병렬 대비, 한 문장 두 생각 (원칙 #1, #5) | 의류 사진 한 장과 가상 모델로 착용 컷을 만듭니다. 룩북은 정해진 구도로 만듭니다. 자유 모드는 장소와 포즈, 비율을 바꿉니다. |
| **vto.locks.0** | 넷 나열 "색과 소재, 단추와 자수" (원칙 #1) | 옷의 색과 소재, 디테일 |
| **vto.note** | "실존하지 않는 가상 인물" — "가상"이 이미 실존 안 함, 겹말 + 딱딱 | 예시 화면입니다. 모델은 가상 인물입니다. |

---

## 그대로 두면 되는 세 줄

1. **pipelineTitle** `파일명을 몰라도 찾습니다` — 한 줄, 한 생각, 누구나 아는 불편을 그대로 말함. 꾸밈이 없어서 믿음이 감.
2. **tabs.2.title** `같은 병, 다른 무드` — 네 단어가 사진 두 장보다 빠르게 기능을 보여줌.
3. **vto.locks.2** `사진에 없는 뒷면은 만들지 않습니다` — 안 되는 걸 솔직하게 쓴 줄. 제품이 자기 한계를 아는 느낌.

---

**전체 톤 한마디:** 구체적인 숫자와 실물(36컷, 월넛 캡, 앰버 색)이 이 페이지를 지탱하고 있고 그게 강점입니다. 본문에 남은 셋씩 나열과 한-문장-두-생각만 걷어내면 그 구체성이 더 숨 쉽니다.
### Opus 4.6 — English

Here's the line-by-line review.

---

## Flagged lines

| Key | Problem | Rewrite |
|---|---|---|
| `heroTitle` | Forced two-line break; "from shots you already have" is filler — the page images already show this | **Your next campaign starts in the library** |
| `heroBody` | Three-item list ("a drive, a generator and a design tool"); "happens in one place" is generic SaaS speak | **No more round trips between the drive and the design tool. Finished cuts go out on real creators' feeds.** |
| `moods.title` | Forced `/` break for a line that reads fine as one | **36 mixed cuts, eight moods** |
| `moods.body` | Three-item list ("light, color and texture"); "land together" personifies the cuts | **Cuts with similar light and color sit in the same group. Tap a mood and the same bottle, shot in that mood, comes to the front.** |
| `earlyNote` | Four-item list, reads like a changelog | **Sorting, search and generation are in early access. Creator campaigns run today.** (fold try-on into "generation" — both are the same early-access tier) |
| `pipelineBody` | "Every cut is tagged" — passive/agentless; second sentence uses the command pattern already spent elsewhere | **Uploads get color codes, light direction, even the mood word your team would use. Type a scene — if no cut matches, generate one from the product photos already in the library.** |
| `tabs.0.body` | Dangling "Including" fragment | **Down to the mood words your team actually uses.** |
| `tabs.2.body` | Personification ("It starts from …", "cuts that pass … show up") | **Generation starts from your product photos. Results are checked against your brand rules before they appear.** |
| `memoryTitle` | Command formula — same pattern as `pipelineBody`'s imperative; every section now opens with a verb order | **Set it once** (shorter, less imperative-lecture) or simply **Once** |
| `memoryBody` | "from brand to campaign to person" is a three-stop "X to Y to Z" paired construction; personification ("rules stack") | **Brand rules sit at the top, campaign rules below, personal preferences at the bottom. A campaign rule never overwrites a brand rule.** |
| `memory.0.body` | Four-item list + "The things that don't change" is vague | **Logo, palette, voice. Fixed across every campaign.** |
| `memory.1.body` | Four-item list ending with conversational tag that doesn't add information | **Moodboard, audience, key line — scoped to one campaign.** |
| `memoryLoop.body` | Personification ("carry into the next one's memory") | **When a campaign ends, the best-performing cuts and lines are available to the next one.** |
| `vto.title` | Forced `/` break; "One X, any Y" template — repeated at `spreadFeed.title` | **Try on anywhere** (let the garment/scene specifics come from the body and the image) |
| `vto.body` | "Lookbook keeps set framing" / "free mode lets you" — personification; three-item list (scene, pose, ratio) | **Upload one garment photo and a virtual model. Lookbook mode: fixed framing on white. Free mode: you choose the scene, pose and ratio.** |
| `vto.modes.1.body` | Four-item list + command ("Pick the…") | **Scene, pose and ratio are yours. For feeds and ads.** |
| `vto.locks.0` | Four items in a single chip — reads like fine print | **Color, material, buttons, embroidery — unchanged** (or split into two chips) |
| `spreadFeed.title` | Repeats the "One X, N Y" template from `vto.title` | **The same bottle on eight feeds** |

## Lines that are fine as-is (no changes needed)

All UI labels (`moods.all`, `moods.light`, `moods.color`, `moods.mood`, `moods.count`, `earlyAccess`, `live`, `beta`, `example`, `stage.*`, `heroCta`, `heroSecondary`, `searchResult`, `makePrompt`, `makeChecks.*`, `pipelineEyebrow`, `memoryEyebrow`, `memory.*.title`, `memory.*.items.*`, `memoryLoop.label`, `vto.eyebrow`, `vto.garment`, `vto.garmentNote`, `vto.lockLabel`, `vto.locks.1`, `vto.locks.2`, `vto.freeLabel`, `vto.frees.*`, `spreadEyebrow`, `tabs.0/1.label`, `tabs.0.title`, `tabs.1.title`, `tabs.2.title`, `tabs.1.body`, `heroEyebrow`, `moods.eyebrow`) — these are either concrete labels, honest disclosures, or short enough to carry no pattern.

---

## 3 strongest lines — keep exactly

1. **`tabs.2.title` — "Same bottle, new mood"** — Concrete, evocative, zero waste. Sounds like something Aesop would put on a card.
2. **`vto.note` — "Example screen. The model is a virtual person who does not exist."** — Direct honesty without hedging. The period after "Example screen" is earned.
3. **`pipelineTitle` — "Find it without the file name"** — Names the exact pain in six words. No abstraction, no promise.

Honorable mention: `vto.locks.2` ("No back view invented when none was uploaded") — honest constraint disclosure, says exactly what the system won't fake.

---

## Overall voice

The copy is 70% there — the concrete parts (bottle, walnut cap, amber, 36 cuts) are doing real work, but the connective tissue between them keeps falling into the same three patterns (command + promise, three-item list, forced line break). Strip those and let the product screenshots carry the persuasion; the best lines on this page are already the ones that name a physical thing.
### Gemma 4 — 한국어

제시해주신 **[브랜드 랜딩 워딩 원칙]**에 따라, AI 특유의 '작법 패턴(대구법, 명령-약속, 추상적 가치 강조)'을 제거하고, 실제 제품의 동작과 실물을 중심으로 한 **Linear(선형적)** 문구로 수정했습니다.

### 1. Line-by-Line 수정 제안

| Key | Problem | Rewrite |
| :--- | :--- | :--- |
| **moods.title** | 쪼개진 문장, 감성적 접근 | **36컷의 사진을 8개 무드로 분류합니다** |
| **moods.body** | '묶습니다' (다소 모호) | **빛과 색, 질감이 비슷한 컷을 그룹화합니다. 특정 무드를 선택하면 해당 무드로 촬영한 제품 컷이 먼저 보입니다.** |
| **heroTitle** | 추상적/결과 중심적 | **촬영 에셋으로 캠페인 콘텐츠를 만듭니다** |
| **heroBody** | '오가던 일을 한곳에서' (AI 전형적 문구) | **드라이브의 원본 파일과 생성 툴을 한 화면에서 사용합니다. 완성된 컷은 크리에이터의 피드로 바로 전달합니다.** |
| **pipelineTitle** | '몰라도 찾습니다' (명령+약속 공식) | **시각적 요소로 사진을 찾습니다** |
| **pipelineBody** | '태그가 붙습니다' (수동적) | **컷마다 색상 코드와 빛의 방향이 기록됩니다. 필요한 장면을 문장으로 검색하거나, 기존 제품 사진으로 새로운 컷을 생성합니다.** |
| **tabs.0.title** | 너무 단순한 나열 | **업로드 시 자동 태깅** |
| **tabs.0.body** | '팀이 쓰는 단어' (모호) | **브랜드 팀이 내부적으로 사용하는 무드 키워드를 태그로 추가합니다.** |
| **tabs.1.title** | '문장으로 찾습니다' (반복) | **자연어 검색** |
| **tabs.1.body** | '찍힌 것으로 찾습니다' (구어체 과함) | **파일명 대신 사진 속 사물, 색상, 구도로 검색합니다.** |
| **tabs.2.title** | '같은 병, 다른 무드' (대비 공식) | **제품 기반 컷 생성** |
| **tabs.2.body** | '통과한 컷만 보입니다' (의인화) | **보유한 제품 사진을 기반으로 생성합니다. 설정한 브랜드 규칙이 적용된 결과물만 출력합니다.** |
| **memoryEyebrow** | 숫자 나열 (03 기억) | **브랜드 규칙 관리** |
| **memoryTitle** | '두 번 하지 않습니다' (명령+약속 공식) | **계층별 브랜드 규칙 적용** |
| **memoryBody** | '덮어쓰지는 못합니다' (대비 공식) | **규칙은 브랜드, 캠페인, 개인 단위로 저장합니다. 상위 단계인 브랜드 규칙은 하위 규칙보다 우선 적용됩니다.** |
| **memory.0.body** | '바뀌면 안 되는 것들' (추상적) | **로고, 서체, 컬러 팔레트 등 고정 가이드라인입니다.** |
| **memory.1.body** | '지난주에 정한 것' (너무 가벼움) | **무드보드, 타깃, 핵심 메시지 등 캠페인별 설정값입니다.** |
| **memory.2.body** | '자주 남기는 피드백' (모호) | **선호하는 구도와 비율, 반복되는 수정 요청 사항입니다.** |
| **memoryLoop.body** | '메모리로 들어갑니다' (의인화) | **캠페인 종료 후 성과가 좋았던 컷과 문구를 다음 캠페인 규칙에 반영합니다.** |
| **vto.title** | 쪼개진 문장, 감성적 접근 | **의류 사진으로 가상 착용 컷을 만듭니다** |
| **vto.body** | '만듭니다' 반복, 나열식 | **제품 사진 한 장과 가상 모델을 조합합니다. 룩북 모드에서는 정해진 구도로, 자유 모드에서는 장소와 포즈를 변경해 생성합니다.** |
| **vto.modes.0.body** | '상세페이지용' (단편적) | **흰 배경의 고정 구도로 상세페이지용 이미지를 만듭니다.** |
| **vto.modes.1.body** | '고릅니다' (단순 나열) | **장소, 포즈, 비율을 설정해 피드 및 광고용 이미지를 만듭니다.** |
| **vto.locks.2** | '만들지 않습니다' (부정문 강조) | **사진에 없는 뒷면은 생성하지 않습니다** |
| **spreadEyebrow** | '확산' (추상적 한자어) | **크리에이터 배포** |
| **spreadFeed.title** | '여덟 개의 피드로' (AI식 비유) | **하나의 제품으로 다양한 크리에이터 피드 구성** |

---

### 2. 유지해도 좋은 강한 문장 (Strongest Lines)
이 문장들은 구체적인 실물(월넛, 앰버, 4:5 등)을 언급하고 있어 브랜드의 전문성과 신뢰감을 줍니다.

1. **"캡은 월넛 원목"** (구체적인 소재 언급)
2. **"앰버 주스 색 유지"** (제품의 시각적 특성 명시)
3. **"세로 4:5 먼저"** (실무적인 작업 단위 언급)

### 3. 전체적인 보이스 톤 (Overall Voice)
**"감성적인 형용사를 걷어내고, 툴의 작동 원리와 실무자의 작업 단위를 그대로 말하는 '담백한 매뉴얼'의 톤"**입니다.