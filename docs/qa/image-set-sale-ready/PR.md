# feat(renders): 이미지 세트 판매 준비 — Seedream 셀카 Base64 경로 + 결과·공유·메일에 N장 모두

PR #103(웨딩 화보 5컷 세트 등록)의 "판매 전 막힌 것" 1·2를 푼다. 대표 지시(2026-10-28): "Seedream 셀카 Base64 경로 + 실측 스모크 준비, 결과 페이지·메일·공유에 5장 표시. main에서 새 브랜치로." #103과 독립적으로 병합할 수 있다. 두 PR이 같이 고친 파일은 `tests/routes/cache-contract.test.ts` 하나이고 변경 내용이 같다.

## 무엇이 바뀌나

| 영역 | 내용 |
| --- | --- |
| 셀카 → Seedream (`lib/identity/service.ts` `needsIdentity`, `lib/recipes/schema.ts` `identityPath`) | ModelArk 중 **영상(Seedance)만** 자산 라이브러리 `asset://`를 쓴다. **Seedream 이미지는 셀카 바이트를 Base64 data URL로 직접** 보낸다. Seedream 이미지 API는 `asset://`를 `invalid url`로 거절한다(2026-09-22 실측, `c8e06ca`). 그래서 지금 main에서는 Seedream 얼굴 템플릿이 결제 후 첫 컷에서 실패한다. 단일 프롬프트 경로와 레시피(세트) 경로 둘 다 같은 규칙을 따른다. 두 규칙이 같은지는 테스트로 고정했다. |
| 검수 | 우회 없음. Seedream 자체 검수가 그대로 돌고, 얼굴 거절(`InputImageSensitiveContentDetected`)은 `face_policy:{step}`으로 실패·환불된다(테스트). 어댑터는 `asset://`가 Seedream으로 가려 하면 유료 호출 전에 막는다. OpenAI·Gemini·Kling 바이트 경로와 같은 계약이다. |
| 실측 스모크 (`scripts/image-smoke.ts`) | 원래는 `--photo`로 Seedream에 **파일 경로 문자열**을 보내는 버그가 있어 실셀카 측정이 안 됐다. 이제 렌더 패스와 필드 단위로 같은 요청(Base64 data URL, JPEG, b64 응답)을 보낸다. 새 옵션 `--manifest <매니페스트> --frame N`은 그 컷의 프롬프트를 레시피 경로의 `engineStepPrompt`로 만들어, 판매될 때와 똑같은 텍스트로 1장($0.09)을 찍는다. `--dry`는 사진을 크기로만 출력한다. |
| 결과 페이지 `/renders/{id}` | 세트(이미지 레시피 2장 이상)는 `render_job_outputs` N장을 **가로 스와이프 띠**로 보여준다. 장 크기는 기존 결과와 같은 높이 규칙이고, 다음 장이 가장자리에 보인다. 장마다 `n/N ↓` 저장 링크가 붙는다. 주 버튼은 **"5장 모두 저장"**이다. 휴대폰은 공유 시트("이미지 5개 저장")로 한 번에, 그 밖에는 장별 다운로드로 저장한다. 스크립트가 없으면 1번 다운로드 링크로 동작한다. 메타는 "사진 5장 · 3:4". 한 장짜리 결과는 지금과 같다. |
| 공유 페이지 `/r/{id}/{token}` | 같은 띠와 "5장 모두 저장". 모든 장이 같은 3일 토큰 뒤에 있다. 공유 카드(OG)는 1번 장. |
| 완성 메일 | 1번 장은 크게, 나머지는 한 줄 썸네일로 보여준다. 모두 같은 3일 링크로 열리고, 메타는 "사진 5장". |
| 게이트웨이 `GET /api/renders/media/{id}?frame=N` | N=1~6. 결과와 **같은 문**을 쓴다(소유자 세션 또는 그 렌더의 3일 토큰). 다른 렌더의 토큰, 없는 장, `frame`+`poster`는 404다. 응답은 `private, no-store`, 저장 파일명은 `twings-{slug}-{id8}-{N}.jpg`. |
| 문서 | PLATFORM-2.0 §9 단가표의 Seedream 경로, §18.1 진행 기록, TEMPLATES-IA §8.2 정정. |

## 판매를 열기 전 남은 것 (대표)

1. **실셀카 스모크 1장**. 본인 셀카로 아래 명령을 돌린다($0.09, `.env.local`의 `ARK_API_KEY` 사용, 키 값은 출력하지 않음).
   - 결과가 `tmp/`에 저장되면 얼굴 유지를 눈으로 본다.
   - `InputImageSensitiveContentDetected`가 나오면 Seedream은 고객 셀카를 받지 않는 것이다. 그때는 이 세트를 판매하지 않고 엔진을 정해야 한다(대표 결정).
   ```bash
   npm run image:smoke -- --engine seedream-5.0-pro --ratio 3:4 --photo <본인 셀카.jpg> --manifest "D:/dev/Video-Creator/projects/2026-10-27-bridal-5shots-reverse/final_5shots_seedream/twings_templates_manifest.json" --frame 2
   ```
2. 스모크가 통과하면 #103 병합 → 운영 등록(`templates:import --target cloud --apply`) → `/admin`에서 가격 설정(제안 4,900원 / $3.49, 대표 결정).
3. 예시 이미지 속 인물을 공개해도 되는지 확인(#103).

## 검증 (worktree `claude/image-set-sale-ready`, 로컬)

| 명령 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | ✓ |
| `npx vitest run` | **332 파일 / 3,161 테스트 통과**. 새 테스트: Seedream 캐러셀이 셀카를 data URL로 보내고 자산 그룹을 만들지 않음, Seedream 얼굴 거절은 `face_policy:f1`, 게이트웨이 `?frame=N`의 토큰 범위·404, 결과·공유 페이지 N장, 메일 썸네일, 완성 알림에 N장 전달 |
| `npm run build:local` | ✓ |
| `npm run start:local` + `npm run sweep:anon` | **1,151 / 1,153**. 실패 2개는 main의 기존 문제다(`05bab0d`가 `/brands/stories/morphic` 문구를 지웠는데 스윕 기대값이 남아 있음). #103과 같다 |
| 스모크 드라이런 | `--manifest … --frame 2 --dry`: 프롬프트가 매니페스트 원문에 공통 얼굴 유지 한 줄을 더한 것과 같다(1,413자). 사진은 `<image/jpeg base64, N chars>`로만 표시 |
| 브라우저(로컬 QA 스냅샷, 가짜 Seedream으로 실제 렌더 패스 1회, 5장) | 모바일 375: 1번이 크게 보이고 2번이 가장자리에 보인다. "5장 모두 저장·공유·하나 더"가 첫 화면 안에 있고 5장 모두 로드(888×1184), 가로 넘침 없음. 저장 버튼은 1~5번을 순서대로 `-1.jpg`~`-5.jpg`로 저장(클릭 가로채 확인, 실제 다운로드 없음). 공유 페이지도 같다. 데스크톱 1024×768: 버튼 줄이 첫 화면 안에 있다 |

**검증하지 못한 것**:
- 실제 휴대폰의 공유 시트 경로("이미지 5개 저장"). 브라우저 창에는 `navigator.canShare`가 없어서 PC 경로만 확인했다.
- 실제 Seedream 호출. 위 1번이 그 검증이다.
- 클라우드 스토리지 서명 URL을 공유 시트용으로 `fetch`할 때의 CORS. 막히면 장별 다운로드로 넘어간다.

마이그레이션 없음.
