# 부분 수정 · 레이어 편집 통합 설계 (묶음 A) — 2026-11-11

> 원본 지시: `docs/HANDOFF-2026-11-11-GEMINI.md` §4-A, `docs/design/IDENTITY.md` §6-4-3.
> 기준 녹화: oplux 편집 흐름 2건(폴로 셔츠 로고 제거, 참조 인물로 얼굴 교체) 및 향수 병 부분 수정 경계 어긋남 사례.
> 운영 실측 원인(`f3138609-3bfb-4851-a335-14f21a4bd1e1`): ① `lib/brand-studio/lane-api.ts:91`에서 `region_edit`의 `request.regionCrop.aspect`(`"3:2"`)를 빠뜨리고 `p.aspect`(`null`)만 넘겨 계정 레인(`sunra_mcp`)이 기본 `1:1`(`2048×2048`)로 생성한 뒤 `3:2`(`478×319`) `roi`에 강제 압축하면서 향수 병 가로 폭이 +13.5%(`245px → 278px`) 늘어남, ② 프롬프트 보정기(`enhancer`)에 `cropKey`(1번 이미지)가 전달되지 않고 전체 장면 6단계 지시가 들어가 원통 곡면 재묘사를 유도함, ③ 레이어 마스크 마감 없이 상자 전체를 덮어씀.

## 1. 목표와 하지 않을 것

### 목표
1. **부분 수정과 디테일 편집(레이어 편집, 2026-11-25까지 "꾸미기")을 한 화면(`components/brand-studio/layers/*`)으로 통합한다.**
   - 스튜디오 생성 결과뿐 아니라 **업로드한 에셋(`LibraryRail` 업로드·폴더·좋아요 포함)**에서도 동일하게 열린다.
   - 상단 중앙 도구 막대(Dynamic Contextual Island): **이동(`move`) · 사각 선택(`marquee`) · 지우개(`eraser`) · 되살리기 붓(`restore`)**.
   - 고칠 부위를 **작게 사각 선택**하면 오른쪽 부분 수정 패널에 선택 조각이 **1번 이미지(입력 미리보기)**로 자동 배치되고, 추가한 참조 이미지가 **2번부터 정사각 썸네일**로 붙는다.
   - 생성 중에도 편집기·갤러리 화면을 막지 않는다(동시 다중 실행 가능). 완료되면 원본을 덮어쓰지 않고 **선택한 자리(`box`)에 놓인 새 이미지 레이어**로 들어온다.
   - **바탕(원본) 레이어 숨기기 토글(`baseHidden`)**을 지원해 체커보드 위에서 새 조각만 보며 **지우개(크기·경도 기본 30%)**와 **되살리기 붓**으로 가장자리를 비파괴 마스크(`maskDataUrl`)로 다듬고, **아래로 합치기** 또는 **새 에셋으로 저장**한다.
   - 빠른 단건 처리를 원할 때만 켜는 **"자동으로 바로 합치기"** 옵션을 함께 둔다.
2. **지시 도우미 엔진(`lib/brand-studio/enhancer/region-assistant.ts`)을 추가한다.**
   - 5가지 작업(**로고·글자 지우기 / 로고·글자 넣기 / 인물 바꾸기 / 디테일 보강 / 직접 쓰기**) 선택 시 검증된 번호 문장 틀(`"1번 이미지에서 …을 그대로 유지한 채 …만 …"`)을 채워 준다.
   - 인물 바꾸기·로고 넣기처럼 참조 이미지(2번)가 필요한 작업에서 참조가 빠졌으면 먼저 안내한다.
   - 상자 면적이 과도하게 크거나(>30%) 상자 경계가 강한 구조선(윤곽선)을 가로지르면 더 작게 고르도록 안내한다.
3. **프롬프트 보정기(`lib/brand-studio/enhancer/*`)의 대상 재묘사 버그를 고친다.**
   - `region_edit` 보정 시 **1번 조각 이미지(`crop`)를 보정 모델에 실제로 함께 전달**해 병·사물 형태를 추측("cylindrical curvature")하지 않게 한다.
   - `region_edit`에서는 전체 장면 생성용 6단계 묘사 지시를 끄고, **조각의 구도·크기·윤곽·픽셀 위치 고정 규칙**만 적용한다.
4. **서버 자동 보조(`lib/brand-studio/region-edit/align.ts`, `composite.ts`)를 넣는다.**
   - 상자 바깥 문맥 띠(`roi \ box`)를 기준으로 다단계 피라미드 배율(`sx, sy`)·이동(`dx, dy`) 정합을 수행해 3~8% 크기 변화와 수 픽셀 밀림을 맞춘다.
   - 실제로 달라진 영역 중심의 부드러운 차이 마스크(`diffMask`)를 초기 마스크로 생성하고, 구조선 경계에서 번짐을 넓힌다.
   - 정합 뒤 바깥 띠 잔차가 기준치를 넘으면 1회 자동 재시도하고, 그래도 어긋나면 합치지 않고 `region_misaligned`로 종결하며 크레딧을 차감하지 않는다(`usage_krw = 0`).
   - 자동 합성본의 **상자 밖 픽셀 변경 0개(`diffOutside === 0`)** 불변 조건을 유지한다.

### 하지 않을 것
- 서버에 Python/OpenCV나 대용량 `opencv-wasm` 의존성을 추가하지 않는다.
- 모픽 샌드박스 차단(`isSandboxedClientOrganization`), 개인 셀카 검수 레일, 결제·약관·가격 코드는 건드리지 않는다.

## 2. 검토한 대안과 버린 이유

| 결정 항목 | 채택한 안 | 버린 대안과 이유 |
| --- | --- | --- |
| 조각 정렬 구현 | **`sharp`(블러·리사이즈) + 순수 TS 다단계 피라미드 배율·이동·서브픽셀 정합** | `opencv-wasm`(번들 ~10MB·콜드스타트 악화), 로컬 GPU 워커 위임(워크스테이션 오프라인 시 단일 장애점) |
| 지우개·되살리기 붓 | **`ImageLayer` 비파괴 알파 마스크(`maskDataUrl`) + 오프스크린 Canvas 합성** | 원본 레이어 픽셀 직접 지우기(되살리기 붓 복원 불가, 실행 취소 시 전체 이미지 복제 메모리 증가) |
| 서버 결과 저장 형태 | **자동 합성본(`storage_key`, 갤러리 호환) + 정렬된 조각·초기 마스크(`patchKey`, `maskKey`) 동시 보관** | 조각만 저장(기존 갤러리 전/후 슬라이더·카드 미리보기 파괴) 또는 합성본만 저장(레이어 지우개 마무리 불가) |

## 3. 데이터 모델과 계약 변경

DB 스키마(마이그레이션) 추가 없이 기존 JSONB 작업 상태(`brand_studio_jobs.work`)와 클라이언트 레이어 문서(`LayerDoc`)를 하위 호환 확장한다.

- `JobWorkRegion` (`lib/brand-studio/types.ts`):
  - `patches?: Record<string, { patchKey: string; maskKey?: string; box: PixelRect }>` — 출력 슬롯별 정렬·톤 보정된 조각 PNG와 초기 소프트 마스크 PNG 키(영구 보관 대상이라 `dropWorkingFiles`에서 삭제하지 않고 출력 삭제 시 함께 정리).
  - `alignAttempts?: Record<string, number>` — 잔차 초과 시 자동 재시도 횟수(상한 1회).
- `StudioOutputView` (`lib/brand-studio/contracts.ts`):
  - `regionPatch?: { url: string; maskUrl: string | null; x: number; y: number; w: number; h: number } | null`
- `StudioErrorCode` (`lib/brand-studio/contracts.ts`):
  - `'region_misaligned'` 추가 (`"이 부분은 정확히 맞추지 못했어요. 고칠 부위만 조금 더 작게 골라 다시 시도해 주세요."`). DB `brand_studio_jobs_error` CHECK 제약을 건드리지 않도록 SQL `error_code`에는 `'failed'`를 저장하고 `work.region.misaligned = true`를 기록한 뒤 `repo.ts`(`jobView`)에서 `'region_misaligned'`로 투영한다.
- `LayerDoc` & `ImageLayer` (`components/brand-studio/layers/model.ts`):
  - `LayerDoc.baseHidden?: boolean` — 원본 바탕 숨기기(체커보드 위에서 조각 가장자리 확인용).
  - `ImageLayer.maskDataUrl?: string | null` — 레이어 로컬 해상도 기준 알파 마스크 PNG Data URL.
  - `mergeLayerDown(doc, id, renderedDataUrl)` — 선택한 레이어를 바로 아래 레이어(또는 바탕 위 새 병합 레이어)와 합치는 순수 함수.

## 4. 실패했을 때의 동작

- **정합 잔차 초과**: 바깥 문맥 띠의 평균 절대 오차(MAE)가 임계치를 넘으면 1회 재요청하고, 2차에서도 초과하면 `status = 'failed'`, `error_code = 'region_misaligned'`, `usage_krw = 0`(크레딧 미차감)으로 마감하고 사용자에게 더 작게 영역을 잡으라고 안내한다.
- **차이 마스크 추출 불가**: 변경 픽셀이 너무 적거나 상자 전체가 바뀌는 작업(예: 인물 교체)에서는 차이 마스크 대신 상자 테두리 소프트 번짐 마스크(`defaultFeather` 확장형)로 안전하게 내려간다.
- **참조 누락**: 지시 도우미에서 `인물 바꾸기` 선택 시 2번 참조 이미지가 없으면 전송 전 인라인 안내를 띄운다.

## 5. 측정할 숫자

1. 정합 테스트: 인위적으로 **3~8% 확대·축소** 및 **수 픽셀 평행 이동**시킨 편집 조각에서 정합 후 바깥 띠 MAE 감소율 및 중심 정렬 오차(≤ 1.5px).
2. 불변 조건: `tests/brand-studio/intel/region-composite.test.ts` 전체 케이스에서 `diffOutside === 0`.
3. 실증 사례 3종: (1) 작은 부위 로고 넣기·지우기(향수 병 포함), (2) 참조 인물 얼굴 교체, (3) 원거리 작은 얼굴 2K 디테일 보강.

## 6. 되돌리는 방법

- DB 마이그레이션이 없으므로 PR 되돌리기(`git revert`)만으로 즉시 이전 상태로 복구된다.
- 기존 `LayerDoc` 초안(`localStorage`)은 `baseHidden`·`maskDataUrl`이 선택 필드이므로 구버전·신버전 간 호환된다.
