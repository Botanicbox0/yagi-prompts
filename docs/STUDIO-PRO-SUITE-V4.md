# Studio Pro Suite v5 — 설계 및 확정 사양서 (Carbon × Fable 5.2 × 대표 최종 확정, 2026-11-13)

> 브랜치: `gemini/studio-pro-suite` (`D:\dev\.worktrees\twings\studio-pro-suite`)
> 디자인 정본: Studio UI v4 (`95% Monochrome #FFFFFF / #F4F4F5 / #09090B` + `5% Electric Ultramarine #0033FF` 단일 CTA, `Geist + Pretendard Variable + Geist Mono tabular-nums`, 보더리스 면 분리)

---

## 1. 대표 확정 정책 (2026-11-13)

1. **명칭 통일**:
   - 기존 `비디오 스튜디오` → **`영상 스튜디오`** (`/brand/studio/video`)
   - 영상 스튜디오 안의 작업 단위는 **`프로젝트`** (`새 프로젝트`, `내 프로젝트`, `완료 처리`)로 명명한다. (`brand_studio_video_projects` 테이블 — `야기 팀과` 의뢰 룸 `brand_projects`와 스키마·권한을 분리한다.)
2. **`@` 레퍼런스 인식 시각화**:
   - 프롬프트 입력창에서 `@image1`, `@video1`, `@audio1` 등 실제 첨부된 트레이 항목과 바인딩된 멘션은 **옅은 파란색 배경 알약(`color-mix(in srgb, var(--ys-cta-bg) 10%, transparent)`)**으로 즉시 하이라이트한다.
   - `<textarea>` 미러 레이어는 글꼴·크기·굵기·자간·패딩·스크롤을 100% 동일하게 유지(배경만 채색)하여 다중 줄 한글 IME 조합 중 커서 밀림이 절대 발생하지 않게 하고, 인식된 에셋의 상단 트레이 썸네일에도 같은 파란 링을 켜 양방향으로 확인시킨다. 매칭되지 않는 번호(`@image9` 등)는 앰버 점선 밑줄로 구분한다.
3. **수동 `자동 개선(✨)` 노출 제거 → 상시 백그라운드 멀티모달 디렉터 (`Video-Creator` 문법 직결)**:
   - 프롬프트 독(`Dock`)에서 고객이 직접 누르던 `자동 개선` 스위치와 `✨` 버튼을 제거한다.
   - 뒷단은 **`MediaAnalyzer`**(첨부 시점 선행 분석, 기본 `gemini-3.8-flash`, 향후 `Argon` 어댑터 결합 슬롯 분리)와 **`PromptCompiler`**(제출 시점 3갈래 분류: 정교한 프롬프트 Pass-through / 누락 슬롯 보강 / 짧은 한국어 브리프 전체 확장)로 구성한다.
   - `D:\dev\Video-Creator` (`seedance-film-director`)의 핵심 연출 원칙을 그대로 내장한다:
     - `Reference authority:` → `Visual style:`(`#Hex` 팔레트, 조명 방향, 렌즈/질감) → `0.0s–Xs` 초단위 타임라인 및 컷 경계(`hard cut`, `match cut`, `continuous`) 명시
     - 실사 인물 자연 피부(`glass-skin` 등 플라스틱 광택어 금지로 SeedVR2 우글거림 방지), 주변 조명·그림자 통합(얼굴 동동 뜸 방지), 정면 고정 탈피(대각·측면·OTS 교차 및 오프축 시선)
     - Seedance 생성 프롬프트 기본 **Strict No-BGM (현장 폴리·앰비언스만 생성)** — 음악은 시퀀스 레일 후반 작업에서 결합
   - **샷 시트 캐시 수명 (용량 무한 증가 방지)**:
     - 레퍼런스 영상 분석 결과(`brand_studio_assets.film_sheets`)는 무거운 이미지 파일 없이 경량 구조화 JSON만 저장하며, **마지막 사용일로부터 `14일` 슬라이딩 만료(`film_sheets_expires_at`)**를 둔다.
     - 해당 레퍼런스 영상을 쓰던 영상 스튜디오 `프로젝트`가 **`완료(completed)` / `보관(archived)` 또는 삭제**될 때(다른 활성 프로젝트가 참조하지 않으면) 즉시 `film_sheets` 캐시를 자동 비운다.
4. **`영상 스튜디오` 단일 스테이지 + 3단 탄성 시퀀스 레일(`72px / 200px / 55vh`) + 테이크 스택 + Premiere/DaVinci 반출**:
   - 진입 시 빈 프로젝트 난립과 모달 마찰을 막기 위해 즉시 작업 화면을 열고(우측 보관함에 이미지 스튜디오 **최근 생성물 · 조직 공유 폴더 · 멤버별 개인 좋아요 · 업로드** 기본 노출 + `Ctrl+V`), **첫 생성 제출 또는 첫 클립 추가 시 서버 `프로젝트`를 자동 생성(Lazy Create)**한다.
   - 탭 이동 없이 한 화면에서 하단 **시퀀스 레일**이 3단계 높이로 열린다:
     - `72px`: 스토리보드 순서 썸네일, 드래그 정렬, 같은 컷 재생성 시 옆으로 늘어나지 않고 겹쳐 쌓이는 **테이크 스택(`1/3`)**
     - `200px`: 빠른 앞뒤 트림 핸들, 컷 자동 인식 마커, BGM·자막 트랙
     - `55vh`: 정밀 멀티트랙 편집기 (이때 프롬프트 `Dock`은 1줄 알약 `+ 새 클립 만들기…`로 접힘)
   - 클립 또는 구간을 선택했을 때만 플로팅 액션 바(`[자르기 · 컷 자동 인식 · 레퍼런스 색보정 · @ 레퍼런스로 재투입 · 구간 맞춤 음악 생성 · SeedVR2 업스케일]`)가 나타나 CapCut식 복잡한 상주 패널을 없앤다.
   - **내보내기**: 웹 MP4 렌더링과 함께 Premiere Pro·DaVinci Resolve 양쪽이 기본 직독하는 **`FCP7 xmeml v4 (.xml)` + 원본 클립(`media/`) + 컬러 그레이딩 `.cube` 3D LUT + `.srt` 자막 `.zip` 패키지**를 제공하며, **타임라인에 올린 BGM은 기본 제외 없이 그대로 함께 내보낸다.**
5. **조직별 `워크플로우 · 지식` 허브 (`캐릭터 시트 메이커` 기본 탑재) + 멀티 클라이언트 `MCP 연결하기` (무제한 · 원클릭 온보딩)**:
   - 좌측 레일 `직접 만들기`: `이미지 스튜디오` · `영상 스튜디오` · `워크플로우` · `에셋`.
   - `워크플로우` 허브(`/brand/studio/workflows`): `우리 팀 워크플로우` | `기본 템플릿` | `팀 지식 · 가이드` 구성.
   - **기본 탑재 1번 템플릿 — `캐릭터 시트 메이커`**: 기준 캐릭터(`@image1` 또는 설명) → 16:9 와이드 정면·측면·후면 동시 턴어라운드 생성·슬라이스 → 표정 4종 및 착장 디테일 시트 생성 → `Gemini 3.8 Flash` 비전 일관성 대조(이탈 시 1회 자동 재시도) → 캐릭터 폴더 세트로 저장.
   - **"방금 한 작업을 워크플로우로 저장"** 및 **자연어 AI 워크플로우 빌더** 제공.
   - **멀티 클라이언트 MCP (`https://brand.twings.app/api/mcp`)**: 인위적 토큰 일일 크레딧 상한 없이 조직 크레딧 한도 내에서 자유롭게 동작하며, `MCP 연결하기` 모달에서 **`Claude` · `Claude Code` · `ChatGPT` · `Gemini` · `Cursor` · `Codex (CLI)` · `OpenClaw` · `Hermes`** 탭별 **1–2–3단계 원클릭 복사/연결 가이드**와 멤버별 토큰 발급·폐기 및 OAuth 2.1 연결을 모두 지원한다.

---

## 2. 철칙 및 불변 안전선

- **Higgsfield 절대 금지**: 어떠한 Higgsfield API/CLI/MCP/SDK 호출도 하지 않는다(크레딧 지출 `0`).
- **모픽 샌드박스 격리**: `d425c3b1-4066-4970-8a3b-93c52b3eef70`, `deb648e9-c2df-43d4-b2a7-7f9eff8180d9`, `Morphic`/`모픽` 조직 및 `generative_media` 차단 조직은 모든 신규 페이지·API·MCP·OAuth 경로에서 예외 없이 `404`를 반환한다.
- **고객 노출 문구 위생**: 내부 인프라·모델·서버명(`ComfyUI`, `YuE2`, `SheetSage`, `YAGI-SERVER`, `gpu-arbiter`, `Slack`, `Supabase`, `R2` 등) 노출 금지, 원화 금액 대신 크레딧(`tabular-nums`)만 표기.
- **클립보드 `Ctrl+C / Ctrl+V`**: `LayerEditor`, `RegionEditPanel`, `RegionForm`, `Viewer`, `StudioApp`, `Dock`, `VideoStudioWorkspace` 전 표면 동작 유지.
