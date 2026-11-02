# YAGI-SERVER에서 TWINGS 개발 이어가기

2026-10-14. 서버 개발 경로는 `D:\dev\twings`, 저장소는 `Botanicbox0/yagi-prompts`다. `D:\dev\twiin`은 이전 제품이므로 덮어쓰지 않는다. 현재 PC의 경로는 `C:\dev\twings`다.

## 무엇을 옮기는가

| 구분 | 이어받는 방법 |
| --- | --- |
| 소스·미디어·운영 문서·에이전트 규칙 | GitHub의 검증된 main에서 clone/fetch. `AGENTS.md`와 `CLAUDE.md`도 포함한다. |
| 서비스 운영 | 기존 Vercel 프로젝트 `yagi-prompts`, Supabase `nhokkikjkzjalxqsbzuk`, 도메인을 계속 사용한다. 개발 PC 변경으로 다시 만들지 않는다. |
| 서버 개발 환경 | Node.js 22 이상, Git, `npm ci`. `node_modules`, `.next`는 복사하지 않는다. |
| 로컬 DB·스토리지 | `npm run db:local`로 fixture를 다시 만든다. 현재 `.storage`·`.pglite`의 별도 작업 자료는 먼저 목록을 확인하고 필요한 것만 비공개로 보관한다. 운영 DB와 혼동하지 않는다. |
| 환경변수·로그인 | 서버의 기존 환경을 먼저 확인한다. 필요한 값은 운영자가 제공사 설정에서 별도로 등록한다. 브라우저 쿠키·Claude/Codex 인증 파일을 일괄 복사하지 않는다. |
| 템플릿 원본 파일 | Git에 없는 원본은 기존 OneDrive `TWINGS/Assets/templates`와 로컬 자료를 대조한다. 서버에 이미 있는 파일을 덮어쓰지 않는다. |
| 토스 회신 추적 | 채팅/자동화가 실행되는 호스트와 Gmail·Slack 연결을 서버에서 확인한다. PC 종료만으로 추적이 계속된다고 가정하지 않는다. 아래 상태 파일은 비공개로 보존한다. |
| 정기결제 작업자 | `ops/creator-subscriptions-worker`는 준비된 Cloudflare Worker다. 코드 clone이 Worker 배포나 활성화를 뜻하지 않는다. 별도 운영 절차를 따른다. |

코드 리뷰·성능 검증은 **Opus 5.5**, 한국어 문구 검토는 **Opus 4.6**으로 한다. 모델은 호출마다 정확히 지정한다. 이 변경은 전역 Claude 설정이나 다른 프로젝트의 모델을 바꾸지 않는다.

## 서버 소스 확인

서버에 같은 폴더가 있으면 우선 `git status`, `git remote -v`, `git worktree list`를 확인한다. 변경·서버 전용 파일이 있으면 보관과 비교가 끝나기 전까지 checkout/pull로 덮어쓰지 않는다. `git reset --hard`, `git clean`, 폴더 미러 삭제를 이관 수단으로 쓰지 않는다.

아직 폴더가 없을 때만:

```powershell
git clone https://github.com/Botanicbox0/yagi-prompts.git D:\dev\twings
cd D:\dev\twings
git rev-parse HEAD
```

이미 깨끗한 main이면 `git fetch origin main` 후 `git merge --ff-only origin/main`으로 이어받는다. 검증한 배포 커밋과 HEAD를 비교하고, 새 개발은 `codex/<topic>` 브랜치에서 한다. main 직접 push 대신 PR을 거친다.

## 로컬과 서버의 파일 대조

각 PC의 저장소 루트에서:

```powershell
npm ci
npx tsx scripts/server-handoff-inventory.ts
```

`.agents/handoffs/server-inventory.json`에 Git 관리 파일의 경로·크기·SHA256, HEAD, 작업 트리 상태를 기록한다. 환경변수는 `.env.example`에 있는 이름의 설정 여부(boolean)만 기록한다. 비밀값·그 값의 해시·얼굴 사진·로컬 DB 내용은 넣지 않으며, Git 밖 자료는 폴더별 파일 수만 기록한다. 로컬과 서버의 `files` 항목을 경로별로 비교한다. 같은 HEAD여도 미커밋 파일이 다르면 해시 차이가 나온다. 관리 파일이 삭제돼 있으면 inventory는 실패하므로, 삭제 의도를 확인하고 먼저 커밋하거나 보존한 원본으로 복원한다.

대조 전에 서버 파일을 바꿔야 한다면 대상 경로를 먼저 확인하고, 바뀔 기존 파일만 timestamp 백업 후 SHA256을 검증한다. 서버 전용 자료는 별도로 유지한다. 이 inventory는 읽기 전용이며 파일 전송·설치·DB 적용을 수행하지 않는다.

## 개발 검증

서버의 기존 `.env.local`은 덮어쓰지 않는다. 오프라인 개발용 파일이 없다면 `.env.example`에서 시작한다. 클라우드 설정을 사용할 때에도 아래 로컬 검증은 local 모드를 강제한다.

```powershell
npm run db:local
npx tsc --noEmit
npx vitest run
npm run build:local
npm run start:local
# 별도 PowerShell에서
npm run sweep:anon
```

`SWEEP PASSED`와 실제 localhost 화면을 확인한다. 서버에서 이미 쓰는 포트·다른 서비스·모델 작업은 중단하지 않는다. 포트를 바꿔 검증하려면 빌드 URL과 시작·스윕 URL도 맞춰야 한다.

## 운영 상태를 그대로 이어받기

- 구독: `docs/qa/creator-subscription/README.md`. 소스 구현과 운영 SQL·빌링 키·계약·검증 증빙·Worker·판매 개방은 별도다. 약관 버전/해시가 바뀌면 과거 승인으로 신청을 열 수 없다.
- 캠페인 직접 제작: `docs/qa/campaign-self-service.md`. `0045_core_campaign_production.sql`, `0130_glue_campaign_production.sql`은 대표/Director의 운영 적용 대상이다. 이번 이관 준비로 SQL이나 공개 플래그가 적용되지는 않는다.
- 미디어: 현재 local/Supabase 드라이버다. Cloudflare Worker 준비가 R2 스토리지 이전을 뜻하지 않는다.
- 빌링 암호화 키: 이미 운영하는 `TOSS_BILLING_ENCRYPTION_KEY`를 새로 만들거나 교체하지 않는다. 기존 카드 키 복구에 필요한 값은 운영자 보관 경로에서 유지한다.
- 토스 추적: Codex의 `slack` heartbeat 자동화다. 실행 호스트·일정·Gmail과 Slack 연결을 서버에서 확인하고, 이전 호스트에서 중복 실행되지 않도록 한다. 상태 파일은 기존 호스트의 `<CODEX_HOME>/visualizations/2026/10/06/01a11327-a37d-7351-a7f6-60880eb7b5fb/toss-reply-tracker-state.json`이다. 처리한 메일/Slack 식별자와 시각을 유지해야 중복 알림을 막을 수 있다. 값은 저장소에 커밋하지 않는다. 서버 경로를 정하면 자동화의 경로도 그에 맞춰야 한다.

## 기존 PC를 더 사용하지 않기 전

1. 모든 필요한 소스가 GitHub에 있고, 서버 HEAD·관리 파일 해시가 일치하는지 확인한다.
2. Git에 없는 원본·로컬 자료·작업별 검증 기록의 보관 위치를 확인한다.
3. 서버의 개발 실행, 관리자 로그인, 필요한 연결과 토스 추적의 실제 실행을 확인한다.
4. 운영 서비스의 기존 키·DB·스토리지·Worker가 유지되는지 확인한다.

확인 전에는 기존 PC의 작업 파일이나 인증을 삭제하지 않는다. 준비 문서·로컬 inventory·서버 수신·해시 검증·개발 기동·운영 연결은 각각 다른 완료 단계다.
