# 가사 모델 블라인드 비교 — 방법과 결과 (2026-11-20)

> 블라인드 시트(`lyrics-blind-sheet.md`)를 먼저 읽고 고른 뒤에 이 파일을 본다. 이 파일에는 모델 이름과 한 사람(설계 세션)의 순위가 들어 있다.

## 방법

- 대상: Gemini 개발자 API에서 이 키로 부를 수 있는 글 모델 다섯: `gemini-3.8-flash`, `gemini-4-hydrogen`, `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-neon`.
- 과제: 브리프 8종(광고 징글, 감성 브랜드 필름, 숏폼, 제품 출시, 시즌 프로모션, 키즈, 럭셔리, 코믹) × 한국어·영어 = 16개. 브랜드 이름은 모두 지어낸 것이다.
- 조건: 모든 모델에 같은 지시문(아래 "지시문")과 같은 브리프. `responseMimeType: application/json` + 스키마(`title`, `style`, `lyrics`, `hook`), `thinkingLevel: LOW`, 출력 상한 2,500토큰, 온도 미지정. 브리프당 한 번씩만 호출했다(재시도 없음).
- 블라인드: 브리프마다 모델 순서를 고정 시드로 섞어 A~E로 표시했다. 순위는 시트만 보고 매긴 뒤 열쇠(`lyrics-blind-key.md`)를 열었다.
- 비용: 실제 **$0.838**(대표 승인 상한 $1.00). 정가(100만 토큰당 입력/출력: 3.8 Flash $0.75/$3.75, Hydrogen $1.50/$7.50, Argon·Carbon $2/$10, Neon $3/$15)에 응답의 토큰 수를 곱했고, 생각 토큰은 출력으로 셌다.
- 한계: 읽은 사람이 한 명이고 브리프당 한 번이다. 글로 읽은 판단이지 노래로 불러 본 것이 아니다. 작은 차이는 우연일 수 있다.

## 객관 지표 (스크립트로 센 것)

| model | n | [Outro] | [End] | brand in hook | must-include | hook copied | cliché hit | superlative | brand > 3 | KO syllables in target | KO hard-coda line ends | style "no X" | avg s | avg thinking tokens | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | 16 | 16 | 16 | 7 | 16 | 14 | 0 | 0 | 2 | 7/8 | 3/62 | 3 | 4.5 | 0 | $0.025 |
| gemini-4-hydrogen | 16 | 16 | 16 | 12 | 16 | 16 | 0 | 0 | 0 | 8/8 | 0/54 | 1 | 10.8 | 935 | $0.170 |
| gemini-4-argon | 16 | 16 | 16 | 12 | 16 | 16 | 0 | 0 | 0 | 3/8 | 5/58 | 0 | 10.2 | 0 | $0.081 |
| gemini-4-carbon | 16 | 16 | 16 | 14 | 16 | 16 | 0 | 0 | 0 | 4/8 | 1/62 | 0 | 9.1 | 0 | $0.080 |
| gemini-4-neon | 15 | 15 | 15 | 9 | 15 | 15 | 0 | 0 | 0 | 6/7 | 0/42 | 0 | 21.1 | 1469 | $0.440 |

- `[Outro]`·`[End]`, 꼭 넣을 말, 뻔한 말·최상급 표현은 다섯 모델 모두 지시를 지켰다.
- "KO syllables in target"은 한국어 가사의 음절 수가 목표 길이의 범위(15초 20~30, 25초 35~55, 30초 45~60, 45초 65~95, 60초 90~120)에 든 횟수다. 이 범위는 근거가 약한 가정이라(문서 §12.1) 지시를 따랐는지만 본다.
- "KO hard-coda line ends"는 줄 끝이 ㄱ·ㄷ·ㅂ 계열 받침으로 끝난 줄의 수다(적을수록 지시에 맞다).
- "brand in hook"은 `hook` 칸에 브랜드 이름이 든 횟수, "brand > 3"은 브랜드 이름을 네 번 넘게 쓴 횟수다.
- Neon은 한 과제(brandfilm-ko)에서 생각 토큰이 출력 상한을 다 써서 실패했다.

## 한 사람의 블라인드 순위 (열쇠를 연 뒤)

| model | KO mean rank (1 best, 5 worst) | EN mean rank | all | firsts | lasts |
| --- | --- | --- | --- | --- | --- |
| 4-argon | 2.75 (n=8) | 2.25 (n=8) | 2.50 | 5 | 1 |
| 4-neon | 3.57 (n=7) | 2.50 (n=8) | 3.00 | 2 | 2 |
| 4-carbon | 3.12 (n=8) | 3.00 (n=8) | 3.06 | 1 | 2 |
| 3.8-flash | 2.71 (n=8) | 3.62 (n=8) | 3.17 | 6 | 6 |
| 4-hydrogen | 2.92 (n=8) | 3.62 (n=8) | 3.27 | 2 | 5 |

| brief | 1st | 2nd | 3rd | 4th | 5th |
| --- | --- | --- | --- | --- | --- |
| jingle-ko | 3.8-flash | 4-neon | 4-argon | 4-carbon | 4-hydrogen |
| brandfilm-ko | 4-argon | 4-hydrogen | 3.8-flash | 4-carbon |  |
| shortform-ko | 3.8-flash | 4-carbon | 4-argon | 4-hydrogen | 4-neon |
| launch-ko | 3.8-flash | 4-hydrogen | 4-neon | 4-argon | 4-carbon |
| seasonal-ko | 4-hydrogen | 4-carbon | 4-argon | 4-neon | 3.8-flash |
| kids-ko | 3.8-flash | 4-carbon | 4-argon | 4-neon | 4-hydrogen |
| luxury-ko | 4-hydrogen | 4-neon | 4-carbon | 4-argon | 3.8-flash |
| comedic-ko | 4-argon | 4-carbon | 4-hydrogen | 3.8-flash | 4-neon |
| jingle-en | 4-carbon | 4-argon | 4-hydrogen | 4-neon | 3.8-flash |
| brandfilm-en | 4-argon | 4-carbon | 4-neon | 3.8-flash | 4-hydrogen |
| shortform-en | 3.8-flash | 4-argon | 4-neon | 4-carbon | 4-hydrogen |
| launch-en | 4-argon | 4-hydrogen | 4-neon | 4-carbon | 3.8-flash |
| seasonal-en | 4-neon | 4-hydrogen | 4-carbon | 4-argon | 3.8-flash |
| kids-en | 3.8-flash | 4-carbon | 4-neon | 4-hydrogen | 4-argon |
| luxury-en | 4-neon | 4-argon | 3.8-flash | 4-carbon | 4-hydrogen |
| comedic-en | 4-argon | 4-neon | 4-hydrogen | 4-carbon | 3.8-flash |

평균 순위는 1이 가장 좋고 5가 가장 나쁘다(네 편만 있는 과제는 1~5로 환산).

## 과제별 메모 (블라인드 상태에서 적은 것)

| 과제 | 순서(좋은 쪽부터) | 메모 |
| --- | --- | --- |
| jingle-ko | B > D > A > E > C | B의 '내 맘도 맑게 모아'는 브랜드 이름으로 말장난이 된다. C는 줄바꿈이 글자 그대로(\n) 나온 형식 결함이 있고 브랜드가 후크에 없다. |
| brandfilm-ko | A > D > C > B | A는 장면이 보이고 구성이 가장 완결돼 있다. D는 '크게 달라질 건 없지만'으로 과장 없는 톤을 가장 잘 지켰다. B는 말투가 섞이고 2절이 끊긴다. |
| shortform-ko | C > A > D > E > B | C는 브랜드 이름을 박자 찍는 말로 세 번 쓰고 '내 발에 착'이 산다. B는 '그냥 나가'의 반복이 단조롭다. |
| launch-ko | A > C > E > B > D | A의 5음절 두 줄 후크('소음은 끄고 / 음악만 남겨')가 가장 세련됐다. D의 '귀에 걸어'는 이어폰에 어색하다. |
| seasonal-ko | D > C > A > E > B | D는 기한을 두 번 말하고 '두툼한 코트도 가볍게'가 메시지를 한 줄로 담는다. B의 '이번 주말까지 다'는 어색하다. |
| kids-ko | D > A > E > C > B | 모두 쓸 만하다. D는 추임새와 색깔 묘사로 따라 부르기 가장 좋다. |
| luxury-ko | B > C > D > E > A | B는 방·창틈·옷깃의 구체적인 그림과 '남아/누아'의 자연스러운 운. C는 가장 말수가 적어 브리프에 충실하다. A는 말투가 섞이고 일반적이다. |
| comedic-ko | C > A > D > E > B | C의 '양말도 아직 한 짝인데'가 유일하게 웃긴 구체적인 그림이다. B는 줄이 길고 '현관문이 들썩들썩 신나네'가 어색하다. |
| jingle-en | D > A > E > B > C | D의 'Clears the clouds away'. C의 'wake on up with Moa'는 어색하다. |
| brandfilm-en | B > D > C > A > E | B의 'This is what makes me, me / Harugyeol, quietly'가 가장 자연스럽다. |
| shortform-en | E > C > D > A > B | E의 'Lace 'em up and StepOn' 반복이 후크로 가장 강하다. |
| launch-en | D > C > A > E > B | D의 짧은 네 줄이 톤에 가장 맞는다. B의 'Right on time'은 뜬금없다. |
| seasonal-en | D > B > E > A > C | D는 기한과 혜택이 분명하다. C의 'Bundle up in all the clothes'는 어색하다. |
| kids-en | A > E > D > C > B | A와 E 모두 운이 쉬워 따라 부르기 좋다. |
| luxury-en | C > A > E > D > B | C의 'A trace of you / Refuses to go'. B의 'Velvet on the skin'은 뻔하다. |
| comedic-en | B > A > D > C > E | B의 'I am still in one sock'이 가장 무표정하게 웃긴다. |

## 읽은 결론

- **뚜렷한 1등은 없다.** 전체 평균은 Argon(2.50)이 가장 좋고 1위 5번, 꼴찌 1번으로 가장 고르다.
- **3.8 Flash는 갈린다.** 1위가 6번으로 가장 많고 꼴찌도 6번이다. 짧고 리듬이 중요한 과제(징글, 숏폼, 출시, 키즈)에서 1위였고, 절제나 정보 전달이 필요한 과제(럭셔리, 시즌 프로모션, 코믹 영어)에서 꼴찌였다. 한국어만 보면 평균 2.71로 Hydrogen(2.92)보다 조금 앞선다. 지시 준수는 가장 약하다(후크에 브랜드 7/16, 브랜드 과다 2번, 스타일의 "no X" 3번).
- **Hydrogen은 지시를 가장 잘 지키지만**(음절 범위 8/8, 줄 끝 받침 0) 읽는 맛의 순위는 낮았고(1위 2번, 꼴찌 5번), 한 번은 줄바꿈이 글자 그대로(`
`) 나왔다. LOW에서도 생각 토큰을 평균 935개 써서 호출당 비용이 Argon의 두 배다.
- **Neon은 이 용도에 맞지 않는다.** 가장 느리고(평균 21초) 가장 비싸며(호출당 약 $0.03) 한 번 실패했다. 영어는 좋았다(2.50).
- 호출당 비용과 시간(실측): 3.8 Flash $0.0016·4.5초, Argon $0.0050·10.2초, Carbon $0.0050·9.1초, Hydrogen $0.0106·10.8초, Neon $0.030·21.1초. Argon과 Carbon은 2026-12-01부터 정가가 두 배다.
- 그래서 노래로 확인할 후보는 **Argon과 3.8 Flash**이고, 지금 기본값인 Hydrogen을 기준으로 함께 둔다(문서 §12.3, §12.6).

## 지시문 (모든 모델에 같은 것)

```text
You write lyrics for short commercial music (advertising, brand films, social video). An AI music engine will sing exactly what you write. The lyrics must sound like something a person would sing, not like ad copy set to a beat.

You receive a brief as JSON: language, use, targetSeconds, brand, product, message, mustInclude, tone, vocal.

Write in the brief's language. Return JSON with title, style, lyrics, hook.

RULES FOR THE LYRICS
1. One message. Say the brief's message once, clearly, in a way that can be sung. Do not add other selling points.
2. Length follows targetSeconds, because the engine sings every line you write and nothing sets the length except the amount of lyrics:
   - 15 s or less: hook only, 2 to 4 short lines.
   - 20 to 30 s: 4 to 8 short lines. Start with the hook. No verse before it.
   - 45 to 60 s: 8 to 14 lines: one short verse, the hook, optionally a second short verse, the hook again.
3. Structure. Put a section label alone on its own line in square brackets: [Hook], [Verse], [Chorus], [Outro]. Always finish with an [Outro] of one or two lines that lands the brand or the message, then a last line with [End]. Square brackets are only for labels. Parentheses are only for words a backing voice sings.
4. The brand name appears in the hook, at least once and at most three times in the whole lyric, spelled the same way every time. Every mustInclude phrase appears word for word.
5. Singable lines. Keep lines short and of similar length, so parallel lines carry the same number of beats. Prefer line endings on open vowel sounds. Repeat a short phrase to make the hook stick. Do not force rhymes.
6. Original words only. No names of real artists, songs, other brands or public figures. No lines taken from existing songs.
7. No medical or performance claims, no superlatives ("best", "number one", "최고", "1위"), no promises of results.
8. No clichés: no "dreams", "shine bright", "new beginning", "special you", "특별한 너", "빛나는 순간", "새로운 시작", "함께라면", unless the brief asks for them.

KOREAN
- 구어체로, 사람이 흥얼거릴 말로 쓴다. 번역투, 문어체 어미, 광고 문구 같은 명사 나열을 쓰지 않는다.
- 한 줄은 대체로 5~10음절. 짝이 되는 줄은 음절 수를 맞춘다.
- 줄 끝과 길게 끄는 자리에는 받침 없는 음절이나 ㄴ·ㅇ·ㄹ·ㅁ 받침을 둔다. ㄱ·ㄷ·ㅂ으로 끝나는 줄을 피한다.
- 숫자와 영문 약어는 소리 나는 대로 한글로 쓴다. 브랜드 이름은 브리프에 적힌 한글 표기 그대로 쓴다.
- 영어 단어는 후크나 추임새에 한두 개까지만.
- 한 곡은 한 가지 말투로 쓴다(해요체나 반말 중 하나).
- 감정 이름만 적은 줄을 쓰지 않는다. 누가 어디서 무엇을 하는지가 보이는 줄을 쓴다.
- 노래로 부르는 분량의 감: 15초에 20~30음절, 30초에 45~60음절, 60초에 90~120음절.
- 받침이 겹치는 음절을 빠른 자리에 몰아 두지 않는다. 영어 단어 옆의 우리말은 받침 없는 말로 고른다.

ENGLISH
- Plain spoken words, natural stress, simple rhyme or near-rhyme only where it falls naturally.

RULES FOR THE STYLE FIELD (always in English, one paragraph, at most 600 characters)
Genre and feel first, then tempo as BPM, then the voice (gender, register, delivery, and "sung in Korean" or "sung in English"), then two or three instruments and what they do, then the arrangement in a few words, then how it ends (for example "ends on a clean final hit, no fade"). No artist or song names. Do not state a length in seconds. Do not write "no X"; describe what should be there.

hook: the one line a listener should remember, copied exactly from the lyrics.
title: at most 40 characters, in the lyric language, no brand slogan.
```

## 브리프

```json
[
 {
  "id": "jingle",
  "kind": "ad jingle",
  "seconds": 15,
  "ko": {
   "brand": "모아",
   "product": "레몬 탄산수",
   "message": "한 모금에 기분이 맑아진다",
   "must": [
    "모아"
   ],
   "tone": "상쾌하고 가볍게",
   "vocal": "밝은 여성 보컬"
  },
  "en": {
   "brand": "Moa",
   "product": "lemon sparkling water",
   "message": "one sip clears your head",
   "must": [
    "Moa"
   ],
   "tone": "fresh and light",
   "vocal": "bright female vocal"
  }
 },
 {
  "id": "brandfilm",
  "kind": "emotional brand film",
  "seconds": 60,
  "ko": {
   "brand": "하루결",
   "product": "스킨케어",
   "message": "매일의 작은 돌봄이 나를 만든다",
   "must": [
    "하루결"
   ],
   "tone": "잔잔하고 따뜻하게, 과장 없이",
   "vocal": "담백한 여성 보컬"
  },
  "en": {
   "brand": "Harugyeol",
   "product": "skincare",
   "message": "small daily care is what makes me",
   "must": [
    "Harugyeol"
   ],
   "tone": "calm and warm, no exaggeration",
   "vocal": "plain, intimate female vocal"
  }
 },
 {
  "id": "shortform",
  "kind": "upbeat short-form video",
  "seconds": 25,
  "ko": {
   "brand": "스텝온",
   "product": "러닝화",
   "message": "오늘은 그냥 나가서 뛴다",
   "must": [
    "스텝온"
   ],
   "tone": "신나고 리듬감 있게",
   "vocal": "에너지 있는 남성 보컬"
  },
  "en": {
   "brand": "StepOn",
   "product": "running shoes",
   "message": "today I just go out and run",
   "must": [
    "StepOn"
   ],
   "tone": "energetic and rhythmic",
   "vocal": "energetic male vocal"
  }
 },
 {
  "id": "launch",
  "kind": "product launch",
  "seconds": 30,
  "ko": {
   "brand": "에코핀",
   "product": "무선 이어폰",
   "message": "소음은 끄고 음악만 남긴다",
   "must": [
    "에코핀"
   ],
   "tone": "세련되고 자신감 있게",
   "vocal": "쿨한 여성 보컬"
  },
  "en": {
   "brand": "Echofin",
   "product": "wireless earbuds",
   "message": "turn off the noise, keep the music",
   "must": [
    "Echofin"
   ],
   "tone": "sleek and confident",
   "vocal": "cool female vocal"
  }
 },
 {
  "id": "seasonal",
  "kind": "seasonal promotion",
  "seconds": 30,
  "ko": {
   "brand": "오브제마켓",
   "product": "겨울 세일",
   "message": "이번 주말까지 겨울 옷을 가볍게 산다",
   "must": [
    "오브제마켓",
    "이번 주말까지"
   ],
   "tone": "포근하고 들뜨게",
   "vocal": "따뜻한 혼성 보컬"
  },
  "en": {
   "brand": "Objet Market",
   "product": "winter sale",
   "message": "winter clothes for less, until this weekend",
   "must": [
    "Objet Market",
    "this weekend"
   ],
   "tone": "cozy and excited",
   "vocal": "warm mixed vocals"
  }
 },
 {
  "id": "kids",
  "kind": "kids' product",
  "seconds": 25,
  "ko": {
   "brand": "튼튼곰",
   "product": "어린이 비타민 젤리",
   "message": "하루 한 알, 곰돌이랑 같이",
   "must": [
    "튼튼곰"
   ],
   "tone": "귀엽고 따라 부르기 쉽게",
   "vocal": "아이들이 함께 부르는 밝은 보컬"
  },
  "en": {
   "brand": "Tunbear",
   "product": "kids' vitamin gummies",
   "message": "one a day, together with the bear",
   "must": [
    "Tunbear"
   ],
   "tone": "cute and easy to sing along",
   "vocal": "bright vocal with kids singing along"
  }
 },
 {
  "id": "luxury",
  "kind": "luxury fragrance film",
  "seconds": 45,
  "ko": {
   "brand": "누아",
   "product": "향수",
   "message": "밤이 지나도 남는 잔향",
   "must": [
    "누아"
   ],
   "tone": "절제되고 깊게, 말수가 적게",
   "vocal": "낮고 조용한 여성 보컬"
  },
  "en": {
   "brand": "Noir",
   "product": "fragrance",
   "message": "the scent that stays after the night",
   "must": [
    "Noir"
   ],
   "tone": "restrained and deep, few words",
   "vocal": "low, quiet female vocal"
  }
 },
 {
  "id": "comedic",
  "kind": "comedic app ad",
  "seconds": 25,
  "ko": {
   "brand": "후딱",
   "product": "배달 앱",
   "message": "배고플 때 생각보다 빨리 온다",
   "must": [
    "후딱"
   ],
   "tone": "능청스럽고 웃기게",
   "vocal": "장난스러운 남성 보컬"
  },
  "en": {
   "brand": "Hoodak",
   "product": "food delivery app",
   "message": "when you're hungry, it comes faster than you think",
   "must": [
    "Hoodak"
   ],
   "tone": "deadpan and funny",
   "vocal": "playful male vocal"
  }
 }
]
```
