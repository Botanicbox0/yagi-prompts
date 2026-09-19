# 브랜드·어드민 글꼴과 주소 운영

2026-09-20 대표 지시 반영. **글꼴 시안 수정 / 주소 선택 확정 / 운영 DNS 개방 전**.

## 글꼴

한글은 저장소의 **Pretendard Variable** WOFF2를 직접 불러온다. 영문·숫자는 로컬 **Helvetica Neue**를 우선한다. Helvetica Neue가 없는 기기에서는 Helvetica/Arial로 대체한다. 로컬 유료 글꼴 파일을 웹폰트로 복사·배포하지 않는다. 모든 기기에서 Helvetica Neue를 동일하게 제공하려면 별도 웹폰트 사용 권한과 배포 파일이 필요하다.

두 독립 시안의 공통 스타일은 `workspace-typography.css`다. 이전에는 Pretendard 이름만 선언하고 CSS/파일을 연결하지 않아 기본 글꼴로 표시됐다. 이제 기존 OFL 글꼴 자산을 재사용한다. 표 숫자는 같은 폭으로 정렬하고 제목의 굵기·자간도 공통으로 맞춘다. 실제 서비스 `/admin`의 글로벌 글꼴이나 마케팅 디자인 전체는 이번 시안 변경으로 바뀌지 않는다.

검증용 HTTP 서버:

```powershell
node scripts/preview-product-design.mjs admin # 127.0.0.1:4780
node scripts/preview-product-design.mjs brand # 127.0.0.1:4781
```

서버는 지정 HTML·공통 CSS·Pretendard CSS와 92개 subset만 제공한다. 저장소 루트·환경변수를 정적으로 공개하지 않는다. 파일을 직접 열 때보다 이 HTTP 경로를 검증 기준으로 사용한다.

## 주소와 배포 단위 — 확정

| 주소 | 담당 |
|---|---|
| `twings.app` | 일반 사용자·크리에이터, 템플릿·생성·캠페인 참여 |
| `brands.twings.app` | 브랜드 가입·의뢰·확인·승인·리포트 |
| `admin.twings.app` | 스튜디오 운영·제작·모집·정산 |

현재 단계에서는 **저장소 1개 + Next.js 앱 1개 + Vercel 프로젝트 1개 + Supabase 1개**를 유지하는 것이 운영상 가장 단순하다고 판단한다. 환경변수·마이그레이션·크론·도메인 서비스를 중복 관리하지 않으면서 호스트별 화면과 API를 분리할 수 있다. 독립 운영팀·배포 주기·서버 권한 경계가 필요해지면 그때 별도 프로젝트를 검토한다. [Vercel 다중 도메인](https://vercel.com/docs/domains/working-with-domains/add-a-domain)

주소만 연결하는 것으로 앱·권한이 분리되지는 않는다. 현재 middleware는 경로 중심이며 `/api`, `/auth`, 정적 파일·robots 등이 제외된다. 새 호스트 전체에 적용되는 접근 정책을 먼저 배포해야 한다. 브랜드를 관리자 역할로 만들지 않고, 모든 조직 데이터는 별도의 조직 멤버십으로 제한한다.

첫 관리자 버전은 기존 `/admin/*` 경로를 유지하고 `admin.twings.app/`만 `/admin`으로 보낸다. 링크·폼을 대규모로 바꾸지 않는다. 기존 twings.app의 관리자 경로는 새 호스트가 검증되기 전까지 호환성을 유지한다. POST를 다른 호스트로 자동 전달하지 않는다. 실제 브랜드 앱이 생기기 전에는 brands 호스트를 닫아 두며 HTML 시안을 운영 화면으로 배포하지 않는다.

## 인증과 운영 경계

- 동일 Supabase 계정을 사용하되 세션 쿠키는 각 호스트에 한정한다. `.twings.app` 전체 공유 쿠키로 간이 SSO를 만들지 않는다. 사용자는 필요한 공간에서 로그인하며 PKCE 시작·복귀도 같은 호스트에서 완료한다.
- 호스트 허용 경로와 서버 데이터 권한을 모두 검사한다. `/admin/do`와 관리자 API의 same-origin 검사를 느슨하게 바꾸지 않는다. 결제·렌더 callback·크론은 기존 소비자 origin에서 유지한다.
- 인증의 `next`는 URL 파서로 정규화한 뒤 동일 origin과 허용된 경로를 검사한다. `/\\external.example` 같은 백슬래시 입력이 외부 주소로 바뀌는 기존 검사 문제를 별도 구현 PR에서 회귀 테스트로 고친다.
- Supabase 운영 redirect 허용 목록에는 사용할 호스트의 정확한 callback 경로를 등록한다. 공개하지 않는 brands callback은 앞서 등록할 필요가 없다. 별도 광범위 CORS나 wildcard 로그인 복귀는 추가하지 않는다. [Supabase redirect 설정](https://supabase.com/docs/guides/auth/redirect-urls)
- brands/admin은 noindex·private/no-store를 적용하고 소비자 sitemap·공유 렌더·결제 API가 다른 호스트로 노출되지 않게 한다. 로그아웃도 해당 호스트의 로그인 진입으로 돌아간다.

## 활성화 순서와 중단 조건

1. 호스트 라우팅·인증 복귀 정규화 PR의 단위/통합 테스트와 AGENTS.md §3 전체 루프를 통과한다.
2. 대표/Director가 검증한 커밋을 병합·배포한다. AGENTS.md §3의 main 직접 push·Executor 병합 금지를 유지한다.
3. 실제 사용할 관리자 callback 허용 목록과 Google/Kakao 왕복을 검증한다. 브랜드는 조직·멤버십·의뢰 권한이 구현될 때까지 닫힌 상태다.
4. Vercel에 사용할 호스트를 추가하고 프로젝트가 제시하는 CNAME을 확보한다. twings.app의 **권한 DNS인 Cloudflare**에서 해당 레코드만 추가한다. 기존 apex·MX·TXT·NS는 유지하며 wildcard는 필요 없다. [Cloudflare DNS 관리](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
5. 인증서·DNS·로그인 성공/실패/취소·비관리자 거절·API 호스트 거절·소비자 결제 회귀를 실제 운영 주소에서 확인한다.
6. 장애 시 새 호스트를 닫고 기존 소비자 경로를 유지한다. 호스트 보호가 없는 이전 배포로 되돌린 채 새 DNS만 남기지 않는다.

검증되지 않은 로그인 설정이나 접근할 수 없는 DNS 계정은 다른 호스트·공유 쿠키·임시 리다이렉트로 우회하지 않는다. 필요한 계정 접근이나 승인된 배포가 준비되지 않으면 정확한 단계와 이유를 보고한다.

2026-09-20 로그인된 Cloudflare에서 twings.app 영역을 확인했다. 현재 apex와 www 두 CNAME이 DNS only로 Vercel에 연결되어 있고 brands/admin 레코드는 없다. 계정 접근은 확인되었으며 레코드 변경은 하지 않았다. 실제 추가 시에는 Vercel에서 각 호스트에 제시하는 값을 다시 확인한다.
