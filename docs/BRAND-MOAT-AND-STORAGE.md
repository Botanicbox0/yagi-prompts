# 브랜드 문안과 미디어 저장소 설계안

2026-10-08 · 대표의 브랜드 광고/확장성 문안 및 Supabase 무료 유지 요청에 대한 설계안.
이 문서는 제안과 실측을 기록한다. 브랜드 문안은 후속 브랜드 페이지 PR에서 반영한다. 운영 환경변수, 저장소, 개인정보처리방침은 이 설계안으로 변경하지 않았다.

## 권장 문안

**크리에이터가 먼저 만들고 싶은 브랜드 광고.**

브랜드에 맞는 AI 영상을 만들고, 크리에이터가 자기 얼굴로 완성해 자신의 채널에 소개합니다. 영상 제작부터 크리에이터 모집, 게시와 성과 확인까지 TWINGS가 운영합니다.

확장성을 설명하는 아래 섹션의 제목:

**한 편의 기획이, 여러 크리에이터의 콘텐츠로.**

브랜드에 맞는 장면을 먼저 만듭니다. 같은 장면에 크리에이터마다 다른 얼굴과 이야기가 더해지고, 각자의 채널에서 새로운 콘텐츠가 됩니다.

영문 대응안:

**Brand campaigns creators want to make.**

We produce an AI film for your brand. Creators make it their own, with their own faces, and share it on their channels. TWINGS manages production, creator recruitment, publishing, and reporting.

**One creative idea. Multiple creator stories.**

We build the first scene for your brand. Each creator brings their own face and story to the format, then shares it with their audience.

목표는 헤드라인에서 참여 욕구와 광고 상품을 명확히 하고, 본문에서 제작·인물·유통의 연결을 설명하는 것이다. “가장 완성도 높은”, “무한 확장”, 자동 바이럴·전환 보장은 넣지 않는다. 참여자와 게시물 수가 늘어나도 제작 품질, 검수와 운영이 함께 필요하다. 확장성을 낮은 비용이나 무제한 처리량과 동일시하지 않는다.

## 현재 확인된 운영 상태

운영 프로젝트 `nhokkikjkzjalxqsbzuk`에 읽기 전용 집계 SQL을 실행했다. 개인 정보나 파일 내용은 가져오지 않았다.

| 항목 | 실측 |
| --- | ---: |
| Postgres `pg_database_size` | 18,533,523 bytes (약 18.5 MB) |
| `content` | 126개 / 291,170,946 bytes |
| `public-content` | 28개 / 126,787,279 bytes |
| `renders` | 3개 / 4,103,430 bytes |
| 객체 메타데이터 합계 | 157개 / 422,061,655 bytes (약 0.422 GB) |

객체 크기는 `storage.objects.metadata.size` 합계이며 실제 청구 계측과 완전히 같다는 의미는 아니다. DB 크기도 청구용 디스크 지표와 구분한다. 대시보드 로그인 세션이 없어 월간 egress·cached egress·CPU·MAU·조직 내 다른 프로젝트 사용량은 확인하지 못했다. 경고 원인이 egress라고 확정하지 않는다. R2로 이전해도 이미 사용한 월간 egress는 줄어들지 않는다.

현재 런타임은 `local | supabase`만 지원하며 R2는 구현되지 않았다.

- `lib/storage/index.ts`, `lib/storage/supabase-driver.ts`: CMS 게시·캠페인 첨부파일. 게시물은 콘텐츠 주소 키, 덮어쓰기 금지. 비공개 게시/첨부 URL은 기존 최대 60초 계약 유지.
- `lib/renders/store.ts`: 개인 입력 사진·생성 결과물. 별도 인터페이스와 URL 유효기간, 작업별 재시도 동작이 있다.
- `lib/content/asset-url.ts`, `lib/content/shape.ts`, `lib/runtime-mode.ts`: 공개 URL에 Supabase 경로를 가정하는 부분이 있다. 드라이버 하나를 추가하는 것만으로 이전이 끝나지 않는다.
- `public/reel/brands/`: 이번 브랜드 랜딩의 영상은 이미 Vercel 정적 파일이다. 이 파일을 R2로 옮기는 것만으로 현재 Supabase 사용량이 감소하지 않는다.
- 로컬 `.storage/`와 PGlite는 운영 저장소와 분리되어 있다.

## 권장 구성

| 역할 | 권장 서비스 | 접근 방식 |
| --- | --- | --- |
| 로그인, 회원·캠페인·문의·결제 기록 | Supabase Free | 현재 인증·권한/RLS 유지, 파일 bytes 대신 식별자 저장 |
| 승인된 공개 쇼릴·사례·썸네일·템플릿 예시 | R2 Standard + Cloudflare 캐시 | 전용 공개 버킷과 소유 커스텀 도메인, 버전/해시 키 |
| 개인 얼굴 사진·생성 결과물·비공개 캠페인 첨부 | 별도 비공개 R2 버킷 | TWINGS 서버에서 현재 사용자 권한 확인 → 짧은 S3 서명 URL |
| 웹사이트·문의·비즈니스 로직 | Vercel | 미디어 bytes를 프록시하지 않고 직접 업로드/다운로드 URL 발급 |

공개 도메인 후보는 `media.twings.app`이다. 아직 생성하거나 연결하지 않았다. 공개 CDN과 개인 파일은 버킷부터 분리하며, 얼굴 사진을 공개 도메인 아래에 두지 않는다. 모바일 앱도 같은 인증 API와 미디어 계약을 사용한다.

초기에는 Workers나 Stream을 추가하지 않는다. R2는 객체 저장소이며 자동 인코딩/적응형 스트리밍 서비스가 아니다. 현재 짧은 MP4는 포스터, fast-start, 적절한 해상도, Range 요청과 클릭 재생으로 제공한다. 긴 영상의 품질 전환이 실제 요구사항이 될 때 별도 검토한다.

## 단계별 이전

1. **사용량 원인 확인:** 조직 Usage에서 해당 프로젝트와 청구 기간을 선택해 Storage egress, cached egress, DB/pooler, CPU, MAU를 구분한다. 경고 항목과 기간을 기준으로 우선순위를 결정한다.
2. **공개 미디어부터:** `public-content`의 승인된 공개 파일을 R2로 복사한다. bytes·SHA-256·MIME·포스터·재생·Range·KO/EN URL을 확인한 항목만 공개 URL 해석기에 연결한다. 기존 URL은 유지하고, 롤백 가능한 버전의 매니페스트로 전환한다. 초기 복사 후 Supabase 원본을 삭제하지 않는다.
3. **두 저장 인터페이스 구현:** CMS용 `StorageDriver`와 개인 결과물용 `RenderStore`에 각각 R2 구현을 추가한다. `STORAGE_DRIVER=r2`만 넣었다가 개인 결과물이 로컬 디렉터리로 잘못 보내지지 않도록 선택기를 명시적으로 바꾸고 설정 누락은 실패로 처리한다.
4. **객체별 위치 추적:** 기존 논리 asset ID를 유지하고 비공개 매핑에 provider/bucket/key/bytes/hash/복사 검증 상태를 기록한다. 새 업로드는 R2, 기존 파일은 확인된 기존 위치에서 읽는다. 전체 저장소를 한 번에 전환하지 않는다. 401/403/5xx에서 다른 공급자로 무조건 우회하지 않는다.
5. **개인 파일 전환:** 현재 소유권·브랜드 멤버십·공유 만료 검사를 그대로 통과한 요청만 R2 URL을 받는다. 공급자 얼굴 검수와 자산 등록 절차는 그대로 둔다. 개인정보처리방침의 수탁자/이전 항목을 실제 계약·위치에 맞춰 대표 검토 후 반영해야 하며, 그 전에는 개인 데이터를 새 공급자로 복사하지 않는다.
6. **회수:** 복사 확인, 읽기 전환, 롤백 확인과 보존 의무를 검토한 뒤에만 참조가 없는 원본 정리를 별도로 진행한다. 게시 파일에 무조건 만료 규칙을 걸지 않는다. 공유 링크 3일 만료를 계정 결과물 3일 삭제로 해석하지 않는다.

읽기 우회는 검증된 레거시 객체에만 허용한다. 서버/API 키, 서명 URL과 얼굴 파일 경로는 로그·채팅·커밋에 남기지 않는다. 브라우저 PUT은 권한을 확인한 서버가 객체 하나에 발급하고, 업로드 완료 시 크기·MIME·소유권을 검증한다. 게시물의 덮어쓰기 금지와 개인 작업 재시도는 서로 다른 계약으로 유지한다.

## 공개 파일 R2 이전 1단계 런북 (2026-11-02 대표 승인)

범위는 `public-content`의 콘텐츠 주소 파일뿐이다. 비공개 파일과 얼굴 사진은 2단계이고, 개인정보처리방침의 위탁사 변경이 먼저다. Supabase 원본은 지우지 않는다. 삭제는 대표에게 따로 확인을 받는다.

코드에서 달라진 것:

- `publicContentUrl()`은 R2 복사가 확인된 키만 `PUBLIC_MEDIA_BASE_URL`로 보낸다(`lib/content/public-media-keys.ts`, 자동 복사를 켠 뒤에는 `public_media_copies`까지). 나머지 키와 변수가 없는 경우는 지금처럼 Supabase다. 이 변수가 없으면 배포해도 동작이 같다.
- URL을 저장하는 캐시(`prompt-catalog`, `landing-media`)의 키에 호스트와 파일 수를 넣었다. 전환과 되돌리기 모두 옛 주소를 들고 있지 않는다.
- `shape.ts`의 `defaultPublicUrl`은 테스트용 기본값이고, 운영 경로는 모두 `publicContentUrl`을 넘기므로 고치지 않았다.
- `<img>`·`<video>`만 쓰고 공개 파일을 스크립트로 읽지 않으므로 R2 CORS 설정은 필요 없다. CSP에도 이미지·미디어 허용 목록이 없다.

순서:

1. 대표: twings.app이 있는 Cloudflare 계정에서 R2를 켜고 버킷 `twings-media-apac`(Standard, Location = Asia-Pacific)을 만든다. 버킷 Settings → Custom Domains에 `media.twings.app`을 연결한다. r2.dev 공개 주소는 켜지 않는다.
2. 대표: 이 버킷만 Object Read & Write로 쓸 수 있는 R2 API 토큰을 만들어 `D:\dev\twings\.env.local`에 넣는다. 값은 채팅에 옮기지 않는다.

   ```
   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   R2_PUBLIC_BUCKET=twings-media-apac
   PUBLIC_MEDIA_BASE_URL=https://media.twings.app
   ```

3. 복사와 검증: `npm run r2:sync-public`. 파일마다 바이트, 형식, 캐시 헤더, 영상·음성의 구간 요청을 공개 주소로 다시 읽어 확인하고 통과한 키만 `public-media-keys.ts`에 쓴다. `temp-dm/`, `ig-masters-*/`는 복사하지 않고 `LEFT`로 보고한다.
4. 바뀐 `public-media-keys.ts`를 PR로 올린다. 병합만으로는 주소가 바뀌지 않는다.
5. 대표 승인 뒤 Vercel Production에 `PUBLIC_MEDIA_BASE_URL=https://media.twings.app`만 넣고 재배포한다.
6. 확인: 템플릿과 랜딩의 이미지·영상이 `media.twings.app`에서 재생되는지, 토스 심사 항목, `/auth/v1/health`, Supabase 로그의 공개 파일 요청 감소.

되돌리기: Vercel에서 `PUBLIC_MEDIA_BASE_URL`을 지우고 재배포한다. Supabase 원본이 남아 있을 때만 쓸 수 있다.

새로 게시한 파일은 아래 자동 복사를 켜기 전까지 Supabase에서 나간다.

## 새 공개 파일 자동 복사 (2026-11-02)

지금은 `public-media-keys.ts`에 적힌 96개만 R2에서 나간다. 이 목록을 바꾸려면 스크립트를 손으로 돌리고 PR을 병합해 배포해야 한다. 그 사이 새 파일은 Supabase 전송량을 쓴다.

### 고른 방식

| | 게시 직후 복사 + 매일 대조, 검증 키는 DB (채택) | 예약 작업 + 키 목록 PR |
| --- | --- | --- |
| 새 파일이 R2로 옮겨지는 시점 | 게시 응답 직후. 놓치면 다음 날 대조 | 예약 주기마다 |
| 주소가 바뀌는 시점 | 검증 직후, 배포 없이 | PR 병합과 배포 뒤 |
| 사람 손 | 없음 | 병합은 대표 또는 Director(AGENTS §3) |
| 실패 위험 | 복사 실패는 게시에 영향 없음, 다음에 재시도 | 빌드 실패 이력이 있는 프로덕션 빌드를 파일이 늘 때마다 거침 |
| 실행 장소 | Vercel | GitHub Actions(무료 한도로 멈춘 이력) 또는 상시 켜진 PC |
| 필요한 것 | Vercel에 R2 키 4개(대표 승인), 마이그레이션 | GitHub에 R2·Supabase 키, 자동 병합 정책 변경 |

Cloudflare Worker로 복사하는 안은 R2 키를 Vercel에 두지 않아도 되지만, Supabase 서비스 키를 Cloudflare로 옮기게 되고 위 "초기에는 Workers를 추가하지 않는다"를 뒤집으므로 고르지 않았다.

R2 키를 Vercel에 두는 위험은 키가 새면 공개 버킷의 파일을 덮어쓸 수 있다는 것이다. 토큰을 `twings-media-apac` 한 버킷의 Object Read & Write로 제한했으므로 다른 자원에는 닿지 않는다. 비공개 파일과 얼굴 사진은 이 버킷에 없다.

### 동작

1. 게시 경로는 모두 `StorageDriver.copy()`를 지난다. `public-content`의 콘텐츠 주소 키가 처음 보이면 `after()`로 복사 한 번을 예약한다. 게시 응답을 기다리게 하지 않고, 복사가 실패해도 게시는 그대로 성공한다.
2. 복사는 `public-content` 목록에서 아직 검증되지 않은 키만 고른다. 키마다 Supabase에서 읽어 이름과 해시를 맞추고 R2에 쓴 뒤, `media.twings.app`으로 다시 읽어 바이트, 형식, 캐시 헤더, 영상·음성의 구간 요청을 확인한다. 검증이 끝난 파일은 다시 읽지 않으므로 Supabase 전송량은 파일당 한 번이다.
3. 전부 통과한 키만 `public_media_copies.verified_at`이 채워진다. 그 전까지 `publicContentUrl()`은 Supabase 주소를 낸다. 실패한 키도 Supabase 주소 그대로라 화면은 깨지지 않는다.
4. 검증되면 캐시 문서와 정적 페이지를 바로 갱신해 새 주소로 바꾼다. 갱신을 놓쳐도 1시간 TTL 안에 바뀐다.
5. `/api/public-media/tick`이 매일 05:00(KST) 같은 복사를 돌려 놓친 파일을 잡는다.

안전 장치:

- 같은 파일을 두 실행이 동시에 읽지 않는다. 키를 잡을 때 15분 임대를 건다.
- 실패한 파일은 1시간, 2시간, 4시간 식으로 간격을 늘려 최대 3일마다 다시 시도한다. 이름과 바이트가 다른 파일은 고쳐질 수 없으므로 다시 읽지 않는다.
- 코드 목록은 그대로 둔다. DB를 읽지 못해도 96개는 R2에서 나가고, 나머지는 Supabase로 나간다.
- `next build` 중에는 DB를 읽지 않는다. 실패한 조회가 연결을 버리는 문제가 빌드 실패의 원인이었다(`lib/db/connect-shared.ts`).
- R2 키가 없으면 아무것도 읽거나 쓰지 않는다. 코드만 배포해도 지금과 같다.

### 켜는 순서

1. 대표 또는 Director: 마이그레이션 `0073_core_public_media_copies`, `0149_glue_public_media_copies`를 적용한다.
2. 대표: Vercel Production에만 `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`을 넣고 재배포한다. 값은 `D:\dev\twings\.env.local`과 같다. Preview에는 넣지 않는다.
3. 확인: 템플릿을 하나 게시하고 몇 분 뒤 `select key, attempts, last_failure, verified_at from public_media_copies order by created_at desc`로 검증을 본다. 그 템플릿 페이지의 영상 주소가 `media.twings.app`인지, 재생과 탐색이 되는지 확인한다.

`CRON_SECRET`은 이미 Production에 있다(`docs/BRAND-INQUIRY-DELIVERY.md`). 없으면 매일 대조만 503으로 멈추고 게시 직후 복사는 돈다.

되돌리기:

- 자동 복사만: Vercel에서 R2 키 4개를 지우고 재배포한다. 코드 목록의 키만 R2에서 나가고, `public_media_copies`에만 있던 키는 Supabase로 돌아간다.
- 파일 하나: `public_media_copies`에서 그 행을 지운다. 1시간 안에 Supabase 주소로 돌아가고, 다음 복사 때 다시 복사·검증해 통과하면 R2로 돌아온다.
- 전체: 위처럼 `PUBLIC_MEDIA_BASE_URL`을 지운다. 원본을 지운 뒤에는 쓸 수 없다(아래 "원본을 지우기 전에").

### 범위 밖

- Supabase 원본은 지우지 않는다. 그래서 Supabase 저장 용량 1 GB 한도는 이 작업으로 줄지 않는다. 삭제는 대표 확인을 받아 따로 한다.
- 비공개 파일과 얼굴 사진.
- `temp-dm/`, `ig-masters-*/`처럼 콘텐츠 주소가 아닌 파일.
- 렌더 결과물은 `public-content`에 없다. 공개 파일의 주소만 다룬다.

`npm run r2:sync-public`은 전체 재검증 도구로 남긴다. 버킷 전체를 Supabase에서 읽으므로 평소에는 돌리지 않는다.

### 원본을 지우기 전에 (대표가 대시보드에서 직접)

앱에는 삭제 코드가 없다. 지울 수 있는 파일과 조건은 아래와 같다.

- **`lib/content/public-media-keys.ts`에 있는 키의 원본만 지운다.** 이 목록은 DB나 환경과 무관하게 코드에 들어 있어서, 어떤 상황에서도 R2 주소로 나간다.
- **`public_media_copies`에만 있는 키의 원본은 지우지 않는다.** 그 표를 아직 읽지 않은 프로세스, 빌드 중에 만들어진 페이지, DB 장애 상황에서는 Supabase 주소로 나가고, 원본이 없으면 404가 된다. 지우려면 먼저 `npm run r2:sync-public`으로 목록에 넣고 PR을 병합·배포한다.
- `temp-dm/`, `ig-masters-*/`는 R2에 없다. 쓰는 곳을 따로 확인하기 전에는 지우지 않는다.

목록은 늘어나기만 한다. 원본을 지운 뒤 재검증을 돌려도 키는 빠지지 않고, 스크립트는 그런 키의 수를 `kept without a Supabase original`로 보고한다. 자동 복사도 검증된 행을 지우지 않는다. 다운로드(`/api/prompts/media/[ref]?download=1`)도 R2에 있는 키는 공개 주소에서 읽는다.

원본을 지운 뒤에는 되돌리는 방법이 달라진다. **`PUBLIC_MEDIA_BASE_URL`을 지우면 지운 키가 전부 404가 된다.** R2 키 4개를 지우는 것은 괜찮다. `public_media_copies`의 행을 지워 파일 하나를 Supabase로 돌리는 것도 원본이 있는 파일에만 쓴다. Preview와 로컬 cloud 모드에도 `PUBLIC_MEDIA_BASE_URL`이 있어야 한다.

## 무료 유지와 비용

2026-10-08 공식 문서 기준:

- Supabase Free: DB 500 MB, 파일 1 GB, uncached egress 5 GB 및 cached egress 5 GB(별도), MAU 50,000. 무료 자동 백업은 포함되지 않는다. 파일을 R2로 옮겨도 DB·CPU·Auth·Realtime 한도는 남는다.
- R2 Standard: 월 10 GB-month, Class A 100만 요청, Class B 1,000만 요청까지 무료. 초과 저장 $0.015/GB-month, A $4.50/100만, B $0.36/100만. R2 자체 인터넷 egress는 무료지만 저장/요청 및 다른 연결 서비스는 비용이 생길 수 있다.
- 환율 1,400원, 요청 무료 한도 이내, 해당 계정 무료 저장 여유가 모두 남아있다는 가정: 월평균 50 GB 저장은 (50-10)×$0.015×1,400 = 약 840원/월, 100 GB는 약 1,890원/월. 세금·추가 서비스·요청 초과 비용 제외. R2 무료 구간은 계정 내 다른 사용량도 함께 확인한다.

공개 파일은 Cloudflare 캐시로 반복 R2 읽기를 줄이고, 큰 미디어는 페이지 진입 시 전부 다운로드하지 않는다. 비공개 파일은 공개 캐시를 적용하지 않는다. 로그의 무제한 보존과 자산마다 DB 쓰기를 피하고, 필요한 필드/페이지네이션/이미 적용된 정적 캐시를 유지한다. DB 백업은 암호화하고 복구 시험까지 포함해야 한다.

제안 경보 기준은 Supabase 각 무료 한도 70%/90%, R2 저장 8 GB 및 무료 요청 70%/90%다. 이는 아직 설정된 알림이나 사용량 하드캡이 아니다. 비용 알림이 실제 지출을 자동 차단한다고 가정하지 않는다.

## 구현 완료 조건

- 권한·만료·재시도·게시 불변성 테스트 및 AGENTS 검증 루프 통과.
- 실제 R2 공개/비공개 객체에 업로드, 읽기, seek, 만료, 무권한 거절, 다운로드 확인.
- 익명 사례/템플릿 영상과 로그인 후 개인 결과물, 브랜드 첨부파일을 각각 확인.
- 객체별 복사 보고서와 롤백 경로, 개인정보 고지, 사용량 전후 비교.
- 운영 전환과 원본 정리는 코드/설계 준비와 별도 상태로 보고.

## 근거

- [Supabase 가격과 무료 한도](https://supabase.com/pricing)
- [Supabase egress 측정·최적화](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [R2 가격](https://developers.cloudflare.com/r2/pricing/)
- [R2 공개 버킷과 커스텀 도메인](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 서명 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): S3 도메인용이며 커스텀 도메인에서는 동작하지 않는다.
- [R2 수명 주기](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
