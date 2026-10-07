# 브랜드 문의 접수와 Slack 알림

`POST /api/brands/inquiries`는 문의와 Slack 발송 대기 기록을 한 SQL 문장으로 저장한다. 둘 중 하나라도 저장하지 못하면 접수 성공을 반환하지 않는다. 문의 성공 화면은 DB 접수를 의미한다. Slack 수신 여부와 접수 메일 발송 여부는 각각 별도로 기록한다.

## 입력과 중복 접수

- `inquiryType`: `campaign | production | filter | undecided`, 생략 시 `campaign`.
- `useCase`: `launch | beauty_fashion | app_platform | local | seasonal | undecided`, 생략 시 `undecided`.
- `requestId`: 선택 UUID. 폼은 성공 여부가 불명확한 동안 같은 값을 재사용한다. 브라우저 저장소에는 이 식별자만 보관하며 문의 내용이나 연락처를 보관하지 않는다.
- 같은 `requestId`를 동시에 제출하거나 다시 제출해도 원래 접수 한 건을 반환한다. 기존 본문을 수정하지 않고 응답에는 문의 원문을 넣지 않는다. 하루 제한에 이미 도달해도 기존 접수의 재조회는 성공한다. UUID 없는 기존 클라이언트는 종전처럼 제출할 때마다 별개 문의가 된다.
- 접수 메일은 처음 저장한 요청에서만 보낸다. 발송 요청이 성공하면 `receipt_sent_at`을 기록하고 재요청은 저장된 결과로 `receipt`를 반환한다. 이 시각은 메일 제공사의 발송 요청 수락 기록이며 수신함 도착이나 읽음 확인이 아니다. 발송 결과를 기록하지 못했다면 재요청에서 `receipt: false`로 답한다.
- JSON 성공 응답은 `{ ok: true, receipt: boolean, id: UUID }`이다. 저장하지 않는 허니팟 응답에는 `id`가 없다. 하이드레이션 전 폼 제출은 `/api/brands/inquiries/result?locale=<locale>&outcome=sent&id=<uuid>`로 303 이동한다. 결과 HTML 자체에 접수 상태와 문의 번호가 있어 JavaScript 없이도 확인할 수 있다. 결과 페이지는 `private, no-store`, `noindex, nofollow`, `no-referrer`이며, DB의 문의 번호와 메일 확인 시각만 읽고 브랜드 문의 폼으로 돌아가는 링크를 제공한다. 입력 내용은 URL에 포함하지 않는다. 하이드레이션 전 hidden `requestId`가 비어 있으면 기존 UUID 없는 요청처럼 접수한다.

## 외부 전송 범위

Slack payload는 문의 UUID, 고정 선택 문의 종류, `https://admin.twings.app/admin/inquiries#inquiry-<uuid>` 링크다. 회사명, 이름, 이메일, 전화번호, 본문, 예산, 희망 일정은 보내지 않는다. 링크 미리보기도 끈다. 관리자 링크는 기존 로그인·관리자 권한 검사를 통과해야 열 수 있다. 기존 개인정보 고지와 약관 문구는 변경하지 않았다.

Webhook URL은 비밀값이다. 서버 전용 모듈만 환경변수를 읽는다. 실제 발송은 `VERCEL_ENV=production` 배포에서만 허용한다. Preview·development·local에 활성화 값과 webhook을 잘못 복사해도 런타임은 `disabled`로 처리한다. 응답 본문, 예외 문자열, URL은 로그나 발송 장부에 기록하지 않는다. webhook 대상은 HTTPS `hooks.slack.com/services/...`로 제한하며 리디렉션은 거부한다. 커넥터 OAuth 토큰을 앱의 서버 토큰으로 복사하지 않는다.

## 발송 상태와 복구

`brand_inquiry_deliveries`는 문의별 기본키 하나이며 개인 연락처를 복제하지 않는다. 문의 삭제 시 발송 기록도 삭제한다. 이전 문의를 일괄 발송 대기열로 옮기지 않는다. 마이그레이션 이후 아직 Slack을 켜지 않았을 때 저장한 새 문의는 대기열에 남아, 이후 활성화하면 처리된다.

| 상태 | 의미 | 다음 처리 |
| --- | --- | --- |
| `pending` | 아직 보내지 않았거나 Slack이 429로 거절함 | 설정된 워커가 예정 시각 이후 처리 |
| `sending` | 행 잠금으로 한 워커가 발송을 맡음 | 정상 처리 시 결과 기록, 5분 넘은 미완료 claim은 `uncertain` |
| `sent` | Slack HTTP 200 + 본문 `ok` 확인 | 자동 재발송하지 않음 |
| `uncertain` | timeout, 전송 오류, HTTP 5xx, 불명확 응답, 결과 기록 전 중단 | 채널에서 문의 UUID로 수신 여부 확인; 자동 재발송하지 않음 |
| `failed` | 확실한 4xx 거절 또는 429가 5회 누적 | 설정·권한·채널 상태를 운영자가 확인 |

행 claim은 `FOR UPDATE SKIP LOCKED` + 갱신을 한 SQL 문장으로 처리한다. 한 문의의 워커 경합이나 재실행이 중복 발송으로 이어지지 않는다. 전송 후 DB 결과 기록이 실패해도 대기 상태로 되돌리지 않는다. 새 알림은 문의 API의 `after()`에서 즉시 1건 처리한다. 독립 cron `/api/brands/inquiries/tick`은 1회에 최대 5건을 처리하고, 실패나 429를 만나면 그 패스를 끝낸다. 한 전송의 요청·응답 본문 대기는 최대 5초다.

Incoming webhook은 발송 응답에 Slack 메시지 timestamp나 중복 방지 영수증을 제공하지 않는다. 그러므로 수신 여부를 잃은 요청에 무조건 재시도하는 방식으로 exactly-once를 보장할 수 없다. 불명 상태는 관리자 문의함에 표시되며 운영 확인 대상으로 남긴다. 자동 수동재발송 버튼은 제공하지 않는다. 채널에서 수신 여부를 확인한 뒤 Director가 승인한 복구 작업으로 처리한다. [Slack incoming webhook 문서](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)

429는 `Retry-After`를 존중하되 최소 60초 뒤로 미룬다. `vercel.json`의 복구 cron은 매일 `0 19 * * *` UTC다. Hobby는 1일 주기와 시간 단위 실행 정밀도이므로 즉각 재시도나 특정 시각 도착을 약속하지 않는다. 필요할 때 운영자가 같은 보호된 tick을 실행할 수 있다. 기존 렌더 cron은 별도로 유지한다. [Vercel cron 제한](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## 2026-10-07 운영 확인 현황

아래는 root가 대표 승인 후 클라우드 SQL과 Vercel 설정에서 직접 확인한 상태다. 로컬 테스트 결과와 구분한다.

- 0041·0125·0126 적용 완료. outbox RLS와 FORCE RLS가 켜져 있다.
- service_role SELECT·INSERT·UPDATE true, DELETE·TRUNCATE·REFERENCES·TRIGGER false. anon/authenticated의 테이블 접근 권한 false.
- `pg_roles`의 postgres/service_role `bypassrls=true` 확인. 배포 앱이 실제로 사용하는 연결 역할은 배포 후 접수 스모크로 최종 확인한다.
- Vercel Production에 webhook 비밀값과 `CRON_SECRET` 저장 완료. 최종 코드·Preview 검증 후 root가 `SLACK_BRAND_INQUIRIES_ENABLED=on`을 Production에만 저장하고 성공 UI와 Production 표시를 확인했다. 이 설정을 반영하는 새 배포와 실제 수신 검증은 아직 남아 있다.
- root 재조회 기준 outbox 0건. 보안 advisor 신규 WARN 없음. outbox의 의도적인 무정책 RLS INFO는 유지한다.
- 실제 사이트 제출 → DB → 지정 Slack 채널 수신 → 같은 requestId 재제출의 E2E 검증은 아직 남아 있다.

## 운영 적용 순서

파일 작성과 로컬 테스트는 운영 활성화·실수신 증거가 아니다. 아래는 신규 환경과 재검증을 위한 순서다. AGENTS.md에 따라 클라우드 SQL 적용은 대표 또는 Director 단계다.

1. 변경할 SQL을 검토한 뒤 `0041_core_brand_inquiry_delivery.sql`, `0125_glue_brand_inquiry_delivery_rls.sql`, `0126_glue_brand_inquiry_delivery_least_privilege.sql` 순서로 적용한다. 0041은 문의 필드와 outbox/RLS를 만들고, 0125는 브라우저 권한을 회수하고 서버 역할에 select/insert/update를 부여한다. **Supabase 기본 권한에 DELETE 등이 이미 있으면 0125의 GRANT만으로 없어지지 않는다.** 0126은 이 테이블의 public/anon/authenticated/service_role 권한을 모두 회수한 뒤 서버 역할에 필요한 select/insert/update만 다시 부여한다. 이미 적용한 0125를 고치거나 되돌리지 않는다. 다른 테이블, 전역 default privileges, 문의 데이터는 변경하지 않는다. Core도 즉시 RLS를 켜므로 glue 적용 전 브라우저 행 조회를 허용하지 않는다.
2. Slack 앱의 incoming webhook이 의도한 private 문의 채널에 연결되어 있는지 확인하고, Vercel Production에 서버 비밀값 `SLACK_BRAND_INQUIRIES_WEBHOOK_URL`을 저장한다. 값은 채팅·PR·로그에 적지 않는다.
3. 무작위 서버 비밀값 `CRON_SECRET`을 Vercel Production에 저장한다. Vercel cron은 이 값을 Bearer 인증에 사용한다. 이 값이 없으면 새 문의 tick은 503, 틀리거나 없는 토큰은 401이다. **기존 `/api/renders/tick`도 같은 변수를 읽으므로 설정 이후 수동 호출에는 Bearer 인증이 필요하다.** 렌더 API가 직접 호출하는 내부 처리 함수에는 영향이 없다.
4. 마이그레이션 완료 후 코드를 배포한다. `SLACK_BRAND_INQUIRIES_ENABLED`가 `on`이 아니면 외부 발송 없이 기록만 남고 report는 `disabled`다. `on`인데 webhook이 없으면 `unconfigured`, URL이 유효하지 않으면 `misconfigured`다. 설정 실패도 사용자 문의 접수 자체를 막지 않는다.
5. 공개 발송을 켤 준비가 되면 Production에 `SLACK_BRAND_INQUIRIES_ENABLED=on`을 저장하고 재배포한다. 실제 사이트에서 식별 가능한 테스트 문의를 제출해 DB 문의 1건, outbox `sent`, 지정 private 채널의 같은 UUID 메시지 1건을 각각 확인한다. 기존 대기건이 있으면 활성화 전 수를 확인한다.
6. 동일 `requestId` 재요청과 보호된 tick 재실행 뒤 문의·알림이 늘지 않는지 확인한다. anonymous tick은 401, 인증된 기존 render tick은 정상 실행되는지 확인한다. 커넥터가 직접 보낸 테스트 메시지는 사이트 서버 연동 검증으로 대체하지 않는다.

로컬은 `npm run db:local`로 스냅샷을 재생성한다. 로컬/Preview에는 운영 webhook과 활성화 변수를 복사하지 않는다.

## 확인 명령

`npx vitest run tests/brands/slack-delivery.test.ts tests/brands/slack-runtime.test.ts tests/brands/inquiry-delivery-privileges.test.ts tests/brands/inquiry-delivery-routes.test.ts tests/brands/inquiries.test.ts tests/brands/inquiry-receipt-timeout.test.ts tests/db/migrations.test.ts tests/routes/brand-usage-boundary.test.ts`

0126 적용 후 `has_table_privilege`로 service_role의 SELECT·INSERT·UPDATE가 true, DELETE·TRUNCATE·REFERENCES·TRIGGER가 false이고 anon/authenticated의 모든 테이블 권한이 false인지 확인한다. 권한 회귀 테스트는 테이블 생성 전에 `ALTER DEFAULT PRIVILEGES ... GRANT ALL`을 설정해 실제 Supabase 기본 권한 상황을 재현하고, 서버 역할로 조회·삽입·갱신 성공 및 DELETE·TRUNCATE 거절을 확인한다.

운영 장부 점검은 문의 원문·연락처 없이 `brand_inquiry_deliveries`의 `inquiry_id`, `status`, `attempts`, `next_attempt_at`, `last_error_code`, `sent_at`으로 한다. 문의 admin 화면에서도 발송 상태를 확인할 수 있다.
