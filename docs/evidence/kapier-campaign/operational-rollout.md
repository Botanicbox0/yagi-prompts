# KAIPER 운영 반영·검증 기록

기록일: 2026-10-16. 기준 소스 `8082a688854c2dfdb91558b6c7940c1733c8f55d`, 브랜치 `codex/kapier-self-serve`, [PR #55](https://github.com/Botanicbox0/yagi-prompts/pull/55).

이 문서는 현재 진행 중인 운영 작업의 중간 기록이다. 아래 DB·Chrome·Slack·워커·위젯 결과는 각각 해당 작업의 관찰 범위에 한정한다. 기준 커밋 이후 수정 중인 diff는 아직 최종 전체 검사·배포가 끝난 소스로 기록하지 않는다. 최종 검사와 활성화 결과는 부모 작업에서 갱신한다.

## 1. 운영 DB 마이그레이션

대상: Supabase `nhokkikjkzjalxqsbzuk`. 적용은 부모 작업에서 수행했다. 이 문서 작성 단계에서 별도 클라우드 변경을 실행하지 않았다.

| 적용 묶음 | 운영 migration history | 상태 |
| --- | --- | --- |
| `0045_core_campaign_production.sql`, `0130_glue_campaign_production.sql`, `0047_core_campaign_collaboration.sql`, `0132_glue_campaign_collaboration.sql`, `0048_core_campaign_risk.sql`, `0133_glue_campaign_risk.sql`, `0049_core_campaign_funding.sql`, `0134_glue_campaign_funding.sql` | `20261015215523` | 8개 파일을 합친 묶음 적용 성공 |
| `0135_glue_campaign_production_least_privilege.sql` | `20261015215739` | 적용 성공 |
| `0136_glue_campaign_trigger_search_path.sql` | `20261015220251` | 적용 성공, 8개 함수의 경로 고정 확인 |

적용 후 실제 `pg_catalog` 확인 결과:

- 신규 18개 테이블 모두 RLS와 FORCE RLS 활성.
- 해당 테이블의 `anon`·`authenticated` SELECT·INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER 권한 모두 없음. 세 역할(`anon`, `authenticated`, `service_role`)의 public 스키마 CREATE 권한도 없음.
- 해당 18개 테이블 모두 `service_role` DELETE·TRUNCATE 권한 없음. 처음 발견된 제작 테이블 2개의 기존 과도한 권한은 `0135`에서 회수했다.
- `0135`는 `campaign_productions`와 `campaign_render_jobs`의 서버용 SELECT·INSERT·UPDATE를 유지한다. 서버 소스에는 두 테이블의 DELETE·TRUNCATE 사용 경로가 없다.
- 8개 캠페인 트리거 함수의 `search_path`를 `public, pg_temp`로 고정했다. SECURITY INVOKER와 기존 함수 ACL은 변경하지 않는다.

`0136` 이후 Supabase security advisors에서 신규 함수 8개의 mutable search_path 경고가 사라졌다. 기존 함수 2개의 경고와 leaked-password protection 비활성 경고는 이번 변경 이전부터 존재하며 그대로다. private server-only 테이블의 RLS no-policy INFO 97건도 남는다. RLS와 역할 권한 확인은 서버의 개별 테넌트·참여자 인가를 대신하지 않는다.

## 2. 실제 Chrome·Google OAuth 관찰

Chrome에서 실제 로그아웃 후 Google 로그인을 선택했고, 인증 후 `twings.app/ko/video`로 복귀했다. 이어 보호된 `/account` 접근이 성공했다.

이는 Google 로그인과 보호된 계정 접근에 대한 관찰이다. 캠페인 초대 fragment 저장 → 신규 가입/로그인 → 같은 초대 복귀 → 수락까지의 실제 roundtrip을 수행한 증거는 아니다. 초대 roundtrip은 별도 검증 항목으로 남는다. 계정 이메일·세션·토큰은 이 문서에 기록하지 않는다.

## 3. Slack 연결 준비

| 항목 | 확인한 값·상태 |
| --- | --- |
| Slack app | `A0C9H5Y4S05` |
| bot user | `U0C9H6E12QM` |
| 비공개 채널 | `twings-risk-review`, `C0C9DRS4DT7` |
| 채널 멤버십 | 멤버 2명 확인, 봇 참여 확인 |
| 서버 자격증명 | Vercel Production에 저장 확인. 비밀값은 소스·문서에 기재하지 않음 |

앱·채널·자격증명 준비 상태와 지속적인 알림 운영은 구분한다. 현재 이 기록에는 운영 워커 활성화나 배포 후 실제 위험 이벤트의 자동 발송 성공이 포함되지 않는다. Slack으로 전달하는 값은 사건 식별자·고정 유형·인증된 관리자 링크에 한정하며, 원문·얼굴·계좌·결제 키는 보내지 않는다.

## 4. Windows 워커 설치 상태

2분 간격 Windows 작업이 설치되어 있으나 **Disabled** 상태다. 로컬 자격증명은 DPAPI로 보호한다. 설치는 워커 활성화·상시 실행 성공이나 배포 완료를 의미하지 않는다.

현재 배포 및 워커 활성화는 미완료다. 활성화 후에는 실제 실행 계정, 인증된 서버 연결, worker heartbeat, 분류 성공/실패, Slack outbox 상태와 중복 억제를 별도로 확인해야 한다. 아직 수행하지 않은 항목을 설치 증거로 대체하지 않는다.

## 5. 결제 정책과 로컬 Toss 관찰

대표가 승인한 브랜드 결제 정책은 2026-10-16 기준으로 소스에 반영했다. 범위는 TWINGS 자체 서비스 대금 수납과 견적별 총액·세금·제작 범위·착수·환불 조건의 명시이며, 브랜드 수납과 참여자 지급은 구분한다. [정책 반영 기록](../../legal/drafts/KAIPER-CAMPAIGN-PAYMENT-POLICY.md)을 따른다. 소스 반영은 운영 배포나 PG 계약 지원 범위 확인의 증거가 아니다.

로컬 격리 환경에서 1,000원 테스트 주문으로 실제 Toss 테스트 위젯에 연결했다. 1,000원은 검증용 값이며 캠페인의 확정 가격이 아니다. live 키 실결제나 실제 금전 이동의 증거로 사용하지 않는다.

사용자가 휴대폰에서 테스트 인증·결제를 완료했고, 데스크톱 복귀 페이지의 명시적 결과 확인을 실행한 뒤 `Receipt recorded · ₩1,000 · Test payment — no live receipt`를 확인했다. 동일 주문을 관리자 화면에서 전액 취소했고 `환불 기록됨`을 확인했다. 실제 Toss GET 결과는 승인 시 `DONE / balance=1000`, 취소 후 `CANCELED / balance=0 / cancels=1`; 로컬 DB도 `paid → refunded`로 일치한다. 비밀값을 제외한 제공사 응답 투영은 [승인](toss-test-approval.json)·[취소](toss-test-refund.json)에 있다. docs TEST 키 검증이므로 운영 가맹점의 live 키·계약·실매출 검증으로 확대하지 않는다.

최초 약관 체크 상태가 버튼에 반영되지 않는 결함은 공식 SDK 런타임의 초기 상태 조회와 변경 이벤트의 순서를 맞춰 수정했다. 지원하지 않는 가상계좌는 환불 계좌 수집 기능이 준비되지 않아 신규 승인을 막았다. 현재 위젯은 카드·토스페이만 허용하고, 서버도 실제 제공사 결제수단을 독립 확인한다. 이미 발행된 결제의 조회·수동 복구는 유지한다. 이 두 후속 변경의 브라우저 재검증은 Chrome CDP 응답 지연으로 완료하지 못했으며 기존 승인·취소 증거와 구분한다. 두 번째 합성 주문에는 결제를 실행하지 않았다.

전체 테스트에서 기존 구독 약관 projection이 바뀐 제4조 제목과 환불 문단 위치를 가정하는 회귀를 발견했다. 조항 번호 및 실제 설명 문단을 기준으로 교체하고 브랜드 조항 전체를 보존하도록 수정했다. 초기 전체 실행의 54개 실패를 최종 통과 결과로 기록하지 않는다.

## 6. 동의 원칙·보관기간 승인 범위

[동의 문서 §8](../../legal/drafts/KAIPER-DELEGATED-LIKENESS-AND-MESSAGING.md)에 대표의 명시 승인 범위를 기록했다. 승인한 기간은 다음 다섯 항목이다.

| 항목 | 승인한 기간 |
| --- | --- |
| 일반 캠페인 대화·공유 파일 | 캠페인 종료와 정산 종료 중 늦은 날부터 90일 |
| 위험 후보·판독 메타데이터·사람의 검토 결과 | 검토 종료 후 90일 |
| 거절·만료된 대리 요청 | 거절 또는 요청 만료 후 30일 |
| 관리자 비공개 원문 접근 이력 | 접근 시점부터 1년 |
| 향후 추천 연락 선택 동의 | 동의일부터 1년 또는 철회·탈퇴 중 빠른 때까지 |

Slack 알림 90일, 백업 잔여분 30일, 신규 대리 동의 증빙 5년은 이번 승인 질문의 대상이 아니었으며 미확정이다. 기존 거래기록의 보관 기준을 신규 처리 전체에 확대 적용하지 않는다.

실제 보존·파기 기능과 제공사 설정 검증 후 시행한다는 조건도 승인되었다. 현재 그 기능·설정 검증은 미완료다. 대리 grant 스키마·승인/철회 UI·actor/subject 분리·제공사 호환성·발송 전 검증도 미구현이므로, 동의 원칙 승인을 대리 얼굴 등록·생성 활성화로 표현하지 않는다.

## 7. 독립 리뷰와 최종 검증 상태

이전에 수행한 Opus 5.5 소스 리뷰와 그 후속 수정·테스트 증거는 해당 시점의 소스 범위에 대한 기록이다. 현재 추가된 운영 DB·정책·연결 및 수정 중인 diff까지 승인한 리뷰로 확장하지 않는다.

새 DB 후속 독립 리뷰는 240초와 600초 제한 모두 timeout이 났다. 이후 공식 CLI stream-json으로 실제 Opus 5.5 운영 리뷰(190.9초)와 결제 리뷰(176.1초)가 정상 완료됐다. 발견된 한·영 적용 범위 문구 불일치와 승인 범위보다 넓은 재견적 약속을 제거했다. 취소 미확정 상태의 수동 제공사 확인 경로에는 실제 요청 미도달·명시적 거절 회귀 테스트와 관리자 안내를 보강했다. 가상계좌 환불 절차 공백은 신규 결제수단의 서버·위젯 제한으로 보완했다. 수정 후 종결 리뷰와 최종 검사는 진행 중이다.

실제 로컬 모델 후속 합성 호출은 2건 모두 완료됐다. 외부 송금 요청 11,115ms / `transfer_solicitation`, 일반 예산 대화 407ms / `none`; 두 건 모두 원문 근거 검증을 통과했다. [실제 응답](risk-local-model-synthetic.json)은 이전 오프라인 재생과 별개다. 2건의 연결 확인이며 일반적인 분류 품질·오탐률 검증은 아니다.

### 운영 변경분 최종 로컬 검사

후속 [Opus 5.5 종결 리뷰](opus-operational-closure-review.md)는 151.1초에 정상 완료됐고, 제공된 동결 소스에서 P1/P2 차단 결함을 발견하지 않았다. 리뷰한 21개 파일의 원본 SHA256 일치를 확인했다. 이는 운영 공개나 실제 새 결제수단 게이트 검증을 대신하지 않는다.

| 검사 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 통과 |
| 전체 Vitest `--maxWorkers=8` | 265개 파일 / 2,533개 테스트 통과, 실패·보류 0 |
| `npm run db:local` | core 마이그레이션 기반 PGlite 스냅샷 재생성 |
| `npm run build:local` | 통과, origin `http://localhost:3107` |
| `npm run start:local -- -H 127.0.0.1 -p 3107` + `SWEEP_BASE_URL=http://localhost:3107 npm run sweep:anon` | 실제 프로덕션 서버, **980/980 SWEEP PASSED** |
| `security:client`, `security:built` | 78개 client entrypoint·빌드 산출물 통과 |
| `python scripts/campaign-risk-background.test.py` | DPAPI·중복 잠금·무창 자식 실행 3개 통과 |

원본 로그는 이 PC의 `C:/Users/User/AppData/Local/Temp/twings-kapier-20261016/*-operational-final.*`에 보존했다. 운영 소스와 달리 로그·비밀값·로컬 DB는 커밋하지 않는다.

부모 작업의 다음 갱신 대상:

1. `0136` history ID와 advisors 후속 결과.
2. 수정된 Toss 위젯·승인·취소의 실제 검증 결과.
3. 캠페인 초대의 실제 OAuth 복귀·수락 결과.
4. 고정 버전 의존성으로 수행한 최종 TypeScript·전체 Vitest·production build/start·익명 sweep 결과와 검증 대상 커밋.
5. 배포 URL·상태, 워커 활성화 여부와 heartbeat/outbox 증거.
6. 새 독립 리뷰 결과와 남은 정책·제공사·보관기간 집행 조건.
