# Sunra AI — 백업 제공사와 가격 비교

조회일 2026-10-31. 아래 Sunra 가격은 모두 **공식 표시 가격**이고 실측이 아니다. 실측은 스모크 결과 절에 따로 적는다.

## 결론

- **Seedance 가격 이점은 거의 없다.** Sunra API 잔액은 충전액에 5% 수수료가 붙는다(약관 §6.2). 이를 넣으면 Seedance 2.0은 약 1.5% 싸고, 2.5는 5% 비싸다.
- **Kling 3.0 Omni는 공식 API가 훨씬 싸다.** Sunra `$0.42/초`는 공식 720p의 3.75배다. 다만 Sunra 상품은 4K 표기라 같은 해상도 비교는 아니다.
- **인물 렌더 백업으로는 지금 쓸 수 없다.** Sunra 업로드 파일 URL은 공개이고 만료되지 않으며, 본인 인증 자산(`asset://`) 경로가 없다. 그래서 어댑터는 이미지가 하나도 없는 작업만 받는다.

## 영상 원가 비교

Seedance 토큰은 ModelArk 공식(`픽셀 × 24 × 초 / 1024`)으로 계산한 9:16, 입력 영상 없음 기준이다. Sunra 공식은 프레임에 1을 더해(`24×초+1`) 값이 아주 조금 더 크며 표에는 반영하지 않았다. 판매가는 바꾸지 않는다.

| 모델 | 조건 | 현재 제공사 | Sunra 표시가 | Sunra +5% 수수료 |
| --- | --- | --- | --- | --- |
| Seedance 2.0 | 720p 5초 (108,000토큰) | ModelArk $0.756 ($7.00/M) | $0.710 ($6.57/M) | $0.745 |
| Seedance 2.0 | 720p 15초 (324,000토큰) | $2.268 | $2.129 | $2.235 |
| Seedance 2.0 | 1080p 5초 (243,000토큰) | $1.871 ($7.70/M) | $1.771 ($7.29/M) | $1.860 |
| Seedance 2.5 | 720p 5초 (108,000토큰) | $1.156 ($10.70/M) | $1.156 ($10.70/M) | $1.213 |
| Seedance 2.5 | 1080p 5초 (243,000토큰) | $2.843 ($11.70/M) | $2.843 ($11.70/M) | $2.985 |
| Kling 3.0 Omni | 720p 5초 | Kling 공식 $0.56 ($0.112/초, 오디오) | $2.10 ($0.42/초, 4K 상품) | $2.205 |
| Kling 4.0 | 720p 5초 | Kling 공식 $0.785 ($0.157/초) | $0.785 ($0.157/초) | $0.824 |
| Kling 4.0 | 1080p 5초 | $1.175 ($0.235/초) | $1.178 ($0.2355/초) | $1.236 |

현재 제공사 단가 출처는 `lib/ark/pricing.ts`(2026-10-09 확인), `lib/kling/models.ts`(2026-10-24 확인)이다.

Sunra 영상은 제출할 때 잔액을 먼저 묶는다. 표시된 묶음액은 Seedance 2.0 $8, 2.5 $18, Mini $2다. 건당 원가보다 훨씬 큰 잔액이 있어야 제출할 수 있다.

## 이미지 원가 비교

| 모델 | 조건 | 현재 제공사 (`lib/images/engines.ts`) | Sunra 표시가 |
| --- | --- | --- | --- |
| Seedream 5.0 Pro | 2K | ModelArk $0.09, 참조 $0.003 | $0.09, 2번째 참조부터 $0.004 |
| Nano Banana 2.1 | 2K | Gemini 어림값 $0.0504 | $0.050 |
| GPT Image 2 | 토큰 | 입력 $5/M, 이미지 입력 $8/M, 출력 $30/M | 같음 |

## 공식 문서로 확인한 사실

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| 운영사 | Second Enlightenment Global Private Limited, 싱가포르 UEN 202530874K | [Terms](https://sunra.ai/terms) §1, §23 |
| 인증 | `Authorization: Key $SUNRA_KEY` | [Authentication](https://docs.sunra.ai/platform/authentication.md) |
| 비동기 | 제출, 상태, 결과, 취소 큐. 종료 시 webhook, 최대 3회 재시도 | [Queue](https://docs.sunra.ai/multimodal/queue.md) |
| 입력 파일 | 업로드 `file_url`은 공개, 만료 없음. 본문 100 KiB 제한이라 base64는 약 75 KiB까지 | [File upload](https://docs.sunra.ai/platform/file-upload.md) |
| 실패 과금 | 실패한 예측은 청구하지 않음 | [Errors](https://docs.sunra.ai/platform/errors.md) |
| 학습 | 입력과 출력을 학습에 쓰지 않음. 모델 제공사의 같은 약속은 "확보 중" | [Terms](https://sunra.ai/terms) §9, [Privacy](https://sunra.ai/privacy) §4 |
| 보관 | 삭제나 탈퇴까지 보관, 이후 30일 안에 운영 시스템에서 제거. 고정 보관 기간 없음 | Terms §9.2, Privacy §7 |
| 위치 | 파일은 싱가포르, 모델 제공사는 미국 등에서도 처리 | Privacy §6 |
| 인증서 | SOC 2, ISO 27001 아직 없음 | Privacy §8 |
| 인물 | 등장 인물 동의를 이용자가 보증. 동의 없는 실존 인물 묘사 금지 | Terms §8.4, §10 |
| 생체정보 | 얼굴 처리에 대한 별도 조항 없음 | Privacy §2 |

찾지 못한 것: 결과 URL 보관 기간, Seedance 실존 인물 얼굴 처리 방식, Kling 3.0 Omni의 해상도별 가격. 가격은 [Pricing](https://docs.sunra.ai/platform/pricing.md)과 `https://api.sunra.ai/v1/pricing/model/{model_id}/endpoint/{endpoint}`에서 읽었다.

## 구현 범위

- 어댑터: `lib/sunra/client.ts`, 연결은 `lib/renders/engines.ts`.
- 스위치: `SUNRA_VIDEO_BACKUP=on`일 때만, 이미지 없는 Seedance 작업만 Sunra로 간다. 기본은 꺼짐이다.
- 사진, 인증 자산, 참조가 있는 작업은 플래그와 무관하게 원래 제공사와 검증 경로로 간다.
- 자동 전환 없음. 엔진 ID 추가 없음. `MAKER_ENGINE_IDS` 변경 없음.
- 켜기 전 `0072_core_render_provider_sunra` 클라우드 적용이 필요하다.

## 스모크 결과

2026-10-31 실측, 생성 전 중단, 비용 $0. `npm run sunra:smoke`(인물 없는 이미지, 표시가 $0.045)가 HTTP 412 `INSUFFICIENT_CREDIT`로 끝났고 잔액은 $0.00이었다. 키가 잔액 확인 단계까지 통과했고 제출 경로와 오류 해석도 실제 응답으로 맞았다. 상태 조회, 결과, 영상 입력 스키마의 실제 호출은 확인하지 못했다. 잔액이 생기면 같은 명령을 다시 돌린다.

## 대표 결정 항목

1. 운영 키 등록과 `SUNRA_VIDEO_BACKUP` 사용 여부.
2. 인물 렌더까지 넓힐지 여부. 넓히려면 Sunra에 공개 URL 없는 입력 방식, 보관 기간, 모델 제공사 약속을 서면으로 확인하고 개인정보 문서의 국외 이전 항목을 검토해야 한다.
3. 잔액 충전 여부. 충전액에 5% 수수료가 붙고, 영상은 묶음액만큼 잔액이 필요하다.
