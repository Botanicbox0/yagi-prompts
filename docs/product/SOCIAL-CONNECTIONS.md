# SNS 연결과 캠페인 조건·성과 설계

2026-09-20 · 공식 문서·참고 화면 조사 / **연동 구현·앱 심사 승인 완료 아님**

## 1. 이번에 확정된 제품 방향

대표는 **일반 사용자 생성 앱부터 출시**하고, 같은 사용자가 조건을 충족하면 캠페인에도 참여하도록 정했다. Instagram·TikTok·X 계정 확인/연동, 캠페인별 팔로워 범위·핵심 지표 설정을 요청했다. 캠페인은 스튜디오가 운영하고 브랜드는 확인·승인하는 기존 방향을 유지한다.

설계안: 생성은 SNS 연결 없이 이용한다. 캠페인을 탐색할 때 공개 지원 조건을 보여주고 지원할 때 해당 SNS 연결을 요청한다. SNS 연결은 해당 계정의 접근 권한 확인이며 실명·얼굴 인증·팔로워 진위 보증이 아니다. 얼굴 검증은 기존 절차를 그대로 거친다. 크리에이터용 별도 가입이나 계정 전환을 요구하지 않는다.

현재 코드에는 SNS URL·팔로워 수 직접 입력, Instagram·TikTok·YouTube 플랫폼 선택, 게시 URL 플랫폼 확인, 단일 조회수·출처 저장이 있다. OAuth 연결, X, API 수집기, 팔로워 상하한, 조건 판정은 없다. 근거: `lib/campaigns/schemas.ts`, `service.ts`, `components/admin/campaign-fields.tsx`, `0013_core_campaigns.sql`. 기존 YouTube 지원은 이번 설계 때문에 삭제하지 않는다.

## 2. 참고 서비스에서 채택할 것

### Brandazine

사용자가 지정한 로그인 후 캠페인 참여자 화면을 읽기 전용으로 확인했다. 팔로워·유효 팔로워, 광고/일반 콘텐츠 조회·도달, 국가 비율 필터와 도달/콘텐츠 확보 목적을 구분하는 UI가 있다. 계정 정보·개인 행·캠페인 수치·화면 캡처는 이 문서나 공개 시안에 복제하지 않는다.

TWINGS에서는 많은 열을 기본 노출하는 대신 **지원 가능 여부 → 최근 콘텐츠 근거 → 캠페인 적합성 → 실제 수행 이력** 순서로 보여주는 것을 권장한다. 수집 출처와 계산식이 확인되지 않은 ‘유효’ 지표를 자체 공식 API 항목처럼 재현하지 않는다.

### Featuring

Featuring은 팔로워 성장, 참여 지표, 개별 광고와 계정 성과 비교, 협업 이력을 함께 보여준다. TWINGS도 계정 규모만으로 정렬하지 않고 콘텐츠 성과·포맷 적합성을 판단할 근거를 제공한다. [영향력 분석](https://featuring.co/product-analysis)

Featuring의 X 랭킹처럼 기간·갱신 시점·산식이 보이는 구조를 참고한다. 회사가 제공하는 자체 추정치와 공식 API 관측치를 구분한다. [X 랭킹](https://featuring.co/ranking-x)

‘가짜 팔로워 비율’, ‘예상 구매력’, ‘예상 매출’, 통합 영향력 점수를 첫 버전에서 사실처럼 표시하지 않는다. Featuring의 유효 팔로워·자체 엔진에 관한 내용도 업체의 제품 주장이지 Meta 등이 직접 제공하는 보증 필드가 아니다. [Featuring 게시 고객 사례](https://blog.featuring.co/case-study-solution-hyundaihomeshopping-2025)

## 3. 공식 API로 가능한 범위

개발자 앱과 사용자 동의가 필요한 **자기 계정 연결**을 기본으로 한다. 공개 계정 검색·일괄 수집·외부 분석 서비스는 별도 기능과 계약으로 취급한다.

| 플랫폼 | 1차 연결 후보 | 받을 수 있는 주요 자료 | 제한 |
|---|---|---|---|
| Instagram | Instagram API with Instagram Login | Professional 계정의 프로필·팔로워, 게시물과 권한별 인사이트 | Business/Creator 계정 필요. 일반 개인 계정에 같은 인사이트를 약속할 수 없음. 앱 권한 심사 필요 |
| TikTok | Login Kit + Display API | 동의한 계정의 팔로워·공개 영상, 조회·좋아요·댓글·공유 | Display에는 저장·시청 유지율·오디언스 인구통계 없음. scope 승인과 사용자 동의 필요 |
| X | OAuth 2.0 PKCE + X API | 계정 팔로워, 게시물의 공개 반응·노출, 일부 소유자 지표 | 종량제 예산 필요. 소유자 심화 지표의 권한·기간 제한. 일반 API에 팔로워 인구통계 없음 |

### Instagram / Meta

Instagram Login은 Professional 계정용이며 Facebook Page 연결 없이 시작할 수 있다. Facebook Login 경로는 연결된 Page를 사용하는 별도 경로다. 개인 Instagram 계정 전체에 제공되는 범용 인사이트 로그인이라고 표현하지 않는다. [Meta 공식 Instagram API 컬렉션](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

팔로워 범위 판정은 프로필의 총수 `followers_count`를 사용한다. Insights의 `follower_count`와 이름이 비슷하다고 동일 의미로 매핑하지 않는다. [IG User](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)

계정 인사이트는 `instagram_business_basic`·`instagram_business_manage_insights` 권한을 사용하는 Instagram Login 경로, 또는 `instagram_basic`·`instagram_manage_insights`·`pages_read_engagement`를 사용하는 Facebook Login 경로를 구분한다. 팔로워/참여 오디언스의 국가·도시·연령·성별은 집계 자료다. 팔로워 100 미만의 follower demographics 등은 제공되지 않으며, 인구통계에 알려진 이용자와 상위 결과만 포함될 수 있다. 누락은 0이 아니다. 지연이 있어 ‘실시간’으로 표시하지 않는다. [계정 Insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights)

게시물의 조회·도달·반응·저장·공유와 릴스 평균 시청시간·총 시청시간·skip rate 등은 미디어 형식·지원 버전·권한에 따라 다르다. 모든 콘텐츠에 같은 필드가 채워진다고 가정하지 않고 capability 표로 관리한다. 특히 과거 `impressions`/`plays`와 새 `views`를 이름만 바꿔 하나의 시계열로 합치지 않는다. Instagram Login Insights webhook을 전제로 하지 않고 수집 작업을 설계한다. [Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)

타 Professional 계정의 일부 공개 정보를 얻는 Business Discovery와 동의받은 본인 계정의 private insights는 별개다. 첫 버전은 사용자 연결 데이터에 집중한다. 타 계정의 저장·도달·오디언스까지 임의 조회할 수 있다고 약속하지 않는다. [Business Discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)

네이티브 앱에서는 공급사 지원 범위에 맞는 브라우저 OAuth → 서버 연결 완료 → 검증된 앱 링크 복귀를 설계한다. 운영자 테스트 계정 성공만으로 전체 사용자 권한이 열린 것으로 간주하지 않는다. 개발자 Dashboard의 실제 권한, App Review·Advanced Access·필요한 사업자 확인을 통과한 뒤 비역할 사용자로 검증한다. [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)

### TikTok

`user.info.basic`은 식별자, `user.info.profile`은 프로필, `user.info.stats`는 팔로워 등 통계, `video.list`는 공개 영상에 사용한다. 연결 후에도 사용자가 일부 권한만 허용할 수 있다. [사용자 정보](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info), [Scopes](https://developers.tiktok.com/docs/en/scopes-overview)

Display 영상 객체는 조회·좋아요·댓글·공유 수를 제공한다. 저장 수·완주율·인구통계를 이 연결의 결과로 약속하지 않는다. [Video Object](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-object)

Research API는 상업용 크리에이터·광고 서비스의 우회 경로로 쓰지 않는다. Business/Organic API와 TikTok One의 심화 기능은 별도 접근 자격·앱 권한 확인 후 다음 단계로 검토한다. Display 승인으로 자동 개방된다고 설계하지 않는다. [Research FAQ](https://developers.tiktok.com/docs/en/research-api-faq), [API for Business](https://ads.tiktok.com/resources/help/article/marketing-api?lang=en)

토큰 갱신·철회와 `authorization.removed` 이벤트를 연결 상태에 반영한다. 조회 세 endpoint의 공개 기본 rate limit은 각각 분당 600회 이동 구간이며 429 백오프가 필요하다. 이는 TWINGS의 실제 승인 한도를 보장하지 않는다. 공개 Display 문서에서 호출 단가를 확인하지 못했으므로 무료로 확정하지 않는다. [토큰 관리](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [Webhooks](https://developers.tiktok.com/docs/en/webhooks-events), [Rate limits](https://developers.tiktok.com/docs/en/tiktok-api-v2-rate-limit)

### X

`/2/users/me`로 연결 사용자의 고유 ID를 받고 사용자·게시물 조회를 연결한다. 읽기 목적 권한은 `tweet.read users.read`, 계속 동기화하려면 `offline.access`가 후보다. 팔로워 수만 필요하면 전체 팔로워 목록이나 DM·게시 권한을 요청하지 않는다. [OAuth PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [인증 매핑](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping)

공개 게시물 지표와 소유자 전용 지표를 구분한다. 소유자 전용 organic/promoted/non-public 지표는 user context가 필요하고 최근 30일 제한이 있다. X 게시물 노출과 영상 재생수는 서로 다른 항목이며 TikTok 영상 조회와 무조건 합산하지 않는다. [Metrics](https://docs.x.com/x-api/fundamentals/metrics)

2026-09-20 공개 가격: 게시물 읽기 $0.005/반환 리소스, 사용자 읽기 $0.010/반환 리소스. 계정 1명과 게시물 20건을 매일 새로 과금한다고 보수적으로 계산하면 `$0.01 + 20×$0.005 = $0.11/일`, 30일 `$3.30/계정`이다. 실제 청구·중복 처리·확장 조회는 Console에서 재확인한다. 앱 소유자용 할인은 일반 연결 사용자에게 적용된다고 가정하지 않는다. **구매/예산 승인은 하지 않았다.** [공식 가격](https://docs.x.com/x-api/getting-started/pricing)

삭제·수정·철회에 따른 저장 데이터 처리도 구현 범위다. X 또는 계정 소유자의 삭제 요청은 정책에 맞춰 신속히 반영한다. 개인정보처리방침·공급사 약관 반영은 별도 검토하며 현재 법무 본문을 자동 변경하지 않는다. [Developer Policy](https://docs.x.com/developer-terms/policy)

## 4. 수치를 쓰는 네 가지 목적

| 구분 | 예 | 효과 |
|---|---|---|
| 지원 조건 | 연결 계정, 플랫폼, 팔로워 최소·최대 | 충족해야 지원 가능. 데이터 부족은 ‘확인 필요’ |
| 선정 참고 | 최근 영상 중위 조회수, 포맷 적합성, 수행 이력 | 스튜디오 판단 근거. 충족했다고 자동 선정되지 않음 |
| 성과 목표 | 게시 완료 수, 플랫폼별 조회, 링크 클릭, 확인된 전환 | 캠페인 리포트의 목표 대비 진행 |
| 정산 조건 | 계약된 고정료·성과료·측정 기준일 | 약정 버전 기준 계산. 다른 점수나 목표 수정에 의해 자동 변경되지 않음 |

설정 주체는 스튜디오 어드민이다. 브랜드는 제시된 조건과 결과를 확인·승인한다. 이 요청만으로 브랜드의 캠페인 직접 개설·선정·지급 권한을 추가하지 않는다.

### 조건 편집기

기본: 허용 SNS, 연결 필수 여부, **해당 SNS의** 팔로워 최솟값/최댓값, 요구 콘텐츠 형식. 범위 양끝은 포함하며 최솟값≤최댓값, 음수·비정수·잘못된 기간을 거절한다. SNS 간 팔로워를 더해 자격을 만들지 않는다. 허용 SNS 중 하나로 지원하는 것을 기본 후보로 하고 여러 플랫폼을 모두 요구하는 캠페인은 명시적으로 구분한다.

고급: 지표 이름, 플랫폼·계정, 비교 연산, 기준값, 집계 기간, 최소 표본, 인정 출처, 최대 데이터 경과시간, 누락 시 처리. 공급사가 제공하지 않는 필드를 선택하면 수집 불가 이유를 보여주고 공식 API 필수 조건으로 게시하지 못하게 한다. ‘최근 조회수’처럼 정의 없는 조건을 저장하지 않는다.

조건 변경은 버전을 만든다. 지원 시의 규칙·계정·관측 수치·판정 근거를 저장하고 선정 직전 다시 확인한다. 모집 중 변경을 기존 지원자에게 소급 적용하거나 선정자를 자동 탈락시키지 않는다. 변경 영향과 이전 조건을 운영자에게 보여준다.

판정은 세 값이다:

- **충족**: 필수 자료가 있고 조건 범위 안이다.
- **미충족**: 필수 자료가 있으며 조건과 명확히 다르다.
- **확인 필요**: 연결 만료·권한 누락·수집 중·기한 경과·표본 부족·공급사 미제공. 숫자 0이나 미충족으로 치환하지 않는다.

사용자에게 이유와 다음 행동(연결·재연결·갱신·다른 캠페인 보기)을 표시한다. 운영자 예외 검토를 허용할지는 캠페인 정책으로 정하고, API 검증과 같은 배지를 붙이지 않는다.

### 지표 카탈로그 후보

| 지표 | 정의·표본 | 화면 표시 |
|---|---|---|
| 팔로워 | 특정 연결 계정의 관측값 | 플랫폼·확인 시각·출처 |
| 최근 영상 중위 조회수 | 같은 플랫폼·형식, 기간 내 조회값이 있는 콘텐츠 표본 | 표본 수·게시 경과일·관측 시각. 평균과 구분 |
| 조회 대비 공개 반응률 | 정의된 좋아요+댓글+공유 ÷ 같은 표본 조회수 | 분자 항목이 없거나 분모 0이면 산출 불가. 사람의 비율 아님 |
| 저장·공유 | 지원되는 공급사의 실제 값과 일관된 분모 | 저장/조회와 저장/도달은 다른 지표 이름 |
| 오디언스 분포 | 공급사 제공 집계의 모집단·기간·범주 | 누락/상위 결과 한계 표시. 국가 비중×연령 비중으로 가짜 교차 분포를 만들지 않음 |
| 광고 성과 비교 | 근거가 있는 광고/일반 콘텐츠를 같은 형식·기간으로 비교 | 양쪽 표본·광고 분류 근거. 불명확하면 미분류 |
| 수행 이력 | 확정된 의무 대비 기한 내 제출·수정 대응 | TWINGS 내부 기록, 신규 사용자는 ‘이력 없음’ |
| 목표 달성 | 동일 단위의 실제값 ÷ 캠페인 목표 | 단위·기간·출처, 미수집 값과 0 구분 |

조회·도달·노출·고유 이용자는 서로 다르다. 릴스 도달의 합계는 캠페인 전체의 중복 제거 도달이 아니다. 플랫폼이 제공하지 않는 교차 계정 중복 제거 수치를 만들어 표시하지 않는다. 누적 지표는 일별 스냅샷을 더하지 않고 지정 시점 값이나 유효한 증분으로 집계한다.

조회 기반 선정 참고는 같은 게시 경과일에 비교하는 방향을 권장한다. 초기 연결만으로 과거 게시 후 7일 값을 복구할 수 있다고 약속하지 않는다. 기록이 쌓이기 전에는 게시 경과일이 다른 현재값의 비교라는 한계를 표시한다. 표본 기준은 검증 후 확정하며 팔로워 하한·조회수 목표를 전 캠페인에 임의 지정하지 않는다.

클릭은 추적 가능한 TWINGS 링크, 전환·매출은 브랜드 동의와 집계 연동이 있어야 한다. SNS 조회수만으로 구매·ROAS를 계산하지 않는다. Meta Marketing/Conversions API도 해당 인스타그램 사용자의 유기적 콘텐츠 전환을 자동 증명하는 만능 데이터 원천으로 취급하지 않는다. [Meta 공식 Marketing API 컬렉션](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)

## 5. 사용자와 운영자 화면

사용자: **내 정보 → SNS 연결 → 권한 확인 → 연결됨/수집 중 → 내 계정 지표**. 캠페인 상세에는 공개 조건과 본인 상태를 나란히 보여준다. SNS 연결을 해제해도 생성 계정이나 구매 내역을 함께 삭제하지 않는다. 개인정보 삭제 범위는 별도 요청 흐름에서 처리한다.

운영자: 캠페인 **지원 조건·성과 목표**에서 조건을 편집하고 판정 예시를 확인한다. 지원자 목록의 기본 정보는 조건 상태·최근 콘텐츠 성과·표본·최근 갱신·담당자의 다음 행동이다. 상세에서 출처와 게시물 근거를 확인하고 선정한다. 숫자 하나로 자동 합격·탈락시키는 불투명한 통합 점수는 도입하지 않는다.

시안의 조건 편집·판정은 가상 입력으로만 동작한다. [어드민 시안](admin-prototype.html)은 실제 SNS 연결·조건 저장·캠페인 선정 화면이 아니다.

## 6. 구현 계약 제안

- 연결은 `(provider, provider account ID)`로 식별한다. 이름·핸들 변경에 흔들리지 않는다. 다른 TWINGS 계정에 중복 연결된 SNS의 재연결·이전은 별도 소유 확인을 거친다.
- OAuth state·PKCE(지원 경로)·만료·redirect allowlist·연결 사용자 바인딩을 검증한다. 임의 redirect/계정 ID를 신뢰하지 않는다. 토큰은 서버에서 암호화하고 브라우저·로그·리포트·감사 JSON에 출력하지 않는다.
- 연결 상태와 지표 상태를 분리한다: 연결됨/재연결 필요/해제됨; 수집 중/정상/일부 누락/미지원/오래됨/실패. OAuth 성공이 전체 권한·데이터 수집 성공을 의미하지 않는다.
- adapter는 계정 식별·프로필·게시물·지원 지표·토큰 갱신·철회 기능을 공급사별로 제공한다. capability에 없는 지표는 호출하지 않는다. API 버전과 의미가 바뀌면 정의 버전을 올린다.
- 스냅샷에는 대상 계정/게시물, 공급사 필드, 값 또는 누락 사유, 단위, 정의 버전, 기간·시간대, 관측 시각, 출처·표본·범위·수집 상태를 기록한다. 전체 응답이나 개인정보를 무제한 보존하지 않는다.
- 수집은 영속 작업 큐로 처리한다. 429/일시 장애 백오프·중복 방지·동시 실행 lease·토큰 갱신 경쟁 보호·실패 가시화가 필요하다. 첫 연결/지원/선정/리포트 시점 우선 갱신, 유휴 계정은 낮은 빈도를 기본안으로 한다.
- X 예산·공급사 rate limit을 서버에서 제한하고 새로고침 연타로 과금이 증가하지 않도록 재사용·dedupe·쿨다운을 둔다. 비용과 실제 승인 한도를 확인하기 전 주기 전체 수집을 열지 않는다.
- 제출물 author의 고유 ID를 연결 계정과 대조한다. URL host 검사는 계정 소유 확인을 대신하지 않는다. private/deleted 콘텐츠는 재확인·정정·삭제 규칙을 적용한다.
- 브랜드에는 배정 캠페인에 필요한 집계·게시물만 제공한다. 다른 브랜드·토큰·연결 계정 private 원문·개인별 팔로워 목록은 제공하지 않는다. 연결 해제/삭제/권한 회수 시 작업 중지·캐시 및 제공사 데이터 처리까지 연결한다.
- 법정 거래 보존과 SNS 데이터 보존은 구분해 설계하되, 외부 API 약관·삭제 요구를 무시하는 영구 스냅샷으로 만들지 않는다. 법무 본문과 동의 문안은 초안 검토 뒤 반영한다.

신규 테이블 후보는 SNS 연결·지표 스냅샷·수집 작업·규칙 버전·지원 판정·캠페인 목표다. 아직 마이그레이션 번호 예약이나 클라우드 적용은 하지 않는다. X를 추가할 때 기존 TypeScript enum·URL 판별·SQL 제약·KO/EN 사전·폼·테스트를 함께 바꾼다.

## 7. 검증과 출시 순서

1. 일반 사용자 앱: 생성·내 작품·저장·공유·계정·탈퇴와 앱 배포 채널 결제 계약부터 완성한다. 캠페인 API 심사가 일반 생성 출시의 불필요한 선행 조건이 되지 않게 한다.
2. 캠페인 규칙·지표 카탈로그: 순수 판정 서비스와 시연 데이터로 경계값·누락·기한 경과·조건 버전 회귀 테스트를 작성한다. 공급사 미구현 상태를 실제 연결처럼 보이지 않게 한다.
3. Instagram/TikTok부터 개발자 앱·테스트 사용자·최소 읽기 권한으로 연결 검증. 네이티브 복귀·취소·권한 일부 거부·철회·재연결을 확인한다. 공급사 심사 전 일반 사용자 공개는 하지 않는다.
4. X는 동등한 연결 흐름을 지원하되 사용량 상한·비용 승인 후 공개한다. Business API·외부 분석 제공사의 심화 지표는 별도 검증 후 확장한다.
5. 캠페인 종단 테스트: 연결→조건 판정→지원→선정→게시물 소유 확인→시점별 성과→검수·정산. 같은 사건의 중복 실행·교차 조직 접근·권한 회수 후 조회를 거절한다.

필수 회귀 사례: 팔로워 경계값/범위 오류; 타 플랫폼 합산 금지; 미지원·미수집·0 구분; 만료 자료; 표본 부족; OAuth state 재사용·다른 사용자 연결; 중복 계정; 토큰 갱신 경쟁; 429/중단 복구; 게시물 저자 불일치; 누적 조회 중복 합산; 규칙 수정 후 기존 지원 근거 보존; 목표 수정이 정산에 영향 없음; 삭제·철회 후 수집 중단.

## 8. 현재 검증 한계와 필요한 외부 준비

공식 문서와 참고 화면을 확인했으며, 실제 Instagram/TikTok/X 개발자 앱 설정·토큰 발급·테스트 계정 API 호출·심사·과금·네이티브 복귀를 수행하지 않았다. Meta 문서 경로별 권한 표나 지원 범위는 변경될 수 있으므로 실제 Dashboard와 승인된 API 버전으로 확인해야 한다. TikTok Business 심화 필드·가격·계정 자격은 구현 보장 범위에 포함하지 않는다.

다음 외부 준비: 소유 회사의 개발자 앱·도메인/redirect URI, 최소 권한과 심사 자료, 개인정보/연결 동의/삭제 경로, 테스트 계정, X 비용 한도. 비밀값을 채팅·문서로 전달받지 않는다. 키가 없거나 심사가 막힌 경우 스크래핑·타인 토큰·Research API로 우회하지 않는다. Meta 데이터 삭제·보호 조건도 이 준비에 포함한다. [Platform Terms](https://developers.facebook.com/terms/dfc_platform_terms/)
