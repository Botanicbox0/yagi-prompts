## AI 크리에이티브 — 프로필·대표 작업·회원 전용 레시피·셀프 공개·MCP (docs/PLATFORM-2.0.md §20)

대표 요청(2026-10-28): 메이커 컬렉션 페이지를 디자인·감도로 일하는 AI 크리에이티브가 자기를 소개하고 템플릿을 파는 곳으로. SNS 댓글 → DM → 외부 튜토리얼 블로그로 흘러가던 "만드는 법"을 TWINGS 안으로. 결제·가격·약관 코드는 건드리지 않았다.

### 바뀐 것
- **호칭** "메이커" → **"AI 크리에이티브" / "AI creative"**(컬렉션 "AI 크리에이티브 컬렉션" / "By AI Creatives", 작업 공간 "크리에이티브 스튜디오"). `KO_TERMS`·`EN_TERMS`만 바꿨고 DB·코드·URL 식별자는 그대로. "커뮤니티"는 요청·후기 공간과 옛 UGC를 가리켜 유료 검증 템플릿을 아마추어처럼 읽히게 해서 택하지 않았다(§20.1).
- **프로필(0065)**: 이름·한 줄 소개·작업하는 나라/도시·링크 6개(플랫폼 자동 인식)·공개 이메일(HTML에 글자/`mailto` 없이 버튼으로만)·작업 도구·브랜드 협업 가능·프로필 사진. 공개를 켰을 때만 보인다.
- **대표 작업**: 이미지·짧은 영상 12개, 순서·제목·설명·원본 링크. 메타데이터 제거 재인코딩, 비공개 버킷 → `/creative-media/…`(공개 프로필일 때만, 엣지 캐시, Range 응답).
- **공개 페이지** `/{locale}/makers/{handle}`: 아이덴티티 히어로 → 소개·도구·링크 → 대표 작업(메이슨리 + 전체 화면) → 템플릿. `ProfilePage/Person` JSON-LD. 짧은 주소 **`twings.app/@handle`**.
- **템플릿 페이지**: 크리에이티브 카드(사진·이름·장소·한 줄 소개·협업 가능) + "@handle의 다른 템플릿".
- **레시피 = 회원 전용**: 정적 HTML에는 개요만(도입 글, 단계·엔진·필요한 재료, 소스 파일 수, 잠긴 줄). 로그인 회원은 `/api/recipes/{id}`로 프롬프트(복사)·단계 팁·마무리 글·소스 파일 보기/내려받기. 소스 파일 게이트웨이도 회원 전용으로 바꿨다. 열람은 `recipe_unlocks`에 (템플릿, 회원) 단위로 세어 스튜디오에 숫자만 보여 준다.
- **레시피 노트**(표시 전용): `notes.intro`·`steps[].note`·`notes.outro` — Higgsfield 블로그식 튜토리얼을 그대로 받는다. 편집기·JSON 가져오기/내보내기 지원.
- **셀프 공개(대표 지시 "스튜디오 승인 없이 올릴 수 있게, 일단은")**: 레시피 검사 + 권리 확인 + 예시 파일 + **내 사진 테스트 렌더 1회 성공**이면 크리에이티브가 바로 공개. 가격은 기준가(5%) + 로열티 자동. 스튜디오는 사후 보관으로 내린다. `TWINGS_MAKER_SELF_PUBLISH=off`면 기존 검수 경로로 복귀.
- **TWINGS MCP** `POST /api/mcp`(Streamable HTTP, JSON): 개인 토큰 `twk_…`(SHA-256만 저장, 5개, 폐기), 도구 16개(가이드·검증·초안·파일·테스트 렌더·공개·검수 제출·프로필·대표 작업·통계). URL 가져오기는 SSRF 울타리(공인 주소만, 소켓 DNS에서 검사). 스튜디오에 Claude Code·Cursor·Codex 연결 문구.

### 검증 (worktree `D:\dev\.worktrees\twings\creative-profile`)
| 단계 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run` | **337 파일 / 3,209 테스트 통과** (신규: 필드·SSRF, 프로필·작업·토큰·MCP(Postgres), 셀프 공개, 회원 레시피·짧은 주소·MCP 라우트, 공개 HTML에 프롬프트·팁·파일 주소 없음 카나리) |
| `npm run build:local` | 통과 |
| `npm run start:local` + `npm run sweep:anon` | **SWEEP PASSED 1195/1195** (신규 체크: 크리에이티브 페이지·이메일 비노출·`/@handle`·회원 전용 레시피 401·MCP 401/405·미디어 공개 캐시) |
| 브라우저(로컬 dev:pro) | 회원 레시피 열림, 스튜디오 3패널, 토큰 발급 → 실제 `/api/mcp` initialize·tools/list·whoami·list_works → 폐기 후 401, 모바일 375 가로 넘침 0 |
| Gemma 4 워딩 | 신규 한국어 문구 1회 패스 반영(통계 문장은 사실과 달라 제외) |

스크린샷: 이 폴더 `01`~`06`(값은 모두 로컬 TEST 픽스처).

### 클라우드 적용 필요 (코드 배포 전, 대표 또는 Director)
- `supabase/migrations/0065_core_creative_profiles.sql` + `0145_glue_creative_profiles.sql`. 없어도 코드는 이전처럼 동작한다(프로브). `claude/account-deletion` 브랜치가 0064/0144를 쓰고 있어 번호를 건너뛰었다.

### 대표 결정 필요
1. 개인정보처리방침에 "크리에이티브가 고른 프로필 항목·작업물 공개" 문구 추가(§18.1 남은 항목과 합침).
2. `TWINGS_FORMAT_CREATORS`를 켜 첫 크리에이티브를 받을 시점(지금 운영 off — 스튜디오·MCP·셀프 공개 모두 그 뒤에 있다).
3. 레시피가 로그인 뒤로 가면 `lens-portal-tutu` IG DM 퍼널도 로그인을 거친다. 캡션·DM 문안을 "로그인하면 바로 볼 수 있어요"로 맞출지.
4. 셀프 공개 유지 기간("일단은") — 끄려면 `TWINGS_MAKER_SELF_PUBLISH=off`.

### 남은 위험
- 셀프 공개 템플릿은 사람이 보기 전에 카탈로그에 뜬다. 판매 개방은 여전히 `storefrontOpen()`이 정하므로 결제 범위는 그대로지만, 부적절한 예시 이미지는 사후 보관으로만 막는다.
- `next.config`가 `/api/*` 전체를 `private, no-store`로 고정해 기존 `/api/prompts/media`도 캐시되지 않는다. 이번 미디어는 `/creative-media/…`로 우회했고, 전역 규칙은 건드리지 않았다.
- AGENTS.md §6 표 5행의 "메이커" 표기는 원본(PLATFORM-2.0 §20.1)을 따라 갱신이 필요하다 — 메인 체크아웃에 커밋 안 된 AGENTS.md 변경이 있어 이 PR에서는 손대지 않았다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
