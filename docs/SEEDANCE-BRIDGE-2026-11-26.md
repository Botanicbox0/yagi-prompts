# Seedance 2.5 브리지 기록 — 슬라이스 SB-1 (2026-11-26)

> 정본 기준: `D:\dev\Video-Creator\docs\TWINGS-SOTA-BRIDGE.md` §2-2, `D:\dev\Video-Creator\.agents\skills\seedance-film-director\SKILL.md`, `D:\dev\Video-Creator\AGENTS.md`.

## 1. 정본의 4대 규칙

1. **Seedance 2.5 영상 피부·노출 공식 분리 (`10/30 Underexposed 35mm Optical Law`)**: 정지 이미지 국소 편집(`nano-banana-2.1` 등)은 노화 방지를 위해 모공 강조를 계속 배제하고, Seedance 2.5 영상은 하이라이트 클리핑(`p99 > 230`)과 시간축 평활화를 막기 위해 프롬프트당 1회 `looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under; skin stays natural and warm, unretouched matte-satin with visible micro-pores and fine stray flyaway hairs, never over-lit or glossy, with no blush` 공식을 사용한다. 물광 토큰(`porcelain`, `glass-skin`, `dewy`, `flawless`, `poreless`)은 계속 차단하며 프롬프트 본문·제외 목록 어디에도 적지 않는다.
2. **타이트 얼굴 크롭 폐기 → 3:4 거리감 바스트업 마스터**: 얼굴이 프레임 높이의 `60–85%`를 채우는 헤드샷 크롭을 금지한다(대두 왜곡 유발). 인물 레퍼런스는 머리 높이 프레임의 `32–42%`, 정수리 위 헤드룸 `12–16%`, 좌우 여백·목·쇄골·어깨·상반신이 함께 담긴 3:4 거리감 구도를 유지한다. 넓은 소매·상의 부피 차단은 크롭 대신 `Reference authority`에 `"ignore any wide casual top/sleeve volume from @Image 1"` 한 줄로 처리한다.
3. **3-Tier 레퍼런스 슬롯 라우팅**:
   - **Mode A (기본값):** `@Image 1` 3:4 거리감 얼굴 마스터 단독 + 의상은 텍스트 서술.
   - **Mode B:** `@Image 1` 얼굴 마스터 + `@Image 2` 얼굴 없는 분리 의상(목 아래 크롭 또는 고스트 마네킹).
   - **Mode C (조건부 전용):** 3패널 턴어라운드 시트는 다각도 서사극·가상 캐릭터에만 제한 적용(기본값 금지).
4. **샷별 방어 보일러플레이트 반복 금지 & 장르 적응형 카메라**: 체형·소매·부정어 방어 문구는 `Reference authority`와 `Exclusions`에 한 번만 선언해 매 타임라인 샷 반복을 막는다. 카메라는 장르에 맞게 분기하고(액션·MV·판타지·추격전은 동적 카메라 워크, 패션 에디토리얼·룩북은 컷 리듬 + 홀드 포즈 미세 동작), 클립당 프롬프트 길이는 `15,000자` 이하를 유지한다.

## 2. SB-1에서 바뀐 것 (엔진 전송 프롬프트 변경 0건)

- **미실행 규칙 데이터 정리**:
  - `lib/template-director/morphic-production-playbook.ts`: 헤더의 개인 실명·핸들·고객사 표기를 제거하고 중립 문구로 정리했으며, `MORPHIC_APPROVED_VIDEO_LAWS`의 `headneck_crop_against_wide_sleeves`를 `distance_3x4_bustup_and_sleeve_authority`(3:4 거리감 32–42% / 헤드룸 12–16% / 60–85% 크롭 금지 / 소매 1줄)로 교체하고, Law 5와 `MORPHIC_MODIFICATION_PLAYBOOK` `silhouette_slim_arm_lock`에 정지 이미지·영상 분리 규칙 및 3:4 거리감 원칙을 반영했다(`enforcePersonalMorphicGuardrails` 런타임 동작은 변경 없음).
  - `lib/brands/production-pipeline/video-creator-techniques.ts` 및 상수 입력 호출부 3곳(`brand-brief-studio.tsx`, `campaign-wizard.tsx`, `review-stage.tsx`): `evaluateOpticalIdentityLockV2`의 지표를 머리 폭 `35–55%`(65% 초과 경고)에서 머리 높이 `32–42%`·헤드룸 `12–16%`(60–85% 타이트 크롭 금지)로 전환하고, `headneck_runway_override`를 `sleeve_volume_prompt_guard`로 교체했으며 내부 모델·단계 용어를 제거했다.
- **브리프 컴파일러 (`lib/brands/briefs/compiler.ts`)**:
  - `SKIN_MATTE_CONTRACT_A10`을 정지 이미지용으로 바이트 단위 그대로 보존하고, `serializeSeedance` 전용 `SKIN_VIDEO_CONTRACT_SEEDANCE`를 분리해 인물 영상 프롬프트당 1회 삽입했다.
  - 기존 금칙어 차단(`BANNED_AI_BUZZWORDS`, `BANNED_PINK_MAKEUP_TERMS`)은 변경 없이 그대로 유지하고, `serializeSeedance` 참조 바인딩에 Mode A/B/C 주석과 15,000자 이내 길이 회귀 테스트를 추가했다.
- **문서 기록**: `docs/design/IDENTITY.md` §6-4(영상 피부·노출 공식 + Higgsfield 금지 정정), `docs/PERSONAL-STUDIO.md` §4(2026-11-26 분리 노트), `docs/INDEX.md`, 본 문서.

## 3. 아직 바뀌지 않은 것 (후속 슬라이스 대상)

- **브랜드 스튜디오 디렉터** (`lib/brand-studio/director/**`) — 실제 크레딧 렌더 경로. 환경변수 스위치 뒤에 후속 반영 예정.
- **리비전 프로필** (`lib/brand-studio/enhancer/profiles/seedance.ts` 등 `enhancer/**`) — 스튜디오 영상 수정 경로. 후속 반영 예정.
- **개인 영상 컴파일러** (`lib/template-director/flash-director.ts`) 및 `enforcePersonalMorphicGuardrails` 출력 — 유료 개인 맞춤 주문 경로. 환경변수 스위치 및 여유 길이(headroom) 확인 후 후속 반영 예정.
- **템플릿 마스터 프롬프트·메이커 레시피** (DB 원문), **고객 노출 화면 문구**(`messages/*.ts`, `lib/brands/production/reference-studio.ts`, `lib/template-director/schema.ts`).
- **인물 레퍼런스 이미지의 실제 픽셀 크롭/패딩**: 조사(FACTS §C.4) 결과 현재 코드베이스 어디에서도 인물 레퍼런스를 3:4 거리감으로 실제 자르지 않는다. `lib/identity/selfie-images.ts`는 `fit: 'inside'` 축소만 수행하며 크롭·왜곡·확대를 하지 않고, `bustupCropBoxNormalized`는 실행 경로에서 호출되지 않는 데드 코드다. 실제 이미지 크롭·아웃페인팅 도입 여부는 대표 결정 대상이다.
