# feat(makers): 레시피 v2 — 단계·슬롯·등록 화면·검수 렌더 (R1)

docs/PLATFORM-2.0.md §7.3·7.4·§8.3, §18 R1. 플래그 `TWINGS_FORMAT_CREATORS`(기본 off) 뒤에서만 열린다.

- 기능 커밋 `1e4a41e` (base `488f302`, main)
- `git diff --stat main...HEAD`: 53 files, +3,606 / −46 (캡처 6장·QA 스크립트 포함)

## 무엇이 바뀌나

| 영역 | 내용 |
| --- | --- |
| 데이터 (0059/0142) | `prompt_items.recipe`(jsonb, 서버 전용 — 공개 카탈로그 컬럼 목록에 없음) · `disclosure`({prompts, assets}, 기본 둘 다 false) · `presentation`(make-first/story-first). `platform_formats`: `'draft'` 상태, `recipe_v2`(기존 `recipe`가 v1 text라 이름을 나눔), `title_ko`, `disclosure`, `presentation`, `royalty_krw`(500~5,000 CHECK), `test_renders_used`(≤3 CHECK), `example_url` NULL 허용. 새 표 `platform_format_assets`(`ast_<32hex>`, 4MB·MIME CHECK), `render_job_recipes`(잡별 레시피 스냅숏·단계 상태·purpose), `render_job_outputs`(캐러셀 N장). `platform_private_format()`가 수락된 포맷의 `recipe`·`disclosure` 변경도 막는다. 0142: 새 표 3개 RLS 강제·브라우저 롤 전면 차단. |
| 스키마 `lib/recipes/schema.ts` | §7.3 그대로(zod). 사용자 입력은 `selfie` 하나, 나머지는 메이커 파일. 단계: 이미지 1 / 영상 1 / 이미지→영상 / 캐러셀 1~6. 토큰은 `{{입력}}`만(선언·사용 일치, `@image1` 금지), 앞 단계만 참조(순환 불가), 메이커 허용 엔진(GPT Image 2·Seedream 5.0 Pro/Lite·Seedance 2.0/2.5 — 2.5 GPT는 조직 인증 전이라 제외), 길이·해상도는 엔진 제약, 모든 결과물이 셀카를 거친다. 얼굴 경로(`identityPath`)는 `needsIdentity`와 같은 규칙(테스트로 고정). |
| 렌더 패스 | 템플릿에 recipe가 있으면 `lib/recipes/execute.ts`가 단계 실행: 기존 `runImageRender`/`startVideoRender` 재사용(참조 배열만 추가), 고객 얼굴(셀카·셀카로 만든 중간 결과)은 ModelArk에 **검증 자산 `asset://`로만**, OpenAI는 바이트, 메이커 파일은 짧은 서명 URL. 중간 결과 `{job}/step-{id}.*`, 재시도는 끝난 단계를 건너뜀, 실패 코드 `code:step`(사용자 문구는 `baseFailureCode`로 원래 사유), 원가 단계 합산(`cost_source=estimate`). 결과 N장은 `render_job_outputs`, 첫 장은 기존 `result_key`. **recipe가 없으면 기존 경로 그대로**(기존 테스트 전부 통과). 구독 편집은 레시피 템플릿에 `unsupported_template`. |
| 메이커 등록 화면 | `/creators/workspace/formats/{new\|id}` (`data-recipe-editor`, 데스크톱 좌우 분할). 왼쪽: 제목 ko/en · 매체(영상/이미지/캐러셀) · 단계 편집기(엔진·비율·길이·해상도, `[내 사진]` `[참조 1]` `[1단계 결과]` 끼워 넣기 → 저장 시 `{{selfie}}` 등으로 변환) · 참조 자산(바이트로 형식 판별, 이미지 재인코딩으로 메타데이터 제거, 4MB·6개·20MB) · 예시(게시물 링크 또는 업로드) · 공개 범위 · 페이지 순서 · 희망 로열티(500~5,000, 기본 1,500, 예상 가격 = 원가 하한 + 로열티) · 실시간 확인 목록 · JSON 가져오기/내보내기. 오른쪽: 템플릿 페이지 미리보기 + 테스트 렌더(본인 저장 사진, 포맷당 3회, TWINGS 부담 기록, 결과는 본인만). 제출 → `submitted`. 작업공간은 0059가 있으면 기존 폼 대신 이 화면으로 링크, 초안은 "작성 중 · 이어서 편집". |
| 스튜디오 검수 | `/admin/community` 포맷 카드에 레시피 요약(단계·엔진·입력·파일). 새 오퍼레이션 **`platform.review`**: 스튜디오가 가진 얼굴 3장(관리자 저장 사진 → 가이드 인물 `public/images/portrait-guide/*`)으로 검수 렌더 3개, 감사 기록. 수락(`platform.manage` format)에 `priceKrw` — 제안가(플로어 + 로열티) 미리 채움, 플로어 미만 거부, 수락 시 `recipe`·`disclosure`·`presentation`·가격·`author_id`·엔진·비율·길이를 `prompt_items`(pending)에 복사. 초안은 큐에 안 보인다. v1 포맷 수락은 그대로. |
| 템플릿 페이지 | 메이커 템플릿만: `presentation`에 따라 "만드는 법" 위치(story-first = 예시 위). `disclosure.prompts`면 단계별 프롬프트(`[내 사진]` 표기) + 복사, `disclosure.assets`면 참조 자산(`/api/makers/files/{ast}` — 공개·게시된 것만 캐시 가능). 둘 다 꺼져 있으면 **프로젝션 객체에 프롬프트·핸들 자체가 없다**(HTML·RSC 캐너리 테스트). 페이지의 다른 부분은 그대로. |
| 테스트·메일·공유 | 테스트/검수 렌더는 내부 샌드박스 템플릿(audience brand, archived, 가격 0)을 가리키고, 메일 skipped · 내 결과물 제외 · 공유 링크 not_found. |

## 검증 (이 브랜치, 로컬)

| 명령 | 결과 |
| --- | --- |
| `npm run db:local` | 스냅숏 재생성 ✓ |
| `npx tsc --noEmit` | ✓ |
| `npx vitest run` | **322 파일 / 3,076 테스트 통과** (새 `tests/recipes/*` 8파일 67개: 스키마 허용 9·거부 33 + 보조 5, 파이프라인 6, 메이커 서버 5, 검수·수락·트리거·캐너리 4, 마이그레이션 2, 오퍼레이션 3, 편집기 2, 작업공간 링크 2) |
| `NEXT_PUBLIC_APP_URL=http://localhost:3017 npm run build:local` | ✓ |
| `PORT=3017 npm run start:local` + `SWEEP_BASE_URL=http://localhost:3017 npm run sweep:anon` | **SWEEP PASSED — 1111/1111** |
| 로컬 브라우저 QA | `scripts/recipe-v2-local-qa.ts`(합성 데이터, 클라우드 자격 미전달, 실제 생성 없음)로 시드 → 헤드리스 Chrome 캡처 |

실제 유료 생성은 하지 않았다. 모든 엔진은 가짜(테스트) 또는 그려 낸 이미지(QA)다.

### 캡처 `docs/qa/recipe-v2/`
- `01-editor-draft-1440.png` — 이미지→영상 초안, 참조 자산, 미리보기, 완료된 테스트 렌더
- `02-editor-new-1440.png` — 새 등록 화면
- `03-template-story-first-1440.png`, `04-template-story-first-390.png` — 공개 레시피 섹션(프롬프트+자산, story-first)
- `05-workspace-1440.png` — 작업공간 링크·초안
- `06-admin-review-queue-1440.png` — 검수 큐(레시피 요약, 검수 렌더 3개, 제안가)

## 건너뛴 검사 · 남은 위험
- 실제 ModelArk/OpenAI 호출 없음: 다중 참조(이미지 2~3장 + 참조 영상)·중간 결과의 자산 등록은 가짜 엔진으로만 확인. 첫 운영 테스트 렌더를 Director가 지켜봐야 한다.
- 다단계 원가는 `estimate`로 기록 → 정산 `settle`은 기존 규칙상 `cost_pending`(안전 쪽). 단계별 인보이스 어댑터는 후속.
- 영상 참조 파일은 서명 URL이 필요하다(로컬 드라이버는 없음 → 실패 처리). 4MB 상한(Vercel 함수 본문)이라 긴 참조 영상은 못 올린다.
- 구매자의 비율 선택은 결과 단계에만 적용(중간 단계는 레시피 비율). 메이커 템플릿의 비율 선택지를 레시피 비율로 좁히는 건 템플릿 페이지 스튜디오 변경이라 범위 밖.
- 템플릿 카드·페이지 크레딧은 아직 "YAGI 제작" — 메이커 크레딧·호칭 교체는 R3(catalog-makers).
- 전체 페이지 HTML 캐너리는 컴포넌트·프로젝션·카탈로그 단위로 검증(로컬 스냅숏에 메이커 템플릿 픽스처를 넣으면 스윕 수치가 바뀌어 넣지 않음).

## 클라우드 적용 필요
1. `supabase/migrations/0059_core_maker_recipes.sql`
2. `supabase/migrations/0142_glue_maker_recipes.sql`

순서대로. 코드는 둘이 없어도 기존과 같이 동작한다(편집기 링크 대신 기존 제출 폼, 레시피 경로 비활성).

## 대표 결정 필요
- 로열티 범위 500~5,000원 · 기본 1,500원 · 메이커 테스트 렌더 3회 · 검수 렌더 3장 — 전부 §18 기본값 제안이며 §13-2에서 확정.
- 새 사전 문안(`makerRecipe.*`, 특히 템플릿 페이지 "만드는 법" 안내와 권리 확인 문장) — 외부 공개 전 문안 승인.
- 메이커 허용 엔진 목록(GPT Image 2.5·Kling·Nano Banana는 R2 스모크 뒤).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
