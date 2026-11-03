# 브랜드용 AI 크리에이티브 플랫폼 SOTA 조사 (2026-11-03)

> 조사 기준일 2026-11-03. 공식 사이트·요금 페이지·도움말을 직접 열어 확인한 값만 "확인"으로 적고, 공식 페이지가 열리지 않거나(403·SPA·인증서 만료) 숫자가 클라이언트 렌더링이라 안 보인 값은 **미확인**으로 표시하고 2차 출처를 병기했다. 통화는 표기 그대로(USD 기본, KRW는 원화로 표기). 모든 URL은 2026-11-03 확인.
> TWINGS 포지션 전제: "브랜드만의 AI 미디어 엔진 = 고정 층(아이덴티티·절대 규칙·제작 원칙·메모리) + 바뀌는 것"(`docs/BRAND-ENGINE.md`). 범용 생성 도구 방향은 제안하지 않는다.

## 0. 결론 먼저

1. **"브랜드 학습"은 세 갈래로 갈라져 있고, 어느 플랫폼도 네 층을 다 갖지 못했다.**
   - (a) 문서→규칙화·검사: Adobe GenStudio(브랜드 가이드 기반 자동 검사), Jasper Brand IQ(Brand Voice·Visual Guidelines·Style Guide, 위반 플래그), Typeface Arc Graph(가이드·오디언스·캠페인 학습을 구조화).
   - (b) 웹사이트→브랜드 키트 자동 추출: Omneky(로고·색·서체·보이스), Pomelli Business DNA(톤·서체·이미지·팔레트), Magnific One Brand Kit(웹·PDF·이미지→로고·팔레트·타이포·스타일·톤).
   - (c) 커스텀 모델(LoRA) 학습: Scenario(Pro $45~), Flair(Pro+ $26~, 커스텀 모델 수로 티어), Krea(LoRA 이미지 50→2,000장), Kive(Pro "Advanced brand training"), Botika Enterprise(브랜드 룩 전용 모델), Adobe Firefly Custom Models(API GA, GenStudio 연동은 베타).
   - **아무도 없는 것**: "승인한 컷·고친 부분·금지한 표현"이 생성에 다시 들어가는 **메모리 층**, 출력물의 **마크 일치·팔레트 이탈을 픽셀 수준으로 검사**하는 절대 규칙 층, **동의한 실제 얼굴**을 브랜드 콘텐츠에 쓰는 신원 층. 이 셋이 TWINGS의 자리다.
2. **패션·CPG가 "가장 완성도 높은 결과"를 못 얻는 이유는 플랫폼들이 스스로 인정한다.** Google은 Pomelli 도움말에 "AI가 색·로고·질감 같은 제품 디테일을 바꿀 수 있으니 게시 전 검토하라"고 적었고, Botika는 요금제에 사람 리터치 라운드(2~3회)와 48시간 수정 SLA를 넣었으며, WeShop은 "AI Hands & Feet Fixer"를 별도 도구로 판다. 생성 품질이 아니라 **마감(부분 수정·색 보정·사운드·검수)** 이 비어 있다.
3. **가격은 거의 전부 USD·크레딧 기반이고, 티어를 가르는 축은 (1) 생성량 (2) 브랜드/워크스페이스 수 (3) 좌석 (4) 커스텀 모델 학습 가능 여부 (5) 법적 보호(상업 라이선스·면책·no-train) (6) 사람 검수·SLA** 여섯 가지다. 엔터프라이즈는 예외 없이 비공개·연간 계약이다.
4. **국내(Vrew·드랩아트·빔스튜디오)는 셀러·편집 도구 포지션**이며 브랜드 고정 층 개념이 없다. 원화 가격을 공개 페이지에 렌더링하지 않는 곳이 둘(Vrew·드랩아트)이다.

---

## 1. 플랫폼별 표

범례 — 타깃: ENT(엔터프라이즈)·AG(에이전시)·IH(인하우스 팀)·SMB(소상공인/셀러)·IND(개인). 브랜드 학습 유형: **문서→규칙**, **웹 추출**, **스타일 레퍼런스**, **LoRA/커스텀 모델**, **색·서체 추출**, **승인 메모리**, **적합도 검사**. 출시 상태는 2026-11-03 공개 페이지 기준.

### 1-1. 엔터프라이즈 마케팅 OS

| 플랫폼 | 한 줄 정의 | 타깃 | 브랜드 학습 메커니즘 | 범위 | 요금 (2026-11-03) | 상태 | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Typeface** | 엔터프라이즈 마케팅 에이전틱 플랫폼. "Arc Graph"가 브랜드 가이드·오디언스·에셋·캠페인 학습을 구조화해 에이전트가 집행 | ENT(마케팅·IT·크리에이티브) | **문서→규칙(Arc Graph)** + 채널 성과가 학습으로 환류 + 에이전트가 "스스로 검수"한다고 서술. 커스텀 이미지 모델·Brand Kit 명칭은 홈에 없음 | 텍스트·이미지(Figma·Photoshop·Illustrator 연동). 영상·오디오 언급 없음 | **비공개**(데모 전용). 2차: 온보딩 6~16주, 견적 기준 좌석·채널·에셋량(미확인) | GA | https://www.typeface.ai/ |
| **Adobe GenStudio for Performance Marketing + Firefly Services** | 브랜드 승인 에셋 조립→변형 생성→브랜드 검사→Meta/LinkedIn/CM360/Marketo 활성화 | ENT | **문서→규칙 + 적합도 검사**: "브랜드 가이드라인 기반으로 voice·tone·채널 규칙 정의", "모든 광고·이메일을 브랜드 보이스·접근성·규제 기준으로 자동 검사". 템플릿에서 편집/교체/잠금 요소 지정. **Firefly Custom Models API는 GA, GenStudio 연동은 베타**(2025-03 발표, 이후 공식 상태 갱신 못 찾음) | 카피·이미지·영상 변형(Firefly·Azure OpenAI·Veo), 소셜·디스플레이·CTV·이메일 | **GenStudio 비공개**. Firefly 개인: Standard $9.99(2,000 크레딧)·Pro $19.99(4,000)·Pro Plus $49.99(10,000)·Premium $199.99(50,000); 팀 라이선스당 동일. Firefly Foundry(2025-10)는 맞춤 계약 | GA(연동 일부 베타) | https://business.adobe.com/products/genstudio-for-performance-marketing.html · https://www.adobe.com/products/firefly/plans.html · https://news.adobe.com/news/2025/03/adobe-firefly-services-custom-models-unlock-on-brand-content-production |
| **Jasper (Brand IQ)** | 마케팅 카피·캔버스·에이전트. Brand IQ = Brand Voice·Visual Guidelines(팔레트·이미지 스타일·레이아웃 규칙)·Style Guide | IH·ENT | **문서→규칙 + 적합도 검사**(위반 플래그 + 대체안 제안, 점수 아님). 입력 포맷은 페이지에 미기재 | 텍스트 중심, 이미지 스타일 규칙. 영상은 아이콘만 | Pro $69/월/좌석($59 연간): Brand Voice 2·Knowledge 5·Audience 3, Visual Guidelines 미포함. Business 비공개: 무제한 IQ·Visual Guidelines·SSO·API | GA | https://www.jasper.ai/pricing · https://www.jasper.ai/brand-iq |
| **Pencil** | 광고 소재 생성·리사이즈·성과 예측(Brandtech Group) | IND·IH(Core/Growth), ENT(Pro) | **웹/업로드 브랜드 키트 권장**(로고·서체·색 + 설명). "Brand library"·AI 이미지/영상 생성 행은 **Coming soon** 표기. Pro에 custom models & fine-tuning | 텍스트·이미지·영상 광고(Anthropic·OpenAI·Google·Kling 모델), 포맷 리사이즈당 1 생성 | Core $14/월($11 연간) 50 생성·1 워크스페이스. Growth $55($44) 250 생성·무제한 워크스페이스. Pro 비공개: 무제한 생성, IP 양도·no-train·면책·데이터 링펜싱 | GA(일부 Coming soon) | https://www.trypencil.com/pricing |
| **Omneky** | 링크 하나로 9채널(Meta·Google·YouTube·TikTok·LinkedIn·Reddit·Pinterest·X·OpenAI Ads) 광고 생성·집행·분석 | SMB·IH·AG | **웹 추출**: "웹사이트에서 로고·색·서체·브랜드 보이스로 브랜드 시스템을 만든다", 수정 가능. Enterprise "AI trained on your 1P data" | 이미지 14비율, 10~30초 커머셜, 제품 애니메이션, 아바타(1~2명) 영상, 승자 광고 복제. Claude/ChatGPT/Slack 안에서 실행 | Lite $29/월($24 연간) 200 크레딧·1 브랜드·1 좌석. Standard $99($79) 1,000·3·3. Pro $249($199) 3,000·5·5. Enterprise 비공개(미디어 바잉 포함). 추가 크레딧 $0.10, 만료 없음. Meta/Google/OpenAI Ads는 Omneky 계정으로 집행 시 **광고비 + Omneky 수수료 선결제** | GA | https://www.omneky.com/pricing-plans · https://www.omneky.com/ |
| **Canva Enterprise** | 디자인 플랫폼 + Brand Kit + Canva AI(구 Magic Studio) | SMB~ENT | **색·서체·로고 키트 + 승인 워크플로**(2차 정보). 공식 페이지 403으로 직접 확인 실패 | 이미지·영상·문서 전반 | **미확인**(canva.com 403). 2차: Pro $15~18/월, Business $20~25/사용자, Enterprise 비공개; Brand Kit 1/5/100/1,000 | GA | https://www.canva.com/pricing/ (403) · 2차: https://piktochart.com/blog/canva-pricing-2026-costs-raised/ |
| **Pomelli (Google Labs)** | 웹사이트 URL→Business DNA→캠페인 아이디어→소셜 에셋 | SMB | **웹 추출(Business DNA)**: "톤 오브 보이스, 커스텀 서체, 이미지, 컬러 팔레트" | 이미지·영상(2026 Animate·Photoshoot·Catalog은 2차 정보), 영어만, 18+ | **무료**("currently at no charge", "several hundred image and video generations"). 유료 전환 미정 | 공개 베타 실험(2025-10-28 미·캐·호·뉴 출시 → 현재 **한국 포함** 국가 목록) | https://support.google.com/labs/answer/16715058 · https://support.google.com/labs/answer/16945066 · https://blog.google/technology/google-labs/pomelli/ |

> Pomelli 도움말 원문 요지: "AI가 색·로고·질감 같은 제품 디테일을 바꿀 수 있으니 게시 전 모든 AI 이미지를 검토하라." — 브랜드 자동 추출의 한계를 Google이 직접 적은 문장이다.

### 1-2. 생성 스튜디오 (멀티모델 작업공간)

| 플랫폼 | 한 줄 정의 | 타깃 | 브랜드 학습 메커니즘 | 범위 | 요금 (2026-11-03) | 상태 | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Higgsfield** | 50+ 모델 통합 워크스페이스 + Marketing Studio(Product shot·Motion·UGC·TikTok·Ads·Posters·Marketplace 템플릿) | IND·AG·ENT | **템플릿 + Consistent Characters**. Brand Kit는 Enterprise·Marketing Studio 페이지에 명칭 없음(브랜드 에셋/워크플로 언급만). Soul(얼굴 학습)은 개인용 | 이미지·영상·오디오, Premiere/AE/Photoshop/Resolve 플러그인 | 개인 요금 페이지 SPA라 **미확인**(2차: Starter $19, Plus $47~59, Ultra $99~129, 팀 $65/좌석). Enterprise 비공개: 연간 계약·크레딧 풀, "No training on your data"(계약 보증), SOC 2-aligned(인증 아님), SSO, 계약 면책 | GA | https://higgsfield.ai/enterprise · https://higgsfield.ai/marketing-studio · https://higgsfield.ai/pricing (SPA) |
| **Scenario** | 커스텀 모델·워크플로·API 중심 생성 플랫폼(게임→광고·커머스·패션 확장) | AG·IH·ENT | **LoRA 커스텀 모델**("브랜드 룩·제품 라인·반복 캐릭터"), Multi-LoRA 병합, 레퍼런스 앵커. Enterprise: **Quality Gate·IP Detection(프롬프트·입력 이미지 사전 검사, 출력물은 미검사)**·모델 허용목록·지출 한도·활동 추적 | 이미지·영상(첫/끝 프레임 제어)·3D 일부 | Starter $15(1,500 크레딧·50GB), Pro $45(5,000·커스텀 모델 학습·500GB), Max $75(10,000·1TB), Enterprise 비공개(12개월·SSO·SOC 2 Type II·DPA·no-train). 연간 33% 할인(금액 미표시) | GA | https://www.scenario.com/pricing · https://www.scenario.com/ |
| **Runway** | Gen-4.5·Aleph 2.0 영상 생성/편집 + Runway Ads + App Studio | IND·AG·ENT | **Brand Kit(Pro 1개·Max 3개)**, 커스텀 보이스 클론(Pro 1·Max 3). 스타일 학습 없음 | 영상·이미지·음악/보이스/SFX·4K 업스케일 | Free 125 크레딧(1회). Standard $15/월($12 연간) 625. Pro $35($28) 2,250. Max $95($76) 9,500. Enterprise 비공개. **Gen-4.5 12 크레딧/초, Aleph 2.0 28 크레딧/초(140/5초)** | GA | https://runway.com/pricing · https://runwayml.com/enterprise |
| **Krea** | 멀티모델 이미지/영상 + Krea 3 + Agent + Nodes | IND·IH·ENT | **LoRA 스타일/캐릭터/오브젝트 학습**: Basic·Pro 50장, Max·Team 2,000장, Enterprise 맞춤 | 이미지·영상·3D·립싱크·22K 업스케일 | Free(100유닛/일). Basic $9($5) 5,000. Pro $35($21) 20,000. Max $105($63) 60,000. Team $200($160) 80,000. Enterprise 비공개(SAML·면책·커스텀 ToS). 2차: 2026-11-02 Free 플랜 LoRA 행 비활성(미확인) | GA | https://www.krea.ai/pricing |
| **Magnific (구 Freepik)** | 스톡+AI 스위트. 2026-10-08 "Magnific One" 이미지 모델 + **Brand Kit**(모든 유료 플랜) | IND·IH·ENT | **웹/PDF/이미지/텍스트→Brand Kit**(로고·팔레트·타이포·비주얼 스타일·톤)를 "아트 디렉션 층"이 프롬프트 전에 적용. Magnific One에서만 동작. 문서 페이지 403 → 메커니즘 세부는 2차(미확인) | 이미지(30+ 모델)·영상(Kling 등)·업스케일 | Premium $20/월($14.50 연간) 240K 크레딧/년. Premium+ $45($33.75) 600K. Pro Starter $90($66.92) 1.5M~4M. Business·Enterprise 비공개. 개인 플랜 "No model training on your data". 크레딧 1년 유효 | GA | https://magnific.com/pricing · https://www.magnific.com/one · 2차: https://venturebeat.com/orchestration/magnific-one-launches-to-give-teams-an-image-generator-that-avoids-the-ai-look-and-automatically-upholds-their-brand-kit |
| **Kive** | 제품 사진·광고·편집 + 라이브러리 + MCP(Claude·ChatGPT) | SMB·IH | **Advanced brand training**(Pro 이상), Enterprise는 "custom AI ideas and presets" | 이미지·숏 비디오·라이브러리(10,000→50,000 항목) | Free 40 크레딧. Basic $40/월($30 연간) 2,000·2인. Pro $100(5,000)~$1,600(80,000)·10인. Enterprise 비공개(150,000+). 미사용 크레딧 월 한도 2배까지 이월 | GA | https://kive.ai/pricing |
| **Flair.ai** | 드래그앤드롭 제품/패션 사진·광고·영상 | SMB·IH | **커스텀 모델 수로 티어**(Free 1, Pro+ 8 Standard/2 Fast, Scale 15/4). 브랜드/텍스트 보존은 2차 주장 | 이미지·숏 비디오·API(Scale 얼리 액세스) | Free $0(5장). Pro $8. Pro+ $26(80장·**회사 상업 라이선스**). Scale T1 $38(150장·API). Enterprise 비공개. 즉시 생성·광고 생성은 **4배 과금** | GA | https://flair.ai/pricing |
| **Photoroom** | 배경 제거→AI 배경·그림자·편집 앱 + API | SMB·ENT(API) | **Brand Library**(Pro 이상). 브랜드 키트 세부 미기재. Enterprise API **Visual QA** | 이미지, Enterprise에 Image to Video | 앱: Pro 8,000·Max 25,000·Ultra 75,000 크레딧/월, 좌석 50까지; **금액은 지역별 렌더링이라 미확인**(2차 2026-10: Pro $12.99/$7.50, Max $34.99/$20.99, Ultra $99/$82.50). API: Basic $0.02/장(1,000장 $20), Plus $0.10/장, 샌드박스 월 1,000회 워터마크, Enterprise 비공개(SLA·SSO·SOC 2) | GA | https://www.photoroom.com/pricing · https://www.photoroom.com/api/pricing |
| **Recraft** (신규 플레이어·참고) | 벡터/래스터 디자인 생성, Custom Styles | IND·IH | **스타일 레퍼런스 학습(Custom Styles)** | 이미지·SVG | 플랜 금액 페이지 미렌더링(미확인, 2차 $10~12/월~). 유료만 상업권, Free 이미지는 Recraft 소유·공개 | GA | https://www.recraft.ai/pricing |
| **Morphic** (경쟁사이자 TWINGS 고객사 — 공개 정보만) | 멀티모델 영상·이미지 작업공간, Workflows(기성 파이프라인), 캔버스 | IND·팀·ENT | 요금 페이지에 브랜드 키트·스타일 레퍼런스 명시 없음(Workflows는 전 플랜) | 영상·이미지 | Free 20 크레딧. Education $4. Basic $19/월($228/년) 2,400. Standard $24($288) 3,625. Pro $45($540) 6,350 공유(추가 4인 유료). Max $170($2,040) 24,650(추가 9인). Enterprise 비공개. 상업 이용 Standard 이상 | GA | https://morphic.com/pricing |

### 1-3. DAM + AI

| 플랫폼 | 한 줄 정의 | 타깃 | 브랜드 학습 메커니즘 | 범위 | 요금 | 상태 | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Frontify** | 브랜드 가이드라인·DAM·템플릿 + AI | ENT | **가이드라인 자체가 소스**: Brand Assistant("가이드라인으로 학습한 AI", 답변이 해당 섹션 링크), **Frontify MCP**(승인 에셋·가이드·컨텍스트를 외부 AI가 조회), AI 번역. 생성형 이미지·브랜드 검사 명시 없음 | 관리·배포(생성은 보조) | **비공개, MAU(월 활성 사용자) 모델**(6개월 평균, 연 1회 재산정). 2차 추정 $15K~60K/년(미확인) | GA | https://www.frontify.com/en/pricing · https://www.frontify.com/en/ai |
| **Bynder** | 모듈형 DAM(DAM·Bynder AI·Studio·Content Workflow·Print Brand Templates) | ENT | Bynder AI = 검색(이미지·텍스트·음성)·메타데이터·중복 제거. Studio = 브랜드 템플릿 기반 이미지·영상·GIF. 생성형은 Content Workflow. MCP 없음(Frontify 비교 페이지 주장) | 관리·템플릿 제작 | **비공개 모듈 패키지**(사용자·스토리지·통합 수 기준). 2차: AWS Marketplace 12개월 $66,000 패키지(미확인) | GA | https://www.bynder.com/en/pricing/ |

### 1-4. 패션 AI 모델·가상 촬영

| 플랫폼 | 한 줄 정의 | 타깃 | 브랜드 학습 메커니즘 | 범위 | 요금 | 상태 | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Lalaland.ai → Browzwear AI Model Library** | 3D 의류 제작 스위트 안의 "검증된 AI 모델 라이브러리"로 이커머스·홀세일·마케팅 일관성 | ENT 패션 | **큐레이션된 고정 모델 세트 + 3D 가먼트**(학습이 아니라 통제). 2025-07 Browzwear 인수(2차) | 온모델 이미지 | **비공개(Contact Us)**. lalaland.ai는 Browzwear로 리다이렉트 | GA(데모 전용) | https://lalaland.ai/ |
| **Botika** | 플랫/마네킹→AI 모델 착장 + **사람 리터치 라운드** | SMB~ENT 패션 | Enterprise: **브랜드 룩 전용 AI 모델·전용 배경·화이트글러브 QC·커스텀 리터치 브리프**(규칙을 사람이 적용) | 이미지 2K/4K | Pro $55/월($46 연간) 600 크레딧/년·2K·리터치 2회·2일 수정. Advanced $100(페이지에 $40 병기, 불일치) 1,000/년·4K·3회·1일. Enterprise 비공개(연 240장 초과). 페이지 내 크레딧 단위(연/월) 불일치 | GA | https://botika.com/pricing |
| **ZMO.ai** | AI 패션 모델·배경 | SMB | 2차: 커스텀 모델 | 이미지 | **미확인**(zmo.ai 인증서 만료로 접속 불가). 2차 $29~59/월~, 상한 $799 | 불명 | https://www.zmo.ai/pricing (CERT_HAS_EXPIRED) |
| **Vmake** | 소셜 영상 중심 편집·생성(패션 솔루션 페이지 별도) | IND·SMB | 없음(템플릿) | 영상 중심, 카탈로그 스틸 약함(2차) | Free 20 크레딧/일, Plus 1,000/월, Pro 4,500/월; **금액 미렌더링(미확인**, 2차 $9.99/$29.99) | GA | https://vmake.ai/pricing |
| **WeShop AI** (MOGU, NYSE 상장사) | 가상 피팅·AI 패션 모델·제품 사진·Model↔Mannequin·**Hands & Feet Fixer**·영상, 3rd-party 모델 전부(Seedance 2.5·Kling 3.0·Sora 2·Veo 3·GPT Image 2.5·Nano Banana·Seedream 5.0 Pro) | 셀러·마켓플레이스·브랜드 | 커스텀 모델 명시 없음(포인트제) | 이미지·영상·API·앱 | Free 200포인트. Pro $9.99/월($7.99 연간) 12,000pt/년·동시 16. Ultra $45($36) 72,000. Enterprise $457($365.6) 180,000. 통화 미표기 | GA | https://www.weshop.ai/member · https://www.weshop.ai/ |

### 1-5. UGC 광고

| 플랫폼 | 한 줄 정의 | 타깃 | 브랜드 학습 메커니즘 | 범위 | 요금 | 상태 | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Creatify** | URL→UGC/제품 영상, AI 액터 1,500, Aurora 아바타, Ad Agent·경쟁사 광고 추적 | SMB·IH·AG·ENT | **Brand spaces**(1/2/3/10/무제한), 커스텀 아바타 3, Enterprise **custom AI model fine-tuning** | 영상(Seedance 2.0·Boreal·Aurora)·이미지(GPT Image 2.5) | Standard $10(정가 $15 취소선) 55 크레딧. Pro $38($55) 280·2 브랜드. Max $66($95) 730·3좌석·3 브랜드. Business $136($195) 1,500·10좌석·10 브랜드. Enterprise 비공개(SOC 2·화이트라벨·IP 양도). API $99(500)·$299(2,000). Studio 대행 월 25~100+편·48시간. **크레딧 2개월 만료**. 취소선 가격이 연간인지 프로모션인지 페이지에 미기재 | GA | https://creatify.ai/pricing |
| **Arcads** | AI 액터 1,000+ UGC 광고, 자기 아바타 생성, Arcads Studio(Seedance 2.5), 30+ 언어 번역 | D2C·앱·AG | 없음(액터·프리셋) | 영상 | **비공개**(요금 페이지 404, "Free trial available"). 2차 $110/월 10편(미확인) | GA | https://www.arcads.ai/ |
| **Icon.com** | **사람이 찍는 UGC 대행**("no AI / 100% real") + Admaker 2.0 | D2C | 해당 없음(크리에이티브 디렉터가 사람) | 실사 영상 | The Agency $1,000/월(3일 무료 후) 6편(크리에이터 2×3), 환불 보증. Dedicated Creative Director 비공개. Agency Whitelabel 볼륨 | GA(AI 생성에서 실사 대행으로 전환) | https://icon.com/pricing |

### 1-6. 국내

| 플랫폼 | 한 줄 정의 | 타깃 | 브랜드 학습 메커니즘 | 범위 | 요금 | 상태 | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Vrew(브루)** | 자동 자막·AI 음성·텍스트→영상 편집기 | IND·강사·SMB | 없음 | 편집·TTS·자막·AI 영상 생성(Standard 이상, 2차) | 공식 페이지는 Free/Light/Standard/Business 4종과 "연간 20% 절감", "창작물 AI 학습에 쓰지 않음"만 렌더링, **금액 "US$ -"로 미확인**. 2차(2026-07-24 기준): Free 음성인식 120분·AI음성 1만자, Light 1,200분, Standard 6,000분·클라우드 50GB, Business 7,200분. 다른 2차: 2026-04-22 통합 크레딧 개편, Light 14,900원·Standard 23,900원·Business 39,600원(미확인) | GA | https://vrew.ai/ko/pricing/ · 2차 https://www.moket.kr/tools/vrew |
| **드랩아트(Draph Art)** | 상품 사진·AI 모델샷·광고 영상·상세페이지 | SMB 셀러·브랜드 | 없음(프리셋·BP 크레딧) | 이미지·영상·상세페이지·API 문의 | 공식 요금 페이지는 "월간/연간, 연간 최대 15% 할인, 상세페이지·영상은 프로플러스 또는 옴니"만 렌더링, **금액 미확인**. 2차(프레이머 페이지): 스탠다드 350BP(최대 70회), 프로 720BP(144회), 프로플러스 1,500BP(300회), 신규 5회 무료 | GA | https://draph.art/pricing · https://draphart.framer.ai/ |
| **Pixelcut**(미국, 국내 셀러 사용 많음) | 배경 제거·업스케일·AI 상품 사진 배치 | SMB | 없음(브랜드 키트 미기재) | 이미지 | Free. Pro $10/월($8 연간) 600 크레딧·3좌석·배치 1,000·상업 라이선스. Business $30($24) 3,600·10좌석·배치 2,000 | GA | https://www.pixelcut.ai/pricing |
| **빔스튜디오(바이스벌사)** — 조사 중 발견 | 패션 리테일 특화: 상품컷·룩북→상세페이지·자사몰→판매·재고·리오더 연동(AX) | 패션 브랜드·백화점·플랫폼 | 없음(운영 데이터 연동이 핵심) | 이미지·상세페이지; 2026 하반기 AI 숏폼 자동 제작·AI 라이브커머스 계획 | **비공개**. "콘텐츠 제작 비용 20% 이상 절감" 자사 주장 | 2024 론칭 | https://fashionbiz.co.kr/article/229911 (2026-10-01) |

### 1-7. 조사 중 발견한 2026년 움직임(2차 출처, 미확인)

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| Magnific One + Brand Kit | 2026-10-08 출시, 모든 유료 플랜 포함. "아트 디렉션 층"이 브랜드 키트를 프롬프트 전에 적용 | https://venturebeat.com/orchestration/magnific-one-launches-to-give-teams-an-image-generator-that-avoids-the-ai-look-and-automatically-upholds-their-brand-kit |
| Freepik→Magnific 리브랜드 | 2026-04-28(2차) | https://oakgen.ai/blog/magnific-ai-freepik-rebrand-pricing |
| Icon.com 피벗 | AI UGC→사람 촬영 UGC 대행($1,000/월)으로 공식 페이지 전환 | https://icon.com/pricing |
| Poolday $11M(2026-09) | 브랜드 마케팅 영상 자동 제작 에이전트 | https://newmarketpitch.com/blogs/news/ai-video-generation-funding-news |
| Krea Free LoRA 제거(2026-11-02) | 무료 플랜 50장 LoRA 행 비활성 | https://pricingsaas.com/companies/krea/diffs/2026W45 |
| Adobe Firefly Foundry(2025-10) | 기업 맞춤 파운데이션 모델 서비스 | https://news.adobe.com/news/downloads/pdfs/2025/10/102825-genstudio-innovations-at-adobe-max.pdf |
| Canva AI 2.0 "Brand Intelligence"·Figma Buzz | 브랜드 일관 에셋 레이어(2차 블로그만, 미확인) | https://www.flatlineagency.com/blog/ai-design-tools-for-brands-2026/ |

---

## 2. '브랜드 학습'을 가장 잘하는 3곳과 비어 있는 것

| 순위 | 플랫폼 | 왜 잘하나(근거) | 비어 있는 것 |
| --- | --- | --- | --- |
| 1 | **Adobe GenStudio for Performance Marketing (+Firefly Custom Models)** | 가이드라인→voice·tone·채널 규칙 정의→**모든 산출물 자동 검사**(브랜드 보이스·접근성·규제)→Workfront 승인→채널 활성화까지 한 줄. 템플릿에 잠금/교체 요소 지정. 커스텀 모델 API GA | 검사 대상이 **카피·규제 중심**이고 픽셀 수준 마크·팔레트 검사는 명시 없음. 커스텀 모델 연동은 베타. 가격·도입 비공개(ENT 전용). 얼굴·초상 동의 층 없음 |
| 2 | **Typeface (Arc Graph)** | 가이드·오디언스·에셋·**캠페인 성과 학습**을 한 그래프로 구조화해 에이전트가 집행·자가 검수. "학습이 쌓인다"는 개념이 TWINGS 메모리 층과 가장 가깝다 | 영상·오디오 없음. 이미지 모델 커스텀 명시 없음. 온보딩 6~16주·비공개 가격(2차). 승인한 '컷'이 아니라 '성과'가 쌓인다 — 미감 메모리는 아님 |
| 3 | **Jasper Brand IQ** | Brand Voice + **Visual Guidelines(팔레트·이미지 스타일·레이아웃 규칙)** + Style Guide 세 층을 명시적으로 분리하고 **위반을 플래그·대체안 제안**. Pro $59~로 가격 공개 | 텍스트 우선. Visual Guidelines는 Business(비공개)에서만. 입력 포맷·한도 미기재. 생성 이미지 품질 검사 없음 |
| 차점 | **Magnific One Brand Kit / Omneky / Pomelli** | 웹·PDF→키트 자동 추출이 가장 빠르다(수 분). Magnific은 "아트 디렉션 층"으로 프롬프트 앞단에 적용 | Pomelli가 인정하듯 **제품 디테일(색·로고·질감)이 바뀐다**. 키트는 "가이드"이지 보증이 아니다. 승인 메모리·검수 없음 |
| 차점 | **Scenario / Krea / Flair / Botika Enterprise (LoRA·전용 모델)** | 브랜드 룩·제품을 모델 가중치로 고정 → 반복 생산에 강함. Scenario는 IP Detection·Quality Gate로 운영 통제 | LoRA는 '스타일'을 잡지 '규칙'을 모른다(로고 크기·위치, 금지 표현, 동의 얼굴). 학습 데이터 준비·재학습 비용이 브랜드 팀 몫 |

---

## 3. 패션·CPG가 '가장 완성도 높은 AI 이미지·영상'을 못 얻는 지점 — TWINGS가 파고들 틈

| 결함 축 | 플랫폼들이 못 하는 것(근거) | TWINGS 틈 (BRAND-ENGINE §4·§6 기준) |
| --- | --- | --- |
| **로고·마크·제품 디테일** | Google Pomelli 도움말: "AI may alter product details like colors, logos, or textures — review before publishing". Adobe 검사는 보이스·접근성·규제. Scenario IP Detection은 **입력만** 검사. 어느 곳도 출력 마크 일치·팔레트 ΔE 검사를 제품 기능으로 내세우지 않음 | **절대 규칙 자동 검사(P0)**: 마크 매치·팔레트 ΔE·금지어 + 사람 검수. 부분 수정(마스크 재생성, 엣지 하드니스 ~50) 표준 공정 |
| **피부·얼굴** | 패션 툴(Botika·Browzwear·WeShop)은 **합성 모델**만, UGC 툴(Creatify·Arcads)은 **AI 액터**. Icon은 아예 사람 촬영으로 피벗. 동의 기반 실제 얼굴 + 제공사 검수 흐름을 브랜드 콘텐츠에 붙인 곳 없음 | 이미 있는 **본인 인증 셀카 + 제공사 검수 + 크리에이터 캠페인**을 엔진의 "바뀌는 것(크리에이터 얼굴)"으로 연결. 얼굴 검증 우회 금지는 그대로 |
| **착장·의류 일관성** | Botika는 리터치 2~3회·48시간 수정 SLA를 **요금제에 포함**(= 1회 생성으로 안 끝남). WeShop은 "Hands & Feet Fixer"를 별도 도구로 판매. Browzwear는 3D 가먼트가 있어야 함(ENT 전용). 국내 크몽 판매자도 "단추·지퍼 디테일은 실촬영 병행" | 전신 컷 전체 재생성 금지, **부분 수정 공정** + 모델별 라우팅 표(어떤 컷에 어떤 모델). 패션은 "레퍼런스 측정 → 적응" 원칙(LESSONS) |
| **사운드** | 사운드 마감(드롭·−14 LUFS)을 제품 기능으로 둔 곳 없음. Runway·Higgsfield는 음악·SFX '생성'까지, Vrew는 TTS | **사운드 마감 단계**를 파이프라인 기본값으로(§4-8). 음악 라이선스(CC BY-NC 보류)는 대표 결정 |
| **컬러 그레이딩·룩 저장** | Magnific Brand Kit는 "색·무드·구도" 가이드 수준. LUT·그레이드를 브랜드 룩으로 **저장·재적용**하는 기능은 어디에도 없음 | **저장한 색 보정 = 고정 층 메모리**. 레퍼런스 맞춤 그레이드 후 값 저장 → 다음 컷에 자동 적용 |
| **운영 지원** | 사람 검수는 전부 최상위 티어 또는 대행: Botika Enterprise 화이트글러브 QC, Photoroom Enterprise Visual QA, Creatify Studio(48시간 대행), Pencil Pro 크리에이티브 팀, Icon 사람 디렉터 | TWINGS는 **스튜디오 검수와 캠페인 운영이 이미 제품**(brand.twings.app). 검수를 '옵션'이 아니라 절대 규칙 층의 일부로 둔다 |
| **승인 메모리** | Typeface는 성과 학습, Frontify는 가이드라인 Q&A·MCP, Jasper는 Knowledge. "승인한 컷·고친 부분·쓰지 않기로 한 표현"이 다음 생성에 들어가는 곳 없음 | **브랜드 메모리(P1)**: 조직·캠페인·개인 3층. 승인·수정·노트가 쌓여 고정 층이 두꺼워진다 — 해자 |

---

## 4. 가격·패키지에서 배울 점 — 무엇으로 티어를 가르나

| 티어 축 | 쓰는 곳 | 수치 예 | TWINGS 시사점 |
| --- | --- | --- | --- |
| 생성량(크레딧) | 거의 전부 | Runway 625→9,500, Krea 5,000→80,000유닛, Magnific 240K→4M/년 | 브랜드 측은 크레딧 노출보다 "컷 수·캠페인 수"가 읽힌다. 엔진별 단가 자동 계산(이미 결정)만 내부에 둔다 |
| 브랜드/워크스페이스 수 | Omneky 1/3/5, Creatify 1/2/3/10, Runway Brand Kit 1/3, Pencil 1/무제한 | — | **브랜드 1개 = 고정 층 1세트**가 자연스러운 과금 단위. 에이전시는 브랜드 수로 |
| 좌석 | Omneky 1/3/5, Pixelcut 3/10, Kive 2/10, Jasper 좌석당 | — | 좌석보다 브랜드·검수 단위가 TWINGS에 맞다 |
| 커스텀 모델·학습 | Scenario Pro $45, Flair Pro+ $26(모델 수), Krea Max(2,000장), Kive Pro, Botika ENT | — | "아이덴티티 초안(웹 추출)"은 기본, "전용 룩 학습·메모리"는 상위 |
| 법적 보호 | 상업 라이선스(Flair Pro+·Krea 유료·Recraft 유료), 면책(Krea·Pencil Pro·Higgsfield·Freepik ENT), no-train(Scenario ENT·Magnific 개인·Higgsfield ENT 계약) | — | 약관 §5.3·초상권 절차가 이미 차별점. "동의 얼굴만" 보증을 패키지 문구로(약관 변경은 대표 승인) |
| 사람 검수·SLA | Botika 리터치 2/3회·2일/1일, Creatify Studio 48h, Photoroom Visual QA, Pencil Pro SLA | — | 검수 포함 여부·수정 라운드·납기를 티어 변수로 |
| 크레딧 유효기간 | Magnific 1년, Creatify 2개월, Omneky 추가분 무기한, Kive 2배 이월 | — | 스토어 결제·구독(§19) 설계 시 "만료 없는 이미지 크레딧"과 충돌 여부 확인 |
| 연간 할인 | 17~33%(Botika 17, Runway·Krea·Magnific·Vrew 20~25, Scenario 33) | — | 참고값. 금액 결정은 대표 |
| 엔터프라이즈 | 전원 비공개·연간 계약·12개월(Scenario·Jasper Business) | — | brand.twings.app도 "문의" 티어 하나는 필수. 단 중간 티어는 **공개가 신뢰** (Botika·Omneky·Creatify) |

공통 관찰: 국내 2곳(Vrew·드랩아트)은 공개 페이지에 원화 금액을 렌더링하지 않는다. TWINGS 한국어 페이지는 원화 고정가 노출 원칙(AGENTS §5)이 오히려 차별점이다.

---

## 5. TWINGS 제품 결정용 요약 표

| 구분 | 항목 | 근거 |
| --- | --- | --- |
| **꼭 갖춰야 할 것** | 웹사이트·자료→아이덴티티 초안(색 역할·서체·톤) 수 분 내 생성 | Omneky·Pomelli·Magnific이 기본 제공. 없으면 온보딩에서 진다 |
| | 브랜드 1개 단위 워크스페이스·에셋 라이브러리·승인 상태 | Creatify brand spaces, Photoroom Brand Library, Frontify DAM |
| | 상업 이용권·no-train·초상 동의를 **문구로** 명시 | Krea·Scenario·Magnific·Higgsfield 모두 티어 변수. 약관 문구 변경은 대표 승인 |
| | 공개 중간 티어 + 문의 엔터프라이즈 | Botika·Omneky·Creatify 패턴 |
| | 채널별 비율 내보내기(9:16·4:5·1:1·16:9) | Pencil 리사이즈 1 생성, Omneky 14비율 |
| **차별화할 것** | **절대 규칙 자동 검사(마크·팔레트·금지어·동의 얼굴) + 사람 검수** | 아무도 출력 픽셀을 검사하지 않음(§3) |
| | **승인 메모리**(승인 컷·수정·금지 표현·저장한 그레이드) | Typeface는 성과만, Frontify는 가이드만 |
| | **마감 공정**(부분 수정·색 보정 저장·사운드 −14 LUFS·4K) | Botika·WeShop이 "수정 도구"로 인정한 결함 축 |
| | **동의한 실제 얼굴**(크리에이터)과 브랜드 고정 층의 결합 | 패션·UGC 툴은 합성 모델·AI 액터만 |
| | 한국어·원화 공개가·국내 운영 지원 | 국내 경쟁자는 금액 미노출, 해외는 USD |
| **하지 않을 것** | 50+ 모델 선택 UI·프롬프트 노출 | 범용 도구 방향 금지(AGENTS §5). 공개 페이지에 엔진 이름 쓰지 않음 |
| | AI 액터·합성 인플루언서 라이브러리 | 포지션("내 얼굴") 위배. Icon은 반대로 사람으로 피벗 |
| | 미디어 바잉·광고 계정 대행(Omneky식 수수료) | 캠페인은 크리에이터 확산이 본업. 결제 수단 변경은 대표 결정 |
| | DAM 전면 경쟁(Frontify·Bynder) | 라이브러리는 엔진의 입력·출력 보관까지만 |
| | 학습 데이터 준비를 브랜드에 떠넘기는 LoRA 셀프서비스 | 고정 층은 "브랜드 자료 + 팀 확정"으로 만든다(§3) |

---

## 6. TWINGS 제안

1. **P0 그대로**: 브랜드 아이덴티티 스키마·편집기 + 절대 규칙 자동 검사. 검사 결과 화면에 "마크 일치 / 팔레트 ΔE / 금지어 / 동의 얼굴" 네 칸을 고정 노출하고, 사람 검수를 대체하지 않는다는 문장을 유지한다.
2. **P1 아이덴티티 초안**은 Omneky·Pomelli 수준(웹 크롤→색·서체·톤)으로 충분하되, 결과를 "초안"으로만 저장하고 팀 확정 전에는 생성에 쓰지 않는다 — Pomelli가 인정한 디테일 변형 위험을 제품 문구로 뒤집는다("추출은 빠르게, 고정은 사람이").
3. **메모리 층을 가격표의 상위 변수로**: "승인 컷·저장한 룩·수정 이력"이 쌓이는 브랜드만 상위 티어. 경쟁사가 팔지 않는 축이라 비교표에서 빈 칸이 된다.
4. **마감 공정을 기본 포함**(부분 수정·색 보정·사운드·4K). Botika처럼 "수정 N회·납기"를 티어 변수로 두되, 횟수·납기 숫자는 대표 결정.
5. brand.twings.app 랜딩 비교표에 §5의 "차별화" 다섯 줄만 싣고, 경쟁사 실명·가격은 싣지 않는다(문안은 Gemma 경로, 사실은 이 문서).
6. 영상 엔진 공개 명칭은 계속 숨긴다. 단 내부 라우팅 표에 Runway Gen-4.5(12 크레딧/초)·Aleph 2.0(28/초) 같은 공개 단가를 기록해 가격 자동 계산(이미 결정된 규칙)에 반영한다.

## 7. 대표 결정 필요

- 브랜드 측 과금 단위: 브랜드 수 / 캠페인 수 / 컷 수 중 무엇을 1차 축으로 두나. 금액·패키지는 전부 대표.
- 검수 포함 범위: 모든 컷 사람 검수 vs 절대 규칙 자동 검사 + 샘플 검수. 수정 라운드 수·납기 숫자.
- 아이덴티티 초안 자동 추출의 범위(웹만 / 웹+자료 업로드)와 공개 문구("얼리 액세스").
- 음악·사운드 라이선스(CC BY-NC 보류 중) — 사운드 마감을 기본 포함하려면 라이선스 경로 확정 필요.
- 약관 §5.3·상업 이용권·no-train 보증 문구 — 경쟁사 수준(면책·IP 양도)까지 갈지.
- 고객 사례에 쓸 브랜드명·수치, 비교표에 경쟁사 실명을 쓸지(현재 제안: 쓰지 않음).

## 부록 A. 검증 필요 주장(2차 출처·미확인)

| 주장 | 출처 |
| --- | --- |
| Canva Pro $15~18/월, Business $20~25/사용자, Brand Kit 1/5/100/1,000 | https://piktochart.com/blog/canva-pricing-2026-costs-raised/ (공식 403) |
| Higgsfield 개인 요금 Starter $19·Plus $47~59·Ultra $99~129, 팀 $65/좌석, 비ENT 사용자 콘텐츠 학습 | https://www.heygen.com/blog/higgsfield-pricing (공식 SPA) |
| Photoroom 앱 Pro $12.99/$7.50·Max $34.99/$20.99·Ultra $99/$82.50 | https://www.eesel.ai/blog/photoroom-pricing (공식은 지역별 렌더링) |
| Vrew 2026-04-22 통합 크레딧 개편, Light 14,900원·Standard 23,900원·Business 39,600원 | https://beompick.com/vrew/ · https://www.moket.kr/tools/vrew (공식 금액 미렌더링) |
| 드랩아트 스탠다드 350BP/프로 720BP/프로플러스 1,500BP | https://draphart.framer.ai/ (공식 금액 미렌더링) |
| Magnific One Brand Kit 2026-10-08 출시·웹/PDF/이미지→로고·팔레트·타이포·톤 추출 | https://venturebeat.com/orchestration/magnific-one-launches-to-give-teams-an-image-generator-that-avoids-the-ai-look-and-automatically-upholds-their-brand-kit (문서 페이지 403) |
| Firefly Custom Models↔GenStudio 연동 베타 상태가 2026-11에도 유지되는지 | https://news.adobe.com/news/2025/03/adobe-firefly-services-custom-models-unlock-on-brand-content-production |
| Arcads 요금 $110/월 10편, ZMO $29~59/월 | https://www.prismposter.com/blog/ai-ugc-ads-guide · https://aichief.com/ai-image-generator/zmo-ai/ (공식 404·인증서 만료) |

## 부록 B. 접속 실패·미렌더링 기록(2026-11-03)

typeface.ai/pricing 404 · omneky.com/pricing 404(→/pricing-plans 정상) · canva.com/pricing 403 · canva.com/help/brand-kit-limits 403 · labs.google/pomelli SPA(도움말로 대체) · higgsfield.ai/pricing SPA · zmo.ai 인증서 만료 · weshop.ai/pricing 404(→/member 정상) · arcads.ai/pricing 404 · vrew.ai/ko/pricing 금액 미렌더링 · draph.art/pricing 금액 미렌더링 · magnific.com/ai/docs/brand-kit 403 · business.adobe.com brand-compliance 타임아웃(메인 페이지로 대체) · browzwear.com/ai-model-library 404(lalaland.ai 리다이렉트 페이지로 대체).
