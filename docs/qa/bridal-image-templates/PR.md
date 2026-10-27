# feat(templates): 웨딩 화보 5컷 세트 — 이미지 세트 템플릿 등록 경로

Video-Creator `projects/2026-10-27-bridal-5shots-reverse/final_5shots_seedream/twings_templates_manifest.json`(대표 검수 완료 5컷)을 **템플릿 하나**로 등록한다. 대표 지시(2026-10-27): "모든 이미지가 하나의 세트로", 썸네일은 02(통창 역광 크라우칭), 제목은 후킹하게. 운영 DB에는 이미지 템플릿이 아직 0개다(2026-10-27 읽기 전용 조회) — 첫 이미지 템플릿이다.

| 항목 | 값 |
| --- | --- |
| slug | `bridal-editorial-5-shots` (`content/templates/bridal-editorial-5.json`) |
| 제목 | ko "셀카 한 장으로 찍는 웨딩 화보 5컷" · en "Five Bridal Editorial Shots From One Selfie" (`/admin`에서 바꿀 수 있음) |
| 결과 | 한 번 주문 → 이미지 5장, Seedream 5.0 Pro 2K, 3:4 |
| 썸네일 | `02_window_crouch_vine_seedream_2k.png` |
| 가격 | 0 = **판매 전**("준비 중"). 가격은 대표 결정 — 아래 "판매 전 막힌 것" 해결 뒤 `/admin`에서 |

## 무엇이 바뀌나

| 영역 | 내용 |
| --- | --- |
| 세트 등록 `lib/prompts/image-templates.ts` | 매니페스트 + 세트 파일(slug·제목·썸네일) → **레시피 v2 캐러셀** 하나(`shot1`~`shot5`, 각 단계 = 셀카 한 장 입력, `seedream-5.0-pro`, 3:4). 매니페스트가 사진을 부르는 말 "Image 1"을 `{{selfie}}`로 바꿔 저장하고, 렌더 시 `engineStepPrompt`가 다시 "Image 1"로 돌린다 → 엔진은 **매니페스트 원문 그대로** + 레시피 경로 공통의 얼굴 유지 한 줄("Image 1 shows the person to feature. Keep their identity, face and features exactly as photographed.")을 받는다. 피부 관련 단어 추가·축약 없음. 쓰기 전에 다섯 컷 모두 이 왕복을 검증하고, 저장 후 레시피를 다시 읽어 비교한다. 모델 id `seedream_v5_pro`→`seedream-5.0-pro`, `2k`만, 이미지 비율 표만, 한 세트는 같은 엔진·같은 비율, 2~6컷. 하나라도 틀리면 전체 거부. 이미 있는 slug는 건드리지 않음. 행과 레시피는 한 트랜잭션. |
| 미디어 `gallery` | `prompt_items.media.gallery` = 세트의 예시 컷(순서대로, 최대 6). 공개 자산이지만 **템플릿 페이지에만** 쓰고 카드에는 없음. `publishPromptMedia`가 갤러리도 발행·보존 → `/admin`에서 가격을 넣으며 저장해도 갤러리가 사라지지 않는다(테스트). 공개 사본이 없는 프레임은 내보내지 않음. |
| 템플릿 페이지 | 갤러리가 2장 이상이면 헤더 아래 `data-template-gallery` 섹션("한 번에 받는 5컷", 2/3/5열), 결과물 사실이 "이미지 5장". 카드의 `gallery`는 선택 필드 — 이 배포 전 캐시된 카탈로그(태그 `prompts`)에는 없으므로 페이지가 없을 때를 견딘다. |
| CLI `npm run templates:import -- <manifest.json> --set <set.json> [--target local\|cloud] [--apply]` | `--apply` 없으면 검증·이미지 인코딩·계획만. `local` = `.pglite/catalog.tar.gz`+`.storage/`, `cloud` = `.env.local`의 `DATABASE_URL`+Supabase 스토리지. 이미지: 원본 2K PNG(약 6MB) → **같은 해상도 1760×2352 WebP q88(248~489KB)**. 비율이 2% 넘게 어긋나면 거부. |
| 모델 칩 어휘 | `seedream-5.0-pro` 추가 — 없으면 `/admin` 저장 시 모델이 기본값 SEEDANCE 2.5로 바뀐다. |
| 스윕·픽스처 | 이미지 픽스처(`static-portrait-window-light`)에 2컷 갤러리. 스윕: 상세에 `data-template-gallery="2"`·2번째 프레임·"2 images", 이미지 탭과 단일 템플릿 상세에는 세트 섹션 없음. |
| 테스트 정리 | `tests/routes/cache-contract.test.ts`가 git에 없는 빈 폴더 `components/ad`를 읽다가 새 체크아웃(worktree·CI)에서 ENOENT — 없으면 건너뛴다. |

## 판매 전 막힌 것 (대표 결정·후속)

1·2는 다음 PR에서 고친다(대표 2026-10-27: "판매 준비 수정은 다음 PR로"). 이 PR은 가격 0으로 등록만 하므로 병합해도 결제 경로가 열리지 않는다.

1. **Seedream 이미지에 고객 셀카가 들어가는 길이 검증되지 않았다.** 렌더 패스는 ModelArk 엔진(Seedream 포함)에 셀카를 자산 라이브러리 `asset://`로만 보낸다(`needsIdentity`, 레시피도 같음). 2026-09-22 실측에서 Seedream Pro 이미지 API는 `asset://`를 `invalid url`로 거절했다(`c8e06ca`, `lib/images/seedream.ts`, TEMPLATES-IA §7). Base64 직접 전송은 합성 도형으로만 HTTP 200 확인, 실제 얼굴 미검증. 지금 가격을 넣으면 결제 → 첫 컷에서 실패 → 환불로 끝날 가능성이 높다. 필요: Seedream 이미지 단계의 셀카를 Base64 + 제공사 기본 검수로 보내는 경로(검수 우회 아님) + 대표 본인 셀카 실측(`npm run image:smoke -- --engine seedream-5.0-pro --ratio 3:4 --photo <셀카>`).
2. **결과 페이지가 첫 장만 보여준다.** 캐러셀은 `render_job_outputs`에 5장을 남기지만 `/renders/{id}`·완료 메일·공유 링크는 `result_key`(첫 장)만 쓴다. 나머지 장은 메이커 편집기·검수 패널의 `/api/makers/renders/{id}/{n}` 링크로만 열린다(소유자 접근은 이미 허용). 판매 전에 결과 페이지에 5장 + 장별 저장.
3. 예시 이미지 속 인물이 공개해도 되는 얼굴인지(레퍼런스 출처) 대표 확인.

## 운영 등록 (병합·배포 뒤, 대표 또는 Director)

```bash
npm run templates:import -- "D:/dev/Video-Creator/projects/2026-10-27-bridal-5shots-reverse/final_5shots_seedream/twings_templates_manifest.json" --set content/templates/bridal-editorial-5.json --target cloud --apply
```

먼저 `--apply` 없이 돌려 계획을 본다. 등록 뒤 카탈로그 캐시(태그 `prompts`)는 1시간 안에, 또는 `/admin` 템플릿 동작 한 번으로 갱신된다. 이 PR이 캐시 키를 `v9-set-gallery`로 올리므로 배포 직후엔 새로 읽는다. 마이그레이션 없음(0059 레시피 표는 운영 적용됨).

## 검증 (worktree `claude/bridal-image-templates`, 로컬)

| 명령 | 결과 |
| --- | --- |
| `npm ci` → `npm run db:local` → `templates:import … --target local --apply` | 세트 1개 생성, 재실행 시 `exists`(그대로 둠) |
| 실제 매니페스트 드라이런 | 5컷 모두 "엔진이 받는 프롬프트 = 매니페스트 원문 + 공통 얼굴 유지 줄" 왕복 검증 통과, 이미지 1760×2352 WebP 248~489KB |
| `npx tsc --noEmit` | ✓ |
| `npx vitest run` | **332 파일 / 3,160 테스트 통과** (새 `tests/prompts/image-templates.test.ts` 10개 포함) |
| `npm run build:local` | ✓ |
| `npm run start:local` + `npm run sweep:anon` | **1,156 / 1,158** — 새 세트 체크 5개 통과. 실패 2개는 이 PR과 무관한 main의 기존 문제: `/brands/stories/morphic`의 "전환율은 별도로 집계하지 않았습니다"/"conversion" 문구를 `05bab0d`가 지웠는데 스윕 기대값이 남아 있다 |
| 직접 확인 | `/ko·en/image`: 세트 카드 1장(썸네일 02), 컷별 카드 0. `/ko·en/t/bridal-editorial-5-shots`: 제목, "준비 중", 결과물 "이미지 5장"·3:4, 갤러리 5컷(로컬은 `/api/prompts/media/{id}:gallery-N` → 200 image/webp). 프롬프트 원문·`{{selfie}}`·`@image1` 노출 0. 모바일 375px 2열, 가로 넘침 없음 |
