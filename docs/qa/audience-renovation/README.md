# 브랜드·크리에이터 Preview 검증

2026-10-07. 최종 런타임 소스: `da6c5ffc42996ef81a6eb717f9f9a52aa4ff2b1b`.

- [PR #41](https://github.com/Botanicbox0/yagi-prompts/pull/41)
- [브랜치 Preview](https://yagi-prompts-git-codex-audience-8eed70-yagi-workshops-projects.vercel.app)
- [해당 Vercel 배포](https://vercel.com/yagi-workshops-projects/yagi-prompts/AUNuRjjtohzPaAxmKVGzLvzkR14s)

root가 실제 Preview를 Chrome에서 열고 아래 여섯 화면을 캡처했다. 구현 담당은 저장된 이미지 모두를 별도로 열어 확인했다. 이미지 속 우측 검은 원형 버튼은 Vercel Preview 도구다. 브랜치 URL은 이후 배포에 따라 갱신되므로 이미지와 위 소스 해시를 함께 기준으로 삼는다.

| 화면 | 크기 | 캡처 |
| --- | --- | --- |
| 크리에이터 영어 PC | 1280×800 | [이미지](creator-final-en-desktop.jpg) |
| 크리에이터 영어 모바일 폭 | 320×760 | [이미지](creator-final-en-320.jpg) |
| 크리에이터 한국어 모바일 폭 | 390×844 | [이미지](creator-final-ko-390.jpg) |
| 브랜드 영어 PC | 1280×575 | [이미지](brand-final-preview-en-desktop.jpg) |
| 브랜드 영어 모바일 폭 | 320×760 | [이미지](brand-final-preview-en-320.jpg) |
| 브랜드 한국어 모바일 폭 | 390×844 | [이미지](brand-final-preview-ko-390.jpg) |

실제 공개 카탈로그 8개와 영상, 두 목적지의 내비게이션·CTA, 가로 넘침 없음, 크리에이터 영상의 16:9 프레임, 준비 중 안내를 확인했다. root의 320px 메뉴 키보드 확인은 Tab 순환과 Escape 후 메뉴 버튼 초점 복귀를 포함한다. 이는 데스크톱 브라우저의 모바일 폭 검증이며 모바일 실기기·인증 완료·실결제·생성·운영 Slack 수신을 증명하지 않는다.

## 자동 검증

아래는 같은 최종 소스에서 순서대로 수행한 실제 결과다. `--maxWorkers=4`는 브라우저와의 자원 경합을 줄이기 위한 병렬 수 제한이며 검사 파일을 제외하지 않는다.

```text
npx tsc --noEmit
exit 0

npx vitest run --maxWorkers=4
Test Files  190 passed (190)
Tests       2038 passed (2038)
Duration    835.18s
exit 0

npm run build:local
production build success / exit 0

npm run start:local
http://localhost:3000 / Ready in 545ms

npm run sweep:anon
SWEEP PASSED — 711/711 checks passed
exit 0
```

## 독립 검토

root가 실제 Claude CLI `claude-fable-5-1`로 코드 검토와 시각 검토를 수행했다. 코드 최종 검토는 935,703ms·24턴, 최종 여섯 이미지 검토는 272,025ms·9턴으로 성공 종료했다. 코드 판정은 필수 검증 통과를 전제로 Ship, 이미지 판정은 출시를 막을 시각·UX 결함 없음/Ship이다. 두 결과 JSON의 모델 사용 기록과 시각 검토 원문을 확인했다.

시각 검토는 이 여섯 정적 첫 화면과 이전 코드 검토 결과에 한정된다. 폴드 아래 전체 페이지·실기기·로그인·운영 상태를 모델이 확인한 것은 아니다. 브랜드 쇼릴의 작은 여백, CTA 용어 선호, 기존 CMS 제목 맞춤법은 선택 사항으로 남겼으며 영상 비율이나 동결 소스를 임의로 바꾸지 않았다.

Production 활성화와 사이트→Slack 실제 수신·중복 방지는 별도 운영 검사다. [문의 운영 기록](../../BRAND-INQUIRY-DELIVERY.md)에 준비 상태와 실제 검증 결과를 구분한다.
