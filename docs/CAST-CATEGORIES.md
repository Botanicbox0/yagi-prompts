# 누가 나오나요 — 혼자 · 둘이서 · 반려동물 (cast)

> 2026-11-11. 대표 요청: 개인 쪽에 **커플**과 **반려동물** 섹션을 따로 두고, 각각 이미지와 영상이 한눈에 나뉘게.
> 설계 결정은 Fable(메인 세션), 구현은 이 브랜치(`claude/b2c-couple-pet-812783`). 아래 §8은 대표가 정할 것.
> 코드가 원본이다. 이 문서와 다르면 코드를 믿고 이 문서를 고친다.

## 1. 새 축 하나: cast

템플릿에는 이미 두 축이 있다. `medium`(무엇을 만드나: 영상·이미지)과 `use_case`(어디에 쓰나). 여기에 **누가 나오나**를 셋째 축으로 더한다.

| 값 | 뜻 | 받는 사진 |
| --- | --- | --- |
| `solo` (기본) | 지금 있는 모든 템플릿. 구매자 한 사람 | 내 셀카 |
| `pet` | 반려동물. 반려동물만 나오거나, 나와 함께 나온다 | 반려동물 사진 (+ 함께 나오면 내 셀카) |
| `couple` | 구매자와 상대방 두 사람 | 내 셀카 + 상대방 사진 |

- DB: `prompt_items.cast_kind text not null default 'solo'` + CHECK(`0078_core_template_cast`). `cast`는 SQL 예약어라 열 이름만 `cast_kind`이고, 코드에서는 `cast`다.
- 읽기는 `to_jsonb(prompt_items.*)->>'cast_kind'`에 `solo` 기본값이라 0078을 적용하기 전 운영 DB도 지금처럼 돈다. 쓰기는 `solo`가 아닌 값을 0078 없이 쓰려 하면 마이그레이션 이름을 대며 실패한다(`setPromptCast`).
- 타입·검증: `lib/prompts/schemas.ts` `TEMPLATE_CASTS`, 카드 `PromptCard.cast`(`lib/prompts/catalog.ts`).
- 표시하는 곳: 관리자 템플릿 폼의 "누가 나오나요"(`components/admin/prompt-fields.tsx`, `lib/admin/prompt-operations.ts`), AI 크리에이티브 레시피 편집기의 같은 선택(`혼자 · 반려동물만 · 나와 반려동물 · 둘이서`, `components/recipes/recipe-editor.tsx`). 크리에이티브 템플릿은 승인·셀프 공개 때 레시피의 사진 자리로 cast가 정해진다(`recipeCast`).

## 2. 레시피 사진 자리: `pet`, `partner`

`lib/recipes/schema.ts` 슬롯 역할에 둘을 더했다. 이름도 고정이다(`pet`, `partner`). 둘 다 고객이 반드시 넣는 사진이다.

| 규칙 | 전 | 후 |
| --- | --- | --- |
| 셀카 | 언제나 필수 | **혼자·둘이서는 셀카 필수, 반려동물만 나오는 템플릿은 셀카 대신 `pet` 필수** |
| 추가 고객 사진 | 사람이면 안 됨 | `pet`(사람 아님), `partner`(사람)만 추가. 한 템플릿에 둘을 같이 쓰지 않는다(`cast_mix`) |
| 결과물 | 모든 결과에 내가 나와야 함 | 그대로 + 반려동물 템플릿은 모든 결과에 반려동물이(`no_pet`), 둘이서는 두 사람이(`no_partner`) |
| 상대방 얼굴 | — | 검증 라이브러리(ModelArk 자산)로 가는 단계에 상대방 사진이나 그걸로 만든 결과를 넣을 수 없다(`partner_asset`). 실행기도 한 번 더 막는다(`lib/recipes/execute.ts`) |

엔진에 가는 문장도 cast를 따른다(`engineStepPrompt`): 사람은 "the person to feature", 두 사람은 "the two people to feature … two distinct people", 반려동물은 "the pet to feature … species, breed, coat colour, markings"를 붙인다. 반려동물에게 사람 문장을 붙이지 않는다.

## 3. 사진의 안전 규칙과 수명

**반려동물은 사람이 아니다.** 반려동물 사진은 얼굴 검증, 본인 인증, 인물 자산 그룹, 본인 얼굴 동의를 거치지 않는다. 제공사의 일반 검수(OpenAI·Gemini·Seedream·ModelArk의 거절)는 그대로 받는다. 거절되면 지금과 같은 실패·환불 흐름이다. 영상 엔진에는 얼굴 자산(`asset://`)이 아니라 일반 참조 이미지(짧은 서명 URL)로 간다.

**내 얼굴은 아무것도 바뀌지 않는다.** 셀카는 지금 경로(저장된 셀카 → 검증 라이브러리) 그대로이고, 이 작업의 어떤 코드도 그 경로를 지나지 않는다.

**흐름.**
- 만들기 카드(`components/twings/studio.tsx` + `cast-photos.tsx`)가 템플릿이 받는 사진만 묻는다: 반려동물만 → 셀카 칸 없이 반려동물 사진 하나(좋은 사진 3가지: 얼굴이 또렷하게 · 몸 전체가 다 나오게 · 혼자 나온 사진), 나와 반려동물 → 셀카 다음 반려동물 사진, 둘이서 → 셀카 다음 상대방 사진과 동의 체크 하나. 사진은 결제 요청 때까지 브라우저에만 있다.
- 결제 주문(`app/api/billing/toss/orders` → `lib/renders/cast-form.ts`): 반려동물만이면 주문이 들고 가는 사진이 반려동물 사진이다. 두 번째 사진은 주문이 만들어진 직후 그 주문의 렌더 id(`billing_payments.render_ref`)에 묶는다. **금액·결제 로직·토스 호출은 건드리지 않았다**(사진을 고르는 부분만 바뀌었다).
- 렌더 생성(`lib/renders/service.ts` `createAuthorizedRender`): 템플릿 cast와 레시피 cast가 맞지 않거나 레시피가 없으면 `not_for_sale`, 사진이 빠지면 `slot_missing`, 상대방 동의가 없으면 `partner_consent_required`. 반려동물만 나오는 작업에 저장된 셀카가 붙어 오면 거절한다(`bad_photo`).
- 사진 정리: 모든 슬롯 사진은 sharp로 다시 저장해 EXIF(위치, 기기)를 지운다(`cleanSlotPhoto`, 셀카 정리와 같은 방식).

**수명** (`render_slot_inputs`, `0079_core_render_slot_inputs` + `0153_glue_render_slot_inputs`, 서버 롤 전용): 반려동물·상대방 사진은 **렌더가 끝나면(성공이든 실패든) 다음 렌더 패스에서 지운다.** 끝나지 않는 작업도 최대 7일, 결제되지 않은 주문에 묶인 사진은 2시간 뒤 지운다(`deleteSpentSlotPhotos`, `runRenderPass` 3c단계). 반려동물만 나오는 템플릿의 반려동물 사진은 작업의 입력 사진 자체라 같은 행으로 기록해 같은 규칙으로 지운다. 기존 규칙과의 관계: 셀카와 일반 입력 사진(`{job}/input.*`)은 결과가 남아 있는 동안 보관한다는 지금 규칙 그대로다. 슬롯 사진은 구독 편집 참조 사진(7일 보관, `deleteExpiredEditReferences`)과 같은 "구매자가 낸 추가 사진" 범주로 보고 그보다 짧게 잡았다. 행은 지운 시각(`deleted_at`)과 함께 남겨 "있었고 지웠다"는 기록이 된다.

**알려진 한계.** 실패 판정 뒤 관리자 승인형 무상 재생성(TEMPLATES-IA §12 "다시 만들기 1회")은 반려동물·상대방 사진이 지워진 뒤라 같은 사진으로 다시 만들 수 없다. 그 경우 고객에게 사진을 다시 받는다. 계정 삭제 때 행은 FK cascade로 지워지고, 파일은 렌더 버킷 정리 런북이 지운다(`docs/RUNBOOK-deletion.md`에 `slot-*.jpg` 한 줄 추가 필요).

## 4. 둘이서는 꺼 둔다

`lib/flags.ts` `coupleTemplatesOpen()` — 환경변수 `TWINGS_COUPLE_TEMPLATES`가 정확히 `on`일 때만 열린다. **기본은 꺼짐.**

**이유.** 약관 §5.3은 "본인 얼굴만"이라고 말한다. 토스가 정기결제를 심사하는 동안 약관은 고칠 수 없고, 둘이서 문구는 그 뒤 대표가 정한다. 2026-09-13 결정표(TEMPLATES-IA §12)도 둘이서를 "계속 검토 — 두 트윈 모두 인증 + 상호 동의"로 남겨 두었다. 이 작업은 그 결정을 앞서 가지 않고, 문구가 정해지면 바로 열 수 있게 흐름만 만들어 둔다.

**꺼져 있을 때 (지금 운영).** 둘이서는 어디에도 없다.
- 카탈로그가 couple 템플릿을 아예 빼므로(`loadPromptCatalog` `coupleOpen`, 캐시 키에도 들어감) 홈·목록·사이트맵·메이커 페이지·템플릿 페이지 어디에도 나오지 않는다. 템플릿 주소는 404.
- `/{locale}/couple`은 404, 메타데이터는 noindex.
- 홈 섹션, `/video`·`/image`의 섹션, 칩 어디에도 없다.
- 렌더 생성과 결제 주문은 `not_found`로 거절한다. 상대방 사진을 보내도 마찬가지다.

**켜져 있을 때.** 구매자는 지금의 검증된 경로로 자기 셀카를 내고, 상대방 사진 한 장과 "상대방에게 사진 사용 동의를 받았어요" 체크 하나를 낸다. 상대방 사진은 계정의 인물 자산 그룹에 들어가지 않고(§2 `partner_asset`), 렌더가 끝나면 지운다(§3). 동의 시각은 `render_slot_inputs.partner_consent_at`에 남는다.

**지금 열 수 있는 둘이서 템플릿.** 상대방 얼굴이 검증 라이브러리로 가면 안 되므로 둘이서 레시피는 바이트로 사진을 받는 엔진(GPT Image, Seedream, Gemini)만 쓸 수 있다. 메이커 영상 엔진은 지금 Seedance(ModelArk)뿐이라 **둘이서 영상은 아직 만들 수 없다.** 열려면 (a) Kling처럼 바이트로 받는 영상 엔진을 허용하거나 (b) 렌더마다 상대방 전용 임시 자산 그룹을 만들고 끝나면 지우는 경로를 새로 설계해야 한다. 어느 쪽이든 약관 문구와 함께 정한다.

## 5. 화면

- **홈** (`app/(marketing)/[locale]/page.tsx`): 메인 갤러리는 `solo`만 보여 준다(`soloCatalog`). 갤러리 아래에 "반려동물과 함께", (켜졌을 때) "둘이서" 섹션이 하나씩 붙는다. 섹션마다 **영상** 줄, **이미지** 줄을 이름표와 개수로 나누고, 줄마다 4장까지, 오른쪽에 "모두 보기". 템플릿이 없는 섹션은 통째로 그리지 않는다(운영에 빈 선반 없음).
- **목록** (`/video`, `/image`): 그 탭의 solo 그리드 아래, 정의 문단 위에 같은 매체의 반려동물·둘이서 줄.
- **전용 페이지** (`/{locale}/pet`, `/{locale}/couple`, `components/templates/cast-page.tsx`): 제목, 한 줄 소개, 영상·이미지로 건너뛰는 pill 한 줄(둘 다 있을 때만), 이름표 붙은 두 줄, 정의 문단(GEO), FAQ. 템플릿이 하나도 없으면 404. 무접두 `/pet`은 다른 마케팅 경로처럼 미들웨어가 로케일로 보낸다(`(app)` 경로가 아니라 엣지 게이트 등록은 필요 없다).
- **PR #195와의 관계**: #195가 고치는 칩 한 줄(`sequence-dispatch.tsx`, `sequence-curation.ts`)은 건드리지 않았다. cast는 칩이 아니라 섹션과 페이지다(칩 줄은 무드·매체 필터로 남는다). 홈 파일에서는 #195가 바꾸지 않는 줄만 고쳤다.
- **템플릿 페이지**: 가격·카드 규칙은 그대로(한국어 카드에 가격 없음). 반려동물만 나오는 템플릿에는 "내 셀카 → 결과" 띠를 그리지 않고 "사진 한 장이면 우리 아이가 주인공이 돼요"라고만 쓴다. 레시피가 없는 pet·couple 템플릿은 "준비 중".
- **SEO**: 두 페이지 모두 정규 URL·ko/en 대체 링크, `CollectionPage` + `ItemList` JSON-LD(이름·주소만, 가격 없음), 사이트맵에는 템플릿이 있을 때만(둘이서는 켜졌을 때만).
- **스윕 마커**: `data-cast-home`, `data-cast-section`, `data-cast-rail`, `data-cast-see-all`, `data-cast-page`, `data-cast-jump`, `data-cast-photo`, `data-partner-consent`.
- **문구**: `messages/*.ts`의 `cast` 그룹. 한국어 1차는 로컬 Gemma 4가 다듬었고, 사실이 틀어진 두 줄(반려동물과 함께 나오는 템플릿도 "사진 한 장이면 충분" 등)은 원래대로 고쳤다.

## 6. 프롬프트 잠금 — cast에 맞게

"한 사람(젊은 여성)"을 전제한 잠금을 지우지 않고 cast를 따르게 했다. solo 출력은 한 글자도 바뀌지 않는다(테스트로 고정).

| 위치 | 바뀐 것 |
| --- | --- |
| `lib/recipes/schema.ts` `engineStepPrompt` | 사람·두 사람·반려동물 문장(§2) |
| `lib/renders/prompt.ts` `identityLockFor(cast, medium)` | solo는 기존 두 문장, pet·couple 문장 추가. pet·couple은 레시피로만 돌아서 지금은 쓰이지 않는다 |
| `lib/premium-editing/guard.ts` `premiumEditInstructions(cast)` | "sole person"을 두 사람·반려동물에 맞게. 구독 편집은 레시피 템플릿을 받지 않아 지금은 solo만 쓰인다 |
| `lib/template-director/morphic-production-playbook.ts`, `flash-director.ts` | TWO-PERSON LOCK / PET LOCK, 반려동물에는 사람 체형 잠금(SLENDER SILHOUETTE)을 붙이지 않음 |

남은 것: `flash-director.ts`의 셀카 보정(`compileModelSpecificIdentityPrompt`)은 구매자 본인 셀카를 다듬는 단계라 cast와 무관하게 늘 한 사람이다. 다만 "young Korean woman" 전제는 남성 구매자에게도 틀린 오래된 가정이라 따로 고칠 대상이다(이 작업 범위 밖).

## 7. 로컬 확인

`npm run db:local`이 반려동물·둘이서 예시 템플릿 8개를 넣는다(`scripts/cast-fixtures.ts`, 캐스트 × 매체마다 2개, 자리표시 미디어, 제목에 "(예시)"). 운영에는 들어가지 않는다. 그중 3개(반려동물만 이미지, 나와 반려동물 이미지, 둘이서 이미지)는 레시피가 있어 만들기 카드에 사진 칸이 뜬다. 둘이서 화면을 보려면 빌드와 실행 모두 `TWINGS_COUPLE_TEMPLATES=on`.

## 8. 대표가 정할 것

1. **첫 실제 템플릿**: 반려동물(영상·이미지)과 둘이서(이미지)에 무엇을 올릴지. 운영에는 아직 하나도 없어서 섹션과 페이지가 보이지 않는다(의도된 상태).
2. **둘이서 약관 문구**: §5.3 "본인 얼굴만"을 어떻게 바꿀지(상대방 동의 확인 방식, 상대방 인증 요구 여부 — 2026-09-13 메모는 "두 트윈 모두 인증 + 상호 동의"). 정해지면 `TWINGS_COUPLE_TEMPLATES=on`.
3. **둘이서 영상**: 바이트 영상 엔진 허용 또는 상대방 임시 자산 그룹 설계 중 무엇으로 열지(§4).
4. **반려동물만 나오는 템플릿의 가격 차이**: 셀카·인증 비용이 없다. 지금은 다른 템플릿과 같은 가격 규칙(원가 플로어)을 따른다. 달리 할지.
5. **슬롯 사진 보관 기간**: 지금은 "렌더가 끝나면 삭제, 최대 7일". 약관·개인정보 문구와 맞출 때 확인.

## 9. 클라우드 적용 필요

| 파일 | 내용 |
| --- | --- |
| `0078_core_template_cast` | `prompt_items.cast_kind` + CHECK + 인덱스. glue 없음(0102가 표 전체를 브라우저 롤에 막음) |
| `0079_core_render_slot_inputs` + `0153_glue_render_slot_inputs` | 슬롯 사진 행. RLS 강제, 서버 롤 전용 |

적용 전에도 코드는 지금처럼 돈다: cast 읽기는 `solo`로 떨어지고, 슬롯 사진 표가 없으면 정리 단계와 슬롯 조회가 건너뛴다. 단, 적용 전에는 pet·couple 템플릿을 저장할 수 없다(의도).
