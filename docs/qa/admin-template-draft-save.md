### 원인
관리자 화면(`/admin/prompts/new`)에서 템플릿 등록 작업 시 제목, 프롬프트 본문, 모델/유즈케이스 선택, 메이킹 스토리 및 대용량 미디어 업로드를 수행하는 도중 화면이 꺼지거나 뒤로 가기, 새로고침 등 예기치 못한 이탈이 발생할 경우 작성 중이던 모든 내용과 업로드 영수증이 소실되는 문제가 있었습니다.

### 수정 내용
1. **임시저장 스토리지 유틸 (`lib/admin/prompt-draft.ts`)**:
   - 브라우저 `localStorage` 기반의 안전한 초안 저장/로드/삭제(`savePromptDraft`, `loadPromptDraft`, `clearPromptDraft`) 모듈 추가.
   - 제목, 한글 제목, 프롬프트, 모델, 유즈케이스, 출처 URL, 제작 과정 및 미디어 업로드 receipt 정보 포함.
2. **템플릿 등록 폼 자동 저장 및 복원 (`components/admin/prompt-create-feedback.tsx`)**:
   - 사용자가 폼을 입력할 때 디바운스(300ms)로 `localStorage`에 자동 저장.
   - 페이지 진입 시 저장된 초안이 있으면 폼 필드들을 자동으로 복원하고 복원 안내 배너 및 '임시저장 비우기' 옵션 제공.
   - 템플릿 등록 성공 시 임시저장 데이터를 자동으로 정리.
   - 내용 입력 중 의도치 않은 이탈을 방지하기 위해 `beforeunload` 경고 리스너 등록.
3. **미디어 업로드 영수증 유지 (`components/admin/media-drop.tsx`)**:
   - Direct upload 완료 시 업로드 영수증(receipt)과 파일 라벨을 초안에 보존하여, 재진입 시 대용량 영상을 다시 업로드하지 않고 등록을 마칠 수 있도록 복원 지원.
4. **이미지 세트 폼 이탈 방지 (`components/admin/image-set-form.tsx`)**:
   - 다중 프레임 업로드 작업 중 브라우저 닫기/이탈 시 `beforeunload` 보호 추가.
5. **다국어 사전 지원 (`messages/ko.ts`, `messages/en.ts`)**:
   - 임시저장 복원 안내, 비우기 버튼, 저장 시각 안내 문구 추가.

### 검증 결과
- `npx tsc --noEmit`: 오류 없음 (통과)
- `tests/admin/prompt-draft.test.ts`: 신규 단위 테스트 5개 통과
- `tests/admin/prompt-create-feedback.test.tsx`: 신규 렌더링 테스트 통과
- `tests/i18n/dictionary.test.ts`: 사전 키 무결성 13개 테스트 통과
- `npx vitest run --maxWorkers=4`: 395 파일 / 3,813 테스트 전체 통과 (100% 초록)
- `npm run build:local`: 프로덕션 클린 빌드 통과
- `npm run sweep:anon`: 익명 스윕 1,338/1,338 체크 전체 통과 (SWEEP PASSED)

### 위험도
- **낮음**: 결제/인증/권한/공개화면/DB마이그레이션과 무관하며, 관리자 템플릿 등록 편의 및 이탈 방지를 위한 브라우저 localStorage 기반 점진적 향상(Progressive Enhancement) 기능입니다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
