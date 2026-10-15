# KAIPER 설계 보정 기록

2026-10-16. Fable 최초 계획과 Opus 사전 리뷰는 입력한 소스 범위에 따른 제안이다. 이 파일과 `KAIPER-SELF-SERVICE.md`가 후속 사용자 응답 및 실제 코드 확인을 반영한다.

## 모델 실행 근거

- Fable 계획: 응답 `modelUsage`의 실제 모델 `claude-fable-5-1`, `is_error=false`. `KAIPER-FABLE-PLAN.md`에 원문 보존. 최초 Windows 호출은 OAuth refresh 실패; WSL Ubuntu-24.04 공식 CLI의 별도 Max 로그인으로 성공했다.
- GPT 구현: 이 작업의 `sol_repo_audit`, `sol_admin_ux`, `sol_risk_review` 에이전트에 `gpt-6.1-sol`을 명시했다. 구현·검증 상태는 최종 증거 문서에서 별도 기록한다.
- Opus 사전 리뷰: 실제 모델 `claude-opus-5-5`, `is_error=false`; `KAIPER-OPUS-ARCHITECTURE-REVIEW.md`. 구현 전 가설 검토이며 코드 승인·실행 검증이 아니다.
- 운영 DB 조회는 프로젝트 목록으로 현재 접근을 확인한 후 읽기 전용 SQL만 사용했다.
- Slack 채널 생성 성공: `C0C9DRS4DT7`, private=true. webhook/bot credential 연결·자동 발송 검증은 별도다.
- WSL `http://127.0.0.1:11434/api/tags` 응답으로 로컬 Ollama 서비스와 설치 모델을 확인했다. 후속 합성 요청은 `think:false`에서 16.4초 만에 응답했다. 원문 근거 위치 오류를 확인하고 정확히 한 번 나타나는 인용만 보정해 저장된 응답의 오프라인 재생을 통과했다. 실제 대화 품질·상시 가용성 검증은 아니다. `docs/evidence/kapier-campaign/risk-local-model-diagnosis.json`과 `risk-local-model-replay.json`에 구분했다. 기존 CRM의 모델·프로세스를 재시작하거나 교체하지 않았다.

## 채택하지 않는 설계 제안

1. 최초 Fable 계획의 `image_credit` 보상 종류는 이번 요청에 없다. 추가하지 않는다.
2. 지원자가 수락한 보상 조건을 확인 체크박스만으로 바꾸는 제안은 채택하지 않는다. 지급 조건은 참여 시점 스냅샷과 변경 동의가 없는 한 불변이다. 이번 단계에서는 지원 발생 후 변경을 거절한다.
3. 초대 토큰을 경로 또는 OAuth query에 유지하는 제안은 기존 브랜드 초대의 fragment/브라우저 임시 보관 방식과 비교해 최소 노출을 선택한다. 로그·Referer·클라이언트 분석에 토큰을 남기지 않는다.
4. `rejected` 상태는 현재 게시물 반려이고 `declined`는 지원 미선정이다. 동일한 상태라고 가정한 enum 전면 교체는 하지 않는다. 실제 테스트로 의미를 고정한다.
5. 기존 캠페인은 관리자가 브랜드 계약에 연결하는 구조이므로 ‘조직 컬럼 없음’만으로 기존 취약점이라 단정하지 않는다. 신규 초대·대화에는 불변 프로젝트/조직 연결을 두고, 이후 제작 연결 변경이 참여자 정보를 다른 브랜드로 옮기지 못하게 한다.
6. 증거가 없는 8단계 완료 막대를 만들지 않는다. 관리자에게 데이터로 입증되는 준비·대기·진행·완료와 막힌 이유만 보여준다.
7. 모델의 로컬 처리만으로 개인정보 의무가 사라진다고 설명하지 않는다. 분석 목적·열람 권한·보관·철회·정정과 전송 범위를 함께 검토한다.
8. Slack에서 메시지 수신이 불명확하면 무조건 재전송하지 않는다. durable outbox의 `uncertain` 상태와 운영자 확인을 유지한다.
9. Fable 추가안의 부가세 자동 계산, 특정 시점까지 자동 환불, 기존 PG 계약의 캠페인 판매 적합성은 확인된 사실이 아니다. 관리자가 승인한 정확한 총액·세금 설명·조건을 견적으로 기록하고, 자동 지급이나 자동 환불 정책을 만들지 않는다.
10. 대리 얼굴 등록은 이번 요청대로 동의·약관 변경안을 준비한다. 현재 운영 약관, 제공사 승인, 인물 자산의 본인 인증을 변경하거나 우회하지 않는다. 동의 화면만 추가했다고 대리 제작이 허용되는 것으로 처리하지 않는다.
11. 브랜드 결제 영수증은 캠페인 자금 수납 기록이다. 제작 권한, 공개, 검수 완료, 참여자 지급 완료를 자동으로 만들지 않는다. 정산 자동화는 별도 지급대행 계약·검증 후 연결한다.

## 참고 기준

- 데이터 권한과 RLS: [Supabase 공식 가이드](https://supabase.com/docs/guides/database/postgres/row-level-security).
- 별도 지급대행 연동: [토스페이먼츠 지급대행](https://docs.tosspayments.com/guides/v2/payouts).
- UI 접근성: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

위 자료는 구현 검토 기준이며 운영 승인, PG 계약 적합성 또는 법률 검토 완료의 증거가 아니다.
