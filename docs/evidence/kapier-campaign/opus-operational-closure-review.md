# Opus 5.5 운영 변경 후속 소스 리뷰

2026-10-16, `codex/kapier-self-serve`, 기준 HEAD `8082a688854c2dfdb91558b6c7940c1733c8f55d` + 동결된 변경분. 검토 대상 21개 파일의 SHA-256은 [manifest](./opus-operational-closure-manifest.json)에 기록했다. 리뷰 종료 후 21개 파일 모두 해시 일치를 확인했다.

공식 WSL Claude Code 2.1.299에서 `claude-opus-5-5`, medium effort, 도구·MCP 없는 스트리밍 호출을 수행했다. Max OAuth를 유지하고 자식 환경의 ANTHROPIC 자격증명·주소 override를 제거했다. 실행 151.1초, 종료 코드 0, `is_error=false`, `modelUsage`의 실제 모델 `claude-opus-5-5`를 확인했다. [실제 결과 영수증](./opus-operational-closure-result.json)에 모델 사용 정보와 응답 원문을 보존했다. 비밀값·결제 키·계좌·개인 원문은 포함하지 않았다.

결론: 제공된 동결 소스에서 남은 P1/P2 차단 결함을 발견하지 않았다(`findings: []`). 이는 병합 승인이나 법적 적합성 판단이 아니다. 리뷰어는 테스트를 실행하지 않았으며, 아래 실제 제공사·브라우저 검증 및 부모 작업의 전체 검사·CI가 별도로 필요하다.

검토 범위에는 결제 pre-confirm 수단 제한, 선택 동의 초기 상태, 환불 전 재인가, 원문 수동 복구 절차와 신규 실패 회귀 테스트, 공유 gateway의 선택적 필드 호환성, 법무 한·영 적용 범위와 구독 법무 projection 수정이 포함된다. 기존 발견 F1은 자동 재취소 대신 제공사 지원/콘솔의 동일 주문 결과를 확인한 뒤 조회 대사하는 승인된 운영 경계로 평가했다. F2는 신규 승인 전에 카드·토스페이만 허용하는 경계로 평가했다.

## 남은 실제 검증

1. 새 결제수단 게이트를 포함한 실제 테스트 키 흐름에서, 승인 전 조회가 카드의 `method=카드` 또는 토스페이의 `method=간편결제`, `easyPay.provider=토스페이`를 제공하는지 확인한다. 이전 성공 결제는 새 게이트 전이므로 이 검증을 대신하지 않는다.
2. 실제 v2 위젯 `getSelectedPaymentMethod()`가 `code=CARD/TOSSPAY` 형태인지 확인한다. 가상계좌 등은 `requestPayment` 전에 차단되어야 한다. 초기 약관 동의·미동의와 로딩 중 토글도 브라우저로 재검증한다.
3. 기존 미확정·입금·검토 주문에 미지원 결제수단이 존재하는지 읽기 전용으로 확인한다. 존재한다면 해당 주문 환불 전에 같은 수단 제한 또는 별도 승인된 복구가 필요하다.
4. 제공사 콘솔에서 동일 주문 전액 취소 후 앱 조회 대사로 `refunded`가 되는 실제 테스트 키 절차와 담당자의 runbook 접근을 확인한다. 불확실한 요청의 자동 재전송이나 불변 마커 삭제는 하지 않는다.
5. 최종 소스의 전체 TypeScript·Vitest·production build/start·익명 sweep과 원격 CI를 확인한다. 공유 fake snapshot 필드 추가의 소비자 회귀도 전체 검사 대상이다.
6. 최종 게시 문안의 승인 기록과 실제 게시일을 Director가 확인한다. 공개·위험 처리 플래그와 보관 집행 조건은 별도 운영 판단이다.

## 리뷰 뒤 별도 읽기 전용 확인

리뷰에 전체가 포함되지 않았던 `lib/admin/campaign-funding-operations.ts`와 `lib/campaigns/funding/runtime.ts`를 Executor가 추가 확인했다. 관리자 reconcile은 현재 DB의 `studio()` 인가 후 `fundingDeps()`와 `reconcileFunding()`을 호출한다. `fundingDeps()`는 공개 플래그가 꺼졌다는 이유로 null을 반환하지 않으며, reconcile은 schema와 실행 환경 일치를 확인한다. 이 확인은 별도 소스 읽기 결과이며 Opus의 검토 범위를 소급 확대하지 않는다.

이번 리뷰 작업에서 제품 소스·운영 설정·DB·병합은 변경하지 않았다. 리뷰 영수증과 manifest, 이 설명 문서만 추가했다. 정확한 최종 커밋 검토와 병합은 부모 작업의 후속 지시를 기다린다.
