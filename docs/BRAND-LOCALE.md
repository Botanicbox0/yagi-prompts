# 브랜드 첫 방문 언어

2026-09-22. 브랜드 공간의 기본 언어를 접속 국가로 선택한다.

- 명시적인 `locale=ko/en` 및 기존 언어 쿠키가 우선한다.
- 선택이 없으면 Vercel `x-vercel-ip-country`의 `KR`은 한국어, 다른 국가 코드는 영어다.
- 국가가 없거나 알 수 없으면 브라우저 `Accept-Language`, 마지막으로 영어를 사용한다.
- 범위는 브랜드 경로와 해당 경로로 돌아가는 로그인 진입이다. 소비자 마케팅 경로의 기존 언어 규칙은 유지한다.
- 로그인 화면 KO/EN 링크는 안전하게 정규화한 `next`를 유지하고 언어 선택을 기억한다. 제공사 링크, 제목, HTML `lang`도 같은 언어를 쓴다.
- 공유용 주소는 `https://brand.twings.app` 또는 `/auth/choose?next=%2Fbrand`다. `locale=ko`가 붙은 링크는 한국어를 명시한 링크로 유지한다.
- GPS 권한 요청이나 별도 IP 조회 서비스, IP/국가 저장은 없다. 접속 국가 판단은 IP 기반이며 실제 방문자의 언어를 보장하지 않으므로 수동 전환을 제공한다.

공식 근거: https://vercel.com/docs/headers/request-headers#x-vercel-ip-country
DNS 확인 시 brand.twings.app은 Vercel CNAME으로 연결되어 있었다. DNS나 배포 설정은 변경하지 않았다.

검증: 신규 회귀 테스트의 실패를 확인한 뒤 구현. tsc, vitest 118 파일/1,378 테스트, build:local, start:local, sweep 607/607 통과. 프로덕션 로컬 서버에 국가 헤더를 주입한 7가지 요청의 HTML 언어/로그인 링크 검증 통과. 브라우저에서 KO→EN 전환과 HTML lang 일치 확인. 실제 해외 IP를 이용한 운영 지역별 확인 및 외부 OAuth 로그인은 수행하지 않았다.
