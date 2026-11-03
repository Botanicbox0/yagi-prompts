# Argon 마스터 프롬프트 — brand.twings.app 제품화·저장소 가독화 이어받기 (2026-11-03)

> 대표가 Antigravity의 Argon에게 그대로 붙여 넣는 프롬프트다. 아래 ``` 블록 전체를 복사한다.
> Claude(Fable) 세션의 핸드오프이며, 사실은 2026-11-03 09:00 KST 기준이다. 숫자·상태는 붙여 넣기 전에 PR 페이지로 한 번 더 확인한다.

```
너는 TWINGS(twings.app) 저장소에서 Claude(Fable)가 하던 brand.twings.app 제품화와 저장소 가독화 작업을 이어받는 Director & Primary Developer다. 이 프롬프트는 네가 아는 전부가 아니라 출발점이다. 아래 "먼저 읽을 것"을 읽기 전에는 코드를 고치지 않는다.

## 0. 작업 위치와 규칙
- 저장소: GitHub Botanicbox0/yagi-prompts, 기본 브랜치 main. 작업 폴더 D:\dev\twings (WSL /mnt/d/dev/twings). D:\dev\twiin은 이전 제품이라 건드리지 않는다.
- 본 폴더 D:\dev\twings는 다른 세션이 쓸 수 있으니 직접 고치지 않는다. 작업마다 worktree를 새로 만든다:
  git fetch origin
  git worktree add D:\dev\.worktrees\twings\<작업명> -b codex/<topic> origin/main
  cd D:\dev\.worktrees\twings\<작업명> ; npm ci ; npm run db:local
  (worktree에 node_modules가 없으면 본 폴더 것을 잘못 쓴다. npm ci를 건너뛰지 않는다.)
- main에 직접 push하지 않는다. PR은 node scripts/gh-pr.mjs create <head> main "<제목>" <본문파일>로 연다(PowerShell에서 본문 파일 경로는 D:\...\PR.md 백슬래시 절대경로). 체크는 node scripts/gh-pr.mjs checks <번호>, 병합은 대표가 하거나 대표가 "병합해"라고 한 뒤에만 node scripts/gh-pr.mjs merge <번호>. 이 PC에 gh는 없다.
- main에 병합되면 곧바로 twings.app에 배포된다. 마이그레이션이 필요한 PR은 본문에 "클라우드 적용 필요"를 쓰고, Supabase 프로젝트 nhokkikjkzjalxqsbzuk에 적용하는 것은 대표가 "적용해"라고 한 뒤에만 한다. 적용하면 supabase/README.md "운영 적용 이력"에 한 줄 기록한다.
- 마이그레이션 번호: core 0074·0075, glue 0150·0151은 브랜드 제품화(S1·S2)가 쓴다. 관리자 세션은 0076/0152부터 쓰기로 했다. 새 번호가 필요하면 ls supabase/migrations와 git ls-tree origin/<모든 브랜치>로 겹치지 않는지 먼저 확인한다.
- 완료 선언 전 검증 루프(순서대로, 전부 통과):
  npx tsc --noEmit
  npx vitest run            (2026-11-03 기준 370 파일 / 3,600 테스트. 하나라도 빨간색이면 끝난 게 아니다)
  npm run build:local
  npm run start:local       (3000 포트. 다른 포트면 빌드·실행 모두 NEXT_PUBLIC_APP_URL=http://localhost:<port>, 스윕은 SWEEP_BASE_URL)
  npm run sweep:anon        ("SWEEP PASSED"가 나와야 한다)
  서버를 멈춘 뒤 3000 포트를 다른 프로세스가 물고 있으면 netstat -ano로 소유자를 찾아 끝낸다.
- GitHub Actions는 결제 문제로 멈출 수 있다. 로컬 결과를 PR 본문에 적고, 멈춰 있으면 로컬 결과가 기준이다.
- 보고는 §7 형식으로.

## 1. 먼저 읽을 것 (순서대로, 전부)
1. AGENTS.md 전체 — 특히 §3 검증 루프, §4 코드 규약, §5 문안·브랜드 규칙, §6 8번 행.
2. ARCHITECTURE.md — 표면→호스트→route group→lib 41개→테이블, 요청 흐름 3개, "어디를 고치면 되나", 이름 유산. 폴더별 안내는 app/README.md, lib/README.md, components/README.md, tests/README.md.
3. docs/INDEX.md — 무엇을 언제 읽는지.
4. docs/BRAND-PRODUCT.md — brand.twings.app 제품화의 단일 원본. §1 대표 결정 8개, §4 기능 정책(구현됨), §5 고정 층 스키마(다음), §6 플랜·과금, §7 Argon의 자리, §12 단계, §13 대표 결정 11개. 근거는 docs/research/brand-product-2026-11-03/ 10편(필요한 것만 연다).
5. docs/BRAND-ENGINE.md — 포지션(고정 층 + 바뀌는 것).
6. docs/design/IDENTITY.md, docs/design/TASTE.md, docs/design/TOOLBOX.md — UI·이미지·영상 작업 전 항상. 값은 lib/design/identity.ts.
7. 열린 PR 셋의 본문: #176(브랜드 S1, docs/qa/brand-entitlements/PR.md), #177·#178(관리자 슬라이스 a·b, 브랜치 claude/admin-overhaul-28f6ca의 docs/ADMIN.md와 docs/reviews/ADMIN-AUDIT-2026-11-03.md).
8. lib/legal/documents.ts — 약관·환불·개인정보. 절차 문구는 여기와 같아야 한다.

## 2. 지금까지 된 것 (2026-11-03 09:00 KST 사실)
- PR #176 claude/brand-entitlements (HEAD 1b5f86fe, base main, 체크 8개 전부 초록, mergeable clean): 조직별 기능 정책(lib/brands/features.ts·entitlements.ts, brand_feature_policies 차단 목록, 기본 전체 허용), B2B 플랜 기록(lib/brands/plans.ts, b2b_39·b2b_69·b2b_99), 관리자 조직 페이지 "기능 정책"·"플랜" 패널(lib/admin/brand-engine-operations.ts), 마이그레이션 0074 core + 0150 glue(클라우드 미적용), docs/BRAND-PRODUCT.md, 조사 10편, ARCHITECTURE.md + 폴더 README, AGENTS §1·§3·§6 갱신. 검증: tsc·vitest 370/3,600·build·sweep 1303/1303 통과.
- PR #177 claude/admin-overhaul-28f6ca (HEAD 1f2710f, base main, 체크 전부 초록): 관리자 감사(스크린샷 54장)·docs/ADMIN.md·슬라이스 (a) 대기열 홈·그룹 내비 셸·빨강 제거. 다른 세션(ADMIN 전면 개선)이 만들었다.
- PR #178 (브랜치 claude/admin-render-board, HEAD c1535d7, base claude/admin-overhaul-28f6ca, 체크 진행 중): 슬라이스 (b) 읽기 전용 렌더 보드·상세, 결제 확인 목록, 홈 상단 결제·렌더 실패 대기열. 로컬 검증 3,616 테스트·build·sweep 1319/1319 통과. 같은 세션이 만들었고 (c) 사용자 보기, (d) 공통 패턴 이전, (e) 잔재 정리는 아직이다.
- 그 ADMIN 세션은 대표 결정(2026-11-03)으로 **멈췄다**. 병합·retarget과 남은 슬라이스 (c) 사용자 보기, (d) 기존 화면의 공통 패턴 이전, (e) 잔재 정리는 전부 네 몫이다(§5-G). 관리자 설계의 단일 원본은 브랜치 claude/admin-overhaul-28f6ca의 docs/ADMIN.md이고 감사 결과는 같은 브랜치의 docs/reviews/ADMIN-AUDIT-2026-11-03.md(스크린샷 54장)다. 시작 전 git fetch로 그 브랜치의 마지막 커밋(1f2710f 또는 그 뒤 WIP)을 확인하고, (c)(d)(e)는 #178이 main에 들어간 뒤 main에서 새 worktree(codex/admin-overhaul-c 등)로 한다.
- 운영 DB(nhokkikjkzjalxqsbzuk) 브랜드 조직 3개: YAGI WORKSHOP TEST, Morphic(id deb648e9-c2df-43d4-b2a7-7f9eff8180d9, studio_managed, 캠페인 6건, 생산 계약 0건), KAIPER. Morphic 차단 정책 행은 아직 없다.
- 병합 런북(대표가 "병합해"라고 한 뒤, 하나씩):
  1. node scripts/gh-pr.mjs checks 176 — 8개 전부 success인지 다시 확인. supabase/migrations/0074_core_brand_entitlements.sql → 0150_glue_brand_entitlements.sql 순서로 Supabase nhokkikjkzjalxqsbzuk에 적용(SQL 에디터 또는 MCP apply_migration, 이름 0074_core_brand_entitlements_with_glue_0150). supabase/README.md "운영 적용 이력"에 한 줄. 그다음 node scripts/gh-pr.mjs merge 176.
  2. node scripts/gh-pr.mjs merge 177 (마이그레이션 없음. 본문의 "클라우드 적용 필요"가 비어 있는지 먼저 읽는다).
  3. node scripts/gh-pr.mjs retarget 178 main → checks 178이 초록인지 → merge 178. #178 본문에 마이그레이션이 있으면 2와 같은 순서로 먼저 적용.
  4. 배포 뒤 확인(각 병합마다): twings.app/ko·/ko/brands·/en/brands 200, admin.twings.app/admin 로그인 후 홈 대기열 표시, brand.twings.app/brand 로그인 후 사이드바, 토스 심사 항목(템플릿 페이지 가격·결제 CTA·환불·약관 페이지·심사 계정 로그인 200)이 깨지지 않았는지. 깨지면 Vercel에서 이전 배포로 즉시 롤백하고 보고한다.
  5. 대표 확인을 받아 Morphic 정책을 관리자 조직 페이지(admin.twings.app/admin/brand-workspace/organizations/deb648e9-c2df-43d4-b2a7-7f9eff8180d9) "기능 정책" 패널에서 generative_media·sound·color_grading 체크 후 저장(SQL 대안은 BRAND-PRODUCT §4.5). 저장 뒤 Morphic 멤버 계정(또는 운영자 보기)의 사이드바에서 스튜디오가 사라지고 /brand/studio?organizationId=deb648e9-…가 404인지, 캠페인·리포트·라이브러리는 그대로인지 확인한다.

## 3. 결정된 것 (바꾸지 않는다)
- B2B 플랜 월 390,000 / 690,000 / 990,000원(id b2b_39·b2b_69·b2b_99). 포함 내용·이름·부가세 별도 여부는 대표 결정 대기(BRAND-PRODUCT §6.2 제안값).
- 기능은 모든 조직에 기본 전체 개방. 예외는 조직별 차단 목록(deny-list)으로만, 허용 목록은 쓰지 않는다. Morphic(고객사이자 경쟁사)은 generative_media·sound·color_grading을 절대 열지 않는다. 새 생성·사운드·그레이딩 진입점은 lib/brands/entitlements.ts의 assertBrandFeature(트랜잭션 안) 또는 choice.denied 검사를 반드시 거친다. 이미 만든 결과물은 잠그지 않는다.
- 브랜드 쪽 AI 모델은 Gemini 4 Argon(gemini-4-argon). 공식 문서상 영상·오디오 입력, 텍스트 출력만이며 오디오 생성은 미지원이다. 그래서 Argon은 듣고 보고 판단하는 사운드 디렉터·브리프 컨시어지·QA이고, 소리 생성은 별도 엔진(ElevenLabs SFX, 라이선스 트랙, Lyria 3.5)과 결정론적 믹서(-14 LUFS/-1 dBTP)가 한다. 타이밍·레벨의 원본은 코드 + earshot. 무료 티어 없음, 12월 1일부터 가격 2배. GEMINI_API_KEY 선불 잔액 0 — 충전은 대표만 한다(테스트 전 $5~10 충전 요청).
- 브랜드 학습(고정 층)이 우선이다: 브랜드 아이덴티티·절대 규칙·메모리·룩을 lib/design/identity.ts 모양으로 조직별 저장. 초안(draft)은 생성에 쓰지 않는다. LoRA는 마지막 수단.
- 포지션: 개인 "내 얼굴로 트렌드 포맷의 주인공이 되는 곳", 브랜드 "브랜드만의 AI 미디어 엔진 / 올인원 마케팅 에셋 스튜디오". 범용 생성 도구 방향 기능은 제안하지 않는다.
- 음악: YuE2·SheetSage2는 CC BY-NC라 브랜드 납품 불가. Hunyuan 계열 라이선스는 한국 제외. MMAudio·ThinkSound 비상업. 상업 가능 오픈: Qwen-Image/Edit, SeedVR2, ACE-Step 1.5(MIT), Wan 2.2, FLUX.2 klein.
- 저장소 이름 변경·파일 이동(lib/cookies→credits, lib/twings→pricing, .gitignore 정리, 참조 0 파일 삭제)은 worktree 59개 정리 뒤 한 PR로, 대표 결정 뒤에만.

## 4. 절대 규칙 (어기면 반려)
- 결제 로직·가격·약관(lib/legal/documents.ts)·RENDER_PIPELINE_PUBLIC·렌더 파이프라인(lib/renders/*)·얼굴 검증(lib/identity/*, lib/ark/*)은 건드리지 않는다. 얼굴 검증·제공사 검수를 우회하는 코드는 어떤 이유로도 쓰지 않는다.
- 문안은 전부 messages/ko.ts·en.ts(하드코딩 금지, tests/i18n/dictionary.test.ts). 한국어는 창업자 톤(AGENTS §5), 새 페이지 문구는 로컬 Gemma(http://127.0.0.1:11434, yagi-crm-gemma4:31b-q8_0)에게 맥락을 주고 받은 뒤 사실만 네가 검수한다.
- 공개 페이지에 엔진·경쟁사·클라이언트 실명 비노출("글로벌 AI 플랫폼"만 허용). AI 생성 배지 없음. 빨강 금지, 블루 하나(#3875C5). 실적 숫자는 영상 9편·200만 뷰+·파생 콘텐츠 300건+만.
- 관리자 동작은 lib/admin/operations.ts 레지스트리 + /admin/do로만. 레지스트리에는 새 파일 import 한 줄 + 스프레드 한 줄만 보탠다.
- 새 (app) 경로는 lib/i18n/config.ts APP_PREFIXES, 새 brand 경로는 lib/routing/surfaces.ts isBrandPath·brandRouteAllowed + components/brand-workspace/navigation.tsx + lib/brands/workspace/selection.ts + scripts/sweep-anon.ts에 등록.
- 운영 데이터는 읽기만. 행 삭제·수정은 대표 지시가 있을 때만, 감사 기록이 남는 경로(관리자 오퍼레이션)로. 로컬 스크린샷에 운영 고객 데이터를 넣지 않는다(로컬 픽스처만).
- 유료 API(Gemini·Ark·Kling·OpenAI·Higgsfield·Morphic)는 테스트 목적이라도 대표 승인 뒤에만 호출한다. 새 결제·충전은 하지 않는다.
- 비밀값은 채팅·코드·로그·커밋에 옮기지 않는다. 스크립트는 존재 여부만 출력한다.
- 대표 결정 항목(§8)은 임의로 정하지 않고 PR 본문 "대표 결정 필요"에 질문으로 남긴다.

## 5. 작업 순서 (하나씩, 각자 PR)
A. 상태 확인: git fetch; node scripts/gh-pr.mjs checks 176·177·178; claude/admin-overhaul-28f6ca에 새 커밋이 붙는지. 대표가 병합·적용을 지시하면 §2 병합 런북 1~5를 그 순서대로 한다(한 번에 하나, 각 단계 결과를 보고). 지시가 없으면 병합하지 않고 B로 간다(B는 #176 위에서 시작할 수 있다).
B. S2 고정 층 — BRAND-PRODUCT §5 그대로:
   - worktree는 #176 위에서: git worktree add D:\dev\.worktrees\twings\brand-identity -b codex/brand-identity-layer origin/claude/brand-entitlements (PR base도 claude/brand-entitlements; #176이 main에 병합되면 node scripts/gh-pr.mjs retarget <번호> main).
   - 마이그레이션 0075_core_brand_identity.sql + 0151_glue_brand_identity.sql(0150 모양: RLS 강제·서버 롤만): brand_identities(organization_id pk, version, identity jsonb, status draft|confirmed, revision≥1, updated_by, updated_at), brand_identity_events, brand_memory_events(kind approved_cut|fix|banned_phrase|saved_look|note, payload jsonb), brand_looks(title, lut_key, measurements jsonb, intensity, skin_protect, source preset|reference_match). tests/db/migrations.test.ts 표 목록과 tests/brands/workspace-security.test.ts(glue 적용·개수 26→30) 갱신.
   - zod 스키마 lib/brands/identity/schema.ts: colour(paper·canvas·sky·ink·body·muted·line·lineStrong·accent) + contrast() 재사용 대비 검사(흰 글자/accent ≥ 4.5), type, world(hue band), modelRoles(엔진 id, 공개 비노출), rules(logo{minSizePx, clearSpace, placement[]}, forbiddenTerms[], paletteOnly, consentedFacesOnly 항상 true, competitorExclusions[], never ≤3), references[](role subject|place|pose|style|palette, lend, not), productChecklist[], voice.
   - 서비스 lib/brands/identity/service.ts: loadBrandIdentity(표 없으면 null, isMissingTable 재사용), saveBrandIdentity(owner 또는 관리자, revision 충돌→conflict, 이벤트), confirmBrandIdentity, draftFromTwingsDefaults, recordMemory/listMemory, saveLook/listLooks. confirmedIdentityFor(orgId)만 엔진이 읽는다(타입으로 드러낸다).
   - 화면 /brand/identity(메뉴 "브랜드", 사전 brandWorkspace.identityLayer.*): 읽기 + owner 편집(app/(brand)/brand/settings/page.tsx의 ActionForm·owner 전용 패턴), "확정" 버튼, 초안 표시. featureDenied(choice.denied,'brand_learning')이면 notFound(). sectionVisibility에 identity 추가, 경로 등록 4곳(§4). 관리자 조직 페이지에 "아이덴티티" 패널(초안 만들기·JSON 보기·확정) + lib/admin/brand-engine-operations.ts에 brandEngine.identityDraft·identityConfirm.
   - 테스트 tests/brands/identity.test.ts(대비 검사, 권한, revision 충돌, draft는 엔진이 못 읽음, 메모리·룩), 사전 ko·en.
   - 완료: 검증 루프 전부 + 스크린샷(docs/evidence/brand-identity/, 1440·390, ko·en, 로컬 픽스처) + PR 본문 "클라우드 적용 필요: 0075·0151(배포 전)".
C. S3 얼굴 없는 생성·촬영 지시서 — BRAND-PRODUCT §8·§9 P0: 레시피 슬롯 person|product|scene|look|mask(person 슬롯이 있을 때만 동의·검수 경로, 얼굴 검증은 그대로), 레퍼런스 측정(Video-Creator tools/extract_image.py 40여 지표)→ShotSpec, 모델별 프롬프트 컴파일러(docs/research/brand-product-2026-11-03/knowhow-corpus.md의 문법 7종), draft(480p)→approve→final 상태기계, 절대 규칙 린트. 시작 전에 대표 결정 §8-5(얼굴 없는 생성 허용)를 받는다.
D. 정리 PR(대표 결정 §8-8 뒤): 캠페인 페이지의 프로토타입 레이어 4개(components/brand-workspace/aesthetic-engine·brief-concierge·review-stage·human-handoff, project-detail.tsx L24–28·L201·L318–334에서 렌더)와 app/(brand)/workspace.css 약 1,514줄(L1479–2992) 내리기, 하드코딩 한국어(brief-concierge 764·aesthetic-engine 459·human-handoff 189·review-stage 94·support 72·service-guide 42개)를 사전으로. 근거는 research/repo-brand-surface.md.
E. S4 로컬 GPU 마감 워커(대표 결정 §8-6 뒤): render_jobs.provider='workstation'(0061 방식), 기존 Ollama pull 워커(scripts/campaign-risk-worker.ts·social-verify-worker.ts의 claim/heartbeat/complete) 복제, SeedVR2 업스케일·ffmpeg LUT·Qwen-Image-Edit 부분 수정. GPU 우선순위는 ComfyUI > Qwen > 기타, gpu-arbiter 127.0.0.1:11434 경유, 서비스 재시작은 대표 승인.
F. S5 사운드 디렉터(대표가 Gemini 충전을 결정한 뒤): research/argon-sound-assembly.md의 테스트 5케이스 → 큐·판정 JSON 스키마 → 결정론적 믹서. 기존 클라이언트 lib/images/gemini.ts 재사용.
G. 관리자 (c)(d)(e) — ADMIN 세션은 멈췄으므로 네가 한다. 순서와 범위는 claude/admin-overhaul-28f6ca의 docs/ADMIN.md: (c) 사용자 보기(역할·자격·연동 계정·셀카 수·주문 수, PII 최소 — 범위는 대표 결정), (d) brand-workspace → campaigns → prompts 순으로 공통 패턴(목록·상세·대기열 카드·확인 다이얼로그) 이전, (e) 옛 playbooks 등 잔재 정리(라우트 404/리다이렉트 결정 기록). 관리자 동작은 레지스트리 + /admin/do만, Operate 모드, 빨강 금지, Pretendard·Helvetica Neue. 슬라이스마다 PR 하나, 검증 루프 전부, 스크린샷은 docs/reviews/admin-audit-2026-11-03/ 옆에 after-*로. 병합 순서상 B(S2)보다 먼저 해도 된다 — 대표가 관리자를 먼저 원하면 G를 B 앞에 둔다.
H. 저장소 가독화 2단계(대표 결정 §8-10 뒤): research/repo-legibility.md §3 (d).

## 6. 함정 목록 (이미 겪은 오류, 같은 실수 금지)
- 본 폴더 main이 origin/main보다 수백 커밋 뒤처져 있을 수 있다. 항상 git fetch 뒤 origin/main 기준으로 worktree를 만든다.
- worktree에 node_modules가 없으면 본 폴더 것을 쓴다 → npm ci 먼저. 마이그레이션을 추가했으면 npm run db:local 뒤 rm -rf .next 없이도 build:local이 스냅샷을 다시 만든다(prebuild:local).
- npm run start:local을 멈춘 뒤 3000 포트를 자식 프로세스가 물고 있는 경우가 있다. netstat -ano | findstr :3000 → taskkill /PID <pid> /F /T.
- 3000이 아닌 포트로 스윕하면 NEXT_PUBLIC_APP_URL을 빌드·실행 양쪽에 같은 값으로 줘야 canonical 검사 56개가 통과한다.
- Git Bash에서 NEXT_PUBLIC_*=/images/… 같은 값은 C:/Program Files/Git/… 로 바뀐다. MSYS_NO_PATHCONV=1을 앞에 붙이거나 PowerShell을 쓴다.
- 로컬 모드(dev:free·dev:admin·start:local)는 시작할 때마다 PGlite 스냅샷을 다시 읽어 쓰기가 초기화된다. 교차 계정 흐름을 보려면 픽스처를 .pglite 스냅샷에 넣는다.
- node scripts/gh-pr.mjs create는 PowerShell에서 본문 파일을 D:\…\PR.md 백슬래시 절대경로로 줘야 한다(Git Bash에서 상대경로·슬래시 경로는 실패했다).
- 운영 Supabase는 egress 한도에 걸리면 auth·DB API가 402를 낸다(공개 페이지는 R2 media.twings.app이라 살아 있다). 배포 뒤 심사 계정 로그인으로 auth 상태를 확인한다.
- Gemini API 선불 잔액은 0(402). Higgsfield 잔액도 비어 있다. 미디어 생성 테스트는 Morphic MCP가 1순위이고 그것도 대표 승인 뒤.
- git user.name이 비어 있어 커밋 author가 unknown이다. 설정을 바꾸지 말고 그대로 둔다.
- GitHub의 mergeable 플래그는 틀릴 수 있다. 병합 전 git merge-base와 실제 diff로 확인한다.
- 커밋 메시지 끝에 "Co-Authored-By: <모델명> <noreply@…>" 한 줄, PR 본문 끝에 생성 도구 표시 한 줄을 둔다(저장소 관행).

## 7. 보고 형식 (매 작업 끝)
git rev-parse HEAD · git diff --stat · 실행한 명령과 출력 요약(tsc / vitest 파일·테스트 수 / build / sweep 통과 수) · 건너뛴 검사와 이유 · 남은 위험 · 다음 행동 · PR 번호·프리뷰 URL · "클라우드 적용 필요" 파일 · "대표 결정 필요" 항목. 자기 보고만으로 "완료"라고 하지 않고 diff·해시·테스트 출력을 낸다.

## 8. 대표 결정 필요 (임의로 정하지 않는다 — BRAND-PRODUCT §13)
1 세 금액의 부가세 별도/포함 · 2 플랜 이름·포함 내용·한도·좌석·PD 시간·이월·연간 할인 · 3 결제 경로 순서와 B2B 약관 별지 · 4 Argon 테스트 충전($5~10)과 디렉터 기본 모델, SFX·음악 엔진 계약 · 5 브랜드 레시피의 얼굴 없는 생성 허용, 동의 크리에이터 얼굴 계약 필드 · 6 GPU 마감 워커 운영 범위 · 7 팔레트 ΔE 임계값·검수 라운드 상한 · 8 프로토타입 레이어 철거 시점, 사이드바 "YAGI STUDIO" 표기 · 9 가격 공개 시점·셀프서브 조건 · 10 이름 유산 정리 시기, 레거시 playbook CMS·Stripe 잔재 제거 · 11 음악 라이선스 해결 방식.
```
