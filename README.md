# TWINGS

내 얼굴로 영상·이미지 템플릿의 주인공이 되는 서비스와, 스튜디오가 운영하는 브랜드·크리에이터 캠페인 공간입니다.

- 기본 작업 폴더: `D:\dev\twings`
- 에이전트 규칙: [AGENTS.md](AGENTS.md)
- 작업 폴더·브랜치 구분: [docs/WORKSPACE.md](docs/WORKSPACE.md)
- 제품 결정: [docs/TEMPLATES-IA.md](docs/TEMPLATES-IA.md), [docs/CAMPAIGNS.md](docs/CAMPAIGNS.md), 브랜드 2차 활용 [docs/SECONDARY-USAGE.md](docs/SECONDARY-USAGE.md)
- 배포: `twings.app` · `brand.twings.app` · `admin.twings.app`
- 공개 이용자 동선: [브랜드·크리에이터 진입 분리](docs/AUDIENCE-RENOVATION.md), [브랜드 문의 Slack 운영](docs/BRAND-INQUIRY-DELIVERY.md)

기존 npm 패키지명과 `PLAYBOOK_*` 환경변수, DB 식별자는 호환성을 위해 유지합니다. `PLAYBOOK-PLAN.md`는 초기 구현 기록이며 현재 제품 정책은 AGENTS와 제품 결정 문서를 따릅니다.

## Status

브랜드 의뢰·승인·리포트와 토스 단건 결제가 구현되어 있습니다. 공개 생성 플래그는 닫혀 있으며, 얼굴 기준 사진은 별도 PR #8에서 검증 중입니다. 상태 판단은 해당 PR·배포 기록과 함께 확인합니다.

## Run it

```powershell
npm install
npm run check   # typecheck + vitest — what CI runs
npm run dev
```

No external service is required for local development or for the test suite: DB acceptance runs on
PGlite in-process, and storage uses the local filesystem driver under `.storage/`.

## Where things are

| Path | What |
|---|---|
| `app/(marketing)/[locale]/` | public, locale-prefixed, static + `catalog` tag + 1h TTL |
| `app/(marketing)/[locale]/brands/` | brand campaign services and public enquiry; `/campaigns` is creator discovery |
| `app/(app)/`, `app/(admin)/` | authenticated surfaces, `force-dynamic` + `private, no-store` |
| `app/globals.css` | the single design-token source (Tailwind v4 CSS-first, section 5.1/5.2) |
| `lib/content/` | zod block contracts, the shared visibility resolver, the pure `shapeRevision` |
| `lib/publish/` | phase B of publication (the storage copier) around the two DB RPCs |
| `lib/storage/` | bucket semantics behind one interface; local driver now, Supabase driver later |
| `supabase/migrations/` | core (PGlite-testable) + supabase-glue split — see `supabase/README.md` |
| `scripts/seed.ts` | 2 fixture playbooks, every block kind x visibility, published for real |
| `docs/` | `VERSIONS.md` (why each pin), `SETUP.md` (manual steps remaining) |
