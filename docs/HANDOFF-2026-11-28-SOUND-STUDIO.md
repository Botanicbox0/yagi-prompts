# 인계: 사운드 스튜디오 음악 작곡 화면 v2 (2026-11-28)

브랜드 사운드 스튜디오(`/brand/studio/sound`)의 음악 만들기를 한 흐름으로 다시 만드는 작업이다. 서버 쪽(B0–B3)까지 끝났고, 화면(B4)부터는 다음 작업자가 잇는다. 이 브랜치는 **main에 병합하지 않았다.** 과금과 작업 상태를 다루는 코드라 검수 뒤에 병합한다.

- 브랜치: `gemini/sound-studio-suno` (origin에 push됨, PR 없음)
- worktree: `D:\dev\.worktrees\twings\sound-studio-suno`
- 작업 전 기준 커밋(변경 비교용): `830d2258`. 이후 main을 세 번 병합했으므로 `git diff origin/main`이 아니라 이 커밋이나 병합 커밋 기준으로 비교한다.

## 1. 대표 요청 (2026-11-28)

1. 모델을 고를 수 있어야 한다: **Suno v6, Suno v6 Wild, MiniMax Music 3.0** (모두 Sunra 경유).
2. "보컬 없음 / 보컬 있음"을 나란히 두지 말고 Suno 만들기 화면 구조로 한 흐름을 만든다: `간단히 | 직접 쓰기` 전환, 첨부 줄(오디오·보이스·인스포), 가사 → 스타일 → 추가 옵션.
3. MiniMax 쪽 폼은 MiniMax 공식 화면을 따른다.
4. 레퍼런스 오디오를 넣을 수 있다는 것이 한눈에 보여야 한다(보컬 없이 만들 때 특히).
5. 보컬 쪽 선택지를 줄인다.
6. Prompt Architect는 모델마다 그 모델에 맞는 프롬프트 방식으로 설계한다.
7. 이미지 관련 기능은 범위에서 뺐다(대표 정정).

## 2. 확인한 사실

- Sunra의 세 모델 API는 **음원·보이스 입력을 받지 않는다.** 그래서 첨부한 음원은 모델에 보내지 않고, 듣는 텍스트 모델이 특징을 읽어 요청에 설계해 넣는 방식으로 설계했다(읽은 내용은 화면에 보여 준다).
- Suno v6 / v6 Wild: `inspire-mode`(prompt, instrumental), `custom-mode`(title, style, lyrics, instrumental, max_mode). 길이 입력 없음. 요청 한 번에 2곡. 요청당 $0.10(max_mode는 $0.20).
- MiniMax Music 3.0: `text-to-music`(prompt ≤2000, lyrics ≤3500, duration 1–75초, is_instrumental). 1곡, WAV. 곡당 $0.16.
- 크레딧은 기존 계산식 그대로: Suno 16(더 고르게 만들기 32), MiniMax 26(**잠정**).
- Suno 공식 화면의 Weirdness·Style Influence·Variety 슬라이더, 커버, 보이스 페르소나는 이 API에 없다. 화면에 넣지 않는다.

## 3. 끝난 것 (B0–B3)

| 배치 | 내용 | 커밋 |
| --- | --- | --- |
| B0 | 스위치 판독 함수 `brandSoundComposerV2For` + 현재 화면 기준선 테스트 | `a0d2836c` |
| B1 | Suno v6 Wild·MiniMax 엔진, 모델별 견적 | `4f272ff8` |
| B2 | 서버의 v2 작업 생성(모델별 검증·예약·요청·차감), MiniMax 가사 초안 경로, 길이 읽기 | `bd97fb17`, `f5ca3b2b`, `513339a2` |
| B3 | 모델별 Prompt Architect 프로필 3개, 모델별 검사, 평가 스크립트 | `96b05120`, `3865deb6`, `ba1fcff2` |

커밋은 배치마다 남긴 작업 커밋이다. PR을 열 때 하나로 합친다(합치기 전에 main을 먼저 병합하고, 바뀐 파일 목록에 다른 기능 파일이 없는지 본다).

새 파일:
- `lib/brand-studio/sound/engines/minimax-sunra.ts`, `lib/brand-studio/sound/requested-seconds.ts`
- `lib/brand-studio/enhancer/profiles/music/` (`suno-v6.ts`, `suno-v6-wild.ts`, `minimax-music-3.ts`, `index.ts`, `CHANGELOG.md`)
- `scripts/sound-architect-eval.ts`(확장), `scripts/fixtures/sound-architect/v2-fixtures.json`
- `tests/brand-studio/sound/v2-*.test.ts(x)` 6개와 기준선 스냅샷

### 동작 요약
- **스위치**: 환경변수 `BRAND_SOUND_COMPOSER_V2_ORGS`(조직 id 목록, 쉼표나 공백 구분). 목록에 있는 조직만 열린다. 비어 있거나 없으면 모두 닫힘. `*`·`all`은 전체 열림이 아니다. **지금 값: 어디에도 설정하지 않았다(운영·프리뷰 모두 닫힘).** 조직 id는 Vercel 환경변수에만 넣고 코드·문서·커밋에 쓰지 않는다.
- **닫힌 조직**: 화면, 페이지 데이터, 요청, 작업 행이 지금과 같다. v2 필드가 든 요청은 알 수 없는 필드와 똑같이 거부된다.
- **과금**: 버튼 견적 = 생성 시 예약 = 완료 시 차감. 모두 그 작업의 모델 엔진에서 나온다. 실패·결과 0개는 0.
- **MiniMax 보컬 + 가사 비움**: 서버가 가사를 쓰고, 기존 곡과 겹치는지 검사한 뒤에만 유료 요청을 보낸다. 초안 실패·검사 실패는 0크레딧 실패로 끝난다(재시도 반복 없음). Suno의 기존 동작(초안 실패 시 그대로 진행)은 바꾸지 않았다.
- **MiniMax 길이**: 고객이 정한 값 > 붙인 영상 > 문장에서 읽은 값 > 60초. 1–75초로 자른다.
- **길이 읽기**(`parseRequestedSeconds`): `초`, `분`, `sec(s)`, `second(s)`, `min(s)`, `minute(s)`만 길이로 본다. 범위는 큰 값. 길이가 두 개 이상이면 읽지 않는다.
- **Prompt Architect**: Suno v6는 기존 프로필 그대로(모델에 보내는 지시문이 바이트 단위로 같다). Suno v6 Wild는 v6와 같은 규칙. MiniMax는 영어 캡션 세 단락(Global Metadata → Vocal Details → Arrangement), 가사 태그는 한 줄에 태그만, 근거 없는 BPM·키·성별 금지.

## 4. 검증 결과 (실제로 돌린 것)

- 배치마다: `npx tsc --noEmit` 통과, `npx vitest run tests/brand-studio` 통과(B3 수정 1차 시점 386개 파일 / 5,000개 테스트).
- 마지막 상태(main 병합 후): 아래 "마지막 실행" 참고.
- Architect 오프라인 평가: `npx tsx --conditions=react-server scripts/sound-architect-eval.ts --dry-validate` → 36/36, 추가 사례 10/10.
- Architect 실제 텍스트 모델 평가(음악 생성 없음, 2회): 요청 12개 × 모델 3개 = 36건 모두 통과, 대체 문장 0건, 다시 쓰기 1건. 설계 1건에 5–8초.
- 독립 검수(Opus): B1 수정 없음. B2 두 차례(닫힌 경로 동일, 과금 일치 확인). B3 두 차례(기존 경로 동일 확인).

### 마지막 실행
2026-11-28 15:13–15:37, main을 병합한 브랜치 끝 상태(이 문서 커밋 직전)에서:

| 명령 | 결과 |
| --- | --- |
| `npm run db:local` | 통과 |
| `npx tsc --noEmit` | 오류 0 |
| `npx vitest run` (전체) | 1,121개 파일 / 12,436개 테스트 통과, 3개 건너뜀, 실패 0 |
| `npx tsx --conditions=react-server scripts/sound-architect-eval.ts --dry-validate` | 36/36, 추가 사례 10/10 |
| `npm run build:local` | 통과 |
| `npm run sweep:anon` | **미실행** |

이 실행 직전의 전체 테스트에서 두 가지가 나와 고쳤다(둘 다 위 결과에 반영됨): `npm run db:local` 실패(§9의 "공용 모듈" 항목), 모델 호출 인벤토리 미등록 1건(§5).

### 하지 않은 것
- `npm run build:local`, `npm run sweep:anon`(AGENTS.md §3의 나머지 두 단계)은 돌리지 않았다. 화면이 들어간 뒤 전체 루프에서 돌린다.
- **B3 수정 2차(`ba1fcff2`)는 독립 검수를 받지 않았다.** 테스트 검사 복원, 길이 계산에 고객 문장 사용, 작업 뷰의 프로필 표기가 들어 있다. 타입 검사와 테스트만 통과했다.
- 화면이 없어서 클릭으로 확인한 것은 없다.
- 유료 음악 생성은 한 번도 하지 않았다.

## 5. 남은 것

지시서는 저장소 밖 노트 폴더에 있다(같은 PC에서 읽을 수 있다):

```text
C:\Users\User\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_7bbf8eb3-1722-4114-945e-2aed14e92d85\sound-studio-suno
```

| 순서 | 내용 | 지시서 | 참고 |
| --- | --- | --- | --- |
| B4 | 화면: 모델 메뉴, `간단히 | 직접 쓰기`, 가사·스타일·추가 옵션, 한 곡/두 곡 목록, 새 문구 사전 `messages/studio-sound-v2.ts` | `brief-B4.md` | 화면 설계는 `CONTRACT-v2.md` A절, 참고 화면은 `REFERENCE-SCREENS.md` |
| B5 | 첨부 줄: 레퍼런스 오디오 읽기, 인스포, 보이스(상수 기본 꺼짐) | `brief-B5.md` | `CONTRACT-v2.md` B.3 |
| B6 | 문구(로컬 Gemma 2패스 → 사실 대조), 전체 검증 루프, 헤드리스 브라우저로 클릭 확인(작업 요청은 가로채서 실제 생성 없음) | 없음(AGENTS.md §2·§3) | |
| PR | main 병합 → 커밋 합치기 → `node scripts/gh-pr.mjs`로 PR → 병합 뒤 테스트 조직만 환경변수에 추가 → 운영 화면 확인(유료 버튼은 누르지 않음) | | |

B4를 시작하기 전에 알아 둘 것:
- 작업 뷰(`lib/brand-studio/repo.ts`의 `v2MusicJobView`)는 v2 작업의 `composerMode`, `durationSeconds` 같은 값을 브라우저로 보내지 않는다. "비슷하게 만들기"가 모델·모드·길이를 되살리려면 이 뷰에 필요한 값만 추가해야 한다(닫힌 조직의 작업 뷰는 그대로 둔다).
- `간단히` 모드에서는 문장에서 읽은 길이를 만들기 버튼 옆에 보여 준다(`brief-B4.md` 끝부분). 잘못 읽은 길이를 결제 전에 알 수 있게 하기 위해서다.
- 새 모델 호출 2곳(모델별 설계 호출, MiniMax 가사 초안)은 프롬프트 가드 인벤토리(`tests/ai-guard/inventory.ts`)에 "아직 미적용"으로 등록했다. 기존 사운드 호출들과 같은 상태이며, 가드 적용은 그 문서의 S2 순서에서 함께 한다. B5에서 듣는 모델 호출을 추가하면 이 목록에도 등록해야 전체 테스트가 통과한다.
- B2·B3 검수의 남은 권고(급하지 않음): `createMusicJobV2`가 `createMusicJob`의 예약·관문 코드를 복사해 둔 상태다(닫힌 경로를 건드리지 않으려고 일부러 둠). 자세한 목록은 노트 폴더의 `B2-REVIEW-2.md`, `B3-REVIEW-2.md`.

## 6. 대표 결정 대기 (3건)

1. **보이스 첨부**: 올린 목소리와 같은 목소리로 부르게 할 수는 없고, 음색·창법 특징만 반영된다. 코드에서는 상수 기본 꺼짐으로 만들기로 했다. 테스트 조직에서 켜 볼지 결정이 필요하다.
2. **MiniMax 가격**: 기존 계산식으로 1곡 26크레딧(Suno는 2곡 16크레딧). 잠정값이다.
3. **음원 업로드 동의 문구와 개인정보처리방침**: 참고 음원을 외부 텍스트 모델로 분석하는데, 처리방침의 분석 항목에는 이미지·영상만 적혀 있다. 테스트 조직 밖으로 넓히기 전에 문구와 처리방침(오디오 추가)을 정해야 한다.

## 7. 유료 생성으로만 확인되는 것

견적을 먼저 보고하고 대표의 "진행"을 받은 뒤에만 한다. 모델당 1회 기준 Suno v6 $0.10, Suno v6 Wild $0.10, MiniMax $0.16(제품 화면 견적으로는 16 / 16 / 26크레딧).
- MiniMax의 한국어 발음과 보컬 품질
- MiniMax에서 가사가 요청 길이보다 길 때의 동작(중간에 끊기는지)
- MiniMax 응답 형식(`audio` + `output_audio_duration`)과 실제 WAV 규격
- Suno v6 Wild가 길이 설계와 구조 태그를 얼마나 따르는지
- Architect가 설계한 문장대로 음악이 나오는지

## 8. 확인하지 못한 것

- Sunra가 Suno에 적용하는 Weirdness 등 기본값
- 듣는 모델에 음원을 올려 읽는 호출의 속도와 비용(B5에서 처음 만든다)
- 운영 환경에서의 동작 전부(스위치가 닫혀 있어 아무 조직에도 열리지 않았다)

## 9. 검수에서 배운 주의점

- **기존 Suno v6 경로는 한 줄도 바뀌면 안 된다.** `tests/brand-studio/sound/v2-closed-baseline.test.tsx`와 스냅샷이 지금 화면·사전·요청·견적·작업 행·페이지 props를 고정한다. 이 테스트와 스냅샷은 고치지 않는다(`vitest -u` 금지). v2 로직은 기존 함수 안에 섞지 말고 초입의 분기 하나로 나눈다.
- **길이 읽기는 틀리게 읽느니 읽지 않는다.** `80s synthwave`, `Gen Z 20s`, `iPhone 6s`, `3분의 1`을 길이로 읽던 문제가 검수에서 나왔다. 단위 없는 `s`는 길이가 아니다. 알려진 한계: `3분 요리 광고`는 180초로 읽힌다(그래서 화면에 읽은 길이를 보여 주기로 했다).
- **테스트 검사를 빼지 않는다.** 수정 과정에서 테스트 파일을 다시 쓰다가 검사 약 20개가 빠진 적이 있다. 테스트 파일을 고친 뒤에는 `it(`와 `expect(` 개수를 전후로 비교한다.
- **검사가 정상 문장을 거부하지 않는지 실제 모델로 확인한다.** 영어 "in a ~"를 조성으로 오인한 검사는 고정 사례로는 보이지 않았다. 검사를 바꾸면 `--v2` 평가를 다시 돌린다.
- **공용 모듈이 서버 전용 코드를 끌어오지 않게 한다.** v2 판별 함수(`isV2MusicJob`)를 `music-jobs.ts`에 두었더니 `repo.ts`가 서버 전용 모듈까지 불러와 `npm run db:local`이 실패했다. 단위 테스트는 전부 통과한 상태였다. 판별 함수는 의존성 없는 `lib/brand-studio/sound/v2-job.ts`에 두었고 `tests/brand-studio/sound/v2-pure-imports.test.ts`가 지킨다. 배치를 마칠 때 테스트만 보지 말고 `npm run db:local`과 `npm run build:local`도 돌린다.
- **견적은 작업의 모델에서 나와야 한다.** 환경 기본 엔진으로 견적을 내면 모델을 바꿨을 때 버튼과 차감이 달라진다.
- **화면에 있는 것은 생성에 실제로 반영되어야 한다.** 모델이 받지 못하는 항목은 흐리게 두지 않고 뺀다.
- 고객 화면 문구에는 세 모델 이름 외에 공급사·엔진·내부 용어를 쓰지 않는다. 기존 사전(`messages/studio-sound.ts`)과 그 금칙어 테스트는 그대로 두고, 새 문구는 별도 사전에 둔다.
- 샌드박스·생성 차단 조직은 목록에 있어도 404다(기존 관문이 먼저 돈다).
