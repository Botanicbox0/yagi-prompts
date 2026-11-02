# TWINGS 작업 공간

2026-09-22 정리. 현재 서비스는 `D:\dev\twings` 저장소에서 개발한다. `D:\dev\twiin`은 이전 제품·자료가 있는 별도 저장소이며 이번 정리에서 변경하지 않았다.

```text
D:\dev\
  twings\                         기본 저장소와 로컬 환경
  .worktrees\twings\
    identity-portrait\            진행 중인 얼굴 기준 사진 PR #8
    archive\
      brand-launch\               이전 브랜드 작업 보관
      host-routing\               이전 호스트 라우팅 작업 보관
      toss-checkout\              이전 결제 작업 보관
      workspace-deploy\           이전 도메인 작업 보관
```

`playbook-*` 폴더들은 서로 다른 서비스 복사본이 아니라 같은 Git 저장소의 브랜치별 worktree였다. 이번 정리에서는 파일·브랜치·미추적 작업 자료를 삭제하지 않고 위치와 역할을 구분했다. 원본 `.env.local`은 기본 저장소에 그대로 보존한다. worktree의 의존성 연결은 `D:\dev\twings\node_modules`를 가리킨다.

## 작업 시작

1. `AGENTS.md`를 읽고 `git status --short`, `git branch --show-current`, `git worktree list`를 확인한다.
2. 기존 작업이면 해당 worktree를 재사용한다. 새 worktree가 꼭 필요할 때만 `.worktrees\twings\<작업명>` 아래에 만든다.
3. 완료된 작업은 PR 병합과 미추적 자료를 확인한 뒤 보관하거나 제거한다. 파일이 남은 worktree를 강제로 삭제하지 않는다.
4. 기본 저장소의 브랜치가 항상 main인 것은 아니다. 이번 정리 브랜치는 `codex/workspace-cleanup`이며 main 직접 push는 하지 않는다.

## 규칙 파일

`AGENTS.md`가 단일 원본이다. 기존 `CLAUDE.md`는 AGENTS와 내용이 완전히 같아 고유하게 이관할 규칙이 없었다. 현재는 `@AGENTS.md` 한 줄만 둔다.

이 PC의 Claude Code 2.1.223은 AGENTS 직접 로딩 지원 이전 버전이다. 공식 문서는 2.1.277 이상에서 조건부 자동 로딩을 설명한다. 한 줄 import는 현재·새 버전 모두에서 중복 규칙 없이 동작하며, Windows에서 심볼릭 링크도 필요 없다. 향후 Claude 자동 로딩을 실제 확인한 뒤 호환 파일을 제거할 수 있다.

[Claude 공식 메모리 문서](https://code.claude.com/docs/en/memory#agents-md)

## 이름 변경 범위

폴더·README·운영 문서의 서비스 이름을 TWINGS로 맞췄다. 기존 `PLAYBOOK_*` 환경변수, npm 내부 패키지명, DB 테이블, GitHub `yagi-prompts`, Vercel 프로젝트명은 배포 호환성을 위해 유지한다. 이 이름들은 외부 연결과 마이그레이션에 영향을 주므로 폴더 정리와 함께 일괄 치환하지 않는다.

로컬 Claude Code Sonnet 4.6을 도구 없이 새 세션으로 호출해 자동 로딩을 검증했다. 응답에서 제품 TWINGS, 경로 `D:\dev\twings`, 단일 원본 AGENTS.md, main 직접 push 금지 규칙을 모두 정확히 확인했다.
