# Opus 5.5 final permissions patch review

## 리뷰: 0134 service_role 권한 강화 패치

**결론: 이 패치에서 확인된 blocker는 없습니다.** (프로덕션 또는 라이브 승인 의미는 아닙니다.)

### 정확성
- `revoke all ... from public,anon,authenticated,service_role` 다음에 `grant select,insert,update ... to service_role`이 오는 순서가 맞습니다. 기존 `GRANT ALL`로 받은 DELETE, TRUNCATE, REFERENCES, TRIGGER(PG17이면 MAINTAIN 포함)가 모두 제거됩니다. 테이블 단위 REVOKE는 같은 종류의 컬럼 권한도 함께 회수하므로 컬럼 단위 잔여 권한 우려도 없습니다.
- 구문 전체가 멱등적입니다. 재적용해도 안전합니다.
- 리뷰를 마친 0132와 패턴이 같고, 5개 테이블에 동일하게 적용됩니다.

### 테스트
- 기존 `GRANT ALL`을 재현한 뒤 마이그레이션을 다시 적용하는 구조가 적절합니다. red→green 전환이 수정 효과를 직접 입증합니다.
- **전제(검증 불가):** `freshDb()`가 role을 미리 만들지 않으면서 테이블은 생성해야 테스트가 성립합니다. 0134에 존재하지 않는 role을 대상으로 한 REVOKE가 있는데도 `freshDb()`가 통과했다면, helper가 0134를 건너뛰는지 role 구문을 처리하는지 확인하는 것이 좋습니다. 테스트가 실제로 통과했다고 하셨으므로 blocker는 아닙니다.

### Nit (비차단)
- UPDATE 유지(true)는 assert하지 않습니다. REFERENCES, TRIGGER가 false인지와 `anon` 거부도 assert에 넣으면 회귀를 더 넓게 잡을 수 있습니다.
- 테이블 이름을 스키마 없이 `$1`로 넘겨 search_path에 의존합니다. `public.${table}`로 한정하면 더 명확합니다.

### 범위 밖 참고
- 테이블에 identity/serial 시퀀스가 있다면 service_role의 시퀀스 기본 권한(UPDATE → `setval`)은 이 패치로 바뀌지 않습니다. 이는 기존 비차단 항목과 같은 성격입니다.
- service_role은 `bypassrls`라서 FORCE RLS의 영향을 받지 않습니다. 의도된 동작입니다.
- 이전에 기록된 다른 비차단 이슈들은 이 패치와 무관하며 그대로 남아 있습니다.