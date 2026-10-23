# 내 사진 여러 장 + "이 얼굴로 만들까요?" — QA 증거 (2026-10-22)

설계: [docs/IDENTITY-SELFIE.md](../../IDENTITY-SELFIE.md) §3·§4. 요구 원본: `docs/PLATFORM-2.0.md` §4.

## 어떻게 찍었나
- 로컬 `npm run dev:free`(픽스처 계정 `free@playbook.test`, `PLAYBOOK_DEV_IDENTITY`) + `RENDER_PIPELINE_PUBLIC=on`(로컬은 비운영이라 테스트 키 없이 스튜디오만 열림). 한도는 단계마다 `IDENTITY_SELFIE_LIMIT=10` → `3` → `1`로 서버를 다시 띄웠다.
- 사진은 **실제 API**(`POST /api/identity/selfie`, 동의 포함)로 저장했다. 원본은 사이트에 이미 공개된 AI 생성 가이드 이미지 `public/images/portrait-guide/front-facing.webp` 한 장이고, 좌우 반전·크롭·색 보정으로 **같은 사람의 사진 세 장**을 만들었다(실제 인물 사진 없음).
- 화면은 헤드리스 Edge(CDP)로 휴대폰 390×844(DPR 2, 터치·모바일 UA)와 데스크톱 1280×900에서 찍었다. Next 개발 표시기만 숨겼다.
- 키보드 확인은 실제 키 이벤트(`Input.dispatchKeyEvent`)로 했다.

## 스크린샷
| 파일 | 상태 |
| --- | --- |
| `mobile-studio-confirm-ko.jpg` | 저장 사진이 있을 때 스튜디오: 기본 사진 크게 + "이 얼굴로 만들까요?" + [이 사진으로 만들기](48px) [다른 사진 고르기](44px). 결제 버튼은 비활성 + "어떤 얼굴로 만들지 먼저 골라주세요." |
| `mobile-sheet-grid-ko.jpg` | [다른 사진 고르기] → 바텀시트(`aria-modal`): "10장 중 3장", 썸네일(기본 뱃지·선택 표시), 새로 찍기(휴대폰만)/사진 올리기, "본인 사진만" 안내 |
| `mobile-studio-chosen-ko.jpg` | 두 번째 사진을 고른 뒤: 작은 사진 + "이 얼굴로 만들어요", 결제 버튼 활성·초점 |
| `mobile-sheet-full-ko.jpg` | 한도 3에서 3장: "3장 중 3장", 추가 버튼 없이 "사진은 3장까지 둘 수 있어요. 새 사진은 표시된 사진과 바꿔요." + [사진 바꾸기] |
| `mobile-sheet-one-ko.jpg` | 한도 1(기본값): 사진 한 장, 카운터·뱃지 없음, "새 사진을 올리면 지금 사진과 바꿔요…" + [사진 바꾸기] |
| `mobile-account-grid-ko.jpg` | 계정 카드: 한 줄씩(썸네일 + "사진 N"/메모 + 저장일 + [기본으로][메모][삭제]), "10장 중 3장", [사진 추가 →] |
| `mobile-account-delete-confirm-ko.jpg` | [삭제] → "이 사진을 지울까요? 이미 결제한 작품은 그대로예요." [지우기][그대로 두기](초점) |
| `mobile-account-one-ko.jpg` | 한도 1: 사진 한 장, [기본으로]·카운터 없음, [사진 바꾸기] |
| `mobile-selfie-page-ko.jpg` | `/identity/selfie`: 관리 그리드 + [사진 추가] + "템플릿으로/영상 포맷 고르기" |
| `mobile-studio-empty-ko.jpg` | 마지막 사진까지 지운 뒤 스튜디오: PR #76 인라인 업로더로 돌아감 |
| `desktop-studio-confirm-ko.jpg` | 데스크톱 스튜디오: 왼쪽 같은 질문 카드, 오른쪽 결제 열(비활성 + 힌트) |
| `desktop-sheet-grid-ko.jpg` | 데스크톱 시트: 같은 구조를 가운데 패널로(카메라 버튼 없음) |
| `desktop-account-grid-ko.jpg` | 데스크톱 계정 카드: 넓은 컨테이너라 3열 카드 |
| `desktop-account-full-ko.jpg` | 한도 3에서 3장: "3장 중 3장" + [사진 바꾸기](`?change=1`) |
| `desktop-selfie-page-add-ko.jpg` | `/identity/selfie?add=1`: 좁은 열이라 한 줄 목록 + 바로 열린 업로더 |

## 키보드·초점 (헤드리스 Edge, 실제 키)
| 확인 | 결과 |
| --- | --- |
| 시트 열기 → 초점 | 이번 주문 사진 타일(`aria-pressed=true`, "사진 1 · 기본 · 2026년 10월 22일 저장") |
| Tab ×7 / Shift+Tab | 시트 밖으로 나가지 않음(닫기 → 타일 3개 → 새로 찍기 → 사진 올리기 → 닫기…) |
| Escape | 시트 닫힘, 페이지 스크롤 잠금 해제, 초점 [다른 사진 고르기]로 복귀(휴대폰·데스크톱) |
| 사진 고르기 | 시트 닫힘, "이 얼굴로 만들어요", 결제 버튼 활성 + 초점 |
| 메모 열기 / Escape | 입력 칸에 초점 / [메모] 버튼으로 복귀 |
| 삭제 / 그대로 두기(Enter) | [그대로 두기]에 초점 / [삭제]로 복귀 |

## 실제 서버로 확인한 API (로컬 dev, 한도 3)
| 요청 | 응답 |
| --- | --- |
| 4번째 사진 추가 | 409 `{ code: 'limit_reached', limit: 3 }` |
| 동의 없이 저장 | 400 `consent_required` |
| `replaceId`로 기본 아닌 사진 교체 | 201, 3장 유지, 기본 그대로 |
| 같은 바이트 다시 | 200 `unchanged` |
| 다른 출처 PATCH | 403, `private, no-store` |
| 교체된 사진 이미지(소유자) | 200(주문 이력용) |
| 삭제 후 그 사진 이미지 | 404, `private, no-store` |

브라우저 창(Claude 앱)에서도 같은 흐름을 손으로 확인했다: 시트 안 업로드(동의 없이 저장 → 동의 칸으로 초점·안내, 동의 후 저장 → 새 사진으로 확정·결제 버튼 초점, 기본 사진 유지), 주문이 고른(기본이 아닌) `selfieId`를 보내는지(요청 가로채기), 서버가 `selfie_required`를 돌려줄 때 남은 사진으로 다시 묻고 "사진 목록이 바뀌었어요" 안내.
