# feat(catalog): 오리지널/메이커 컬렉션·메이커 프로필·호칭 교체 (R3)

PLATFORM-2.0 §7.5·§14.1, 대표 결정 2026-10-24 — 객체마다 이름 하나. 템플릿 공급자는 **메이커**(정식 "템플릿 메이커"), 캠페인 참여자는 **크리에이터**, 일반 사용자는 역할 호칭 없이 문장에서 "나/내"로 쓰고 부를 때는 "회원님"이라 한다. 헤더 전환 스위치는 **"개인 | 브랜드"**(서비스 구분 라벨로만), 카탈로그 묶음은 **"TWINGS 오리지널" / "메이커 컬렉션"**, 카드 크레딧은 한국어도 **"by @핸들"**이다.

- 커밋: `770b62b`(기능) → `654e6ad`(PR 본문) → 호칭 단일 키 커밋(이 본문과 같은 커밋, PR 커밋 목록 참조)
- 브랜치: `claude/catalog-makers-5d3300`, base `main` @ `488f302`
- **클라우드 적용 필요: `0060_core_maker_profiles.sql` + `0143_glue_maker_profiles.sql`** (아래 §4). 적용 전에도 코드는 그대로 동작한다. 그때는 메이커 크레딧과 프로필이 보이지 않는다.

## 1. 바뀐 것

### 호칭은 언어별 한 객체 (`KO_TERMS` / `EN_TERMS`)
`messages/ko.ts`·`messages/en.ts` 맨 위의 terms 객체가 호칭을 적는 **유일한 자리**다. 다른 문장은 모두 template literal로 이 값을 조립한다. 호칭이 바뀌면 이 객체만 고친다.

| 키 | ko | en |
| --- | --- | --- |
| `maker`(짧은 말, `MAKER` 상수) | 메이커 | maker / makers |
| `makerFull`(역할 설명 자리) | 템플릿 메이커 | template maker(s) |
| `makerProgram` · `makerStudio` | 메이커 프로그램 · 메이커 스튜디오 | Maker Program · Maker Studio |
| `studioCollection` · `makerCollection` | TWINGS 오리지널 · 메이커 컬렉션 | TWINGS Originals · Maker Collection |
| `creditPrefix` | by | by |
| `personal`(헤더 스위치 전용) | 개인 | Personal |

실제로 손댈 값은 ko 4개(`MAKER`, `studioCollection`, `creditPrefix`, `personal`), en 5개(`MAKER`, `MAKERS`, `studioCollection`, `creditPrefix`, `personal`)다. 나머지는 `MAKER`에서 파생된다. ko 주의: 받침이 생기는 말로 바꾸면 조사(가/이, 를/을, 와/과, 로/으로)가 붙은 문장도 확인해야 한다(주석에 적어 둠). 테스트와 스윕은 문자열을 반복하지 않고 이 값을 읽는다. 확정값 자체를 적은 곳은 `tests/i18n/dictionary.test.ts`의 한 줄뿐이다.

### 호칭 교체 (사전만)
- ko: "포맷 작가" → 템플릿 메이커, "작가" → 메이커. 사전의 ko 값에 "작가"는 0건이다(테스트로 고정).
- en: "format creator(s)" → template maker(s), 메이커 프로그램 블록 안의 공급자 뜻 "creator" → maker. 캠페인 뜻 "creator"는 그대로다.
- 페이지 제목: 프로그램 소개 **"메이커 프로그램"**(Maker Program), 지원서·CTA **"메이커 지원하기"**(Apply as Maker), 작업공간 **"메이커 스튜디오"**(Maker Studio), 정산 표 **"정산 현황"**(Earnings). "메이커 공간"을 가리키던 문장도 모두 "메이커 스튜디오"로 바꿨다.
- 브랜드 마법사 포맷 선택지: "포맷 작가의 포맷" → 메이커 컬렉션. "TWINGS 오리지널"도 같은 키를 쓴다.
- 크레딧: 카드·템플릿 페이지 모두 `by @{handle}`. 스튜디오 템플릿은 "TWINGS 오리지널", 공개 핸들이 없는 메이커 템플릿은 "메이커 템플릿"으로 표시한다.
- 헤더 전환 pill: 새 키 `audience.personal`. `audience.creator`("크리에이터")는 `/campaigns` 눈썹 문구가 계속 쓴다(캠페인 뜻).
- 계정 메뉴 이름 대체값 `creatorProfile.fallbackName`: "크리에이터" → **"회원님"**(en "Member"). 사용자를 부를 때의 결정을 따랐다.
- DB·코드 식별자(`platform_creators`, `creatorProgram`, `Audience = 'creator'`, `data-audience="creator"`)는 바꾸지 않았다(§14.1).

### 메이커 공개 핸들 (0060)
- `platform_creators.handle text unique`(`^[a-z0-9_]{3,20}$`), `public_profile boolean not null default false`, `bio text`(1~200자), "공개하려면 핸들 필요" 제약.
- 트리거 두 개가 `prompt_items.author_handle`을 DB에서 맞춘다. 메이커 템플릿(`source='yagi'` + `author_id`, `audience='public'`)의 핸들은 **메이커가 활성 상태이고 공개를 켰을 때만** 채워진다. 끄거나 권한이 해제되면 null이 된다. 어느 경로가 행을 쓰든(수락 단계, 관리자 편집기, 백필) 같다. 레거시 커뮤니티 행은 건드리지 않는다.
- 메이커 스튜디오(`/creators/workspace`, 승인 상태)에 "공개 프로필" 패널: 핸들·소개·공개 체크, 서버 액션(`profile-actions.ts`)이 처리한다. 세션 사용자만 저장할 수 있고 `TWINGS_FORMAT_CREATORS` 게이트를 따른다. 모든 필드는 서버에서 다시 검증하고, 리디렉트 URL에는 결과 코드만 싣는다. 예약 핸들(`twings`, `yagi`, `admin`, `studio`, `official` …)은 막는다. JS 없이도 동작한다.
- `lib/creator-platform/{service,admin}.ts` 로직, `lib/recipes/*`, `lib/renders/*`는 건드리지 않았다(R1 범위).

### 카탈로그 분리
- `PromptCard.origin: 'studio' | 'maker'`: `source==='community' || author_id !== null`이면 maker. `PromptCard.makerProfile`은 공개 메이커 페이지가 있는지를 뜻한다. `PromptCatalog.makers`에는 `{ handle, bio, templateCount, latestPublishedAt }`만 담긴다. **공개 DTO에 `author_id`·user id·이메일은 없다**(캐너리 테스트). 캐시 키 `v4-price-5pct` → `v5-maker-origin`.
- `/video`·`/image`: "TWINGS 오리지널" 레일 → "메이커 컬렉션" 레일, 칩 "전체 · 오리지널 · 메이커"(정적 페이지 그대로, DOM 위 클라이언트 필터, `data-origin-filter`). **메이커 템플릿이 0편이면 둘째 레일·칩·레일 제목이 모두 나오지 않고 지금 화면과 같다.** 칩은 두 출처가 다 있을 때만 나온다.
- 홈: 영상·이미지 레일은 오리지널만 보여 주고, 메이커 템플릿이 있으면 그 뒤에 "메이커 컬렉션" 레일을 붙인다.
- 카드 크레딧은 PR #83의 조건부 자리(`data-card-author`)를 그대로 쓴다. 판정 기준을 `source`에서 `origin`으로 바꿨다.
- 템플릿 페이지: 크레딧 옆에 "· 검증됨"(`data-template-verified`, 오리지널·메이커 공통, title 속성으로 "스튜디오 검수를 통과한 템플릿입니다"). 메이커 블록(`data-template-maker`: 핸들·소개·"메이커 프로필 보기")은 공개 프로필이 있을 때만 나온다.

### 메이커 프로필 `/{locale}/makers/[handle]`
- 마케팅 라우트, `revalidate = 3600`, 같은 `prompts` 태그 카탈로그를 읽는다. 공개 메이커만 200이고 나머지(비공개, 없는 핸들, 형식 오류)는 진짜 404다. `@jun`·`JUN` 같은 주소는 `/makers/jun`으로 308 리디렉트한다.
- 핸들 · 소개 · "템플릿 N편 · 검증됨" · 2열 4:5 카드 그리드. noindex 없음, canonical + hreflang(ko/en/x-default), OG `profile`(가장 최근 템플릿 포스터 또는 사이트 OG).
- 사이트맵: 공개 메이커 중 템플릿이 1편 이상인 사람만, 두 언어로 넣고 `lastmod`는 최신 템플릿 게시일이다.
- 저장하면 `revalidateMakerProfile([이전 핸들, 새 핸들])`가 `prompts` 태그와 `/video`·`/image`·프로필 경로를 갱신한다.

## 2. 검증 (호칭 단일 키 커밋 기준으로 다시 돌림)

| 명령 | 결과 |
| --- | --- |
| `npm run db:local` | 스냅샷 재생성(13 prompt items + 로컬 메이커 `@jun`) |
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | **317 files / 3,036 tests 통과** |
| `NEXT_PUBLIC_APP_URL=http://localhost:3018 npm run build:local` | 통과(`/[locale]/makers/[handle]` ƒ, `/[locale]/t/[slug]`와 같은 방식) |
| `PORT=3018 npm run start:local` + `SWEEP_BASE_URL=http://localhost:3018 npm run sweep:anon` | **SWEEP PASSED — 1153/1153** |

새·바뀐 테스트:
- `tests/makers/profile.test.ts`: 핸들·소개 검증, 0060 컬럼·제약, 공개 전에는 크레딧 없음(쓰는 쪽이 넘긴 핸들도 무시), 켜면 채워지고 끄거나 권한이 해제되면 null, 유니크(대소문자 포함), 비메이커 거부, DTO 캐너리(user id·이메일·`author_id`·레시피 부재), 레거시 커뮤니티 크레딧 보존.
- `tests/makers/profile-action.test.ts`: 세션 신원, 게이트, 체크박스, 결과 코드만 싣는 리디렉트, 예외 숨김.
- `tests/routes/maker-profile.test.tsx`: 200·404·308, 본인 템플릿만, 2열 그리드, noindex 아님, canonical·hreflang·OG.
- `tests/ui/catalog-cards.test.tsx`: 0편이면 레일·칩 없음, 오리지널 → 메이커 순서, 칩 라벨, 메이커만 있을 때, 크레딧, 프로필 링크 조건. 비교값은 모두 `KO_TERMS`/`EN_TERMS`에서 읽는다.
- `tests/i18n/dictionary.test.ts`: ko 값에 "작가" 없음(이모티콘·웹툰·웹소설·그림 작가 문맥만 허용), en에 "format creator" 없음, 프로그램·스튜디오·레일·마법사·크레딧·헤더가 terms에서 조립되는지, 맨 "개인"은 `audience.personal`에만 쓰이는지, "유저님/개인님" 없음, 대체 이름 "회원님".
- `tests/seo/sitemap.test.ts`: 메이커 페이지 포함(0편은 제외), hreflang. `tests/routes/cache-contract.test.ts`: 프로필 라우트가 정적·태그 카탈로그를 읽는지.
- 스윕 `sweepMakers()`: 헤더 라벨, 레일 순서·칩, "작가" 부재, 계정 id 부재, 메이커 블록·검증됨, 프로필 200/404, 사이트맵. 비교값은 terms에서 읽는다.

**스윕 전제에 대한 메모**: 로컬 스냅샷에는 원래 공개된 커뮤니티 픽스처 3편(skate-park, cafe-window, talking-head)이 있고, 이들은 정의상 maker origin이다. 그래서 로컬 스윕은 메이커 레일이 **있는** 상태를 확인한다. 운영처럼 0편인 상태(레일·칩 없음)는 `tests/ui/catalog-cards.test.tsx`가 고정한다.

## 3. 캡처 (`docs/qa/catalog-makers/`, 로컬 3018, CDP 기기 에뮬레이션, 가로 넘침 없음, 최종 호칭으로 다시 찍음)
1. `01-header-ko-390.png`: 헤더 "개인 | 브랜드"
2. `02-catalog-video-ko-390.png`: 칩 "전체·오리지널·메이커", TWINGS 오리지널 → 메이커 컬렉션, "by @jun"
3. `03-catalog-video-ko-desktop.png`
4. `04-maker-profile-ko-390.png`: `/ko/makers/jun`
5. `05-maker-profile-en-desktop.png`
6. `06-template-maker-block-ko-390.png`: 크레딧 링크 · 검증됨 · 메이커 블록
7. `07-header-en-desktop.png`: "Personal | Brands"

## 4. 클라우드 적용 필요
- `supabase/migrations/0060_core_maker_profiles.sql`: 컬럼 3개, 제약, 트리거 함수 2개. 기존 행은 `public_profile=false`, 핸들 null이라 적용 직후 공개되는 것은 없다.
- `supabase/migrations/0143_glue_maker_profiles.sql`: 두 함수의 `revoke … from public,anon,authenticated`와 `search_path` 고정. `platform_creators`의 deny-all RLS(0131)는 새 컬럼에도 그대로 적용된다.
- 순서: 0060 → 0143. 코드 배포 전에 적용하지 않아도 된다(`makerProfilesReady()`가 컬럼을 확인한다).

## 5. 건너뛴 검사 · 남은 위험
- 운영 DB 확인은 하지 않았다(Supabase MCP 미인증). "운영 메이커 템플릿 0편"은 지시문 전제다.
- 서명된 메이커 계정으로 브라우저에서 폼을 저장해 보지는 않았다. 서버 액션·서비스는 단위 테스트로, 결과 화면은 `workspace-page.test.tsx`로 확인했다.
- 공개 메이커가 예전에 커뮤니티 프롬프트를 올린 적이 있으면, 그 카드도 메이커 핸들로 표시된다(사람 하나에 공개 이름 하나). 로컬 `@jun`의 `cafe-window-timelapse`가 그 예다.
- "검증됨"은 카드에 넣지 않고 템플릿 페이지·메이커 페이지에만 넣었다. 390px 2열 카드의 칩 줄(길이·비율)에 셋째 칩을 넣으면 넘치기 때문이다. 카드에도 필요하면 결정해 주세요.
- "메이커 스튜디오"와 본문의 "스튜디오(TWINGS 운영)"가 한 화면에 같이 나온다(예: "스튜디오가 지원서를 검토하고, 결과를 메이커 스튜디오에서 알려드립니다."). 확정 명칭이라 그대로 두었다.
- 기존 ko 문장 중 "개인 생성 서비스를 준비하고 있습니다."(`studio.closedTitle`, 이번 PR 이전 문구)는 사용자를 부르는 말이 아니라 그대로 두었다.
- 문서: `docs/PLATFORM-2.0.md` §7.1·§7.5·§14 본문은 아직 "작가"이고 프로필 경로를 `/creators/@handle`로 적고 있다. 구현은 지시대로 `/makers/[handle]`이다. §14.1·§18 절은 Director가 main에 넣을 예정이라 손대지 않았다.

## 6. 대표 승인 필요 문안
약관(`lib/legal/documents.ts`)에는 "작가"나 템플릿 공급자 표현이 없다. "크리에이터"는 캠페인 참여자 뜻으로만 쓰여 이번 결정과 맞으므로 약관 본문은 고치지 않았다. 아래는 새로 쓰거나 뜻이 바뀐 공개·메이커 대상 문구다.
- 헤더: **"개인 | 브랜드"** / "Personal | Brands"
- 레일: **"TWINGS 오리지널"**(스튜디오가 직접 만든 템플릿입니다.) / **"메이커 컬렉션"**(템플릿 메이커가 만들고 스튜디오 검수를 거친 템플릿입니다.) · 칩 "전체 · 오리지널 · 메이커"
- 크레딧·배지: "by @handle", "메이커 템플릿"(공개 핸들이 없을 때), **"검증됨"**(스튜디오 검수를 통과한 템플릿입니다.)
- 메이커 페이지: "템플릿 메이커", "템플릿 N편", "공개한 템플릿", "아직 공개한 템플릿이 없습니다."
- 메이커 스튜디오 "공개 프로필": 『프로필을 공개하면 템플릿 카드와 템플릿 페이지에 "by @핸들"이 표시되고, 핸들·소개·공개 템플릿을 모은 메이커 페이지가 생깁니다. 끄면 이 표시가 모두 사라집니다.』 / 『핸들과 소개만 공개됩니다. 이름·연락처·계약 조건은 공개되지 않습니다.』. 개인정보처리방침에 "메이커 핸들·소개의 공개"를 넣을지는 대표가 판단해 주세요. 지금은 메이커 본인이 켜는 선택 공개다.
- 계정 메뉴 대체 이름 "회원님" / "Member"
- 질문: 관리자 허브 설명 `adminWorkflow.descriptions.community` "Review creator posts and reports."(en)는 보상 게시 확인과 메이커 요청이 섞인 문맥이라 그대로 두었다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
