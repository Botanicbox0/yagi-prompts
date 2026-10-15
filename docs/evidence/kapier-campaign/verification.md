# KAIPER 구현 검증 기록

2026-10-16. 브랜치 `codex/kapier-self-serve`, 기준 커밋 `61b97f8dace63ec5e60cad792953691ea392442e`. 최종 커밋·프리뷰·CI 상태는 이 파일을 포함한 PR에서 확인한다. 운영 반영 완료 기록이 아니다.

## 결과

| 검증 | 결과 |
| --- | --- |
| `npm ci --no-audit --no-fund` | lockfile의 Next 15.5.27 / Vitest 4.1.11로 독립 설치 |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run --maxWorkers=8 --reporter=json` | 261개 파일, 2,501개 테스트 통과, 실패·보류 0 |
| `npm run db:local` | 실제 core 마이그레이션으로 로컬 PGlite 스냅샷 생성 |
| `npm run build:local` | 프로덕션 빌드 통과. `NEXT_PUBLIC_APP_URL=http://localhost:3107` |
| `npm run start:local -- -H 127.0.0.1 -p 3107` | 로컬 DB·로컬 저장소로 실제 서버 실행 |
| `SWEEP_BASE_URL=http://localhost:3107 npm run sweep:anon` | **SWEEP PASSED — 980/980** |
| `npm run security:client`, `npm run security:built` | 77개 client entrypoint와 빌드 산출물 검사 통과 |
| `git diff --check` | 통과 |

위 환경변수 표기는 명령의 설정값을 설명한 것이다. PowerShell에서는 `$env:NEXT_PUBLIC_APP_URL` 및 `$env:SWEEP_BASE_URL`로 해당 프로세스에 설정했다. 비밀 환경 파일을 복사하지 않았다. 이전 origin 불일치 검사(924/980)나 소스 편집 중 실행한 테스트는 최종 결과로 사용하지 않는다.

`test-summary.json`에 실제 전체 실행 JSON의 SHA256과 집계를 보존했다. `release-source-manifest.json`은 최종·종결·권한 패치 리뷰를 합친 106개 소스/문맥 파일이다. `sha256`은 리뷰 당시 Windows 작업공간 원본 바이트, `gitContentSha256`과 `gitBlob`은 Git의 LF 정규화 후 커밋 대상 내용이다. 마지막 검증 시 리뷰 후 소스 변경 0개를 확인했다. 원본 로그는 이 PC의 `C:/Users/User/AppData/Local/Temp/twings-kapier-20261016/`에 있다.

검증 이후 staged diff 검사에서 0048 SQL과 워커 문서의 파일 끝 빈 줄을 발견해 제거했다. 실행 내용은 변경하지 않았으며, 최종 Git 내용 해시는 이 공백 정리까지 반영한다.

## 독립 모델 리뷰

- 계획: 실제 `claude-fable-5-1`, 원문과 채택하지 않은 제안은 `docs/plans/`에 구분했다.
- 구현: 명시적 `gpt-6.1-sol` 에이전트 3개와 부모 통합 작업.
- 리뷰: 실제 `claude-opus-5-5`. 최초 소스 리뷰 → 수정 → 전체 소스 후속 리뷰 → 변경 파일 종결 리뷰 → 최종 권한 패치 리뷰를 실행했다. 각 응답은 `isError=false`, 실제 모델 ID와 입력 해시를 별도 JSON에 남겼다.
- 종결 리뷰: **제공된 소스 범위에서 남은 P1/P2 차단 결함 없음**. 최종 권한 패치도 차단 결함 없음. 비차단 후속 항목은 `review-resolution.md`와 `opus-closure-review.md`에 남겼으며 운영 승인으로 표시하지 않는다.

## 실제로 확인한 외부 상태

- Supabase 읽기 전용 조회: KAIPER 브랜드 존재, 연결 프로젝트 0개·계약 0개. 기존 제작용 `campaign_productions` / `campaign_render_jobs` 테이블은 조회 시점 운영에 없었다. 운영 DB 수정은 하지 않았다.
- Slack 비공개 채널 [twings-risk-review](https://yagiworkshop.slack.com/archives/C0C9DRS4DT7) 생성 성공. 메시지 발송 0건. 봇 토큰·멤버십·실제 자동 알림은 연결하지 않았다.
- 로컬 Ollama: 합성 문장에 실제 JSON 응답 16.4초. 원본 응답의 근거 위치 오류를 확인한 뒤 고유한 원문 인용만 정확히 재배치하는 어댑터를 추가했다. 저장된 실제 응답의 오프라인 재생과 DB 완료 처리는 통과했다. 두 번째 실추론이나 일반 분류 품질 검증으로 표현하지 않는다. 실제 사용자 메시지·DB claim·Slack 전송 0건.

## 미실행 검사와 운영 조건

- 브라우저 도구가 request-header policy/연결 오류로 초기화되지 않아 화면·모바일·키보드·실제 OAuth 복귀와 Toss 위젯을 직접 검증하지 못했다. HTTP sweep과 React 렌더 테스트는 이를 대신하는 증거가 아니다.
- PGlite는 트랜잭션을 직렬화한다. 실제 PostgreSQL 다중 연결의 잠금 경합·교착 테스트는 미실행이다.
- Toss는 fake gateway 검증이다. 실제 테스트 키 승인·가상계좌·취소·금액 이동을 실행하지 않았다. 지급대행이나 자동 이체는 구현 범위가 아니다.
- 실제 얼굴·제공사 생성·SNS 게시·캠페인 공개·고객 초대 발송은 하지 않았다.
- 클라우드에는 기존 제작 0045/0130 및 신규 0047/0132, 0048/0133, 0049/0134 적용 여부를 전체 이력과 함께 확인해야 한다. 대표/Director 적용 대상이며 이번 작업은 SQL만 준비했다.
- 협업·캠페인 결제·위험 분석·Slack의 기본 플래그는 모두 off다. 가격·서비스/환불 조건·PG 적합성·개인정보 고지·운영 QA 확정 후 연다. 입금 상태는 현재 명시적 조회/관리자 대사이며 상시 webhook/스케줄러는 없다.
- 대리 등록은 [동의·약관 변경안](../../legal/drafts/KAIPER-DELEGATED-LIKENESS-AND-MESSAGING.md)만 준비했다. 현행 약관·본인 얼굴 검증은 변경하지 않았다.

운영 순서는 [KAIPER 운영 전 검증](../../qa/kaiper-self-service.md), [결제 복구](../../qa/campaign-funding-recovery.md), [위험 워커](../../qa/campaign-risk-worker.md)에 기록했다.
