# brand.twings.app 제품화 — 설계·결정·단계 (2026-11-03)

> 2026-11-03 대표 지시("BRAND.TWINGS.APP 실제 제품화 시작")로 시작한 작업의 단일 원본이다. 포지션과 엔진 구조는 `BRAND-ENGINE.md`(2026-10-30)를 그대로 잇고, 이 문서는 **무엇을 어떤 순서로 코드에 넣는지, 무엇이 대표 결정으로 남는지**를 적는다. 둘이 다르면 이 문서가 새 것이다.
> 근거 조사 10편은 `research/brand-product-2026-11-03/`에 있다(§14). 숫자(가격·한도·라이선스)는 그 조사의 확인 날짜 기준이며, 결정 전에 다시 확인한다.

## 0. 한 줄

**브랜드만의 AI 미디어 엔진**을 B2B 구독(월 290,000 / 490,000 / 690,000원, 2026-11-12 대표 공식 변경 승인)으로 판다. 고정 층(아이덴티티·절대 규칙·제작 원칙·메모리)이 상품이고, 생성 버튼은 수단이다. 기능은 모든 고객에게 기본 개방이며 예외는 조직별 차단 목록으로만 둔다.

## 1. 대표 결정 (2026-11-03 ~ 2026-11-12, 그대로 적용)

| # | 결정 | 코드·문서에서의 자리 |
| --- | --- | --- |
| D1 | 최소 플랜 290,000원, 다음 490,000원, 690,000원(기본 저장 한도 200 / 400 / 800 GB, 프로젝트 전용 외주 조직은 월 0원·기본 50 GB·종료 후 90일 보관 뒤 읽기 전용 아카이브, 2026-11-12 대표 확정). | `lib/brands/plans.ts`의 `b2b_29·b2b_49·b2b_69·project_only` |
| D2 | **Morphic**(고객사이자 경쟁사)에게는 생성형 미디어·사운드·컬러 그레이딩을 열지 않는다. | `brand_feature_policies` 차단 목록 = `generative_media, sound, color_grading`(§4.5 적용 절차) |
| D3 | 그 밖의 예외가 없으면 **전체 기능 개방이 기본**이다. | 정책 행이 없으면 전부 허용. 허용 목록이 아니라 **차단 목록**(§4.1) |
| D4 | 브랜드 측 AI 모델은 Argon(Gemini 4 Argon)으로 붙인다. 이유는 "사운드를 조립할 수 있는 유일한 모델". | §7: Argon은 듣고 보고 **판단**하는 디렉터, 소리 **생성**은 별도 엔진 |
| D5 | 브랜드 학습 로직을 잘 빌드하는 것이 중요하다. | §5 고정 층 스키마(P0) |
| D6 | music-creator·Video-Creator에서 콘텐츠를 만든 노하우를 전부 녹인다. | §9 노하우 이관 목록 |
| D7 | 다른 AI가 구조를 한눈에 이해하도록 코드·폴더를 효율화한다. | §11, 루트 `ARCHITECTURE.md` |
| D8 | 비용 효율화 요소를 검토하고 테스트할 수 있는 건 전부 해 본다. | §8 로컬 GPU·오픈 모델 후보와 테스트 계획 |

## 2. 지금 상태 (2026-11-03 조사)

- **브랜드 표면**: 캠페인 운영(의뢰·마법사·지원자·결제·리포트) + 계약형 셀프 스튜디오(브랜드 전용 템플릿 + 본인 셀카)가 운영 중이다. 조직 식별자는 `brand_organizations.id` 하나, 역할은 owner/editor/viewer + 캠페인 게스트 + 스태프 읽기(`lib/brands/workspace/staff.ts`). 고객 쓰기 19개는 전부 `/api/brand-workspace` → `mutation()` → `member()/project()`를 지난다. 캠페인 상세의 "YAGI STUDIO" 프로토타입 레이어(`aesthetic-engine`·`brief-concierge`·`review-stage`·`human-handoff`)는 **서버 연결 없는 목업**인데 운영 화면에 그대로 렌더되고 하드코딩 한국어가 1,600개 넘는다(`research/…/repo-brand-surface.md`).
- **엔진·파이프라인**: 어댑터 1개(`lib/renders/engines.ts`) + 레지스트리로 이미지 7·영상 3 엔진이 붙어 있고 큐·재시도·원가 기록(`render_jobs.cost_usd`)이 있다. 그러나 **셀카 필수** 전제(`selfie_missing`·`no_identity`·`bad_photo`)라 얼굴 없는 제품컷은 못 만들고, 업스케일·색 보정·사운드·마스크 편집·로컬 GPU 경로는 코드가 0건이다. 워크스테이션 연결의 유일한 틀은 Ollama pull 워커 2종이다(`repo-engines-pipeline.md`).
- **과금**: 돈 경로는 단건 3종뿐, 조직 단위 구독·크레딧 표 없음. 토스 자동결제는 별도 계약 대상이고 현 계약은 단건이다. 약관 제4조가 정기결제·크레딧을 부정한다(`repo-billing-b2b.md`).
- **운영 DB**: 브랜드 조직 3개(YAGI WORKSHOP TEST, Morphic, KAIPER). Morphic은 `studio_managed`, 캠페인 6건(스튜디오 모드 3건), 생산 계약·템플릿·예약 0건. 즉 지금 Morphic이 쓰는 생성형 기능은 없고, 차단 정책을 적용해도 당장 끊기는 작업은 없다.

## 3. 제품 구조 (BRAND-ENGINE 요약 + 메뉴)

| 메뉴 | 목적 | 상태 |
| --- | --- | --- |
| 홈 | 오늘 할 일(승인 대기·진행 캠페인·최근 결과) | 운영 중 |
| **브랜드**(신규) | 고정 층: 아이덴티티 편집기·절대 규칙·메모리·저장한 룩 | §5, 다음 슬라이스 |
| **만들기**(신규) | 한 줄 지시 → 촬영 지시서 → 결과 3컷 → 부분 수정 → 영상 → 마감(색·사운드·업스케일) → 내보내기 | §8·§9, P1~P2 |
| 라이브러리 | 에셋·승인 상태·사용 권리 | 운영 중(검색·태그는 미구현) |
| 캠페인 | 크리에이터 캠페인·후보·리포트 | 운영 중 |
| 설정 | 팀·권한·플랜·팀 AI 에이전트 토큰 | 플랜 표시는 §6, 토큰은 P2 |

기능 그룹 7개(`lib/brands/features.ts`)가 이 메뉴를 묶는다: `generative_media`(만들기·셀프 스튜디오·리믹스·부분 수정·업스케일), `sound`, `color_grading`, `brand_learning`(브랜드 메뉴), `campaigns`, `creator_pool`, `agent_access`. 새 화면은 반드시 이 중 하나에 속하고, 그 그룹이 닫힌 조직에게는 보이지 않는다.

## 4. 기능 정책 — 기본 개방, 예외는 차단 목록 (구현됨)

### 4.1 규칙
- 정책 행이 **없으면 전부 허용**이다. 행은 스튜디오(관리자)만 쓴다. 브랜드 쪽에서 바꾸는 길은 없다.
- 차단은 **기능 그룹** 단위다. 엔진 이름이나 경로가 아니라 "고객이 사는 것"의 이름이라, 그룹 안에 새 화면이 생겨도 자동으로 덮인다.
- 닫힌 기능은 **메뉴·페이지·API가 모두** 닫힌다. 페이지는 안내가 아니라 404(브랜드 호스트는 숨긴 것의 존재를 확인해 주지 않는다). **이미 만든 결과물은 그대로 본다** — 정책은 문을 닫지, 작업을 뺏지 않는다.
- 모든 저장은 `brand_feature_policy_events`에 남는다(누가·무엇을·언제).

### 4.2 데이터
`supabase/migrations/0074_core_brand_entitlements.sql` + `0150_glue_brand_entitlements.sql`(**클라우드 적용 필요**, 배포 전).
- `brand_feature_policies(organization_id pk, denied_features text[] ⊂ 7개, note, revision ≥ 1, updated_by, updated_at)`
- `brand_feature_policy_events(id, organization_id, denied_features, note, actor_id, created_at)`
- 같은 파일에 §6의 `brand_plan_assignments`·`brand_plan_events`.

### 4.3 코드
- `lib/brands/features.ts` — 그룹 7개, `featureDenied()`, `normalizeDenied()` (클라이언트 안전).
- `lib/brands/entitlements.ts` — `loadFeaturePolicies(sql, orgIds)`(트랜잭션 밖, 표가 없으면 빈 결과 = 전부 허용), `loadFeaturePolicy`, `assertBrandFeature(sql, orgId, feature)`(트랜잭션 안, `BrandFeatureDenied`), `setFeaturePolicy`(관리자 전용, revision 충돌 검사, 이벤트 기록).
- 적용 지점 3곳 — 이 셋이 "빠짐없이"의 정의다. 새 생성·사운드·그레이딩 진입점은 셋 중 하나를 반드시 거친다.
  1. 사이드바: `loadBrandWorkspaceScope`가 선택지마다 `denied`를 붙이고 `sectionVisibility`가 스튜디오 문을 닫는다(`lib/brands/workspace/selection.ts`).
  2. 페이지: `/brand/studio`는 닫힌 조직에서 `notFound()`.
  3. 작업 시작: `reserveProduction`이 멤버십 확인 직후 `assertBrandFeature(… 'generative_media')` → `feature_unavailable`, API는 404.
- 관리자: `brandEngine.featurePolicy`(체크 = 차단) 오퍼레이션, `/admin/brand-workspace/organizations/[id]` "기능 정책" 패널. 테스트 `tests/brands/entitlements.test.ts`.

### 4.4 운영 절차
1. 마이그레이션 0074·0150 클라우드 적용 → 2. 코드 배포 → 3. 관리자 조직 페이지에서 정책 저장(또는 아래 SQL) → 4. 브랜드 호스트에서 해당 조직으로 `/brand/studio`가 404인지, 사이드바에 스튜디오가 없는지 확인.

### 4.5 Morphic 적용 (배포 뒤, 대표 확인 후 실행)
```sql
insert into brand_feature_policies (organization_id, denied_features, note, revision, updated_by)
values ('deb648e9-c2df-43d4-b2a7-7f9eff8180d9', array['generative_media','sound','color_grading'], '2026-11-03 대표 결정: 고객사이자 경쟁사', 1, null);
insert into brand_feature_policy_events (organization_id, denied_features, note)
values ('deb648e9-c2df-43d4-b2a7-7f9eff8180d9', array['generative_media','sound','color_grading'], '2026-11-03 대표 결정: 고객사이자 경쟁사');
```
관리자 화면에서 저장하면 `updated_by`·`actor_id`가 채워지므로 화면 경로가 우선이다. 캠페인·리포트·후보·라이브러리는 그대로 열린다.

## 5. 브랜드 학습 — 고정 층 (P0, 다음 슬라이스)

조사 결론: 시장의 브랜드 학습은 ① 문서→규칙(Adobe GenStudio·Jasper·Typeface), ② 웹 추출(Omneky·Pomelli·Magnific), ③ LoRA(Scenario·Krea·Flair·Botika) 세 갈래이고, **출력 픽셀 검사·승인 메모리·동의한 실제 얼굴 층은 어디에도 없다**(`sota-platforms.md`). 그 셋이 TWINGS 자리다. LoRA는 "레퍼런스 테스트가 세트 안에서 드리프트할 때만"(Scenario의 자기 규칙) 마지막 수단이다.

### 5.1 스키마 (`lib/design/identity.ts` 모양을 조직별로)
`brand_identities(organization_id pk, version, identity jsonb, revision, updated_by, updated_at)` — jsonb는 zod `BrandIdentitySchema`로 검증:
- `colour`: 역할별 색(paper·canvas·sky·ink·body·muted·line·accent) + 대비 검사(`contrast()` 재사용, 흰 글자/accent ≥ 4.5).
- `type`: 서체 2개(한글·라틴), 굵기·자간 3단.
- `world`: 사진·영상이 사는 색 대역(hue band), 피부·입술 예외.
- `modelRoles`: 컷 종류 → 모델(기본값은 TWINGS 라우팅 표 §9.1; 공개 화면에는 엔진 이름 비노출).
- `rules`(절대 규칙): 로고(형태·최소 크기·클리어 스페이스·위치), 금지 표현(효능·치료·최상급), 팔레트 밖 색 금지(영역별 ΔE 임계값은 대표 결정), 동의한 얼굴만, 경쟁사 색·실루엣 배제, "never" 3개.
- `references`: 레퍼런스마다 역할 하나(subject·place·pose·style·palette) + 가져오지 말 것(scenario multi-reference 규칙 = IDENTITY §6-4-3 문법).
- `productChecklist`: 라벨·캡·실루엣·비율 수치(제품과 텍스트는 생성하지 않고 검사한다).
- `voice`: 한국어 문체 규칙, 금칙어.
- `brand_memory_events(id, organization_id, kind ∈ approved_cut|fix|banned_phrase|saved_look|note, payload jsonb, created_by, created_at)` — 통과한 컷만 입장, "바뀌는 것" 캡션과 "고정" 태그를 분리 저장(훗날 학습 데이터셋 후보).
- `brand_looks(id, organization_id, title, lut_key, measurements jsonb, intensity, skin_protect, source ∈ preset|reference_match, created_at)` — `viral_color_grade.py`의 `defaults` 8필드가 그대로 칼럼이다.
- 마이그레이션 번호: core 0075 / glue 0151.

### 5.2 화면
- `/brand/identity`(메뉴 "브랜드"): 읽기 + owner 편집(설정 페이지의 `ActionForm` + owner 전용 패턴 재사용). 웹사이트·자료로 만든 초안은 **초안 표시**로만 저장하고 팀이 확정하기 전에는 생성에 쓰지 않는다("추출은 빠르게, 고정은 사람이").
- 관리자: 같은 폼 + "TWINGS 기본값으로 초안 만들기".

## 6. 플랜·과금

### 6.1 고정된 것
세 금액(D1). `brand_plan_assignments`로 조직에 플랜·청구 방식(`invoice`|`card`)·시작/종료일·좌석을 **기록**한다(결제가 아니라 기록; 관리자 "플랜" 패널, `brandEngine.plan`). 기능은 플랜으로 가르지 않는다 — 대표가 §6.2를 정하기 전까지 유일한 게이트는 §4 차단 목록이다.

### 6.2 제안 (대표 결정 전까지 가격·포함 내용 공개 금지, BRAND-ENGINE §7-5)
조사 요약(`b2b-pricing-plans.md`): 이 금액대는 해외 비교군의 "엔터프라이즈 영업 구간"이라 생성 횟수가 아니라 **브랜드 학습·마감·PD 시간·납기**로 가른다. 원가 가정(이미지 129원, 마스크 편집 188원, Seedance 2.5 10초 720p 3,234원, PD 50,000원/h, 재시도 1.1배, 카드 3.4%)으로 100% 소진 기준 마진 60~65%.

| | 29 플랜 (월 290,000원) | 49 플랜 (월 490,000원) | 69 플랜 (월 690,000원) |
| --- | --- | --- | --- |
| 기본 저장 한도 (2026-11-12 확정) | **200 GB** | **400 GB** | **800 GB** |
| 브랜드/좌석 (제안) | 1/3 | 2/10 | 3/25 |
| 월 한도(이미지/부분 수정/영상 10s 720p 환산, 제안) | 450/150/10 | 700/200/16 | 900/300/18 |
| 마감 | 기본 룩 1 | 룩 저장·매칭 + 사운드 + 2K 업스케일 | + 레퍼런스 지시서 + 사운드 디렉터 루프 + 4K |
| PD·납기 | 온보딩 1h | 월 1h · 우선 큐 | 월 2h · D+1 |
| 계약 | 월(카드 가능) | 연간 기본 | 연간 |

초과분은 선불 크레딧 팩(제안 100,000원, 90일), 미사용분 1개월 이월·잔액 상한 2배, 연간 선납 2개월 무료. **전부 제안값**이다.

### 6.3 결제 경로
> 2026-11-23: 카드 자동결제와 계좌이체를 함께 받는 정기 결제 설계는 [BRAND-RECURRING-BILLING.md](BRAND-RECURRING-BILLING.md)가 원본이다(구현 전). 아래는 11-03 시점의 요약이다.
- 1차: **세금계산서 후불**(계좌이체). 관리자 오퍼레이션 `invoice`·`confirmDeposit` + 홈택스 수기, 월 10건 넘으면 팝빌 API(200원/건).
- 2차: 토스 자동결제 — **별도 리스크 검토·추가 계약**이 필요하고 현 계약에 없다. 단건 라이브 키와 같은 날 신청, 정산한도(월 1,000만원)·보증보험 증액 함께.
- 약관: 제4조①②("정기결제 아님, 충전식 없음")와 충돌 → B2B 별지(청약철회 적용 제외 조건, 중도 해지, 미사용 크레딧 환불, 할인 환수)가 필요하다. 약관규제법은 B2B에도 적용되므로 "해지 불가"는 무효 위험. 문안은 대표·법무.
- 장부: `brand_subscriptions`·`brand_subscription_periods`·`brand_credit_ledger`·`brand_invoices`(초안은 `repo-billing-b2b.md` §3). 크레딧 단위는 현행 "1크레딧 = 순수입 10원"(PLATFORM-2.0 §19.2, 2026-11-02)으로 통일하고 B2B 원장은 분리한다.

### 6.4 B2B 과금 코어 (서버 · 원장 구현, 마이그레이션 `0176` / `0177`)
- **월 사용 한도 결정 우선순위 (`loadAllowance`)**:
  1. `brand_studio_allowances`에 명시적 덮어쓰기(`is_override = true`)가 있으면 그 `monthly_cap_krw`를 쓴다(기존 행은 마이그레이션에서 전부 `true`로 표시해 현재 조직 동작을 그대로 유지).
  2. 그렇지 않으면 유료 플랜(`b2b_29`·`b2b_49`·`b2b_69` — `project_only`는 플랜 기본값 대상에서 제외) 중 활성 배정(`brand_plan_assignments`의 오늘 KST 기준 유효 또는 `ends_on` 종료 후 유예 일수 `BRAND_PLAN_GRACE_DAYS` 기본 7일 이내)의 플랜 기본 한도(`brand_plan_allowance_defaults`)를 쓴다. 플랜 기본값이 비어 있으면 다음 단계로 넘어간다.
     - **롤백 안전 스냅샷과 한계**: 플랜 기본값을 따르는 조직(`is_override = false` 또는 기존 한도 행 없음)은 `setPlanAllowanceDefault`, 구형 `setPlanAssignment`, 신형 `setPlanAndAllowance` 호출 시 `brand_studio_allowances.monthly_cap_krw`에 당시 플랜 기본값 스냅샷(`is_override = false`)을 함께 생성·갱신한다. 기존 관리자 스튜디오 한도 패널은 `"플랜 기본값을 따름 (N원)"`을 표시하며, 선호 경로만 바꾸면 폼 숨김 필드가 아니라 트랜잭션 내 DB 상태(`is_override`·활성 플랜 기본값)를 기준으로 모드를 유지한다(월 한도를 바꾸면 명시적 덮어쓰기로 전환). 단, `0176` 이전 구버전 코드는 `ends_on`/유예 기간 만료 판정이나 `brand_allowance_grants` 일회성 추가 크레딧 합산을 수행하지 못하며 마지막으로 동기화된 `monthly_cap_krw` 스냅샷만 읽는다.
     - **플랜 기본값 일괄 변경 2단계 확정 (`brandBilling.planDefault.set`)**: 한 플랜의 기본값을 바꾸면 개별 덮어쓰기가 없는 다수 조직의 유효 한도가 한꺼번에 바뀐다. `confirm: true` 없이 호출하면 영향받는 조직 수·이름과 변경 전후 한도만 반환하고 저장하지 않으며, `confirm: true`로 확정할 때 적용하고 `brand_plan_allowance_default_events` 감사 행에 영향 조직 수를 기록한다.
  3. 둘 다 없으면 환경 기본값(`BRAND_STUDIO_DEFAULT_MONTHLY_KRW`, 운영 기본 0 = 생성 닫힘)을 쓴다.
  4. 마지막으로 현재 KST 월에 유효한 미회수 일회성 추가 크레딧(`brand_allowance_grants`)을 더하며, 화면 설명을 위해 `source`(`'override' | 'plan' | 'default'`), `baseCapKrw`, `extraKrw`를 함께 돌려준다. 관리자 오퍼레이션 `brandBilling.planAndAllowance.set`으로 플랜과 한도 모드를 한 번에 저장한다. 스키마 프로브는 프로세스 단위로 양(+)의 결과만 캐시해 `loadAllowance`의 조회를 2회 수준으로 유지한다.
- **조직별 할인 (`brand_discounts` · `brand_discount_codes`)**:
  - 청구서 발행 **횟수(N회, 1–36 또는 무기한)** 기준의 월 이용료 할인이다. 크레딧 단가, 실행 견적, 월 사용 한도는 바꾸지 않는다. 0원 청구서(예: `project_only`)는 할인 횟수를 차감하지 않는다.
  - 조직당 활성 할인은 최대 1개(새 할인을 부여하면 기존 활성 할인은 종료 기록 후 대체).
  - 청구서가 `issued`로 발행될 때 `invoices_used`가 1 증가하고 N에 도달하면 자동 종료되며, 발행된 청구서를 `void`하면 1회가 반환된다.
  - 할인 코드(`brand_discount_codes`, 직접 입력 10–24자 · 자동 생성 시 혼동 문자를 제외한 31자 알파벳 12자리 이상)는 조직 소유자/관리자만 등록한다. 특정 고객사가 정해진 코드는 생성 시 `organization_id`로 1:1 전용 바인딩을 권장한다. 조직당 10분 5회 + 사용자(계정)당 전체 조직 합산 1시간 10회 시도 제한(`brand_discount_code_attempts`), 코드 유무와 무관한 동일 수의 SQL 조회 경로, 그리고 `code_unavailable` 단일 실패(동일 상태·본문)로 코드 존재 유추를 막는다. 기존 활성 할인보다 높은 할인율 코드만 기존 할인을 종료하고 교체한다.
- **청구서 원장 (`brand_invoices` · `brand_invoice_events` · `brand_billing_profiles`)**:
  - 기록 및 오프라인 세금계산서·계좌이체 관리용 원장이다. 상태 전이는 `draft → issued → paid`와 `draft | issued → void`만 허용하며 모든 변경을 `brand_invoice_events`에 실행자(`actor_id`)와 함께 기록한다.
  - 계산 규칙(`invoiceAmounts`): 정상(`manualAmounts=false`) 초안·수정에서는 정가·일할 일수·할인율(%)과 메모만 편집하고 공급가액·부가세·합계는 항상 `invoiceAmounts`(일할 후 할인, 부가세 별도 상수 `BRAND_PLAN_PRICES_VAT_EXCLUSIVE = true` 기준 10% 버림)로 산정하며 플랜 변경 시 새 플랜 정가를 다시 제안한다. 예외적으로 직접 금액을 적으려면 `manualAmounts: true`와 사유(`manualReason`)가 필요하며(`total = supply + vat` 강제), 발행(`issue`) 시 금액 정합성을 다시 검증한다.
  - 미납·연체(발행 후 14일 초과 미입금)는 관리자 조회 전용(`overdueOnly`)이며 스튜디오 생성 기능을 자동으로 막지 않는다.
  - 조직 청구 프로필(`brand_billing_profiles`)은 10자리 사업자등록번호 국세청 체크섬을 검증하며, 조직 소유자/관리자(`GET /api/brand-billing`, `PUT /api/brand-billing/profile`, `POST /api/brand-billing/redeem`)도 본인 조직 것만 열람·수정한다(샌드박스 조직 404, 비관리 멤버 403, `paidMethod`·`voidReason`·관리자 `memo` 비노출).
- **일회성 추가 크레딧 (`brand_allowance_grants`)**: 반드시 하나의 KST 달(`valid_month`, 현재 또는 다음 KST 월만 허용)에만 1회성으로 유효한 양수 KRW 한도를 추가·회수한다(다른 달 누적 지급 없음).
- **예약 만료 10분 스윕**: 기존 10분 주기 크론(`/api/brand-rooms/notices/tick`)이 `expireStaleStudioReservations`와 1일 초과 `brand_discount_code_attempts` 배치 정리를 함께 멱등 실행한다. 10분 패스는 **① 10분 초과 작업 리스 해제, ② `held`/`queued` 24시간 초과 및 `running`/`finishing` 6시간 초과만** 만료 처리하며, 일시적 네트워크 끊김으로 정상 실행 중인 계정 레인(`sunra_mcp`) 작업이 잘리지 않도록 30분 유휴 계정 레인 판정은 일일 스윕(`sweepStudio`)에만 둔다.
- **대표 확인·결정 대기 (임의로 확정하지 않음)**:
  1. 플랜(`b2b_29`·`b2b_49`·`b2b_69`·`project_only`)별 기본 제공 월 크레딧/한도 금액 (현재 기본값: 미설정 → 환경 기본값으로 폴백).
  2. 플랜 종료일(`ends_on`) 경과 후 생성 유예 일수 (코드 기본값 7일. 운영은 2026-11-24부터 `BRAND_PLAN_GRACE_DAYS=14`로 14일).
  3. 플랜 정가가 부가세 별도인지 포함인지 여부 (현재 기본값: `BRAND_PLAN_PRICES_VAT_EXCLUSIVE = true` 부가세 별도).
  4. 첫 달 시작일 기준 일할 계산 기본 적용 여부 (현재 기본값: 초안에 일할 계산을 제안하되 편집 가능).
  5. B2B 별지 약관 문안 (해지·환불·할인 환수 기준).
  6. 고객 노출 과금 화면 문구 (`messages/brand-billing.ts`의 `customer` 블록 — 대표 확인 대기).

### 6.5 고객 플랜 및 청구 UI · 요청 경로 (`/brand/billing`, `POST /api/brand-billing/request`)
- **고객 화면 (`/brand/billing`)**:
  - 접근 제어: 조직 소유자·관리자(`owner`/`admin`) 전체 열람·수정(청구 프로필, 할인 코드 적용, 요청 접수), 비관리 멤버(`editor`/`viewer`/`guest`)는 차분한 `"관리자에게 문의"` 화면, 스튜디오 팀(`studio`, DB 확인 `profiles.is_admin`)은 `<StaffNotice />` 읽기 전용, 샌드박스 조직은 `404(notFound())`, `0176` 테이블 미적용 DB는 `"준비 중"` 화면.
  - 구성: ① 배정 플랜(플랜명·월 이용료 부가세 별도·이용 기간·5단계 상태 `시작 예정`/`이용 중`/`종료 예정`/`종료 · 유예 종료일`/`기간 종료` 및 `"플랜 문의"` / 미배정 시 `b2b_29`·`b2b_49`·`b2b_69` 카탈로그 — `BRAND_PLANS` 단일 기준 + `"이용 신청"`), ② 이번 달 크레딧 사용량(`used ÷ cap`·추가 크레딧 및 만료일만 표시, 원화·관리자 사유 미노출·매달 1일 KST 초기화), ③ 활성 할인 요약 및 할인 코드 입력(`activeDiscount` 응답 기준 `success`/`replaced`/`code_unavailable`/`rate_limited`/`invalid`/`forbidden`/`unavailable` 분기), ④ 읽기 전용 청구 내역(상태 `발행됨`/`입금 확인`/`취소` + 연체 배지·세금계산서 계좌이체 정산 안내, 카드 결제 UI 없음), ⑤ 세금계산서 정보 7항목(실시간 10자리 사업자등록번호 체크섬·이메일 검증, `PUT /api/brand-billing/profile`).
  - 추가 읽기 필드: `GET /api/brand-billing`에 활성 `extraGrants`(`credits`, `validMonth`, `expiresOn`)를 가산(additive) 포함.
- **요청 폼 및 아웃박스 연동 (`BillingRequestDialog` / `POST /api/brand-billing/request`)**:
  - 동일 출처(CSRF `sameOriginMutation`) + 본문 크기 상한(`8,192B`) 검증, 의도 3종(`plan_request`, `allowance_request`, `plan_question`), 희망 플랜(선택, `BRAND_PLANS` 기반 요금·부가세 별도 표기), 용도/필요량 자유 입력(답변은 작업 공간 채팅으로 일원화 안내), 세금계산서 정보 7항목 완성도 및 `/brand/billing#billing-profile` 링크 제공.
  - 제출 시 호출자 로케일(`ko`/`en`)에 맞춰 `brand_support_messages`에 1건 기록하고 `team_notice_deliveries`에 `plan_request` 또는 `allowance_request` 알림 1건(`admin_path = /admin/brand-workspace/organizations/<orgId>`, `plan_question`은 `billing:plan_question:...` surface로 구분)을 적재한 뒤 응답 후 `runLiveTeamNoticeDeliveryPass`를 실행한다.
  - DB 기반 조직당 시간당 5건(`perOrgHourlyLimit = 5`) 요청 제한 및 `requestId` 멱등성(입력 수정 시 신규 `requestId` 재발급) 적용. 안내 소요 시간 약속 금지, 워크스페이스 채팅 답변 안내만 표기.
- **4개 스튜디오 미개방/한도 소진 상태(이미지·영상·사운드·워크플로우·편집·시퀀스 레일·수정 어시스트)**:
  - 미개방(`allowance_closed` / `capKrw <= 0`): 한 줄 안내 + `"이용 신청"` 버튼(요청 폼 `plan_request`; 사운드 스튜디오는 컴포저 유지).
  - 한도 소진(`allowance_exhausted` / 잔여 크레딧 0): 인라인 안내(필요 vs 남은 크레딧, 다음 초기화일 KST, 원화 미노출; 일반 유효성 메시지는 병행 유지) + `"추가 크레딧 요청"` 버튼(요청 폼 `allowance_request`).

## 7. AI 모델 — Argon의 자리 (D4)

공식 문서 확인(`argon-sound-assembly.md`): `gemini-4-argon`은 텍스트·이미지·영상·오디오·PDF **입력**, 텍스트 **출력**, 오디오·이미지 생성·Live API **미지원**. 즉 대표의 "사운드 조립" = **듣고 보고 고르고 배치하고 판정**하는 일이고, 소리 자체는 다른 엔진이 만든다.

- **사운드 디렉터**: 영상을 보고(1 FPS, 초 단위 타임스탬프) 큐 리스트·SFX 후보 선택·음악 드롭 위치·믹스 판정을 **JSON**으로 낸다. 타이밍(ms)·레벨(LUFS·dBTP)의 원본은 코드 + earshot이고, 불일치하면 숫자가 이기고 사람이 본다. 루프 상한 3회. 생성: SFX는 ElevenLabs SFX API 또는 CC0 뱅크, 음악은 라이선스 트랙·Lyria 3.5(YuE2는 CC BY-NC라 상업물 불가), 믹스·마스터는 결정론적(ffmpeg, −14 LUFS/−1 dBTP, `real-sound` 체인).
- **브리프 컨시어지**: 기획서 PDF·무드보드·레퍼런스 영상을 읽어 촬영 지시서 초안을 채운다(지금 `brief-concierge.tsx`는 `setTimeout` 목업). evidence 인용은 문자열 검증, 발송 전 사람 1회.
- **결과물 QA**: 마크·피부·손·팔레트 이탈은 "fail = 플래그, pass = 보증 아님". 정확한 값(ΔE·마크 ECC·글자 판독)은 코드가, 레퍼런스 대비 차이·개수·비율은 VLM이(`scenario-skills-borrow.md` R1~R12).
- **대안·비용**: 같은 입력 모달리티의 Gemini 3.8 Flash가 1/2.7 가격(무료 티어 있으나 학습에 쓰임 → 브랜드 자료 금지). Argon은 **무료 티어 없음**, 11월 $2/$10 → **12월 1일부터 $4/$20 per 1M**. 15초 1편 조립 루프 ≈ $0.22(11월)→$0.43, 월 500편 $108~414. Vertex는 서울 리전 미지원(글로벌·US·EU·싱가포르), Developer API는 한국 가용. 유료 티어는 학습 미사용·DPA.
- **Gemini Omni 1.1 Flash**(소리 포함 영상 생성, ≈$0.10/s)는 3~10초·오디오 레퍼런스 불가라 티저 시안용.
- **테스트 계획(대표 결정 필요)**: 선불 충전 최소 $5, 권장 $10(12월 인상 전). 케이스 5개 — 큐 추출·후보 선택·결함 탐지·환각 프로브·룰 준수. 기존 `lib/images/gemini.ts` 클라이언트(`GEMINI_API_KEY`, Vercel에 있음, 잔액 0)를 그대로 쓴다. 충전은 메모리 규칙상 대표만 한다.

## 8. 엔진·비용 효율화 (D8)

조사(`sota-models-pricing.md`, 2026-11-03 공식 요금표):
- 이미지 품질 1군 Seedream 5.0 Pro($0.045/$0.09)·Nano Banana Pro($0.134), 비용 1군 Nano Banana 2.1($0.0336)·FLUX 3 Klein. GPT Image 2.5는 이미지당 가격이 계산기 전용(미확인).
- 영상 Seedance 2.5 480p/720p/1080p $0.103/$0.231/$0.569 per s(2.0 대비 약 50% 상승), Veo 3.1 720p·1080p $0.40/s(Fast $0.10), Omni ≈$0.10/s, Sora API 종료(2026-09-24).
- **한국 사용 불가**: Hunyuan 계열(이미지 3.0·비디오 1.5·Foley) 라이선스가 한국 제외. **상업 불가**: MMAudio·ThinkSound(V2A)·YuE2. 상업 가능 오픈: Qwen-Image/Edit(Apache-2.0), SeedVR2(Apache-2.0), ACE-Step 1.5(MIT), Wan 2.2, FLUX.2 klein-4B, LTX-2.5(연매출 $10M 미만).
- 로컬 GPU(RTX PRO 6000 96GB, gpu-arbiter)로 할 것: **업스케일(SeedVR2, 운영 중)·부분 수정(Qwen-Image-Edit)·BGM(ACE-Step 1.5)·LUT(ffmpeg)**. 전기 기준 건당 수 원. 워커 틀은 기존 Ollama pull 워커(claim/heartbeat/complete) 복제 + `render_jobs.provider='workstation'`(0061 방식), GPU 꺼짐 시 폴백·하루 상한은 대표 결정.
- 파이프라인 변경(`repo-engines-pipeline.md`): 슬롯을 `person|product|scene|look|mask`로 넓혀 **얼굴 없는 생성**을 열고(person 슬롯이 있을 때만 동의·검수 경로), 레시피 단계에 `finish`(`upscale·grade·audio_mix·inpaint·reframe`) 추가, `claimRenderJobs`에 제공사 동시 작업 상한(10).
- 라우팅 표를 데이터(모델 id·단가·확인일·퇴역일·라이선스 플래그)로 두고 가격 규칙이 읽게 한다.

## 9. 노하우 이관 (D6)

`knowhow-corpus.md`에 61개 항목이 표로 있다(이름·보장·지금 형태·제품 형태·입출력·의존·난이도·우선순위). 요약:
- **P0** 프롬프트 컴파일러(모델별 문법 7종: NB Pro ALL-CAPS LOCK, Seedream 4부 산문, Soul·Seedance 2.5 계약) + 라우팅 표(마크 보존 NB Pro 8/8, 제품 사진다움 Seedream, 새 룩 Soul, 영상 Seedance 2.5, 교체 `video_edit`) + 레퍼런스 측정→촬영 지시서(`extract_image.py` 40여 지표, 의존 없음) + draft(480p)→approve→final 상태기계 + 절대 규칙 린트.
- **P1** 부분 수정 캔버스(180→1440px 확대, ECC 정렬, 하드니스 ≈50, 네모 밖 변경 0), `match`+`save-look`→`brand_looks`, 원본+제품 교체 워크플로.
- **P2** SeedVR2 워커·인스타 마스터(CRF 13, 그레인, 24fps CFR), 사운드 마감(브랜드 보유 음원·라이선스 트랙만, 바이럴 카탈로그는 내부 전용), 마스터 체인(`pedalboard` 라이선스 확인 뒤).
- **보류**: 음악 생성(YuE2 CC BY-NC → 상업 엔진 교체 또는 m-a-p 문의), 모션 그래픽(HyperFrames)은 1차 범위 밖, ArcFace 얼굴 게이트는 비상업이라 제품 기능 아님.
- 공개 금지 검사기: 엔진·도구명, 내부 실측 수치, 레퍼런스 원본, 히트곡명.

## 10. scenario-labs/skills에서 가져오는 것

코드가 아니라 네 가지 게이트(`scenario-skills-borrow.md`): **스펙 먼저**(brand-kit spec sheet = `identity.ts` 모양), **baseline+delta**(한 라운드에 변수 하나, 베이스라인에서 재생성, 라운드 상한 3), **레퍼런스 역할 1개/장 + 누수 점검**, **루브릭 먼저 + 판정 형식 고정**. 실측 교훈: 품질 점수는 결함을 평균하므로 컷 단위 판정, VLM은 hex를 틀리므로 값은 파일 파싱, 보드 마킹은 금지문이 아니라 정의문. 차용 제외: DCC·3D·게임, 매 세션 모델 재탐색, 모더레이션 공급자 교체 루프(IDENTITY §6-1과 충돌).

## 11. 저장소 가독화 (D7)

`repo-legibility.md`: 코드는 도메인별로 잘 쪼개져 있고 죽은 코드는 5파일뿐이다. 헷갈림의 원인은 이름 유산(playbook·prompts·cookies·twings)과 **표면→route group→lib→테이블 지도의 부재**. 이 PR에서 한 것: 루트 `ARCHITECTURE.md`(표면·호스트·lib 41개·테이블·요청 흐름 3개·어디를 고치면 되나·이름 유산), `lib/README.md`·`components/README.md`·`app/README.md`·`tests/README.md`, `docs/INDEX.md` 재편(현행/기록, 누락 문서 수록). 이름 변경·이동(`lib/cookies→credits`, `lib/twings→pricing`, `.gitignore` 정리, 참조 0 파일 삭제)은 worktree 59개가 정리된 뒤 **한 PR**로, 대표 결정.

## 12. 단계

| 슬라이스 | 내용 | 상태 |
| --- | --- | --- |
| S1 기능 정책·플랜 기록 | §4·§6.1, 0074/0150, 관리자 패널 2개, ARCHITECTURE·README | 이 PR |
| S2 고정 층 | §5 스키마(0075/0151)·`/brand/identity`·관리자 초안 | 다음 |
| S3 얼굴 없는 생성·지시서 | 슬롯 확장, 프롬프트 컴파일러, 측정→지시서, draft/approve/final | 다음 |
| S4 마감 워커 | workstation provider, SeedVR2·LUT·부분 수정 | §8 대표 결정 뒤 |
| S5 사운드 디렉터 | Argon 테스트 → 큐·판정 JSON → 결정론적 믹서 | 충전 결정 뒤 |
| S6 과금 | 세금계산서 후불 → 토스 빌링 | 약관 별지·계약 뒤 |
| 정리 | 프로토타입 레이어 4개 내리기, 하드코딩 문구 사전화, 이름 유산 | S2와 같이 또는 별도 |

## 13. 대표 결정 필요 (임의로 정하지 않음)

1. 세 금액이 **부가세 별도**인지 포함인지(포함이면 한도 약 10% 축소).
2. 플랜 이름(29·49·69 플랜은 가칭)과 월 생성 한도·좌석·PD 시간·이월·연간 할인(저장 공간 200/400/800 GB 외에는 §6.2 제안값).
3. 결제 경로 순서(세금계산서 먼저 vs 토스 빌링 계약 동시 신청), 약관 B2B 별지 문안(법무).
4. Argon 테스트 충전($5~10, 12월 인상 전)과 디렉터 기본 모델(Argon vs 3.8 Flash), SFX·음악 엔진 계약.
5. 브랜드 레시피에서 **얼굴 없는 생성**을 열 것인지; 동의 크리에이터 얼굴의 브랜드 쪽 계약 필드.
6. GPU 마감 워커 운영 범위(GPU 꺼짐 시 폴백·하루 상한·gpu-arbiter 우선순위).
7. 팔레트 ΔE 임계값·측정 영역, 검수 라운드 상한(제안 3).
8. 캠페인 페이지의 프로토타입 레이어를 지금 내릴지, 사이드바 "YAGI STUDIO" 표기를 유지할지.
9. 공개 가격·요금표 시점, 셀프서브 최소 플랜 허용 조건.
10. 이름 유산 정리(폴더명 변경) 시기와 레거시 playbook CMS·Stripe 잔재 제거 여부.
11. 음악 라이선스 해결 방식(상업 엔진 교체 vs m-a-p 문의 vs BGM 없는 마스터만).

## 14. 조사 파일

`research/brand-product-2026-11-03/`: `repo-brand-surface.md`(브랜드 표면·권한 훅), `repo-engines-pipeline.md`(엔진·큐·원가), `repo-billing-b2b.md`(결제·장부·약관), `knowhow-corpus.md`(노하우 61항목), `scenario-skills-borrow.md`(차용 패턴), `sota-platforms.md`(플랫폼 비교), `sota-models-pricing.md`(모델·단가·라이선스), `argon-sound-assembly.md`(Argon 설계·비용·테스트), `b2b-pricing-plans.md`(플랜 제안·마진), `repo-legibility.md`(가독화 감사·ARCHITECTURE 초안).

## 15. 런칭 첫 실행 · 미승인 업로드 게이트 · 운영 플래그

- **워크스페이스 첫 실행**: 워크스페이스 생성(`organization.create`) 후 `BRAND_STUDIO_V2=on`이면 `/brand/home`으로 이동한다. `/brand/home`에는 생성 후 30일 이내·미완료 워크스페이스에만 4단계 시작 가이드(`status = 'active'` 팀원 초대 · 로고/제품 사진 · 이용 상태 · 첫 이미지)가 표시되며, 닫기 상태는 조직별 쿠키(`yagi_brand_home_checklist_dismissed_<orgId>`)로 서버에서 읽어 플리커 없이 유지한다. 이용 상태 단계는 DB 상태(`team_notice_deliveries` 실제 이용/한도 요청 여부 — `plan_question` 문의는 제외 — 및 활성 플랜·한도)에 따라 **`"신청 전"` / `"신청 접수"` / `"이용 가능"`** 3단계로 진실하게 표시되며, 권한별(`/brand/billing` 링크는 `owner`/`admin`에게만 노출) 안내와 함께 `이용 신청` 버튼 클릭 시 `BillingRequestDialog`(`POST /api/brand-billing/request`)를 연다.
- **미승인 워크스페이스 업로드 게이트**: `UPLOAD_GATE_APPLIES_FROM`(`2026-11-24T00:00:00+09:00`) 이후 생성된 신규 자가 가입 조직 중 ① `capKrw > 0`, ② 이력이 존재하는 플랜(`brand_plan_assignments`/`brand_plan_events`), ③ 팀 제작/전달 레코드(`studio_managed`·스태프 생성 프로젝트/계약/스토리보드/룸 메시지/전달물/콘텐츠 버전), ④ 어드민 스토리지 오버라이드(`brand_storage_quotas.quota_bytes`) 중 **하나도 해당하지 않는 경우**에만 비관리자 멤버 업로드분과 대기 중인 룸 첨부 예약을 합산해 **500 MB · 50개**(`UNAPPROVED_UPLOAD_QUOTA_BYTES`, `UNAPPROVED_UPLOAD_MAX_FILES`)로 제한한다. 팀원(어드민) 업로드는 차단·합산에서 제외되며, 기존 로고 교체는 파일 수를 +1하지 않는다. 오류 문구는 하드코딩 대신 live 상수(`STUDIO_LIMITS`, `BRAND_ATTACHMENT_LIMITS`, `ROOM_LIMITS`, `STORYBOARD_LIMITS`)와 미승인 한도를 읽어 생성한다.
- **관련 플래그 및 기본값**:
  - `BRAND_WORKSPACE_PROTOTYPE_LAYER`: 기본 **off** (`'on'`일 때만 프로젝트 화면의 프로토타입 모듈과 `/s/` 공유 데모를 로드; **off**여도 실제 납품 영상 `activeContent.mediaUrl`과 DB 메시지/결정 기반 타임코드 핀을 `RealReviewPlayer`로 인라인 재생).
  - `BRAND_ORG_INVITE_EMAIL`: 기본 **off** (`'on'`일 때 `invitation.create`가 기존 트랜잭션 메일러로 타임아웃·예외 격리 발송, 링크 복사는 항상 유지).
  - `BRAND_STUDIO_EDITOR_V2_ORGS`: `all` 또는 `*` 지정 시 전체 브랜드 허용(기존 comma-separated UUID 목록과 함께 동작).
  - `agent_access` MCP 차단: `assertBrandFeature(..., 'agent_access')` 및 워크플로 허브(`agentAccessAllowed`)에서 MCP 토큰 발급·OAuth·인증·목록·폐기를 모두 차단.
