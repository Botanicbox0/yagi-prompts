# 다수 브랜드(Multi-Tenant) Cloudflare R2 최적 아키텍처 및 Supabase Storage 제로화 설계안

> 작성일: 2026-11-12 · 작성자: Director (Gemini Carbon)
> 목적: 다수 브랜드 조직(B2B) 유입 시 미디어 저장소의 격리·속도·비용을 최적화하고, Supabase Storage(Free 1 GB 한도)에 파일이 쌓여 서비스 인증·업로드가 멈추는 구조적 원인을 원천 제거한다.

---

## 1. 핵심 결론: "Supabase Storage 없이 R2만 써도 되는가?"

**기술적으로 100% 가능하며, R2 단일화가 정답이다.**

| 항목 | Supabase Storage (Free) | Cloudflare R2 (Standard) |
| --- | --- | --- |
| 기본 저장 무료 한도 | **1 GB** (초과 시 프로젝트 일시정지·402 위험) | **10 GB-월** (초과 시 **\$0.015/GB-월**, 약 21원/GB) |
| 파일 1개 최대 크기 | **50 MB** (200 MB 시안 영상 업로드 불가) | 단일 PUT **5 GB** · 멀티파트 **5 TB** |
| 외부 전송료 (Egress) | 5 GB 무료 후 초과 제한 / Pro \$0.09/GB | **\$0 (완전 무료)** |
| 비공개 권한 제어 | 서비스 롤 서명 URL | S3 Presigned `GET` / `PUT` URL (`≤60s` / `900s`) |

- **Supabase의 역할 고정**: Postgres DB(`27.6 MB / 500 MB`), 로그인 인증(Auth), RLS 권한 검증만 담당한다. 바이트(파일)는 R2가 전담한다.
- **2026-11-12 전량 R2 단일화 및 법무 개정 완료**:
  - 대표 승인에 따라 `lib/legal/documents.ts` 개인정보처리방침 §5(`LEGAL_EFFECTIVE = '2026-11-12'`)의 `Supabase Inc.` 행을 `데이터베이스·인증 | 회원 정보`로, `Cloudflare, Inc.` 행을 **`암호화 비공개 미디어 저장 및 공개 미디어 전송 | 얼굴 사진, 결과물, 접속 기록`**으로 개정했다.
  - 공개 미디어(`twings-media-apac`)뿐 아니라 브랜드 첨부·스테이징(`lib/storage/r2-private.ts`)과 개인 셀카·생성 결과물(`lib/renders/store.ts` `createR2RenderStore`)까지 전부 비공개 버킷 **`twings-private-apac`**으로 일원화해 Supabase Storage를 **완전 0 MB**로 회수했다.

---

## 2. 계정 내 Cloudflare 유료 현황 및 타 프로젝트 점검 결과 (2026-11-12 실측)

1. **결제 수단 연결 여부**: `twings-media-apac` 및 동일 계정의 R2 버킷이 정상 가동 중이므로 **Cloudflare 계정에 유료 결제 카드가 이미 등록·활성화되어 있음**이 확인되었다(Cloudflare 정책상 결제 수단 없이는 R2 활성화 자체가 불가).
2. **동일 Cloudflare 계정을 공유하는 타 프로젝트 사용량**:
   - **`twings` (`twings-media-apac`)**: 154개 객체 · **`815.6 MB`** (`777.8 MiB`) — R2 무료 10 GB의 8.2%.
   - **`yagi-workshop` (`studio.yagiworkshop.xyz`, 버킷 `yagi-commission-files`)**: 동일 계정(`sameAccountAsTwings: true`) 사용 중. 36개 객체 · **`55.9 MB`** (`53.3 MiB`).
   - **`yagi-workshop`의 Cloudflare Stream 주의**: Vercel `yagi-workshop` Production 환경변수에 **`CLOUDFLARE_STREAM_API_TOKEN`**이 설정되어 있다. R2와 달리 **Cloudflare Stream은 무료 구간이 없는 유료 부가서비스(저장 1,000분당 월 \$5 + 재생 1,000분당 \$1)**이므로, 과거 업로드해 둔 영상이 Stream에 남아 있다면 매월 고정 요금이 청구될 수 있다. 사용하지 않는 Stream 영상은 Cloudflare 대시보드(`Stream`)에서 정리하는 것을 권장한다.
   - **`AMERICANO` (2026-10-22 운영 종료)**: 아카이브 당시 보류된 빈 R2 버킷(`americano-prod-assets`) 삭제 가능.

---

## 3. 다수 브랜드 유입 대비 R2 최적 구성 (2-Bucket + Tenant Prefix + Lifecycle)

### 3.1 신뢰 경계(Trust Boundary)에 따른 2버킷 분리

공개 CDN 도메인(`media.twings.app`)이 붙은 버킷에는 고객사 미공개 시안·계약 문서·개인 셀카를 절대 두지 않는다(`r2.dev` 공개 주소는 두 버킷 모두 영구 비활성화).

| 버킷명 | 성격 | 도메인 / 접근 방식 | 저장 대상 및 키 규칙 |
| --- | --- | --- | --- |
| **`twings-media-apac`** (운영 중) | 공개 CDN | `https://media.twings.app`<br>`Cache-Control: public, max-age=31536000, immutable` | 승인된 공개 템플릿·쇼릴·포스터 (`{sha256}.{ext}`) |
| **`twings-private-apac`** (신규 권장) | **완전 비공개** | 커스텀 도메인 없음 · `r2.dev` OFF<br>서버 권한 검증 후 **S3 Presigned URL (`GET ≤60s`, `PUT 900s`)**만 발급 | • 브랜드 에셋·스튜디오: `orgs/{orgId}/studio/{yyyy-mm}/{uuid}.{ext}`<br>• 프로젝트 룸·시안·첨부: `orgs/{orgId}/rooms/{projectId}/{uuid}.{ext}`<br>• 브랜드 워크스페이스 첨부: `brands/{orgId}/{projectId}/{uuid}`<br>• 일시 업로드 스테이징: `staging/{surface}/{uuid}.{ext}`<br>• (약관 개정 후) 개인 셀카·렌더: `users/{userId}/renders/{jobId}.{ext}` |

### 3.2 왜 이 구조가 다수 브랜드(10개 → 1,000개 조직)에서 최적인가?

1. **버킷 수 제한 회피 + 완벽한 테넌트 격리**: 브랜드마다 버킷을 쪼개면 관리·토큰·CORS 설정이 폭발한다. 단일 비공개 버킷(`twings-private-apac`) 안에서 `orgs/{orgId}/...` 접두사로 격리하고, 서버(`lib/storage/r2-private.ts`)가 DB 멤버십(`organization_id`)을 검증한 뒤에만 해당 키 1개에 대한 60초짜리 S3 서명 URL을 발급한다.
2. **Vercel 서버리스 한도(4.5 MB 본문 / 1 GB RAM / 1 TB 대역폭) 완전 우회**:
   - 업로드: 브라우저 → R2 Presigned `PUT` 직접 전송 (200 MB+ 시안 영상도 서버 RAM 0 바이트 점유).
   - 다운로드/스트리밍: R2 Presigned `GET` `302` 리다이렉트 (신뢰할 수 없는 첨부 문서는 `response-content-disposition=attachment` 서명 강제로 XSS 원천 차단).
3. **자동 수명 주기(Lifecycle) 규칙으로 유령 비용 0원 유지** (`npm run r2:configure`):
   - `abort-incomplete-multipart-1d`: 중단된 대용량 멀티파트 업로드 조각 **1일 뒤 자동 폐기**.
   - `expire-staging-7d`: `staging/` 및 `content/prompt/` 임시 업로드 객체 **7일 뒤 자동 만료 삭제**.
4. **CORS 최소 권한 허용** (`npm run r2:configure`):
   - `AllowedOrigins`: `https://twings.app`, `https://brand.twings.app`, `https://admin.twings.app`, `https://*.vercel.app`
   - `AllowedMethods`: `GET`, `HEAD`, `PUT` (`DELETE`는 서버 전용 S3 API로만 수행)
   - `ExposeHeaders`: `ETag`, `Content-Length`, `Content-Range`, `Accept-Ranges` (웹 비디오 편집기·Canvas·구간 탐색 즉시 호환)

---

## 4. 코드 레벨 즉시 적용 사항 (본 PR 반영)

1. **스테이징 영구 누적 원천 차단 (`StorageDriver.releaseStaging`)**:
   - `lib/storage/public-media-direct.ts`: 공개 미디어가 R2(`media.twings.app`)에 복사·검증(`206`)되는 즉시 원본 스테이징 파일을 자동 해제한다.
   - `lib/brand-studio/assets.ts`, `lib/brand-rooms/deliveries.ts`, `lib/brand-rooms/messages.ts`, `lib/brand-rooms/storyboards.ts`: R2 스튜디오 저장소(`st/...`)로 이관이 끝나는 즉시 임시 스테이징 객체를 해제한다.
   - `app/api/admin/media/[ref]/route.ts`, `lib/admin/assets.ts`: 이미 게시되어 스테이징 사본이 정리된 템플릿도 관리자 미리보기·복제 시 `public-content`(R2)에서 끊김 없이 읽도록 폴백을 추가했다.
2. **비공개 R2 드라이버 (`lib/storage/r2-private.ts`) + 무중단 레거시 폴백**:
   - `R2_PRIVATE_BUCKET`(`twings-private-apac`) 환경변수가 설정되면 모든 신규 스테이징·브랜드 첨부 업로드·서명 URL이 자동으로 R2 비공개 버킷을 사용한다.
   - 이전 전 기존 Supabase `content`에 남아 있는 모픽(`deb648e9-...`, `d425c3b1-...`) 등의 첨부 파일은 읽기 시 자동 폴백하며, `npm run r2:migrate-private` 실행 시 무중단으로 R2로 전량 복사·검증된다.
3. **일괄 설정·마이그레이션 스크립트 추가**:
   - `scripts/r2-configure-buckets.ts` (`npm run r2:configure`): 공개·비공개 버킷에 표준 CORS와 수명 주기 규칙을 멱등 적용하고 검증한다.
   - `scripts/r2-migrate-private.ts` (`npm run r2:migrate-private`): Supabase `content`의 브랜드 첨부 파일을 `twings-private-apac`으로 바이트 크기 대조 복사한다.
4. **Vercel Pro 현행화**:
   - `AGENTS.md` §0 및 `docs/SCALE-RISKS-2026-11.md`의 구형 Hobby 표기를 실제 운영 플랜인 **Vercel Pro (서울 `icn1`, `maxDuration = 300`, 1 TB 대역폭)** 기준으로 현행화했다.
