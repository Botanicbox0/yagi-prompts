# 가입자 알림 체계 (2026-10-31)

오픈 전에 사람을 모아 두고 "이런 템플릿이 올라왔다"를 알리기 위한 설계다. 이 PR에서 구현한 것은 §5의 메일 레이아웃과 원클릭 수신 거부뿐이다. 동의 화면, 카카오 발송, DB 변경은 대표 결정(§8) 뒤에 만든다.

## 1. 결론

1. **카카오는 채널 친구 모으기 + 관리자센터 채널 메시지로 시작한다.** 전화번호, 대행사, 개발이 필요 없고 일반 메시지는 건당 15원(VAT 별도)이다. 자동 발송이 필요해지면 브랜드 메시지 API로 넘어간다.
2. **지금 "새 템플릿 알림" 메일을 보내면 안 된다.** 광고성 메일인데 제목에 (광고)가 없고, 신청 문구와 실제 발송 범위가 다르고, 동의 기록이 없다(§2 P0).
3. 메일은 전부 공용 레이아웃으로 옮겼다. 흰 카드, French blue 버튼 하나, 다크 모드 대응.

## 2. 현황 점검

**있는 것.** 가입은 Google·Kakao 로그인뿐이고(`lib/auth/providers.ts`) 받는 정보는 이메일과 프로필 이름이다(`lib/legal/documents.ts` §5). 수신 설정은 `profiles.notif_new_playbook`, `notif_updates` 두 칸이며 기본값은 false다(`0002_core_schema.sql:19-20`). 사전 모집은 닫힌 스튜디오의 "열리면 알려주세요" 버튼 하나다(`components/twings/studio.tsx:537`, `app/api/notify/interest/route.ts`). 발송은 Resend, 대량 발송은 `lib/notify/broadcast.ts`, 관리자 버튼은 `prompt.announce`다. 웹 푸시는 렌더 완성 알림 전용이다(`lib/renders/notify.ts`).

| 등급 | 문제 | 근거 | 조치 |
| --- | --- | --- | --- |
| P0 | 템플릿 소식 메일 제목·본문에 (광고) 표기가 없다 | `messages/ko.ts:3092` `templates.announce.subject` | 문안 대표 결정 §8-1. **결정 전 "구독자에게 알리기"를 누르지 않는다** |
| P0 | 신청 문구는 "서비스가 열릴 때 이메일로 안내"인데, 켜지는 칸은 모든 새 템플릿 메일을 받는 칸이다. 동의한 범위보다 더 보낸다 | `messages/ko.ts:3120`, `route.ts:23`, `lib/prompts/announce.ts:22` | §6 동의 화면 |
| P0 | 동의 시각·문구 버전·경로 기록이 없다. 불리언 한 칸뿐이라 동의 증명과 주기적 확인이 불가능하다 | `0002_core_schema.sql:19`, `lib/notify/preferences.ts:65` | §6 데이터 모델 |
| P0 | 개인정보 처리방침 이용 목적에 광고성 정보 발송이 없다 | `lib/legal/documents.ts` §2의 6번 "서비스 이용에 필요한 이메일" | 약관 대표 결정 §8-2 |
| P1 | 로그아웃 상태로 누르면 로그인으로 보낸 뒤 신청이 적용되지 않는다. 돌아와서 다시 눌러야 하고, 놓치면 사라진다 | `studio.tsx:539-541` | 동의 화면과 함께 복귀 처리 |
| P1 | 비로그인 방문자가 남길 곳이 없다. 사전 모집은 사실상 스튜디오까지 간 가입자로 한정된다 | `route.ts:20` | 카카오 채널 추가 링크가 이 자리를 맡는다 |
| P1 | 야간 발송 차단이 없다. 관리자가 밤에 누르면 그대로 나간다 | `broadcast.ts` 시각 검사 없음 | §4 발송 창 |
| P1 | 발송 결과를 저장하지 않는다. `announced_at`을 먼저 찍어 실패분을 재발송할 수 없고 성과도 측정할 수 없다 | `announce.ts:48`, `broadcast.ts:92` | §6 `notification_sends` |
| P1 | 구독자 5,000명에서 조용히 잘린다 | `broadcast.ts:24` | 아웃박스 도입 때 함께 |
| P1 | **수정함.** 수신 거부 헤더는 POST를 약속했는데 라우트에 GET만 있어 메일 앱의 구독 취소 버튼이 실패했다 | `mailer-live.ts:71-72`, `app/api/notify/unsubscribe/route.ts` | 이 PR |
| P2 | GET으로 수신 거부가 처리되어 메일 보안 스캐너의 링크 검사만으로 해제될 수 있다 | 같은 라우트 주석 | 해제 경로를 동의 원장에 남겨 추적한 뒤 판단 |
| P2 | 이메일 없는 카카오 계정은 메일 대상에서 빠지고 다른 안내 수단도 없다 | `broadcast.ts:28`, `lib/renders/notify.ts:25` | 채널 친구로 보완 |
| P2 | **수정함.** 메일 팔레트가 다섯 군데에 따로 있었고(검정 버튼, `#0000EE`, 회색) 레드 금지 원칙 밖의 옛 기준이었다 | `lib/brands/email.ts`, `lib/renders/feedback.ts` 등 | 이 PR |
| 확인 | 메일 바닥글 주소가 구로구다. 본점은 2026-10-21 양천구로 돌아갔다는 기록이 있다 | `BUSINESS.address` | 약관 영역이라 건드리지 않음. §8-2 |
| 확인 | `.env.example` 발신자 이름이 `YAGI PROMPTS`다. 운영 `NOTIFY_FROM_EMAIL` 값은 이 세션에서 보지 않았다 | `.env.example:97` | 발송 전 대표 확인 |

## 3. 카카오 수단 비교

| 수단 | 광고 | 대상 | 필요한 것 | 비용 |
| --- | --- | --- | --- | --- |
| **채널 메시지(관리자센터)** | 가능, "광고성" 체크 | 채널 친구 | 채널, 고객센터 연락처 | 일반 15원, 타겟 20원 |
| 브랜드 메시지(API) | 가능 | 친구 + 수신 동의 고객 | 대행사, 전화번호 | 대행사 공시 53원~(텍스트, §7 주의) |
| 알림톡 | **불가**, 심사에서 반려 | 전화번호 | 템플릿 심사, 대행사 | 대행사 공시 13원 |
| 친구톡 | 2025-12-31 종료 | | | |

**추천 경로**

1. **지금**: 채널 개설 → 비즈니스 인증 → 사이트에 "카카오 채널 추가" 링크 → 관리자센터에서 템플릿 소식 발송. 1,000명에게 한 번 보내면 15,000원(VAT 별도)이다.
2. **자동 발송이 필요해질 때**: 브랜드 메시지 API. 이때 전화번호 수집과 대행사 계약을 시작한다. 비친구 발송은 채널 친구 5만 명 등의 조건이 있어 당분간 대상이 아니다.
3. **결제 후 렌더 완성 알림**: 정보성이므로 알림톡 후보다. 지금은 메일과 푸시로 충분해 뒤로 미룬다.

카카오 로그인 동의 화면의 채널 추가(`plusfriends`)는 쓰지 않는다. 공식 문서상 필수 동의만 지원해, 로그인과 광고 수신을 묶게 된다.

**준비물**: 카카오비즈니스 가입, 채널 개설(대표 휴대폰 인증), 비즈니스 채널 심사(법인은 사업자등록증 + 대표자 휴대폰 본인 확인), 고객센터 연락처 등록. 대행사는 2단계에서만 필요하다.

**단위**: 메일은 사람별 발송(템플릿 하나당 한 통), 채널 메시지는 친구 전체 또는 타겟 그룹 일괄이다. 묶음 소식은 주 1회 이하를 제안한다.

## 4. 법령 요건과 시스템 규칙

| 요건 | 내용 | 확인 수준 | 우리 규칙 |
| --- | --- | --- | --- |
| 사전 동의 | 영리목적 광고성 정보는 명시적 사전 동의 필요(제50조 ①) | 조문 | §6 체크박스, 기본 꺼짐, 필수 동의와 분리 |
| 거래관계 예외 | 거래로 연락처를 직접 받은 경우 같은 종류 재화에 한해 예외. 6개월은 시행령 사항 | 조문 / 기간은 2차 자료 | 오픈 전 가입자는 거래가 없으므로 쓰지 않는다 |
| 철회 | 거부·철회 뒤 발송 금지(②), 회피·방해 금지(⑤) | 조문 | 로그인 없는 한 번 클릭 해제 유지 |
| 야간 | 오후 9시~오전 8시는 별도 동의(③). 브랜드 메시지는 08:00~20:50만 가능 | 조문, 카카오 공식 | **09:00~20:00에만 발송**, 야간 동의는 받지 않는다 |
| 표시 | 전송자 명칭·연락처, 수신 거부 방법(④). (광고)는 메일 제목과 본문 모두에 | 조문 / 표기 위치는 대행사 안내, 별표 6 원문 미확인 | 광고성 메일 생성 함수에서 강제 |
| 주기 확인 | 동의 여부를 정기적으로 확인(⑧). 2년은 시행령 사항 | 조문 / 2년은 2차 자료 | 동의일 기준 23개월째 안내, 24개월 도달 전 메일 발송 |

`casenote.kr`로 제50조 본문은 확인했으나 시행령 제62조의3, 별표 6, 벌칙 조항 원문은 가져오지 못했다. 발송 시작 전 법무 확인이 필요하다. 처리 결과 통지 기한(14일 등)도 2차 자료로만 봤다.

## 5. 메일 디자인 (구현됨)

- `lib/notify/layout.ts`: 유일한 문서 셸과 블록(제목, 문단, 목록, 버튼, 이미지, 안내). 색은 `docs/design/IDENTITY.md` §2의 역할값이다. `lib/design/identity.ts`는 PR #131에 있어 이 PR은 의존하지 않고, #131 병합 뒤 값을 그쪽에서 가져오도록 바꾼다.
- 호환: 테이블 레이아웃, 인라인 스타일, 버튼 칸 `bgcolor`, Outlook용 고정폭 조건부 테이블, `word-break:keep-all`.
- 다크 모드: `prefers-color-scheme` 스타일 블록. 블록을 지우는 메일 앱에서는 밝은 메일 그대로 나온다.
- 옮긴 메일: 렌더 결과, 새 템플릿·업데이트, 캠페인, 브랜드 의뢰 2종, 결과 피드백, 수신 거부 페이지. 문구는 바꾸지 않았다.
- 미리보기: `npx tsx scripts/email-preview.ts <폴더>`. 아무것도 보내지 않는다. 스크린샷은 `docs/qa/member-notify/`에 있다.
- **확인 범위**: Chrome 렌더(밝게, 어둡게, 500px 폭)만 봤다. 실제 Gmail, Naver, Outlook 수신 화면은 발송 금지 범위라 보지 않았다.

## 6. 동의와 데이터 모델 (제안, 미구현)

**동의 화면.** 닫힌 스튜디오 버튼을 시트로 바꾼다.
- 체크박스 기본 꺼짐: "새 템플릿과 이벤트 소식을 이메일로 받습니다(선택)." 문구는 초안, §8-1.
- 그 아래 채널 추가 버튼. 카카오 채널 수신 동의는 카카오 쪽 채널 추가로 받는다.
- 로그인 복귀 때 `?interest=1`을 유지하되, 복귀 후 시트를 다시 보여 주고 사용자가 직접 눌러야 켜진다.
- 동의하지 않아도 서비스 이용에 차이가 없다.

```sql
-- 추가만 하는 원장. 현재 상태는 profiles.notif_* 를 유지한다.
create table marketing_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'kakao_brand')),
  action text not null check (action in ('granted', 'revoked', 'reconfirmed')),
  source text not null,      -- studio_sheet, account, unsubscribe_link, list_unsubscribe
  wording_version text not null,
  created_at timestamptz not null default now()
);
-- 사람별 발송 결과: 재발송과 측정의 근거.
create table notification_sends (
  event_key text not null,
  user_id uuid not null references profiles(id) on delete cascade,
  channel text not null,
  status text not null,      -- sent, failed
  provider_id text,
  created_at timestamptz not null default now(),
  primary key (event_key, user_id, channel)
);
```

기존 `notif_new_playbook = true` 계정은 동의 문구를 다르게 본 사람들이므로 그대로 쓰지 않는다. 첫 소식 전에 재동의 안내를 어떻게 할지 §8-3에서 정한다. 전화번호(`profiles.phone`)는 2단계에서 별도 동의와 함께 추가한다.

## 7. 비용과 측정

- 채널 메시지 요금은 카카오 공식값이다. 대행사 단가는 솔라피 공시 기준이며, 다른 대행사 블로그는 브랜드 메시지를 23~25원으로 적는다. **계약 전 견적으로 확인한다.**
- Resend 비용은 이 설계로 달라지지 않는다.

| 지표 | 정의 | 출처 |
| --- | --- | --- |
| 동의율 | 시트 노출 대비 동의 | `marketing_consents` + 스윕 마커 이벤트 |
| 채널 친구 수 | 일별 순증 | 채널 관리자센터 |
| 클릭률 | 발송 대비 `utm_source=kakao|email` 방문 | 접속 기록 |
| 전환 | 소식 클릭 뒤 7일 안의 첫 결제 | 결제 기록 + utm |
| 해제율 | 발송당 `revoked`, 채널 차단 | 원장, 관리자센터 |

메일 열람 추적 픽셀은 넣지 않는다. 처리방침 §7이 "광고 목적의 추적 도구를 사용하지 않습니다"라고 적고 있다. utm 측정도 이 문구와 맞는지 §8-2에서 함께 본다.

## 8. 대표 결정 항목

1. **문안**: 아래 초안과 동의 문구, 메일 (광고) 표기 방식. 확정 전 발송 없음.
2. **약관·처리방침**: 이용 목적에 광고성 정보 발송 추가, 카카오 수탁 기재, 바닥글 주소 갱신. 법무 확인 포함.
3. **기존 신청자 처리**: 재동의 메일을 보낼지, 소식 대상에서 빼고 새로 모을지. 추천은 재동의를 받는 것이다. 재동의 요청 자체가 광고성인지 법무 확인이 먼저다.
4. **채널**: 채널 이름·프로필과 개설 시점, 고객센터 연락처. 개설과 인증은 대표 계정으로 직접 진행한다.
5. **대행사**: 2단계 진입 시점과 업체.
6. **발송 빈도**: 주 1회 이하 제안.

### 메시지 초안 (확정 아님)

전부 **초안**이며 상호·연락처·거부 방법은 §8-2 확정값으로 바꾼다.

- **새 템플릿, 카카오**: `(광고) TWINGS 새 템플릿이 올라왔어요. 사진 한 장으로 {템플릿명}의 주인공이 되어 보세요. 수신 거부: 채널 차단`
- **오픈 소식, 카카오**: `(광고) TWINGS가 문을 열었어요. 신청해 주신 분들께 먼저 알려드립니다. 수신 거부: 채널 차단`
- **새 템플릿, 메일 제목**: `(광고) 새 템플릿 — {title}`
- **동의 재확인, 메일**: `{동의일}에 TWINGS 소식 수신에 동의하셨습니다. 계속 받으시려면 아무것도 하지 않으셔도 되고, 그만 받으시려면 아래 링크를 눌러 주세요.` (안내만, 광고 없음)

## 출처

- 카카오: [브랜드 메시지](https://kakaobusiness.gitbook.io/main/ad/brandmessage), [알림톡](https://kakaobusiness.gitbook.io/main/ad/infotalk), [채널 만들기](https://kakaobusiness.gitbook.io/main/channel/start), [채널 메시지](https://kakaobusiness.gitbook.io/main/channel/run/message.md), [채널 연결·동의항목](https://developers.kakao.com/docs/latest/ko/kakaotalk-channel/common)
- 법령: [정보통신망법 제50조](https://casenote.kr/법령/정보통신망_이용촉진_및_정보보호_등에_관한_법률/제50조)
- 2차 자료(대행사): [솔라피 요금](https://solapi.com/pricing), [솔라피 정책 안내](https://solapi.com/guides/policyguidelines), [비즈고 비친구 조건](https://blog.bizgo.io/inside/brand-message-non-friend-sending-requirements/), [비즈고 알림톡 비교](https://blog.bizgo.io/howto/alimtalk-friendtalk-difference/)
