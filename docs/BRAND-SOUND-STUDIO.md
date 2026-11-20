# brand.twings.app 사운드 스튜디오 — 설계 (2026-11-20, 엔진 확정판)

> **문서 성격**: 사운드 스튜디오를 짓기 위한 설계다. 엔진과 상업 이용은 대표가 2026-11-20에 정했고(§1), 이 문서는 그 결정 위에서 화면·데이터·조각을 구현할 수 있을 만큼 적는다. 제품 코드는 아직 없고 유료 호출도 하지 않았다.
> 같은 날 세 번 고쳐 쓴 문서다. 처음에는 엔진 후보 비교(ACE-Step 자체 운영 추천), 다음에는 ElevenLabs 재검토를 담았다. 그 조사는 버리지 않고 §9(엔진을 바꿔야 할 때의 대안)와 `docs/research/brand-sound-studio-2026-11-20/`에 남겼다.
> 숫자(가격·입력·약관)는 2026-11-20에 읽은 값이다. 확인하지 못한 것은 "확인 못 함"으로 적었다(§10). 가격·약관 문구·화면의 이용 조건 문장은 대표 결정이다(§8).
> 편집 스튜디오의 음악 결정(`docs/BRAND-EDITING-STUDIO.md` §8 "음악")과 `docs/BRAND-PRODUCT.md` §7·§9의 음악 항목은 이 문서가 이어받는다. 음악·효과음 생성에 한해 이 문서가 새 것이다.

## 0. 한눈에

- **엔진(대표 결정)**: 음악은 Sunra API의 **Suno v6**, 효과음은 **ElevenLabs**(지금 스튜디오가 쓰는 Sunra 경유 길).
- **상업 이용(대표 결정)**: Suno 음악은 광고에 상업적으로 쓴다. 근거와 남은 불확실성은 §1.2에 짧게 적었고, 출시를 막는 조건으로 두지 않는다.
- **자리**: 레일 "직접 만들기" 묶음, 영상 스튜디오 바로 아래. 주소 `/brand/studio/sound`, 플래그 `BRAND_SOUND_STUDIO`, 기능 그룹 `sound`.
- **무엇을 하나**: 한 화면에 탭 둘. **음악**은 설명만으로 만들거나, 가사·스타일을 지정해 노래로 만든다. **효과음**은 소리를 설명해서 만든다. 만든 것은 편집 스튜디오와 영상 스튜디오로 보낸다.
- **길이**: Suno에는 길이 입력이 없다(§3.1). 그래서 "만든 뒤 맞춘다". 자르고 끝을 서서히 줄이는 길이 도구를 우리가 만들고(크레딧 없음), 더 길게는 이어 만들기를 쓴다(§4.3).
- **레인**: 음악은 Sunra **API 레인에서만** 돈다. 계정 레인 도구는 설명과 "보컬 없음"만 받아서 가사·스타일·Max Mode·길이 도구를 쓸 수 없다. API 키 잔액이 있어야 한다(§3.3).
- **원가와 크레딧(잠정)**: 음악 요청 하나 $0.10(Max Mode $0.20), 효과음 초당 $0.002. 기존 사용량 계수로 음악 16크레딧(Max 32), 효과음 5초 2크레딧. 가격은 대표가 바꿀 수 있다(§3.4).
- **빌드**: SS1 방과 목록(생성 없음) → SS2 음악 설명 방식 → SS3 음악 직접 지정 방식(가사·스타일·Max Mode) → SS4 길이 도구 → SS5 효과음 탭 → 정리. 엔진은 어댑터 한 장으로 갈아 끼울 수 있게 둔다(§7).
- **출시 순서**: 테스트 조직에서 확인한 뒤, 셀프 스튜디오가 열린 조직에 연다. 샌드박스 조직은 닫혀 있다.
- **대표께 남은 것**: 유료 스모크 테스트 승인(약 $0.79), API 레인 잔액, 화면의 이용 조건 문장과 약관 조항, Max Mode를 고객에게 보일지, 효과음 파일 단독 내려받기, AI 생성 표시 방식, 잠정 크레딧(§8).

## 1. 결정과 근거

### 1.1 대표 결정 (2026-11-20)

| 무엇 | 대표 말씀 | 문서에서의 자리 |
| --- | --- | --- |
| 사운드 스튜디오를 만든다 | "영상 스튜디오 아래에 사운드 스튜디오를 만들어서 음악 만들 수 있게 기능 따로 빼야할 것 같아. 저작권 없는 음악을 만들 수 있는 공간." | §4 |
| 엔진 | "음악 스튜디오는 sunra api에서 음악은 suno로 만들게 하면 될 것 같고, (만약 가사나 이런거 지정해야하는 경우도 구현 가능하게) 그리고 효과음을 설명해서 만드는 경우에는 elevenlabs의 것을 연동해놓으면 좋을 것 같은데." | §3, §7 |
| 상업 이용 | "https://sunra.ai/dev/models/suno/suno-v6?endpoint=inspire-mode&tab=api 여기서 활용 가능한데? 그리고 suno 음악은 광고에 상업적으로 써도 되니까 문제 없어." | §1.2, §2 |

2026-11-18의 "음악 생성은 elevenlabs뮤직을 쓰지 않을거야"는 그대로다. ElevenLabs는 효과음에만 쓴다.

### 1.2 근거와 남은 불확실성

상업 이용은 대표가 약관과 위험을 보고 정한 것이다. 아래는 그 결정을 받치는 글과, 글로는 적혀 있지 않은 것을 기록해 두는 메모다. 출시 조건이 아니다. 인용은 2026-11-20에 원문에서 문자열을 대조했고 전체는 `research/…/suno-via-sunra.md`에 있다.

| | 글로 확인된 것 | 글로 적혀 있지 않은 것 |
| --- | --- | --- |
| Sunra 약관(2026-11-17) | "You may use Outputs for any lawful purpose, including commercial purposes, subject to these Terms and the law." 기업 FAQ: "including ads, campaigns, films and client work." API로 만든 제품을 고객에게 여는 것: "You may build the Sunra API into your own apps, products, platforms and services, including ones your customers use to make content, and offer them commercially." 입력과 결과물을 학습에 쓰지 않는다 | 다른 회사 모델에는 "Their own terms may also apply"라고만 적고, Suno·ElevenLabs와 어떤 계약으로 제공하는지는 어디에도 없다. 카탈로그의 `commercial_use` 표시(259개 중 155개)가 Suno와 ElevenLabs 효과음 항목에는 없고, 그 표시의 뜻도 문서에 없다. 권리 침해에 대한 보증은 없다 |
| Suno 약관(2026-09-03 시행) | 유료 경로의 결과물은 권리를 이용자에게 넘긴다. 내려받은 곡의 상업 이용 권리는 "perpetual"이고 구독이 끝나도 유지된다. 출처 표기 의무가 없다. v6는 Warner Music Group, BMG, Believe와의 계약으로 받은 음악을 학습에 쓴다고 밝혔다 | 상업 이용의 조건이 "downloaded by you through an approved channel"인데 무엇이 승인된 경로인지 정의가 없고 API 제공사에 대한 언급이 없다. Suno의 자체 API는 로그인해야 보이는 베타다. "Applicable rights holders may also have the right to collect revenue related to distribution of Outputs on third party platforms."라는 문장이 있고 누가 언제인지는 적혀 있지 않다. 결과물에 지문·워터마크를 넣을 수 있다고 적는다 |
| 그 밖 | — | UMG와 Sony의 소송은 끝나지 않았다(2026-09에 v6를 겨냥한 두 번째 소송, 언론 보도). 어느 쪽도 이용자를 면책해 주지 않는다 |

어느 엔진이든 우리가 하는 일은 같다. 요청마다 새로 만들고, 결과물을 어디에도 등록하지 않으며, 만든 기록(시각·설명·파일 지문)을 남겨 달라고 하면 내주고, 가수·곡 이름과 기존 가사로 만든 요청은 받지 않는다(§5). 글로 된 확인을 남겨 두고 싶을 때 Sunra에 보낼 질문 초안은 부록 A에 있다(선택 사항).

## 2. 고객에게 약속하는 것

브랜드 담당자가 "저작권 없는 음악"이라고 할 때 원하는 것은 다섯 가지다: 유료 광고와 SNS에 쓸 수 있다, 나라와 기간 제한이 없다, 사용료와 출처 표기가 없다, 올린 뒤 "내 음악"이라는 신고로 광고가 내려가지 않는다, 나중에 조건이 바뀌어 못 쓰게 되지 않는다.

| 고객이 바라는 것 | 화면과 약관에서 | 이유 |
| --- | --- | --- |
| 광고·SNS에 쓸 수 있다 | **말한다** | 대표 결정(§1.1) |
| 사용료와 출처 표기가 없다 | **말한다** | 우리가 받지 않는다. 유료 경로에는 표기 의무가 없다 |
| 요청할 때마다 새로 만든 음악이다 | **말한다** | 라이브러리에서 꺼내 주지 않는다 |
| 우리는 이 음악을 식별 시스템에 등록하지 않는다 | **말한다** | 우리 행동이다 |
| 문제가 생기면 만든 기록을 증빙으로 준다 | **말한다** | 작업 행을 지우지 않는다(§7.2) |
| 어떤 신고도 들어오지 않는다 | 말하지 않는다 | 잘못된 신고와 우연한 유사는 막을 수 없다. 유튜브 Content ID 신고는 주로 누군가 같은 음원을 등록했을 때 생긴다(등록에는 독점 권리가 필요하다, YouTube 고객센터 answer/2605065) |
| 저작권이 고객에게 있다, 독점이다 | 말하지 않는다 | AI만으로 만든 음악에는 저작권이 생기지 않는다. 미국 저작권청 Part 2(2025-01-29): "Copyright does not extend to purely AI-generated material". 한국저작권위원회 등록 안내서(2025-06-30)도 같다. Suno 약관도 "Suno makes no representation or warranty to you that any copyright will vest in any Output."라고 적는다 |
| "저작권 없는 음악"이라는 말 | 화면에 쓰지 않는다(추천) | 위 두 줄 때문에 사실과 다르게 읽힌다. 대신 §4.7의 사실 문장을 쓴다 |

인공지능기본법 제31조 2항(2026-01-22 시행)은 생성형 AI 결과물이라는 표시를 서비스 제공자에게 요구한다. 표시 방식은 §8-6.

## 3. 엔진과 원가

### 3.1 음악: Suno v6 (Sunra API)

Sunra 공개 카탈로그와 각 모델의 입력 스키마, 가격 엔드포인트에서 읽었다(무료, 2026-11-20). 대표가 연 `sunra.ai/dev/models/suno/suno-v6` 페이지의 "duration"은 **결과에만 있는 값**이다. 입력에는 길이가 없다.

| 방식 | 엔드포인트 | 입력 | 가격 |
| --- | --- | --- | --- |
| 설명 방식 | `suno/suno-v6/inspire-mode` | `prompt`(필수, 3,000자까지), `instrumental`(기본 false) | 요청당 $0.10 |
| 직접 지정 방식 | `suno/suno-v6/custom-mode` | `title`(필수, 80자), `style`(필수, 1,000자: 스타일·분위기·악기), `lyrics`(5,000자, 비우면 연주곡용), `instrumental`, `max_mode`("Spend more compute for a more consistent song; doubles the price") | 요청당 $0.10, Max Mode $0.20 |

- **결과**: `clips[]`. 클립마다 `task_id`, `clip_id`, `title`, `audio_url`, `duration`, `styles`, `lyrics`, `image_url`. 가격은 클립 수와 무관하게 요청당이다.
- **한 요청에 몇 곡이 오나**: Sunra 스키마에는 적혀 있지 않다(확인 못 함. 스모크 테스트에서 센다). Suno 자체 앱은 한 번에 두 곡이다(도움말: "Each time you generate, you make two songs"). 화면은 몇 개가 오든 그리게 만든다.
- **곡 길이**: 정할 수 없다. Suno 도움말은 v6가 한 번에 8분까지 만든다고 적는다. 실제로 오는 길이는 스모크 테스트에서 본다.
- **Max Mode**: Suno 도움말은 2분이 넘는 곡과 보컬의 일관성에 좋다고 적는다. 직접 지정 방식에서만 켤 수 있다.
- **없는 것**: 길이 입력, 언어 입력(가사를 쓴 언어로 부른다), 빠르기·조 입력, 참고 음원 입력, 시드.
- `suno/suno-v6-wild`("less predictable and more varied results")는 같은 입력·같은 가격이다. 첫 버전에서는 쓰지 않는다.
- **길이를 다루는 엔드포인트는 예전 이름 아래에만 있다.** `suno/suno-v5.5-relay`(카탈로그 설명: "Suno officially retired versions before v6. This legacy v5.5 slug remains available for API compatibility and is now served by Suno v6; endpoint names and prices are unchanged."):

| 엔드포인트 | 입력 | 가격 | 쓰임 |
| --- | --- | --- | --- |
| `extend` | `task_id`, `clip_id`, `continue_at`(이 초부터 이어서), `title`, `lyrics`, `style`, `instrumental` | $0.10 | 곡 뒤를 이어 더 길게 |
| `clip` | `task_id`, `clip_id`, `crop_start`, `crop_end`(초) | $0.002 | 서버에서 자르기(페이드 옵션 없음) |
| `inpainting` | `clip_id`, `title`, `lyrics`, `aligned_lyrics`, `style`, `infill_start`, `infill_end`, `infill_dur`(10~30초), `song_duration` | $0.10 | 구간 다시 만들기 |
| `cover-mode` | `clip_id`, `title`, `lyrics`, `style` | $0.10 | 같은 곡을 다른 스타일로 |
| `upload` | `url` | $0.002 | 밖의 음원을 올려 이어 만들기의 바탕으로 |

  v6로 만든 클립의 id를 이 엔드포인트들이 받는지는 적혀 있지 않다(확인 못 함. 스모크 테스트의 한 항목). 호환용 이름이라 언제 내려갈지도 모른다. 그래서 길이 도구의 기본은 우리 쪽 자르기이고, 이어 만들기는 엔진이 될 때만 켜는 기능으로 둔다(§4.3).
- 가사 초안을 만드는 길(`…/generate-lyrics`)이 예전 이름의 API 명세에 있지만 가격표와 목록에는 없다. 쓰지 않는다. 가사 초안은 우리 글 모델이 쓴다(§4.2).
- 결과 주소(`audio_url`)가 얼마나 살아 있는지는 Sunra 문서에 없다. 받자마자 우리 저장소로 옮긴다.

### 3.2 효과음: ElevenLabs (지금 있는 Sunra 경유 길)

| 항목 | 값 |
| --- | --- |
| 엔드포인트 | `elevenlabs/sound-effects/text-to-sound-effects` ("Eleven Text to Sound v2") |
| 입력 | `text`(450자), `duration`(0.5~22초, 생략하면 자동), `prompt_influence`(0~1, 기본 0.3), `output_format`(기본 `mp3_44100_128`, PCM 48kHz까지) |
| 가격 | 초당 $0.002 |
| Sunra에 없는 것 | 반복 재생(`loop`)과 최신 v3 모델(ElevenLabs 직접 API에만 있다) |
| 필요한 키 | `SUNRA_API_KEY` 하나(지금 운영 환경에 있는 키, 기존 효과음 생성이 쓰고 있다). ElevenLabs 계정과 요금제는 이 길에서는 필요 없다 |
| ElevenLabs와 직접 계약할 때(참고) | 코드가 읽는 이름은 `ELEVENLABS_API_KEY`. 배포 환경에 있는지는 확인 못 함. 직접 계약이면 고객에게 서비스를 여는 조건이 Scale 요금제(월 $299) 이상이다(OEM 약관, Pro 이하에서는 금지). 효과음에는 음악과 달리 직원 수 조건이 없다. 근거는 `research/…/elevenlabs-terms.md` |

ElevenLabs 효과음 약관에서 알아 둘 것은 둘이다(2026-10-09 약관, 원문 대조).

- 유료 경로의 상업 이용은 광고를 포함해 허용된다: "As long as you have a paid account, you can use our sound effects royalty-free in commercial projects, including YouTube videos, social media content, and even advertising".
- 권리는 **다른 소재와 결합한 결과물**에 준다: "You may exercise those rights only in respect of Output combined with other material". 효과음 파일을 단독으로 제공하거나 효과음 모음으로 제공하는 것은 금지 쪽이다. 그래서 효과음은 영상에 넣어 쓰는 흐름으로 설계하고, 파일 단독 내려받기는 기본으로 두지 않는다(§4.4, §8-5).

지금의 효과음 코드(`lib/brand-studio/music/sfx.ts`)는 같은 엔진·같은 길이라 그대로 열어 둔다. 고칠 것은 엔진이 아니라 주변이다: 가짜 `video_final` 작업 행, 원가와 무관한 고정 크레딧, 받치는 문서 없이 붙는 "상업 이용 가능" 표시, 단독 에셋 저장과 내려받기(§6, SS5).

### 3.3 레인: 음악은 API 레인

대표 말씀의 "sunra api"는 Sunra의 두 길 가운데 **API 레인**(`sunra_api`: 서버가 `SUNRA_API_KEY`로 `api.sunra.ai`를 부르고 웹훅과 폴링으로 결과를 받는다)이다. 다른 하나인 계정 레인(`sunra_mcp`: 워크스테이션 워커가 Sunra 계정의 구독 크레딧으로 돌린다, 지금 운영의 기본)과 비교하면 이렇다.

| | API 레인 | 계정 레인 |
| --- | --- | --- |
| Suno 입력 | 설명 방식과 직접 지정 방식 전부, 길이 엔드포인트 | 도구 `create_audio`가 `prompt`와 "보컬 없음"만 받는다. 가사·스타일·제목·Max Mode·이어 만들기·자르기 없음 |
| 과금 | API 키 잔액에서 달러로 | 계정 구독 크레딧(무료 견적으로 Suno v6 10크레딧) |
| 운영 | 서버만 있으면 된다 | 워크스테이션 워커가 떠 있어야 한다 |
| Sunra 약관 | 고객이 쓰는 제품에 넣어 상업적으로 제공해도 된다고 적는다(§1.2) | Creative 계정으로 "lets other people create content"하는 서비스를 돌리지 말고 소프트웨어 통합은 API를 쓰라고 적는다 |

- 그래서 음악 모델은 `mcp: null`로 등록한다. 기존 레인 규칙(`lib/brand-studio/lanes.ts`)에서 `mcp`가 없는 모델은 계정 레인으로 가지 않고, 조직의 선호 레인과 무관하게 API 레인에서 돈다.
- **API 키 잔액이 있어야 한다.** 2026-11-10에는 $0였고 첫 호출이 `412 INSUFFICIENT_CREDIT`였다. 오늘 잔액은 확인 못 함. 잔액이 없으면 기존 규칙대로 API 레인이 10분 닫히고 작업은 보류된다. 음악에는 넘어갈 다른 레인이 없다. 충전은 대표가 한다.
- 효과음도 같은 레인에서 돈다(지금 코드도 API 키로 직접 부른다). 계정 레인에도 같은 효과음 모델이 있지만 첫 버전에서는 쓰지 않는다.

### 3.4 원가와 크레딧 (잠정: 기존 사용량 계수 그대로)

`lib/brand-studio/usage-rate.ts`의 규칙: 제공사 청구액(센트 올림) × 1,400 × 계수 ÷ 10원, 결과 단위로 크레딧 올림. 음악·효과음에는 이미지 계수(1.12)를 잠정으로 쓴다. 아래 값은 영상 계수(1.11)로 계산해도 전부 같다. **가격은 대표가 바꿀 수 있고, 이 표는 원가에서 나온 잠정값이다.**

| 요청 | 제공사 청구액 | 크레딧(잠정) |
| --- | --- | --- |
| 음악, 설명 방식 | $0.10 | 16 |
| 음악, 직접 지정 방식 | $0.10 | 16 |
| 음악, 직접 지정 + Max Mode | $0.20 | 32 |
| 이어 만들기 | $0.10 | 16 |
| 구간 다시 만들기(나중) | $0.10 | 16 |
| 엔진 쪽 자르기 | $0.002 → 센트 올림 $0.01 | 2 (우리 길이 도구는 0) |
| 효과음 2초 / 5초 | $0.004 / $0.01 → $0.01 | 2 |
| 효과음 10초 | $0.02 | 4 |
| 효과음 22초 | $0.044 → $0.05 | 8 |

- **음악은 요청 단위로 센다.** 한 요청에서 클립이 여러 개 와도 값은 같다. 클립이 하나라도 오면 견적만큼 빠지고, 하나도 못 받으면 0이다. 지금의 "결과 수로 나눠 정산" 규칙(`settledUsageKrw`)을 음악에는 "요청 1건"으로 적용한다.
- 효과음은 개수만큼이다. 4개를 만들면 4건이다. 길이를 반드시 지정해서 보낸다. "자동"으로 보내면 길이를 몰라 값을 미리 말할 수 없기 때문이다.
- 버튼의 숫자가 빠지는 숫자다. 견적 일치 테스트(`tests/brand-studio/server/quote-parity.test.ts`)에 넣는다.
- 지금 코드의 고정 공식(음악 `12 + ceil(초/5) × 2`, 효과음 `4 + ceil(초/5) × 2`)은 쓰지 않는다.
- 가사 초안과 우리 길이 도구는 0 크레딧이다.

## 4. 제품

### 4.1 자리와 문

- 레일 "직접 만들기" 묶음에서 영상 스튜디오 바로 아래. 이름은 **사운드 스튜디오**(Sound Studio). 레일을 두 모드로 나누는 작업(다른 세션)에서는 첫 번째 모드에 속한다.
- 주소 `/brand/studio/sound`. 탭은 `?tab=music`(기본)과 `?tab=sfx`. 홈(`/brand/home`)에 같은 이름의 카드 한 장.
- 보이는 조건: 스튜디오가 열린 조직 + `sound` 그룹이 닫히지 않음 + 플래그. 아니면 메뉴·페이지·API 모두 404(기존 규칙).
- 데스크톱 전용. 브랜드 쪽 화면 규칙(오프블랙 바탕, 포인트 색은 주 행동 하나와 포커스 링에만)을 따른다(`docs/design/IDENTITY.md`, `TASTE.md`, `TOOLBOX.md`).

### 4.2 음악 탭

```
┌ 레일 ┬──────────────────────────────────────────────────────────────┐
│      │ 사운드 스튜디오      [음악] 효과음          검색   필터 ▾   ♡ │
│ 이미지│ 광고와 SNS 영상에 쓸 배경 음악을 만들어요.                    │
│ 영상  │──────────────────────────────────────────────────────────────│
│▶사운드│ ▶ 잔잔한 어쿠스틱 · A   ▁▂▅▇▅▃▂▁▂▃▅▃▂▁   2:41   ♡  ⋯       │
│ 편집  │ ▶ 잔잔한 어쿠스틱 · B   ▂▃▅▃▂▁▂▅▇▅▃▂▁▁   3:05   ♡  ⋯       │
│ 워크  │──────────────────────────────────────────────────────────────│
│ 에셋  │ ▶ 여름 세일 송 · A      ▃▅▇▅▃▅▇▅▃▅▇▅▃▂   2:12   ♡  ⋯       │
│      │   ╭────────────────────────────────────────────────────────╮ │
│      │   │ 분위기, 악기, 빠르기를 적어 주세요.                     │ │
│      │   │ [보컬 없음 ▾]  (보컬 있음이면 가사 칸이 열린다)  (만들기 16)│ │
│      │   ╰────────────────────────────────────────────────────────╯ │
└──────┴──────────────────────────────────────────────────────────────┘
```

**첫 1분**: 레일에서 연다 → 예시 설명 네 개(스킨케어 광고, 패션 필름, 숏폼, 제품 출시) 중 하나를 누르거나 직접 적는다 → `만들기`(버튼에 크레딧) → 결과가 목록 맨 위에 줄로 생긴다 → 눌러 듣는다(저절로 재생하지 않는다) → `길이 맞추기`로 영상 길이에 맞추고 `편집 스튜디오로 보내기`.

**입력 독**(이미지·영상 스튜디오의 독과 같은 부품). 조작은 적게 둔다.

| 조작 | 내용 | 엔진으로 가는 값 |
| --- | --- | --- |
| 설명 | 분위기·악기·빠르기를 글로. 가수·곡 이름은 받지 않는다(§5) | 설명 방식의 `prompt`, 또는 직접 지정 방식의 `style` |
| 보컬 | 보컬 없음(기본) / 보컬 있음 | `instrumental` |
| 가사(보컬 있음일 때 열림) | 직접 쓴다, `가사 초안 만들기`로 초안을 받아 고친다, 또는 비워 둔다(설명에 맞춰 알아서 부른다). 쓴 언어 그대로 부른다 | `lyrics` |
| 더 고르게 만들기(스위치, 가사나 스타일을 지정했을 때만) | 곡이 처음부터 끝까지 더 고르게 나온다. 크레딧 두 배 | `max_mode` |

- **어느 방식으로 보낼지는 우리가 정한다.** 가사가 없고 스위치가 꺼져 있으면 설명 방식, 가사가 있거나 스위치가 켜져 있으면 직접 지정 방식이다. 고객은 "방식"을 고르지 않는다.
- 직접 지정 방식에 필요한 `title`은 설명에서 우리가 짓는다(80자 안, 목록의 이름으로도 쓴다). `style`은 고객 설명을 엔진이 알아듣는 형식으로 다시 짠 것이다(이미지 스튜디오의 Prompt Architect와 같은 자리). 고객 화면에는 고객이 쓴 말만 남고, 보낸 문장은 보여 주지 않는다.
- **가사 초안**: 주제 한 줄과 언어를 받아 우리 글 모델(스튜디오가 이미 쓰는 Gemini 클라이언트)이 구간이 나뉜 가사를 쓴다. 크레딧 없음, 호출 수 제한만 둔다. 초안은 가사 칸에 들어가고 고객이 고친다. 구간 표시([Verse], [Chorus])는 보낼 때 우리가 붙인다.
- **언어**: 엔진에 언어 입력이 없다. 가사가 있으면 그 언어로 부른다. 보컬 있음인데 가사를 비우면 설명 끝에 언어를 적어 보낸다(작업공간 언어가 기본). 한국어 보컬의 품질은 들어 보지 않았다(스모크 테스트 항목).
- **길이 조작부는 없다.** 독 아래에 한 줄로 "곡마다 길이가 달라요. 만든 후 조절하세요."를 둔다.
- **버전**: 한 요청에서 온 클립을 모두 줄로 보여 주고 이름 끝에 A, B…를 붙인다(두 곡을 예상한다, §3.1). 몇 개가 오든 그대로 그리고 모두 목록에 남는다.
- **Max Mode**는 "더 고르게 만들기"라는 스위치 하나로만 보인다. 스모크 테스트에서 차이가 들리지 않으면 고객에게 보이지 않고 끈 채로 둔다(§8-4).
- 목록은 둥근 카드가 아니라 가는 선으로 나눈 줄이다(TASTE 16). 이름은 사람이 읽는 말이고 파일 이름·id는 그리지 않는다(TASTE 15). 줄을 누르면 아래로 펼쳐져 큰 파형, 가사(있으면), 버전 탭, 행동이 나온다. 오른쪽 패널은 붙이지 않는다.
- 줄의 행동: 주 행동 하나 `편집 스튜디오로 보내기`(채운 버튼). 나머지는 조용한 버튼과 `⋯`: 길이 맞추기, 뒤에 이어 만들기, 비슷하게 만들기(같은 설정으로 새 요청), 내려받기, 영상 스튜디오에 넣기, 에셋에 저장, 만든 기록 내려받기, 설명 복사, 설정 다시 쓰기, 삭제.
- 고른 기법(TOOLBOX 1-3에서 넷): 떠 있는 유리 독, 음각 입력 칸, 시간·크레딧의 고정폭 숫자, 가는 선 구획. 1280×720에서 줄 다섯 개와 독이 한 화면에 들어온다.

### 4.3 길이 도구 (만든 뒤 맞춘다)

Suno 곡은 길이를 정해 받을 수 없으므로, 광고 길이(15초·30초·60초)나 영상 길이에 맞추는 일은 전부 이 도구가 한다.

1. **자르기와 페이드(우리 것, 0 크레딧)**. 파형 위에 시작·끝 손잡이. 목표 길이를 숫자로 적거나 `영상 길이에 맞추기`로 영상을 골라 그 길이를 가져온다. 끝을 서서히 줄이기(기본 켬, 1.5초)와 시작을 서서히 키우기(기본 끔). 브라우저에서 처리해 새 버전으로 저장한다(내보내기가 이미 브라우저에서 소리를 섞는다). 원본은 남는다.
2. **음악적인 자리에서 자른다**. 브라우저에서 곡의 박(시작점 검출과 빠르기 추정)을 읽어 손잡이가 박·마디에 붙게 한다. 읽지 못한 곡에서는 붙지 않고 자유롭게 움직인다(그렇다고 화면에 알린다). 구간(절·후렴)의 경계를 읽는 것은 다음 단계다.
3. **세 가지 제안**. 목표 길이를 정하면 자리 셋을 제안한다: 처음부터, 가장 힘 있는 구간(소리 에너지가 가장 큰 창), 끝맺음에 맞추기(곡의 진짜 끝이 목표 길이의 끝에 오게 뒤에서부터 잡고 앞을 서서히 키운다). 광고에는 끝이 깔끔한 세 번째가 자주 맞는다.
4. **영상과 같이 보기**. 영상을 골랐으면 왼쪽에 소리 없는 영상이 같이 돈다(원래 소리를 같이 듣는 스위치). 자른 자리가 그림에 맞는지 그 자리에서 본다.
5. **뒤에 이어 만들기(엔진, 16 크레딧)**. 곡이 목표보다 짧거나 다르게 이어 가고 싶을 때. 이어 붙일 지점을 고르면 엔진의 `extend`가 그 지점부터 새로 이어 만든다. 결과는 새 버전이다. 엔진이 받지 않으면(§3.1의 불확실성) 이 버튼은 그리지 않는다.
6. **구간 다시 만들기, 다른 스타일로**(엔진의 `inpainting`, `cover-mode`)는 첫 버전에 없다. 밖의 음원을 올려 이어 만드는 것(`upload`)은 권리 문제로 넣지 않는다(§5).
7. 엔진 쪽 자르기(`clip`, $0.002)는 고객 기능으로 쓰지 않는다. 페이드가 없고 우리 것이 무료다. 이어 만들기의 바탕으로 잘린 클립이 필요해질 때만 내부에서 쓴다.

### 4.4 효과음 탭

- **첫 화면**: 설명 칸("어떤 소리인지 적어 주세요. 예: 탄산이 터지는 소리"), 길이(2초 · 5초 · 10초 · 직접 입력 0.5~22초, 기본 5초), 만들 개수(1~4, 기본 1), `만들기`(크레딧 = 개수 × 길이의 값).
- 결과는 짧은 파형이 있는 줄. 같은 요청의 여러 개는 붙어 있고 A, B…로 구분한다.
- 주 행동: `편집 스튜디오로 보내기`. 프로젝트를 고르면 그 프로젝트의 효과음 줄(타임라인의 `sfxClips`, 최대 24개)에 재생 위치 또는 0초로 들어간다. 영상 스튜디오 프로젝트에도 같은 방식으로 넣는다.
- 그 밖: 비슷하게 만들기, 좋아요, 삭제, 만든 기록 내려받기.
- **효과음 파일만 따로 내려받는 버튼은 기본으로 두지 않는다.** 화면에는 "영상에 넣어서 쓰는 소리예요. 편집 스튜디오로 보내세요."라고 적는다(§3.2의 약관 조건, 결정은 §8-5).
- 반복 재생(loop)과 "영향도"(`prompt_influence`) 조작은 두지 않는다. 앞의 것은 이 길에 없고, 뒤의 것은 우리가 고정한다(지금 코드의 0.45를 스모크 테스트에서 확인).
- 가수·브랜드 이름이 들어간 설명에 대한 처리는 음악과 같다(§5).

### 4.5 보내기, 보관, 다시 찾기

- **편집 스튜디오로 보내기**(음악): 프로젝트를 고르거나 새로 만든다. 서버가 그 프로젝트의 배경 음악 자리(`ComposeBgm`: 음원·길이·시작점·음량)에 넣는다. 자리는 하나라 이미 있으면 바꿀지 묻는다. 주소로 넘기는 방식은 쓰지 않는다(편집 스튜디오 페이지가 `clip` 주소 값을 읽지 않는다).
- **영상 스튜디오에 넣기**: 그 영상 프로젝트의 배경 음악 줄에 같은 서버 작업으로 넣는다. 지금 영상 스튜디오에는 내 음원을 배경 음악으로 넣는 길이 없어서 이것이 처음이다.
- **에셋에 저장**: `brand_studio_assets`(`kind='audio'`). 보내기를 하면 자동으로 저장된다(편집기는 에셋을 읽는다).
- **내려받기**(음악): 받은 형식 그대로와 MP3. 파일에 생성 표시 메타데이터를 넣는다(§8-6).
- **다시 찾기**: 사운드 스튜디오 목록(최신순, 설명·이름 검색, 보컬·좋아요 필터 한 줄), 에셋의 `오디오` 필터.
- 삭제는 목록에서 지우는 것이고 작업 기록은 남는다(만든 기록을 나중에도 내주기 위해서다). 저장 공간은 조직 한도에 포함된다.

### 4.6 이용 조건을 보여 주는 방식

- 줄을 펼친 자리 맨 아래에 한 줄과 `이용 조건` 링크. 링크는 작은 패널을 열고 §2의 "말한다" 가운데 넷을 적는다. "저작권 없음", "안전", "보장"은 쓰지 않는다.
- `만든 기록 내려받기`는 그 곡을 언제, 어떤 설명(과 가사)으로, 어느 작업공간에서 만들었는지와 파일 지문(SHA-256)을 적은 파일을 준다. 엔진 이름은 고객 파일에 적지 않는다.
- 문장은 §4.7에 있고 확정은 대표가 한다(§8-3). 약관에는 음악·효과음 결과물 조항이 아직 없다.

### 4.7 화면 문구

로컬 Gemma(`yagi-crm-gemma4:31b-q8_0`)에 화면의 사실과 금지 표현을 주고 초안을 받은 뒤(1회), 같은 모델에 검수를 시킨 값이다(2회). 사실 대조는 직접 했다. 가격·기간·권한은 Gemma가 바꾸지 않았다. 검수가 고친 것 가운데 하나는 받지 않았다: "영상 길이에 맞추기"를 "길이 맞추기"로 줄이라는 지적인데, 이 선택지는 길이 맞추기 화면 안에서 영상의 길이를 가져오는 것이라 줄이면 뜻이 사라진다. †는 이용 조건 문장이다(§8-3).

| 자리 | 한국어 | English | 검수 |
| --- | --- | --- | --- |
| 레일·홈 카드 이름 | 사운드 스튜디오 (대표 지정) | Sound Studio | — |
| 홈 카드 설명 | 글로 설명해서 배경 음악을 만들어요. | Create background music from text. | 2회 |
| 첫 화면 한 줄 | 광고와 SNS 영상에 쓸 배경 음악을 만들어요. | Create background music for your ads and social media. | 2회 |
| 탭 | 음악 / 효과음 | Music / SFX | 2회 |
| 음악 설명 칸 안내 | 분위기, 악기, 빠르기를 적어 주세요. (예: 차분한 피아노 곡) | Describe the mood, instruments, and tempo. (e.g., Calm piano) | 2회 |
| 보컬 조작부 | 보컬 / 보컬 없음, 보컬 있음 | Vocals / No vocals, With vocals | 2회 |
| 가사 칸 | 가사 | Lyrics | 2회 |
| 가사 칸 안내 | 가사를 입력하세요. 비워 두면 자동으로 만들어져요. | Enter lyrics or leave blank. | 2회 |
| 가사 초안 버튼 / 설명 | 가사 초안 만들기 / 초안을 확인하고 고쳐 쓰세요. | Draft lyrics / Review and edit the draft. | 2회 |
| 가사 언어 안내 | 쓴 언어 그대로 노래해요. | Sings in the language you write. | 2회 |
| 기존 가사·가수 이름이 들어왔을 때(가사 칸) | 기존 노래 가사나 가수 이름은 넣을 수 없어요. | You cannot use existing lyrics or artist names. | 2회 |
| 가수·곡 이름이 들어왔을 때(설명 칸) | 가수 이름이나 곡 제목은 넣을 수 없어요. 분위기, 악기, 빠르기로 설명해 주세요. | Please avoid artist names or song titles. Describe the mood, instruments, and tempo instead. | 2회 |
| 길이 안내 | 곡마다 길이가 달라요. 만든 후 조절하세요. | Adjust the length after creating. | 2회 |
| 스위치 / 설명 | 더 고르게 만들기 / 곡이 더 고르게 나오고 크레딧이 두 배로 들어요. | Consistent output / More consistent quality. Costs double credits. | 2회 |
| 주 버튼 | 만들기 | Create | 2회 |
| 만드는 동안 | 음악을 만들고 있어요. {seconds}초 정도 걸려요. | Creating music. This will take about {seconds} seconds. | 2회 |
| 여러 버전 | {count}개의 버전이 만들어졌어요. | {count} versions created. | 2회 |
| 길이 맞추기 버튼 / 설명 | 길이 맞추기 / 끝을 자연스럽게 줄여요. 크레딧은 들지 않아요. | Fit length / Trim and fade out the end. No credits required. | 2회 |
| 영상 길이에 맞추는 선택지 | 영상 길이에 맞추기 | Match video length | 2회 |
| 이어 만들기 버튼 / 설명 | 뒤에 이어 만들기 / 크레딧이 추가로 들어요. | Extend / Costs additional credits. | 2회 |
| 다시 만들기 | 비슷하게 만들기 | Create similar | 2회 |
| 내려받기 | 내려받기 | Download | 2회 |
| 편집 스튜디오로 | 편집 스튜디오로 보내기 | Send to Editing Studio | 2회 |
| 영상 스튜디오로 | 영상 스튜디오에 넣기 | Add to Video Studio | 2회 |
| 만든 기록 | 만든 기록 내려받기 | Download creation record | 2회 |
| 이용 조건 링크·패널 제목 | 이용 조건 | Terms | 2회 |
| 결과 아래 한 줄 † | 광고와 SNS에 쓸 수 있어요. 사용료를 낼 필요가 없고 출처를 적지 않아도 돼요. | Use in ads and social media. No royalties or attribution required. | 2회 |
| 패널 1 † | 요청할 때마다 새로 만든 음악이에요. | Each request creates a new piece of music. | 2회 |
| 패널 2 † | 광고와 SNS 게시물에 쓸 수 있어요. 사용료를 낼 필요가 없고 출처를 적지 않아도 돼요. | Use in ads and social media posts. No royalties or attribution required. | 2회 |
| 패널 3 † | 이 음악을 음원 식별 시스템에 등록하지 않아요. | We do not register this music in content identification systems. | 2회 |
| 패널 4 † | 문제가 생기면 만든 기록을 내려받아 증빙으로 쓰세요. | Download the creation record to use as proof if issues arise. | 2회 |
| 빈 목록(음악) | 만든 음악이 아직 없어요. | No music created yet. | 2회 |
| 실패(음악) | 음악을 만들지 못했어요. 크레딧은 빠지지 않았어요. | Failed to create music. No credits were used. | 2회 |
| 보낸 뒤 | 편집 스튜디오로 보냈어요. | Sent to Editing Studio. | 2회 |
| 효과음 설명 칸 안내 | 어떤 소리인지 적어 주세요. 예: 탄산이 터지는 소리 | Describe the sound. e.g., Sparkling soda popping | 2회 |
| 효과음 길이 / 개수 | 길이 (2초, 5초, 10초, 직접 입력) / 만들 개수 | Length (2s, 5s, 10s, Custom) / Quantity | 2회 |
| 효과음 쓰임 안내 | 영상에 넣어서 쓰는 소리예요. 편집 스튜디오로 보내세요. | Add to a video in the Editing Studio. | 2회 |
| 빈 목록(효과음) | 만든 효과음이 없어요. | No sound effects yet. | 2회 |
| 실패(효과음) | 효과음을 만들지 못했어요. 크레딧은 빠지지 않았어요. | Failed to create sound effect. No credits were used. | 2회 |

"{seconds}초"의 값은 스모크 테스트에서 잰 뒤 정한다. 길이 도구의 세 제안 이름, 예시 설명 네 개, AI 생성 표시 한 줄은 구현 조각에서 같은 절차로 받는다.

### 4.8 첫 버전에서 만들지 않는 것

- 길이를 정해 만들기(엔진에 없다), 빠르기·조 조작.
- 참고 음원 올려서 비슷하게 만들기, 커버, 밖의 음원 이어 만들기.
- 특정 가수·곡 스타일, 목소리 지정.
- 구간 다시 만들기, 스템 분리.
- 효과음 반복 재생, 영상에서 효과음 자동 만들기.
- 여러 트랙 믹서, 음량·마스터링 옵션.
- 박자에 맞춘 자동 컷 편집(편집 스튜디오 E6), 영상을 읽고 음악을 제안하기(영상 분석의 약관 문제가 남아 있다, `docs/BRAND-EDITING-STUDIO.md` §8).
- 휴대폰 화면, 외부 공유 링크, 에이전트·API 접근.

## 5. 권리와 안전

| 상황 | 처리 | 약관에 필요한 것(문안은 대표·법무) |
| --- | --- | --- |
| 설명에 실제 가수·그룹·곡 이름 | 받지 않는다. 크레딧을 잡기 전에 이름 목록과 글 모델로 걸러 안내한다. 이름을 지우고 "그 가수 스타일"로 바꿔 보내는 자동 변환은 하지 않는다. 엔진 쪽에서도 거른다(Suno는 가수 이름을 지우고 음악적 특징으로 바꾼다고 밝혔고, Sunra 도움말은 스타일과 분위기로 설명하라고 적는다). 그래도 우리가 먼저 막아 크레딧과 시간을 쓰지 않게 한다 | 실존 아티스트·곡을 흉내 내는 요청 금지 |
| 가사: 고객이 직접 쓴 것 | 그대로 쓴다. 책임은 고객에게 있다 | 가사의 권리와 책임 |
| 가사: 기존 노래의 가사 | 받지 않는다. 글 모델이 널리 알려진 가사로 보이면 막고 안내한다. 걸리면 막는 것이고 통과가 보증은 아니다(짧은 인용까지 자동으로 가려내지 못한다) | 기존 가사 사용 금지 |
| 가사: 우리가 써 준 초안 | 새로 쓴 것이다. 초안에 가수·곡 이름이나 남의 상표가 들어가지 않게 지시문에 적는다 | 초안은 고객이 자유롭게 쓴다 |
| 가사 속 광고 표현 | 효능·치료·최상급 같은 광고 금지 표현은 가사에서도 광고 문구다. 첫 버전에서는 걸러 주지 않고 도움말에서 알린다 | 광고 표현의 책임 |
| 실제 가수 목소리를 닮은 보컬 | 목소리 지정·참고 음원·음색 변환 기능을 두지 않는다. 가수 이름을 막는 것이 곧 이 처리다 | 목소리 모방 금지 |
| 참고 음원 업로드, 밖의 음원 이어 만들기 | 없다. 엔진의 `upload`·`cover-mode`를 쓰지 않는다 | 나중에 열 때: 올린 음원의 권리 확인 |
| 결과가 기존 곡과 닮았다는 신고 | 만든 기록을 내주고, 해당 곡을 목록에서 내리며, 같은 설정으로 다시 만들지 않게 한다. 기존 권리 신고 경로를 쓴다 | 신고 처리 절차, 우리 책임의 범위 |
| 고객이 결과를 음원 식별 시스템이나 음원 유통사에 등록 | 화면에서 막을 수 없다. 약관으로 금지한다(같은 엔진의 다른 사용자가 비슷한 곡을 받을 수 있다) | 등록 금지 |
| 효과음의 쓰임 | 영상에 넣어 쓴다. 단독 파일 제공을 기본으로 두지 않는다(§4.4) | 효과음은 영상 등과 결합해 쓴다는 조건 |
| AI 생성 표시 | 내려받는 파일의 메타데이터 + 이용 조건 패널 한 줄(추천, §8-6) | 인공지능기본법 제31조 대응 |
| 부적절한 설명·가사 | 기존 스튜디오의 사전 검사 규칙. 막힌 요청은 크레딧을 잡지 않는다 | 기존 조항 |
| 음악·효과음 결과물의 이용 허락 | — | 이용 범위(광고·SNS), 사용료·표기 없음, 독점 아님, 저작권 보증 없음. **지금 약관에 없다** |

약관 문안은 쓰지 않았다. 위 표는 필요한 조항의 목록이다.

## 6. 저장소에 이미 있는 것

| 무엇 | 지금 상태 | 사운드 스튜디오에서 |
| --- | --- | --- |
| 음악 생성 `lib/brand-studio/music/{service,provider,contracts}.ts` | 닫혀 있다(`BRAND_STUDIO_MUSIC_GENERATION`이 정확히 `on`일 때만). 엔진을 환경변수로 고르고, Sunra 키가 있으면 ElevenLabs 음악 모델로 나간다. Suno 분기는 Sunra가 아니라 별도 주소(`SUNO_API_URL`)를 부르는 옛 길이다. 입력은 BPM·조·리드 악기·드롭 시점 중심, 3~60초, 보컬·가사 없음 | **다시 쓰지 않는다.** 새 엔진 어댑터로 놓고(§7.1) 정리 조각에서 걷어 낸다 |
| 작업 기록 | 음악·효과음을 `kind='video_final'`, `model='compose-1080p'`, `status='succeeded'`, `lane=null`로 처음부터 성공으로 적는다. 결과는 에셋에만 남는다 | 진짜 작업 종류와 결과 종류로(§7.2) |
| 과금 | 원가와 무관한 고정 공식 | §3.4 |
| 화면 | 편집 스튜디오의 생성 카드, 영상 스튜디오의 구간 음악 버튼·탭(플래그가 닫혀 보이지 않는다). 화면이 7~9초 뒤 기다리기를 그만두는 결함이 있다 | 두 화면의 음악·효과음 만들기를 사운드 스튜디오로 가는 문으로 바꾼다(정리 조각) |
| 효과음 `music/sfx.ts` | 열려 있다. `SUNRA_API_KEY`로 `elevenlabs/sound-effects/text-to-sound-effects`에 `text`, `duration_seconds`, `prompt_influence`를 보낸다. 호출하는 화면은 영상 스튜디오 한 곳 | 요청 모양을 SS5의 어댑터로 옮긴다. 그때까지 그대로 둔다 |
| 로컬 실행 부품 | 가짜 엔진(`BRAND_STUDIO_MUSIC_PROVIDER=fake`)과 합성음(`music/synth.ts`), 에셋 저장 도우미, Sunra 클라이언트(`createSunraClient`) | 그대로 쓴다 |
| 내 음원 올리기 | 된다. MP3·WAV 15MB, 에셋에 `오디오` 필터와 재생기 | SS1의 바탕 |
| 편집 스튜디오의 소리 | 배경 음악 하나(`ComposeBgm`) + 효과음 최대 24개(`sfxClips`) + 컷별 음량. 내보내기는 브라우저에서 섞는다(`compose/export-client.ts`). 배경 음악 시작점 조작·페이드·리미터는 없다(E5 예정) | 보내기의 도착지. 길이와 페이드는 사운드 스튜디오에서 맞춰 보낸다 |
| 프로젝트 저장 | `lib/brand-studio/video-projects/service.ts`의 `runVideoProjectOperation` | 배경 음악·효과음을 넣는 작업을 여기에 더한다(SS1) |
| 작업 만들기 | `POST /api/brand-studio`의 `job.create`(`lib/brand-studio/jobs.ts` `createStudioJob`), 종류별 스키마는 `contracts.ts`, 진행은 `engine.ts`·`finish.ts` | 종류 둘을 더한다(SS2, SS5) |
| 레인 | `sunra_api`, `sunra_mcp`. `mcp`가 없는 모델은 API 레인에서만 돈다. API 레인은 웹훅(`/api/brand-studio/webhook`)과 폴링 | 그대로 쓴다. 새 레인이 필요 없다 |
| 기능 정책 | 기능 그룹 `sound`. 샌드박스 조직은 기본 차단 목록에 들어 있고, 프로젝트 전용 조직은 셀프 스튜디오가 닫혀 있다 | 그대로 쓴다 |
| 레일 | `components/brand-workspace/rail-model.ts`(`RailItemId`, `RAIL_GROUP`, `railItems`) | `sound`를 `video` 다음, 묶음 `make`로 |
| 개인정보처리방침 수탁자 표 | Sunra 운영사가 이미지·영상·효과음 생성의 수탁자로 적혀 있다 | "음악"을 더해야 한다(법무, §8-3) |
| 사운드 디렉터(`docs/BRAND-PRODUCT.md` S5) | 계획만 있다 | 범위 밖. 듣고 판정하는 일은 S5에 남긴다 |

## 7. 빌드 계획

### 7.1 원칙

- 모두 플래그 `BRAND_SOUND_STUDIO` 뒤(정확히 `on`일 때만 열림, `lib/flags.ts`에 `brandSoundStudioOpen`, `studioEnv()`에 `soundStudio`). 꺼져 있으면 레일·페이지·API 모두 지금과 같다.
- 서버 진입점은 기존 순서를 지난다: `studioSeat(requireSelfStudio)` → `assertBrandFeature('sound')`. 샌드박스 조직과 `sound`가 닫힌 조직은 404.
- **엔진 어댑터**: 화면과 작업 기록은 엔진을 모른다. `lib/brand-studio/sound/engine.ts`에 인터페이스를 두고 엔진마다 파일 하나를 둔다(`engines/suno-sunra.ts`, `engines/elevenlabs-sfx-sunra.ts`, 로컬용 `engines/fake.ts`).

  ```ts
  interface MusicEngine {
    id: string;                       // 'suno-v6-sunra'
    capabilities: {
      lengthInput: false | { min: number; max: number };
      vocals: boolean; lyrics: boolean; careful: boolean;   // careful = Max Mode 같은 "더 공들이기"
      extend: boolean; inpaint: boolean; stems: boolean;
    };
    quoteUsd(request: MusicRequest): number;
    submit(request: MusicRequest): Promise<{ taskId: string }>;
    result(taskId: string): Promise<{ status: 'running' } | { status: 'failed'; code: string } | { status: 'ready'; clips: EngineClip[] }>;
    extend?(clip: EngineClipRef, at: number, request: MusicRequest): Promise<{ taskId: string }>;
  }
  ```

  화면은 `capabilities`를 보고 조작부를 그린다. 길이 입력이 되는 엔진으로 바꾸면 길이 칩이 생기고, `extend`가 없으면 이어 만들기 버튼이 사라진다. 엔진을 바꾸는 비용은 어댑터 파일 하나와 모델 등록 한 줄이다. 고르는 값은 서버 환경변수 하나(`BRAND_SOUND_MUSIC_ENGINE`, 기본 `suno-v6-sunra`)로 둔다. 효과음도 같은 모양의 `SfxEngine`이다.
- 매 조각은 AGENTS.md §3 검증 루프(tsc, vitest, build:local, sweep)를 통과한다. 문구는 `messages/studio-sound.ts`(ko·en)에 두고 하드코딩하지 않는다.

### 7.2 데이터 모델 (마이그레이션은 SS2에서 한 번)

`brand_studio_jobs`·`brand_studio_outputs`를 그대로 쓴다. 새 표는 없다.

- `brand_studio_jobs.kind` 검사 제약에 `'music'`, `'sound_effect'` 추가. 두 종류를 한 번에 넣어 SS5에서 마이그레이션을 다시 하지 않는다.
- `brand_studio_outputs.kind` 검사 제약에 `'audio'` 추가. 길이는 `duration_ms`, 파일은 `storage_key`·`mime`·`bytes`·`sha256`.
- `brand_studio_outputs.waveform jsonb`(새 칼럼, 비어도 됨): 목록에서 파형을 그릴 값 수백 개.
- 번호: 2026-11-20 기준 main의 마지막이 core 0099, glue 0171(0169는 없다)이므로 **core 0100**. 표와 RLS가 같아 glue는 필요 없을 것이다. PR 직전에 번호를 다시 확인한다. 클라우드 적용은 대표 또는 Director.
- 코드: `STUDIO_JOB_KINDS`에 두 종류, `StudioMedium`에 `'audio'`, 모델 등록에 `suno-v6`(`medium: 'audio'`, `mcp: null`)와 `elevenlabs-sfx`.
- 작업 행에 적는 것: 고객이 쓴 설명은 `prompt`, 엔진에 보낸 문장은 `final_prompt`(고객에게 보이지 않는다). `params`에 `mode`(`describe` · `custom` · `extend` · `trim`), `vocal`, `lyrics`, `title`, `careful`, `language`, 붙인 영상(`a:<id>`·`o:<id>`), **만든 시점의 조건 스냅숏**(엔진 id, 엔드포인트, 우리 약관 판). `work`에 엔진의 `task_id`와 클립별 `clip_id`(이어 만들기에 필요하다).
- 결과 행: 클립 하나가 결과 하나(`idx` 0부터). 버전 관계는 `parent_output_id`. 길이 도구로 만든 파생본은 `mode: 'trim'`, 견적 0의 작업 행 + 결과 하나(무료 내보내기가 0원 행을 남기는 방식과 같다).
- 삭제는 `deleted_at`. 작업 행은 남고 만든 기록은 거기서 만든다.
- 사용량: `usageKrw(usd, 'audio')`를 더하고 계수는 이미지 계수를 잠정으로 쓴다(§3.4). 음악은 요청 1건으로 정산한다.

### 7.3 SS1 방과 목록 (생성 없음, 마이그레이션 없음)

**무엇이 생기나**: 레일에 사운드 스튜디오, 그 페이지에서 조직의 오디오를 듣고 편집·영상 스튜디오로 보낸다. 크레딧을 쓰는 것은 없다.

| 항목 | 내용 |
| --- | --- |
| 플래그 | `lib/flags.ts` `brandSoundStudioOpen`, `lib/brand-studio/env.ts`의 `soundStudio` |
| 레일 | `rail-model.ts`: `RailItemId`에 `'sound'`, `RAIL_GROUP.sound = 'make'`, `railItems`에서 `video` 다음. 보이는 조건은 스튜디오 표시 + 플래그 + `sound` 미차단. `rail-nav.tsx`에 아이콘과 이름, `messages/studio-shell.ts`에 이름. 홈 카드(`components/brand-workspace/home/`)에도 한 장 |
| 페이지 | `app/(brand)/brand/studio/sound/page.tsx`(서버): 플래그·좌석·`sound` 확인 뒤 아니면 `notFound()`. 화면은 `components/brand-studio/sound/`(목록, 줄, 재생기, 파형, 보내기 창) |
| 목록 데이터 | 기존 에셋 조회에서 `kind='audio'`(올린 음원과 예전 생성분). 최신순, 이름 검색, 좋아요 |
| 듣기 | 줄의 재생 버튼, 펼치면 큰 파형과 재생 위치. 파형은 SS1에서는 브라우저가 파일을 풀어 그린다(보이는 줄만) |
| 올리기 | 기존 업로드 길(MP3·WAV 15MB) |
| 보내기 | `runVideoProjectOperation`에 작업 둘을 더한다: 배경 음악 넣기(프로젝트 id 또는 새 프로젝트, 에셋 id → `ComposeBgm`을 채워 저장, 이미 있으면 바꾸기 확인을 받아 온 요청만 덮는다), 효과음 넣기(→ `sfxClips`에 추가, 24개 한도). 에셋이 그 조직의 오디오인지 서버가 확인한다 |
| 문구 | `messages/studio-sound.ts` 새 파일(ko·en). §4.7의 ① 문구 |
| 테스트 | 레일 순서와 표시 조건, 페이지 404 표(플래그 꺼짐·`sound` 차단·샌드박스 조직·프로젝트 전용 조직), 보내기 작업 둘(권한, 다른 조직 에셋 거절, 오디오가 아닌 에셋 거절, 덮어쓰기 확인, 24개 한도), 사전 키 누락, 플래그가 꺼졌을 때 레일·홈이 지금과 같은지 |
| 실제 화면 확인 | 로컬 모드에서 음원 둘을 올린다. 1440×900과 1280×720에서 줄 다섯 개가 보이는지, 재생·검색·좋아요가 되는지 본다. 한 곡을 편집 스튜디오 프로젝트로 보내고, 편집 스튜디오에서 그 곡이 배경 음악으로 들리는지, 내보낸 MP4에 오디오 트랙이 있는지(ffprobe) 확인한다. 영상 스튜디오 프로젝트에도 같은 확인 |

이 조각만으로 "영상 스튜디오에는 내 음원을 배경 음악으로 넣을 길이 없다"(`docs/BRAND-EDITING-STUDIO.md` §8)가 풀린다.

### 7.4 SS2 음악 만들기: 설명 방식

**무엇이 생기나**: 음악 탭의 입력 독에서 설명과 보컬 여부만으로 곡을 만든다.

| 항목 | 내용 |
| --- | --- |
| 마이그레이션 | §7.2 전부(core 0100, 번호 재확인). 클라우드 적용 필요 |
| 요청 | `job.create`에 `kind: 'music'`. 필드: `organizationId`, `requestId`, `mode: 'describe'`, `prompt`(우리 한도 1,000자), `vocal`(기본 false), `language`(보컬 있음이고 가사가 없을 때 설명 끝에 붙일 언어) |
| 준비 | 가수·곡 이름 검사(걸리면 크레딧을 잡기 전에 `invalid`와 안내 문구). 설명을 엔진용 문장으로 다시 짠다(기존 enhancer 자리에 음악 규칙 한 벌). 이름 짓기(목록용, 80자 안) |
| 견적과 예약 | `quoteUsd` $0.10 → `usageKrw(…, 'audio')` 16크레딧. 요청 1건으로 예약 |
| 엔진 호출 | `engines/suno-sunra.ts`: `suno/suno-v6/inspire-mode`에 `{ prompt, instrumental: !vocal }`. 레인 배정은 기존 `routeJob`(모델 `mcp: null` → API 레인). 웹훅 주소는 기존 것 |
| 결과 받기 | `clips[]`의 클립마다 `audio_url`을 받아 저장소에 넣고 결과 행을 만든다(`kind: 'audio'`, `duration_ms`, `sha256`). `task_id`·`clip_id`·엔진이 돌려준 `lyrics`는 `work`에. 클립이 0개면 실패 처리와 환불 |
| 파형 | 결과를 처음 여는 브라우저가 파형 값을 계산해 서버에 저장한다(소유자 브라우저가 첫 프레임을 올리는 기존 방식과 같다). 그 뒤에는 저장된 값으로 그린다 |
| 화면 | 입력 독(설명, 보컬), 버튼의 크레딧, 만드는 동안의 줄과 진행, 끝난 뒤 A·B… 줄, 펼친 줄(파형, 가사, 행동), 실패 줄, 내려받기, 에셋에 저장, SS1의 보내기 |
| 로컬 | `engines/fake.ts`가 길이가 다른 합성음 두 개를 돌려준다(`music/synth.ts` 재사용). 유료 호출 없이 화면 전체가 돈다 |
| 테스트 | 요청 스키마, 어댑터의 요청 모양(카탈로그 스키마를 고정 자료로), 견적 일치(16), 요청 1건 정산(클립 2개여도 16, 0개면 0), 가수 이름 거르기, 실패 환불, 404 표, 레인 배정(`mcp: null`이면 선호 레인이 계정 레인이어도 API 레인) |
| 실제 화면 확인 | 로컬: 설명을 넣고 만들기 → 두 줄이 생기고 재생되는지, 크레딧 표시가 16 줄었는지, 1280×720에서 독과 줄이 겹치지 않는지. 운영 테스트 조직: 스모크 테스트(§7.7)의 1·2번에 해당하는 요청으로 실제 곡을 받아 재생·보내기·내려받기까지 |

### 7.5 SS3 음악 만들기: 직접 지정 방식 (가사·스타일·Max Mode)

**무엇이 생기나**: 보컬 있음을 고르면 가사 칸이 열리고, 가사를 쓰거나 초안을 받아 노래를 만든다. "더 고르게 만들기" 스위치가 생긴다.

| 항목 | 내용 |
| --- | --- |
| 요청 | 같은 `kind: 'music'`에 `mode: 'custom'`. 추가 필드: `lyrics`(우리 한도 3,000자, 엔진 한도 5,000자), `careful`(Max Mode). 방식은 서버가 정한다: 가사가 있거나 `careful`이면 `custom`, 아니면 `describe` |
| 준비 | `title`(80자 안)과 `style`(1,000자 안)을 설명에서 만든다. 가사에 구간 표시를 붙인다. 가사 검사: 가수·곡 이름, 널리 알려진 기존 가사로 보이는지(걸리면 막고 §4.7의 안내) |
| 견적 | $0.10 → 16크레딧, `careful`이면 $0.20 → 32크레딧 |
| 엔진 호출 | `suno/suno-v6/custom-mode`에 `{ title, style, lyrics, instrumental: !vocal, max_mode: careful }`. 보컬 없음 + `careful`이면 `lyrics`를 비우고 `instrumental: true` |
| 가사 초안 | 새 작업 `lyrics.draft`(`/api/brand-studio`의 작업 하나): 주제·언어·분위기 → 우리 글 모델이 구간이 나뉜 가사를 돌려준다. 크레딧 없음, 사용자별 호출 수 제한. 모델 호출은 기존 Gemini 클라이언트를 쓴다(모델은 편집 스튜디오의 말로 편집과 같은 것을 기본으로, 환경변수로만 바꾼다) |
| 화면 | 보컬 있음 → 가사 칸(글자 수, 초안 버튼, 언어 안내), 스위치와 두 배 표시, 펼친 줄에 가사 표시, "설정 다시 쓰기"가 가사와 스위치까지 돌려준다 |
| 테스트 | 방식 결정 규칙, 어댑터 요청 모양, 견적(16·32), 가사 한도, 가사 검사(막힘은 크레딧을 잡지 않는다), 초안 작업의 권한과 제한, 사전 키 |
| 실제 화면 확인 | 로컬: 한국어 가사를 넣어 만들기 → 줄에 가사가 보이고 크레딧이 16(스위치 켜면 32) 줄었는지, 초안 버튼이 가사 칸을 채우는지. 운영 테스트 조직: 스모크 테스트의 3·4·5번에 해당하는 요청 |

### 7.6 그다음 조각

| 조각 | 내용 | 확인 |
| --- | --- | --- |
| SS4 길이 도구 | §4.3의 1~5. 파생본은 `mode: 'trim'`의 0원 작업. 이어 만들기는 `mode: 'extend'`, 어댑터의 `extend`가 있을 때만 | 18.0초로 맞춘 파일의 실제 길이와 끝 1.5초의 음량 곡선을 재서 보고. 박에 붙는지는 박이 뚜렷한 곡 셋으로. 이어 만들기는 스모크 테스트 결과에 따라 |
| SS5 효과음 탭 | §4.4. `kind: 'sound_effect'`, `engines/elevenlabs-sfx-sunra.ts`, 개수만큼의 작업, 편집·영상 스튜디오 효과음 줄로 보내기 | 로컬 가짜 엔진으로 4개 만들기, 운영 테스트 조직에서 실제 효과음 |
| SS6 영상에 맞춰 | 음악 탭에서 영상을 붙이면 결과가 오자마자 길이 도구가 그 영상 길이로 열린다. 영상과 같이 보기 | 영상 길이와 맞춘 음악 길이의 차이 0.1초 이내 |
| 정리 | 편집·영상 스튜디오의 옛 음악·효과음 길 제거(옛 엔진 분기, 서로 다른 라이선스 표시, 고정 크레딧, 가짜 `video_final` 행), 두 화면의 문을 사운드 스튜디오로, `BRAND_STUDIO_MUSIC_GENERATION` 퇴역 | 플래그가 꺼진 화면이 지금과 같은지 |

**출시**: 조각마다 테스트 조직에서 확인한다. SS3까지 확인되면 셀프 스튜디오가 열린 조직에 연다(샌드박스 조직 제외). SS4가 그 전에 들어가는 편이 낫다. 길이 도구 없이는 30초 광고에 몇 분짜리 곡을 그대로 받게 된다.

### 7.7 유료 스모크 테스트 견적 (대표 승인 뒤 실행)

엔진 비교용 청음 테스트는 하지 않는다(엔진이 정해졌다). 짓기 전에 모르는 것을 확인하는 작은 호출이다. 전부 Sunra API 레인(`SUNRA_API_KEY`의 잔액)에서 나간다.

| # | 호출 | 값 | 알게 되는 것 |
| --- | --- | --- | --- |
| 1 | 설명 방식, 보컬 없음(스킨케어 광고용 어쿠스틱) | $0.10 | 한 요청에 클립이 몇 개 오는지, 곡 길이, 걸리는 시간, 파일 형식, 결과 주소가 살아 있는 시간 |
| 2 | 설명 방식, 보컬 있음, 한국어로(가사 없이) | $0.10 | 가사 없이 언어가 지켜지는지 |
| 3 | 직접 지정, 한국어 가사 | $0.10 | 한국어 발음, 가사를 그대로 부르는지 |
| 4 | 직접 지정, 영어 가사 + Max Mode | $0.20 | 스위치의 차이가 들리는지 |
| 5 | 직접 지정, 보컬 없음 + 스타일(패션 필름 하우스) | $0.10 | 스타일 지정이 설명 방식보다 나은지 |
| 6 | 이어 만들기(1번 결과에) | $0.10 | 예전 이름의 엔드포인트가 v6 클립을 받는지 |
| 7 | 엔진 쪽 자르기(1번 결과에) | $0.002 | 같은 확인 |
| 8 | 효과음 5초 × 4개 | $0.04 | 품질, 길이 준수, 걸리는 시간 |
| 9 | 효과음 22초 × 1개 | $0.044 | 최장 길이 |
| | **합계** | **약 $0.79** | |

API 키 잔액이 $1 이상 있어야 한다(오늘 잔액은 확인 못 함). 결과는 내부 확인에만 쓴다. 승인 전에는 아무것도 실행하지 않는다.

## 8. 대표께 남은 결정 (열린 것만, 추천을 먼저)

1. **스모크 테스트를 진행할까요?** 추천: 진행. 약 $0.79, Sunra API 레인 키 잔액에서 나간다(§7.7).
2. **API 레인 잔액을 채워 주시겠어요?** 음악은 API 레인에서만 돈다(§3.3). 잔액이 없으면 작업이 보류된다. 충전은 대표가 한다. 추천: 스모크 테스트 전에 잔액을 확인하고, 출시 뒤에는 잔액이 낮을 때 알림이 가게 한다(알림은 구현 항목).
3. **화면의 이용 조건 문장과 약관 조항을 확정해 주시겠어요?** 추천: §4.7의 † 문장을 그대로 쓰고 "저작권 없는 음악"이라는 말은 화면에 쓰지 않는다(§2). 약관에 음악·효과음 결과물 조항(§5의 목록)을 넣고, 개인정보처리방침 수탁자 표에 "음악"을 더한다. 문안은 대표·법무.
4. **"더 고르게 만들기"(Max Mode, 크레딧 두 배)를 고객에게 보일까요?** 추천: 스모크 테스트 4번에서 차이가 들리면 스위치로 보이고, 들리지 않으면 숨긴다.
5. **효과음 파일만 따로 내려받게 할까요?** 추천: 두지 않는다. 효과음은 영상에 넣어 쓰는 흐름으로만(§3.2, §4.4).
6. **AI 생성 표시를 어떻게 할까요?** 추천: 내려받는 파일의 메타데이터 + 이용 조건 패널의 한 줄. 화면에 배지를 붙이지 않는다. Suno는 자체 앱에서 내려받는 곡에 AI 생성 메타데이터를 붙인다고 밝혔는데 Sunra 경유 파일에도 붙는지는 스모크 테스트에서 본다. 법무 확인.
7. **크레딧을 §3.4의 잠정값으로 시작할까요?** 추천: 그대로 시작(음악 16, Max 32, 이어 만들기 16, 효과음 5초 2). 숫자는 대표가 언제든 바꾼다.
8. **Sunra에 글로 된 확인을 받아 둘까요?**(선택) 추천: 보내 둔다. 출시와 묶지 않는다. 초안은 부록 A, 문안과 발송은 대표.
9. **편집·영상 스튜디오의 옛 음악·효과음 만들기를 사운드 스튜디오로 모을까요?** 추천: 모은다(§7.6 정리 조각).

이미 정해져 이 목록에서 뺀 것: 엔진, 상업 이용, 보컬과 가사(넣는다), 실행 위치(API 레인), 공개 대상과 순서(테스트 조직 확인 뒤 셀프 스튜디오가 열린 조직, 샌드박스 제외), 엔진 비교 청음 테스트(하지 않는다).

**범위 밖에서 본 것 하나.** Sunra 약관(2026-11-17)은 Creative 계정(구독 크레딧, CLI·MCP)으로 다른 사람이 콘텐츠를 만드는 서비스를 돌리지 말고 소프트웨어 통합에는 API를 쓰라고 적는다. 지금 이미지·영상 생성의 운영 기본인 계정 레인이 이 문장에 닿는지는 이 문서의 범위가 아니지만, 대표가 알고 판단할 일이라 적어 둔다. 인용은 `research/…/suno-via-sunra.md`.

## 9. 엔진을 바꿔야 할 때의 대안

Suno 길이 막히거나(모델이 내려간다, 조건이 바뀐다) 다른 엔진이 필요해질 때를 위해 처음 조사를 줄여 남긴다. 인용과 링크는 `docs/research/brand-sound-studio-2026-11-20/`에 있다. 어댑터 하나를 더하면 된다(§7.1).

| 엔진 | 상업 이용 근거 | 원가 | 길이 지정 | 보컬 | 운영 | 메모 |
| --- | --- | --- | --- | --- | --- | --- |
| Stable Audio 3.0 API | 약관이 결과물 권리를 양도하고, 자기 제품에 넣어 최종 사용자에게 제공하는 것을 글로 허용한다. "trained on fully licensed data" | 곡당 $0.08 (6분까지) | 된다 | 없다 | 없음 | 연주곡 대안 1순위. 새 계정 필요 |
| ElevenLabs 음악, 직접 API | 온라인 광고·SNS 허용(영화·TV·라디오 제외). 회사는 Scale(직원 10명 미만, 월 $299) 이상. 고객이 직접 만드는 구조는 서면 확인 필요 | 분당 $0.15 + 월 고정비 | 3초~10분 | 된다 | 없음 | 구간 구성, 영상에 맞춘 음악, 스템. 대표가 2026-11-18에 음악에는 쓰지 않기로 했다 |
| Google Lyria 3.5 | "Google does not assert any ownership rights…". 결과물 면책 목록에는 없음. SynthID 워터마크 | 곡당 $0.08 (184초까지) | 안 된다 | 된다(한국어 포함) | 없음 | 보컬 대안 |
| ACE-Step 1.5 XL 자체 운영 | 가중치 MIT, 모델 카드가 상업 이용 명시. 학습 데이터가 합법이라는 말은 제작사 주장 | GPU 초(곡당 요금 없음) | 10초~10분 | 된다(한국어 품질 모름) | GPU·워커·새 레인 | 물량이 월 수천 곡을 넘거나 업체 의존을 줄일 때. 워크스테이션 ComfyUI에 노드는 있고 가중치는 없다 |
| YuE2 | 가중치 CC BY-NC 4.0. 회사의 상업 이용은 m-a-p와 별도 계약 | GPU 초 | 안 된다 | 된다 | GPU | 계약 없이는 쓸 수 없다 |
| MiniMax Music 3.0 (Sunra) | Sunra 카탈로그 `commercial_use: true`. 자체 API는 신규 사용자에게 닫힘 | 곡당 $0.16 (75초까지) | 1~75초 | 된다 | 없음 | API 레인만 |

공개 블라인드 순위(Artificial Analysis Music Arena, 날짜 없는 페이지): 연주곡 Suno v6 1위(1148), Lyria 3 Pro 5위(1080), Stable Audio 3 Large 8위(1014), Eleven Music v2.5 11위(1001). 보컬 Suno v6 2위(1144). 인용할 수 있는 음질 근거에서는 대표가 고른 엔진이 가장 위다. 우리 귀로는 아직 어느 것도 들어 보지 않았다.

## 10. 확인하지 못한 것

- Suno 한 요청이 Sunra를 거쳐 돌려주는 클립 수, 곡 길이의 범위, 걸리는 시간, 파일 형식, 결과 주소가 살아 있는 시간(스모크 테스트).
- 예전 이름의 `extend`·`clip`·`inpainting`이 v6 클립을 받는지, 그 이름들이 언제까지 남는지.
- 한국어 보컬과 가사 없는 보컬 요청의 언어 준수, Max Mode의 차이.
- Sunra API 레인 키의 오늘 잔액, 배포 환경에 `ELEVENLABS_API_KEY`가 있는지.
- Sunra가 Suno·ElevenLabs 모델을 어떤 계약으로 제공하는지(부록 A의 질문).
- 효과음 "자동" 길이의 과금 방식(그래서 길이를 항상 지정한다).
- 인공지능기본법 시행령 제23조 원문. 제31조와 한국저작권위원회 안내서 인용은 조사 도구가 읽어 온 값이라 법무 검토 때 원문을 다시 본다.

## 11. 조사 근거

`docs/research/brand-sound-studio-2026-11-20/`

- `suno-via-sunra.md` — Sunra 카탈로그의 Suno 입력·가격·길이 엔드포인트, 계정 레인과의 차이, Suno 약관과 Sunra 약관에서 읽은 것(원문 대조).
- `sunra-catalogue.md` — Sunra의 음악·효과음 모델 전체와 `commercial_use` 표시.
- `elevenlabs-terms.md`, `elevenlabs-capability-price.md`, `elevenlabs-sunra-and-repo.md` — ElevenLabs 약관 인용(효과음 포함), API 기능과 가격, 저장소의 기존 코드.
- `open-model-licences.md`, `api-vendors.md` — 다른 엔진의 라이선스·가격 인용(§9의 근거), 법 배경.
- `local-music-workspace.md` — 로컬 음악 작업공간(YuE2)의 라이선스와 실측.

## 부록 A. Sunra에 보내는 확인 질문 (초안, 선택 사항)

출시 조건이 아니다. 글로 된 기록을 남겨 두려는 것이다. 문안과 발송은 대표가 확정한다.

**English**

> Subject: Written confirmation on output rights for Suno and ElevenLabs sound-effect models via the Sunra API
>
> Hello,
>
> We are adding music and sound-effect generation to our B2B product on the Sunra API. For our records, could you confirm the following in writing?
>
> Models: `suno/suno-v6` and `suno/suno-v6-wild` (inspire-mode, custom-mode), the `extend`, `clip` and `inpainting` endpoints under `suno/suno-v5.5-relay`, and `elevenlabs/sound-effects` (text-to-sound-effects).
>
> 1. Commercial use. May outputs generated with these models through your API be used commercially, in paid online advertising and in social media posts, worldwide and without a time limit, with no royalties and no attribution? Are any media excluded (TV, radio, film, games)?
> 2. Our customers. We generate at the request of our business customers inside our product and deliver the audio to them; they publish it. Is that permitted, and does anything have to appear in our own terms?
> 3. Upstream. Under which agreement with Suno and with ElevenLabs do you provide these models, and which upstream terms apply to outputs generated through you?
> 4. Claims. Do you, Suno, ElevenLabs or their licensors register these outputs with any content-identification system, or keep any right to claim or monetise them? Are outputs watermarked or fingerprinted?
> 5. Withdrawal. If a model or endpoint is withdrawn (for example the "relay" endpoints), do the rights in tracks already generated continue?
> 6. Your catalogue marks many models `commercial_use: true` but not these. What does the mark mean, and why is it absent here?
>
> A short answer per point is enough. Thank you.

**한국어**

> 제목: Sunra API의 Suno·ElevenLabs 효과음 모델 결과물 이용 범위 확인 요청
>
> 안녕하세요.
>
> 저희 B2B 제품에 Sunra API로 음악과 효과음 생성을 넣고 있습니다. 기록으로 남겨 두려고 아래 내용을 글로 확인 부탁드립니다.
>
> 대상 모델: `suno/suno-v6`, `suno/suno-v6-wild`(inspire-mode, custom-mode), `suno/suno-v5.5-relay`의 `extend`·`clip`·`inpainting`, `elevenlabs/sound-effects`(text-to-sound-effects).
>
> 1. 상업 이용: 이 모델들로 Sunra API에서 만든 결과물을 온라인 유료 광고와 SNS 게시물에, 지역과 기간 제한 없이, 사용료와 출처 표기 없이 써도 됩니까? 제외되는 매체(TV, 라디오, 영화, 게임)가 있습니까?
> 2. 저희 고객: 저희는 고객사의 요청으로 제품 안에서 음원을 만들어 고객사에 전달하고, 게시는 고객사가 합니다. 허용됩니까? 저희 약관에 넣어야 하는 내용이 있습니까?
> 3. 상위 계약: Suno, ElevenLabs와 어떤 계약으로 이 모델들을 제공하고 계시며, Sunra를 거쳐 만든 결과물에는 어느 쪽 약관이 적용됩니까?
> 4. 권리 주장: Sunra, Suno, ElevenLabs 또는 그 권리자가 이 결과물을 콘텐츠 식별 시스템에 등록하거나, 권리를 주장하거나 수익화할 권리를 갖습니까? 결과물에 워터마크나 지문이 들어갑니까?
> 5. 모델 중단: 모델이나 엔드포인트(예: "relay" 엔드포인트)가 내려가도 이미 만든 곡의 이용 권리는 유지됩니까?
> 6. 카탈로그의 `commercial_use: true` 표시가 이 모델들에는 없습니다. 이 표시는 무엇을 뜻하고, 여기에 없는 이유는 무엇입니까?
>
> 항목별로 짧게 답해 주시면 충분합니다. 감사합니다.
