# 캠페인 위험 검토 워커 운영 메모

상태: 기본 비활성화. 클라우드 마이그레이션·실제 메시지 분석·Slack 실발송·상시 워커 설치는 별도 운영 개방 단계다. 이 문서는 설정 방법과 코드의 한도를 설명하며 실제 개방 완료를 뜻하지 않는다.

## 저장소와 실행 경계

- 서버: `lib/campaigns/risk/*`, `/api/campaign-risk-worker/{claim,complete,heartbeat,slack}`.
- 워커: `scripts/campaign-risk-worker.ts`. 한 번 실행한 뒤 종료한다. 서비스·예약 작업을 설치하지 않는다.
- 로컬 모델: 실행하는 컴퓨터에서 `http://127.0.0.1:11434/api/chat`에 이미 접근할 수 있어야 한다. 코드가 모델을 설치하거나 서버를 시작하지 않는다.
- Windows와 WSL의 localhost·환경변수·의존성은 별개로 확인한다. 공유 Ollama/CRM 서버를 재시작하거나 모델을 unload하지 않는다.
- 클라우드에는 0047/0132(대화)와 0048/0133(위험 검토)가 먼저 필요하다. 대표/Director가 적용한다.
- 모델은 메시지 텍스트를 데이터로 읽고 JSON을 반환한다. 도구, 결제·권한·생성·제재 호출, 첨부 내용 읽기를 제공하지 않는다. 메시지에 적힌 URL도 따라가지 않는다.

## 환경변수

비밀은 서버 환경 또는 별도 안전한 실행 환경으로 주입한다. 예시 파일·커밋·명령 출력에 값을 기록하지 않는다.

| 변수 | 위치 | 의미 |
| --- | --- | --- |
| `CAMPAIGN_RISK_ENABLED=on` | TWINGS 서버 | 규칙 탐지, 큐 삽입, 워커 API를 개방한다. 미설정은 off. 개인정보 처리 고지·운영 승인 후에만 설정한다. |
| `CAMPAIGN_RISK_WORKER_SECRET` | 서버와 워커 | 서로 같은 32자 이상의 서버 전용 비밀. `Authorization: Bearer …`로 인증한다. |
| `CAMPAIGN_RISK_API_ORIGIN` | 워커 | 승인된 TWINGS 서버의 명시적 origin. HTTPS 또는 로컬 테스트의 localhost/127.0.0.1 HTTP만 허용한다. 경로·사용자정보·query·fragment를 넣지 않는다. |
| `CAMPAIGN_RISK_WORKER_ID` | 워커 | 영문·숫자·밑줄·점·하이픈으로 된 실행기 식별자, 1~80자. |
| `CAMPAIGN_RISK_OLLAMA_MODEL` | 워커 | 설치된 모델 ID를 명시한다. 기본 모델은 없다. 2026-10-16 합성 검증에서 선택한 값은 `qwen3.8:27b-q4_K_M`. |
| `CAMPAIGN_RISK_SLACK_ENABLED=on` | 서버만 | 별도의 Slack 발송 개방 스위치. 기본 off. Vercel production 외 환경에서는 발송하지 않는다. |
| `CAMPAIGN_RISK_SLACK_TOKEN` | 서버만 | 별도 봇 토큰. 워커나 브라우저로 전달하지 않는다. |

Slack 대상은 코드에 고정된 비공개 채널 `C0C9DRS4DT7`, 워크스페이스 `T0AJ7QBQM39`다. 발송 직전 `auth.test`와 `conversations.info`로 워크스페이스, 비공개 여부, 봇의 현재 멤버십, 보관 여부를 확인한다. 조회 권한이 없거나 조건이 맞지 않으면 발송하지 않는다. 실제 토큰·scope는 이번 구현에서 변경하지 않았다.

## 한 번 실행하기

실행 위치는 승인된 작업 체크아웃이다. 서버와 워커 환경은 미리 안전하게 구성되어 있어야 한다. 이 예시는 비밀을 출력하거나 생성하지 않는다.

```powershell
if (-not $env:CAMPAIGN_RISK_API_ORIGIN -or -not $env:CAMPAIGN_RISK_WORKER_SECRET -or -not $env:CAMPAIGN_RISK_OLLAMA_MODEL -or -not $env:CAMPAIGN_RISK_WORKER_ID) {
  throw '워커 실행 환경이 필요합니다.'
}
npx tsx scripts/campaign-risk-worker.ts
```

워커는 먼저 heartbeat를 기록하고, 작업을 한 건씩 claim한 뒤 순서대로 추론·완료 보고한다. 최대 10건을 처리하고 종료한다. 로컬 모델 오류가 한 번 발생하면 실패 상태를 서버에 기록한 뒤 해당 실행을 오류로 종료하며, 같은 실행에서 나머지 작업을 추가 추론하지 않는다. 한 프로세스에서 모델 요청은 동시에 한 건만 보낸다. 공유 모델에서는 운영자가 별도 동시 워커를 시작하지 않도록 관리한다. 자동 재실행·상시 서비스는 이 코드에 없다.

마지막 Slack pass는 서버의 별도 발송 스위치가 켜져 있을 때만 outbox 한 건을 처리한다. 메시지 원문·이름·계좌·브랜드·캠페인명은 보내지 않는다. 고정 이벤트 이름 `risk_review_required`, outbox 이벤트 UUID와 검증된 플래그 UUID를 포함하는 `https://admin.twings.app/admin/risk?flag=UUID#flag-UUID` 링크만 보낸다. 이벤트 UUID는 Slack의 client_msg_id로 고정되고, 링크는 관리 목록에서 해당 신호를 우선 표시한다. 원문은 관리자가 별도로 검토를 열기 전까지 읽지 않는다. 동일 메시지 원문 hash에 대한 규칙·모델 탐지는 각각 기록하지만 Slack 알림은 한 건으로 묶는다.

## 코드에 고정된 한도와 실패 처리

| 항목 | 한도/동작 |
| --- | --- |
| 모델 입력 | 원문 UTF-16 길이 최대 4,000. 이름·이메일·브랜드명·예산·첨부를 별도로 조회하거나 붙이지 않는다. 사용자가 본문에 쓴 내용 자체는 분석 대상이다. |
| 로컬 모델 요청 | 요청당 최대 180초, redirect 거부, localhost URL 고정, temperature 0, think=false, 생성 상한 700 tokens. |
| 모델 응답 | 스트림을 읽으면서 최대 32,768 bytes, JSON 본문 문자열 최대 8,192 UTF-16 길이. |
| 모델 결과 | strict enum/score/evidence JSON. 자유 서술·추가 필드 거부. 근거는 원문 UTF-16 start/end와 정확한 원문 text가 일치해야 한다. 모델의 offset이 틀리더라도 인용 text가 원문에 정확히 한 번 존재하면 로컬 어댑터가 해당 원문 위치로만 고정한다. 원문에 없는 인용·여러 곳에 있는 모호한 인용은 보정하지 않는다. 서버는 보정 후에도 원문 구간과 text 일치를 독립 검증한다. 정규화·유사 문자열 탐색·잘라내기는 하지 않는다. |
| 플래그 저장 | 원문 복사 없이 hash·근거 offset·카테고리·점수·버전·모델 ID만 저장한다. 규칙 플래그는 모델이 none을 반환해도 남는다. |
| 워커 API 요청 | 인증 후 스트림을 읽으며 최대 16,384 bytes. 워커의 각 API 호출은 15초·응답 200,000 bytes 상한. |
| Claim | 기본 1건, 최대 10건. 참조 워커는 항상 1건을 요청한다. |
| Lease | 5분. 완료 시 현재 lease token과 만료시각을 CAS로 확인한다. 만료 회수는 다음 claim 때 수행한다. |
| 실패 재시도 | 최대 5번 시도. 실패 후 대기 간격 1분·4분·15분·1시간, 5번째 실패는 dead. 코드의 4시간 최종 간격은 dead 이후 자동 재시도를 발생시키지 않는다. |
| 워커 상태 | 마지막 heartbeat가 없거나 30분이 지나면 관리자에게 연결 불가 표시. heartbeat 자체가 모델 품질·추론 성공을 증명하지 않는다. |
| Slack 전송 | 전체 검증·전송에 5초, provider 응답 최대 65,536 bytes. 429의 명시적 미전송만 최대 5회 제한 재시도한다. |
| Slack 불명확 응답 | 네트워크 단절·timeout·알 수 없는 응답·sending lease 만료는 uncertain. 자동 재전송하지 않는다. 운영자가 실제 채널 이력을 확인해야 하며 이 버전에는 재전송 버튼이 없다. |

관리자 `/admin/risk`에는 분석·Slack 큐 상태와 워커 상태를 표시한다. 명시적으로 원문 검토를 열면 현재 관리자 자격을 DB에서 다시 확인하고 `risk_review` 목적의 열람 이력을 저장한다. 원문은 이스케이프된 평문으로 렌더하며 검증한 구간만 강조한다. 확인·무시·추가 검토에는 이유가 필수이고, 어느 상태 변경도 사용자·참여·지급 상태를 바꾸지 않는다. 빈 목록과 조용한 Slack을 안전 판정으로 해석하지 않는다.

## 실제 메시지 없이 로컬 어댑터만 확인하기

이 스크립트는 소스에 고정된 두 합성 문장만 사용한다. DB·큐·Slack을 import하거나 호출하지 않는다. 첫 요청이 실패하면 두 번째 요청은 보내지 않는다.

```powershell
$env:CAMPAIGN_RISK_OLLAMA_MODEL = 'qwen3.8:27b-q4_K_M'
npx tsx scripts/campaign-risk-smoke.ts
```

결과는 `docs/evidence/kapier-campaign/risk-local-model-synthetic.json`에 저장된다. 모델의 실제 JSON, 원문 근거 검증 여부, 지연시간을 구분한다. 이것은 연결 확인 자료이며 운영 메시지 탐지 품질·오탐률·한국어/유니코드 정확도를 보증하지 않는다.

### 2026-10-16 합성 실행 결과

Windows 체크아웃에서 명시적 `qwen3.8:27b-q4_K_M`로 첫 외부 송금 요청 합성 문장 한 건을 실제 어댑터에 보냈다. 60,005ms에 제한시간으로 실패했고 JSON 출력·근거 구간은 얻지 못했다. 두 번째 무해한 문장은 요청하지 않았다. DB claim 0건, Slack 발송 0건이다. 이 결과로 로컬 추론 성공이나 분류 품질을 주장하지 않는다. 공유 서버의 재시작·모델 unload·설정 변경은 하지 않았다.


감사 이력 두 테이블은 SELECT·INSERT만 허용하며 UPDATE·DELETE 트리거도 거부한다. 나머지 위험 테이블도 삭제 권한이 없고, 상태·임대·검토 결과 등 실제 사용하는 열에만 UPDATE를 허용한다.


### 로컬 모델 실패 진단과 후속 합성 검증

공식 [thinking 문서](https://docs.ollama.com/capabilities/thinking)와 [chat API](https://docs.ollama.com/api/chat)를 확인했다. 설치된 모델의 /api/show는 thinking 기본값 medium, 허용값 false·low·medium·xhigh를 반환했다. 요청별 think=false를 명시했고, 모델 설치·상주 설정·keep_alive·서비스 상태는 변경하지 않았다. 콜드 로드 여유를 위해 제한시간을 최대 180초로 늘렸으며, 5분 lease 안에서 한 건씩 실행한다.

추가로 허용된 합성 요청 한 건은 16,395ms에 JSON을 반환했다. 응답 계수는 로드 16,285ms, 생성 76 tokens, thinking 문자열 길이 0이다. 이전 timeout의 단일 원인이 thinking이었다고 확정할 수는 없다. 실제 출력은 transfer_solicitation / 0.99였으나, 모델이 근거 end를 66으로 반환해 원문 문장부호를 포함하는 정확한 끝 67과 달랐다. 원래 서버 검증은 이를 거부했다.

이후 실제 응답을 저장한 채 네트워크 없는 재생으로만 고유한 원문 인용의 위치를 보정했다. 보정 구간 [7,67]이 서버 검증을 통과하며 PGlite 완료 처리도 통과한다. 실제 샘플은 한 건이고, 보정 이후 검증은 두 번째 실추론 샘플이 아니다. 기록은 risk-local-model-diagnosis.json(실제 원본)과 risk-local-model-replay.json(오프라인 재생)이다. 한국어·오탐률·일반적인 분류 품질 검증을 뜻하지 않는다.

관리자 화면은 워커 heartbeat와 별도로 작업의 model_unavailable 등 오류를 표시한다. 최근 접속 기록이 있어도 분석 성공을 의미하지 않는다. 어댑터의 선택적 진단 callback은 시간·토큰 수·문자 수만 내보내며 thinking 원문이나 입력 텍스트를 출력하지 않는다.
