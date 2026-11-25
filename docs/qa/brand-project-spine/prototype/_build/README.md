# 프로젝트 뼈대 시안: 다시 만드는 법

`docs/BRAND-PROJECT-SPINE.md`의 시안이다. 앱이 불러오는 파일은 하나도 없다(정적 HTML, 예시 데이터).

## 열어 보기

저장소 루트에서 정적 서버를 띄우고 연다(사진과 글꼴을 `public/`에서 상대 경로로 읽는다).

```powershell
python -m http.server 3148 --bind 127.0.0.1
```

```text
http://127.0.0.1:3148/docs/qa/brand-project-spine/prototype/home.html
```

화면끼리 링크로 이어진다: 레일의 홈·프로젝트·알림함·이미지 스튜디오·에셋, 프로젝트 카드, 사진 타일(보내기), 탭.

## 파일

| 파일 | 무엇 |
| --- | --- |
| `../*.html` | 만들어진 화면 10장. 직접 고치지 않는다 |
| `../spine-app.css` | 앱의 실제 스타일(워크스페이스, 레일, 스튜디오, 대화, 홈, 에셋). 로컬에서 띄운 `origin/main` `3d274a58`에서 받아, 시안이 쓰는 규칙만 남겼다. 고치지 않는다 |
| `../spine-proto.css` | 아직 없는 부분의 스타일. 워크스페이스 토큰만 쓴다 |
| `build.py` | 화면을 만든다. 문구는 맨 위 `T`에 모여 있다 |
| `shell.html` | 실제 레일과 바깥 틀(조직 id와 이름을 지우고 예시로 바꿨다). 레일에 "프로젝트"·"알림함" 두 줄을 시안으로 더했다 |
| `frag-*.html` | 실제 화면에서 가져온 조각: 홈 입력창, 스튜디오 머리말과 입력창, 에셋 머리말, 알림함 머리말, 대화 입력칸 |

## 다시 만들기

문구나 구성을 고친 뒤:

```powershell
python docs/qa/brand-project-spine/prototype/_build/build.py
```

새 화면이 앱의 다른 클래스를 쓰게 되면 `spine-app.css`에 그 규칙이 없을 수 있다. 그때는 로컬 서버(`npm run db:local -- --dir .pglite/dev` 뒤 `next dev`)에서 스타일을 다시 받아 추려야 한다. 캡처·추리기 스크립트는 저장소 밖 세션 노트 폴더 `brand-project-spine/`에 있다.

## 지킨 것

- 사진은 저장소의 `public/reel/landing`, `public/reel/brands`(닫힌 조직의 영상·사진 제외), `public/reel/studio`만 썼다.
- 사람·브랜드·프로젝트 이름과 숫자는 모두 지어낸 것이다.
- 화면에 모델·엔진·내부 도구 이름을 쓰지 않았다(실제 입력창의 모델 칩은 시안에서 뺐다).
- 모든 화면의 레일 가운데 점선 상자에 "시안(목업)"과 만들어야 하는 것을 적었다.
