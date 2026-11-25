"""Builds the static candidate screens for docs/BRAND-PROJECT-SPINE.md.

    python docs/qa/brand-project-spine/prototype/_build/build.py

Inputs (this folder): shell.html (the real workspace shell, captured from a local run and sanitized),
frag-*.html (real fragments: home prompt bar, studio head and dock, asset hub head, inbox head, composer).
Output: ../*.html. Styles: ../spine-app.css (the app's own CSS, pruned to what these pages use) and
../spine-proto.css (only what does not exist yet). Invented names and in-repo pictures only.
Nothing here is imported by the app.
"""
from __future__ import annotations

import pathlib
import re

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent
R = "../../../../public/reel/"

SHELL_RAW = (HERE / "shell.html").read_text(encoding="utf-8")
HTML_TAG, SHELL = SHELL_RAW.split("\n", 1)


def frag(name: str) -> str:
    return (HERE / f"frag-{name}.html").read_text(encoding="utf-8")


CHEV = '<svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"></path></svg>'
ARROW = '<svg class="home_lineArrow__GTfyw" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"></path></svg>'
X = '<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>'
HEART = '<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.2S2.6 10 2.6 6.3A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5.4 1.3C13.4 10 8 13.2 8 13.2z"></path></svg>'
PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"></path></svg>'
SEARCH = '<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2"></circle><path d="M10.2 10.2 13 13"></path></svg>'
PLUS = '<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"></path></svg>'
CHECK = '<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.6 11.5 12.5 4.8"></path></svg>'
FOLDER0 = '<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke-dasharray="2 2"></rect></svg>'

# ---------------------------------------------------------------- wording (candidates; 대표 확인 대기)
T = {
    "news_kicker": "새 소식",
    "news_title": "[예시] 새 기능이나 할인 소식이 이 자리에 한 줄로 들어갑니다",
    "news_cta": "자세히 보기",
    "save_to": "저장 위치",
    "unfiled": "미분류",
    "check_label": "확인할 것",
    "team_label": "야기 팀과",
    "projects_title": "진행 중인 프로젝트",
    "projects_all": "전체 프로젝트",
    "project_new": "새 프로젝트 만들기",
    "unfiled_say": "프로젝트 없이 만든 파일 14개",
    "unfiled_cta": "프로젝트로 옮기기",
    "empty_say": "프로젝트로 묶으면 파일과 팀 대화를 한곳에서 볼 수 있습니다.",
    "recent": "최근 작업물",
    "all_assets": "전체 에셋",
    "continue": "이어서 만들기",
    "to_team": "야기 팀에 맡기기",
    "tab_files": "파일",
    "tab_films": "편집본",
    "tab_talk": "대화",
    "lane_note": "이 대화는 워크스페이스 멤버만 봅니다.",
    "send": "보내기",
    "send_help": "받는 사람의 알림함과 프로젝트 대화에 올라갑니다.",
    "send_hint": "@로 받는 사람을 고릅니다",
    "members": "멤버",
    "not_member": "멤버가 아닌 주소",
    "invite_help": "초대장을 보내고 수락하면 이 메시지가 전달됩니다",
    "invite_send": "초대하고 보내기",
    "open_file": "파일 열기",
    "reply_ph": "답글 남기기",
    "pop_search": "프로젝트 찾기",
    "pop_unfiled_sub": "프로젝트 없이 저장",
    "pop_foot": "새 결과가 선택한 프로젝트에 저장됩니다. 다른 스튜디오로 옮겨도 유지됩니다.",
    "brand_material": "브랜드 자료",
    "brand_material_meta": "모든 프로젝트에서 함께 씁니다",
    "by_project": "프로젝트별",
    "all_files": "모든 파일",
    "see_all": "모두 보기",
}

P1, P2, P3, P4 = "봄 향수 론칭", "데님 룩북 26SS", "겨울 립 컬렉션 필름", "홈 프래그런스 화이트"
SEOA, DOYUN, HARIN = "김서아", "박도윤", "이하린"


def img(path: str, alt: str = "") -> str:
    return f'<img src="{R}{path}" alt="{alt}" decoding="async">'


def tile(path: str, ratio: float, badge: str = "", href: str = "viewer-send.html", picked: bool = False) -> str:
    b = f'<span class="sp-badge">{badge}</span>' if badge else ""
    p = " data-picked" if picked else ""
    return f'<a class="sp-tile sp-plain" style="--r:{ratio}" href="{href}"{p}>{img(path)}{b}</a>'


def wall(rows: list[list[tuple]], pad_last: float = 0.0) -> str:
    out = []
    for i, row in enumerate(rows):
        cells = "".join(tile(*c) for c in row)
        if pad_last and i == len(rows) - 1:
            cells += f'<span class="sp-wall-pad" style="--r:{pad_last}"></span>'
        out.append(f'<div class="sp-wall-row">{cells}</div>')
    return f'<div class="sp-wall">{"".join(out)}</div>'


def avatar(name: str, size: str = "", tone: str = "") -> str:
    s = f' data-size="{size}"' if size else ""
    t = f' data-tone="{tone}"' if tone else ""
    return f'<span class="sp-avatar"{s}{t} aria-hidden="true">{name[0]}</span>'


def note(built: str) -> str:
    screens = [("home.html", "홈"), ("home-empty.html", "프로젝트 없는 홈"), ("project.html", "프로젝트"), ("assets.html", "에셋"),
               ("viewer-send.html", "보내기"), ("project-talk.html", "대화"), ("inbox.html", "알림함"), ("studio-picker.html", "프로젝트 고르기")]
    links = " · ".join(f'<a class="sp-link" href="{h}">{n}</a>' for h, n in screens)
    return (f'<aside class="sp-note" data-mock-note="true"><strong>시안(목업)입니다</strong>'
            f'<span>눌러도 실제로 동작하지 않습니다. 이름·사진·숫자는 모두 예시입니다.</span>'
            f'<span><b>만들어야 하는 것</b> {built}</span><span class="sp-note-links">{links}</span></aside>')


def page(name: str, title: str, rail: str, main: str, built: str, overlay: str = "") -> None:
    shell = SHELL.replace("{{MAIN}}", main)
    shell = shell.replace(f'data-rail-item="{rail}"', f'data-rail-item="{rail}" aria-current="page"', 1)
    html = (f"<!doctype html>\n{HTML_TAG}\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<meta name=\"robots\" content=\"noindex\"><title>{title} · 프로젝트 뼈대 시안</title>"
            f"<link rel=\"stylesheet\" href=\"spine-app.css\"><link rel=\"stylesheet\" href=\"spine-proto.css\"></head>\n"
            f"<body>{shell}{overlay}{note(built)}</body></html>\n")
    (OUT / f"{name}.html").write_text(html, encoding="utf-8")


# ---------------------------------------------------------------- shared pieces
def news(variant: str = "banner") -> str:
    v = ' data-variant="line"' if variant == "line" else ""
    return (f'<section class="sp-news"{v} data-news-slot="true" aria-label="{T["news_kicker"]}">'
            f'<div class="sp-news-media">{img("landing/cut-pump.webp")}</div>'
            f'<div class="sp-news-copy"><span class="sp-news-kicker">{T["news_kicker"]}</span>'
            f'<h2 class="sp-news-title">{T["news_title"]}</h2>'
            f'<div class="sp-news-actions"><a class="bs-btn sp-plain" data-variant="soft" data-size="sm" href="#">{T["news_cta"]}</a></div></div>'
            f'<button type="button" class="sp-news-close" aria-label="닫기">{X}</button></section>')


def home_prompt() -> str:
    f = frag("home-prompt")
    chip = (f'<span class="sp-save-to">{T["save_to"]}<button type="button" class="bs-chip-btn">'
            f'<span class="bs-chip-value">{T["unfiled"]}</span>{CHEV}</button></span>')
    return f.replace("</fieldset>", "</fieldset>" + chip, 1)


def line(title: str, project: str, meta: str, href: str = "inbox.html") -> str:
    proj = f'<span class="home_lineProject__VZkE_">{project}</span>' if project else ""
    return (f'<li><a href="{href}" class="home_line__hZp4_"><span class="home_lineTitle__OeyZ6">{title}</span>'
            f'<span class="home_lineMeta__zUlxD">{proj}<span>{meta}</span></span>{ARROW}</a></li>')


def home_lines(with_share: bool = True) -> str:
    check = ""
    if with_share:
        rows = line(f"{DOYUN} 님이 이미지를 보냈습니다", P1, "“립 컬러는 이 컷이 제일 자연스러워요.”")
        rows += line(f"{HARIN} 님이 영상을 보냈습니다", P2, "“룩 3번 초안이에요. 걸음 속도 봐 주세요.”")
        rows += line(f"{P3} 시안 v2", "", "야기 팀이 올린 시안 · 확인 대기", "project.html")
        check = (f'<div class="home_lineGroup__Ttnzc"><h2 class="home_lineLabel__nfhJS"><span>{T["check_label"]}</span><span class="home_count__wbf21">3</span></h2>'
                 f'<ul class="home_lineRows__gKN42">{rows}</ul></div>')
    return (f'<div class="home_lines__VSvH4" data-home-lines="true">{check}'
            f'<div class="home_lineGroup__Ttnzc"><h2 class="home_lineLabel__nfhJS"><span>{T["team_label"]}</span></h2>'
            f'<div class="home_teamRow__TXxva"><span class="home_teamSay__zrVBj">요청 사항을 적어 야기 팀에 제작을 맡겨요.</span>'
            f'<a href="#" class="home_textLink__tWsT1 home_rowAction__bixcW">새 프로젝트 의뢰</a></div></div></div>')


def card(title: str, covers: list[str], meta: str, activity: str, pill: str = "") -> str:
    p = f'<span class="sp-count">{pill}</span>' if pill else ""
    return (f'<li><a class="sp-card sp-plain" href="project.html"><div class="sp-cover">{"".join(img(c) for c in covers)}</div>'
            f'<div class="sp-card-text"><div class="sp-card-title"><span>{title}</span>{p}</div>'
            f'<div class="sp-card-meta">{meta}</div><div class="sp-card-meta">{activity}</div></div></a></li>')


def project_cards() -> str:
    cards = "".join([
        card(P1, ["landing/cut-hands.webp", "landing/cut-beads.webp", "landing/cut-mark.webp"], "이미지 24 · 영상 6 · 사운드 2",
             f"2시간 전 · {SEOA} 님이 영상을 추가했습니다", "새 메시지 2"),
        card(P2, ["landing/look-street.webp", "landing/look-knit.webp", "landing/look-sculpt.webp"], "이미지 38 · 영상 3",
             f"어제 · {HARIN} 님이 이미지 12장을 만들었습니다", "새 메시지 1"),
        card(P3, ["landing/c-skin-ours.webp", "landing/entry-lead.jpg", "landing/c-skin-wide.webp"], "야기 팀과 · 시안 v2 확인 대기",
             "오늘 오전 · 야기 팀이 시안 v2를 올렸습니다"),
        card(P4, ["landing/c-garment-wide.webp", "landing/c-logo-ours.webp", "landing/c-logo-wide.webp"], "이미지 16 · 사운드 1",
             f"11월 21일 · {DOYUN} 님이 이미지를 올렸습니다"),
        card("겨울 화보 무드 탐색", ["brands/city-fashion.jpg", "brands/slot-3-pose-lowangle-lookbook.jpg", "brands/slot-2-space-concrete-blue.jpg"], "이미지 9",
             f"11월 19일 · {SEOA} 님이 이미지를 만들었습니다"),
        card("12월 매장 포스터", ["brands/tea-editorial.jpg", "brands/slot-4-color-french-cobalt.jpg", "brands/slot-1-subject-editorial.jpg"], "이미지 12 · 영상 1",
             f"11월 18일 · {HARIN} 님이 영상을 추가했습니다"),
    ])
    return (f'<section class="sp-section" data-home-projects="true"><div class="sp-section-head"><h2 class="sp-section-title">{T["projects_title"]}</h2>'
            f'<div class="sp-section-side"><a class="sp-link" href="studio-picker.html">{T["project_new"]}</a><a class="sp-link" href="project.html">{T["projects_all"]}</a></div></div>'
            f'<ul class="sp-cards">{cards}</ul></section>')


def loose_row() -> str:
    thumbs = "".join(img(p) for p in ["brands/city-fashion.jpg", "brands/tea-editorial.jpg", "studio/vto-free-drape.webp", "landing/ad-denim.webp", "studio/vto-free-mirror.webp"])
    return (f'<div class="sp-loose" data-home-unfiled="true"><span class="sp-loose-label">{T["unfiled"]}</span>'
            f'<div class="sp-loose-thumbs">{thumbs}</div><span class="sp-loose-say">{T["unfiled_say"]}</span>'
            f'<a class="sp-link" href="assets.html">{T["unfiled_cta"]}</a></div>')


def home_main(body: str, state: str) -> str:
    return (f'<div class="home_home__zbhkq" data-workspace-home="mock" data-home-mode="make" data-home-state="{state}">'
            f'<h1 class="home_name__5Ztwq">루미에르 코스메틱 작업공간</h1>{body}</div>')


# ---------------------------------------------------------------- (a) home, (a′) news as one line, (b) no project yet
HOME_BUILT = "프로젝트 카드 조회, 소식 칸과 관리 화면, 받은 공유 줄, 미분류 줄. 입력창과 레일은 지금 화면 그대로입니다."
page("home", "홈", "home",
     home_main(news() + home_prompt() + home_lines() + f'<div class="sp-home-extra">{project_cards()}{loose_row()}</div>', "projects"), HOME_BUILT)
page("home-line", "홈 (소식 한 줄형)", "home",
     home_main(news("line") + home_prompt() + home_lines() + f'<div class="sp-home-extra">{project_cards()}{loose_row()}</div>', "projects"), HOME_BUILT)

recent = wall([
    [("landing/cut-pump.webp", 1.79, ""), ("landing/look-knit.webp", 0.667, ""), ("landing/cut-cheek.webp", 1.79, "0:05")],
    [("landing/look-street.webp", 0.667, ""), ("landing/cut-hands.webp", 1.79, ""), ("landing/c-skin-wide.webp", 0.75, ""), ("landing/grid-5.webp", 1.0, "")],
])
empty_body = (news() + home_prompt() + home_lines(False)
              + f'<div class="sp-home-extra"><div class="sp-hintline"><p>{T["empty_say"]}</p>'
              f'<a class="bs-btn sp-plain" data-variant="soft" data-size="sm" href="studio-picker.html">{PLUS}<span>{T["project_new"]}</span></a></div>'
              f'<section class="sp-section" style="margin-top:28px"><div class="sp-section-head"><h2 class="sp-section-title">{T["recent"]}</h2>'
              f'<div class="sp-section-side"><a class="sp-link" href="assets.html">{T["all_assets"]}</a></div></div>{recent}</section></div>')
page("home-empty", "홈 (프로젝트 없음)", "home", home_main(empty_body, "no-project"),
     "프로젝트가 없을 때의 안내 줄과 ‘새 프로젝트’. 최근 작업물 벽은 지금 화면과 같습니다(미분류 파일).")


# ---------------------------------------------------------------- (c) project page
def seg(tabs: list[tuple[str, str, str, bool]]) -> str:
    out = ""
    for label, num, href, on in tabs:
        n = f'<span class="asset-hub_segNum__HAfjg">{num}</span>' if num else ""
        go = f"location.href='{href}'"
        out += (f'<button type="button" role="tab" class="asset-hub_segBtn__P_pIH" aria-selected="{"true" if on else "false"}" onclick="{go}"><span>{label}</span>{n}</button>')
    return f'<div class="asset-hub_segTrack__WJMsR" role="tablist">{out}</div>'


def project_head(active: str) -> str:
    people = "".join(avatar(n, tone=t) for n, t in [(SEOA, ""), (DOYUN, "b"), (HARIN, ""), ("최", "b")])
    tabs = seg([(T["tab_files"], "42", "project.html", active == "files"), (T["tab_films"], "2", "project.html", False), (T["tab_talk"], "3", "project-talk.html", active == "talk")])
    return (f'<div class="sp-crumb"><a class="sp-plain" href="home.html">프로젝트</a><span>/</span><span>직접 만들기</span></div>'
            f'<div class="sp-page-head"><div><h1 class="sp-h1">{P1}</h1><div class="sp-muted sp-num">멤버 4명 · 마지막 작업 2시간 전</div></div>'
            f'<div class="sp-head-actions"><div class="sp-people">{people}</div>'
            f'<button type="button" class="bs-btn" data-variant="soft" data-size="sm">{T["to_team"]}</button>'
            f'<a class="bs-btn sp-plain" data-variant="solid" data-size="sm" href="studio-picker.html">{T["continue"]}</a></div></div>'
            f'<div class="sp-tabs-row">{tabs}<div class="sp-side"><button type="button" class="bs-btn" data-variant="soft" data-size="sm">파일 올리기</button></div></div>')


def kind(title: str, count: str, body: str, more: bool = True) -> str:
    m = f'<a class="sp-link" href="assets.html">{T["see_all"]}</a>' if more else ""
    return f'<section class="sp-kind"><div class="sp-kind-head"><h2>{title}</h2><span class="sp-muted sp-num">{count}</span>{m}</div>{body}</section>'


images = wall([
    [("landing/cut-hands.webp", 1.79, ""), ("landing/grid-4.webp", 1.0, ""), ("landing/cut-beads.webp", 1.79, ""), ("landing/grid-5.webp", 1.0, "")],
    [("landing/grid-1.webp", 1.0, ""), ("landing/cut-mark.webp", 1.79, ""), ("landing/highteen-product.webp", 0.75, ""), ("landing/cut-cheek.webp", 1.79, ""), ("landing/grid-7.webp", 1.0, "")],
])
videos = wall([[("landing/cut-scent.webp", 1.79, "0:05"), ("landing/cut-pump.webp", 1.79, "0:05"), ("landing/entry-fur.jpg", 0.5625, "0:08"), ("brands/studio-editorial-blue-1080p.jpg", 0.5625, "0:15")]], pad_last=1.6)
films = (f'<ul class="sp-films"><li class="sp-film"><div class="sp-film-poster">{img("landing/entry-lead.jpg")}<span class="sp-badge">0:30</span></div>'
         f'<div><strong>론칭 티저 30초</strong><span class="sp-muted">편집 중 · 어제 저장</span></div></li>'
         f'<li class="sp-film"><div class="sp-film-poster">{img("landing/entry-fur.jpg")}<span class="sp-badge">0:15</span></div>'
         f'<div><strong>세로형 15초 컷</strong><span class="sp-muted">내보냄 · 11월 22일</span></div></li></ul>')
sounds = (f'<ul class="sp-sounds">'
          f'<li class="sp-sound"><button type="button" class="sp-play" aria-label="재생">{PLAY}</button><strong>티저 배경 음악</strong><div class="sp-wave"></div><span class="sp-muted sp-num">0:30</span></li>'
          f'<li class="sp-sound"><button type="button" class="sp-play" aria-label="재생">{PLAY}</button><strong>분사 효과음</strong><div class="sp-wave"></div><span class="sp-muted sp-num">0:02</span></li></ul>')
uploads = wall([[("landing/c-garment-ours.webp", 1.0, ""), ("brands/swap-product-luxury-bottle.jpg", 0.8, ""), ("landing/c-logo-ours.webp", 1.0, ""), ("brands/slot-4-color-french-cobalt.jpg", 0.8, "")]], pad_last=5.2)

project_files = (f'<div class="sp-page" data-project-page="mock">{project_head("files")}'
                 + kind("이미지", "24", images) + kind("영상", "6", videos) + kind(T["tab_films"], "2", films, more=False)
                 + kind("사운드", "2", sounds, more=False) + kind("올린 자료", "10", uploads) + "</div>")
PROJECT_BUILT = "프로젝트 페이지 전체(종류별 파일, 편집본, 대화 탭), 사운드가 프로젝트에 담기는 것, 편집본 서버 저장, ‘야기 팀에 맡기기’."
page("project", P1, "projects", project_files, PROJECT_BUILT)


# ---------------------------------------------------------------- conversation with the share card
def msg(name: str, time: str, body: str, extra: str = "", size: str = "", tone: str = "") -> str:
    return (f'<div class="sp-msg">{avatar(name, size, tone)}<div><div class="sp-msg-head"><strong>{name}</strong><span class="sp-muted sp-num">{time}</span></div>'
            f'<p class="sp-msg-body">{body}</p>{extra}</div></div>')


def asset_card(path: str, title: str, meta: str) -> str:
    return (f'<a class="sp-asset-card sp-plain" href="viewer-send.html">{img(path)}<div><strong>{title}</strong>'
            f'<span class="sp-muted">{meta}</span><br><span class="sp-link">{T["open_file"]}</span></div></a>')


def mention(name: str) -> str:
    return f'<span class="sp-mention">@{name}</span>'


share_thread = msg(
    SEOA, "오후 2:31", f"{mention(DOYUN)} 립 컬러는 이 컷이 제일 자연스러워요. 메인으로 어때요?",
    asset_card("landing/cut-hands.webp", "이미지", f"{P1} · 생성 결과")
    + '<div class="sp-replies">'
    + msg(DOYUN, "오후 2:40", "좋아요. 배경만 조금 더 밝게 한 버전도 볼 수 있을까요?", size="sm", tone="b")
    + msg(SEOA, "오후 2:44", "밝게 한 버전 만들어서 다시 보낼게요.", size="sm")
    + f'</div><div class="sp-replybox">{T["reply_ph"]}</div>')
older_thread = msg(
    HARIN, "오전 11:02", f"{mention(SEOA)} 15초 컷 초안입니다. 음악은 아직 가이드예요.",
    asset_card("landing/cut-scent.webp", "영상 · 0:15", f"{P1} · 생성 결과") + '<div class="sp-muted" style="margin-top:8px">답글 1 · 오전 11:20</div>', tone="b")

talk = (f'<div class="sp-page" data-project-page="mock">{project_head("talk")}'
        f'<div class="sp-lane"><span class="sp-count">우리 팀</span><span class="sp-lane-note">{T["lane_note"]}</span></div>'
        f'<div class="sp-thread"><div class="sp-day">오늘</div>{older_thread}{share_thread}</div>'
        f'<div style="max-width:760px;margin-top:28px">{frag("composer").replace("일반 문의에 메시지 남기기", "메시지 남기기. @로 멤버를 부릅니다")}</div></div>')
page("project-talk", f"{P1} · 대화", "projects", talk,
     "파일에 붙는 대화 카드, 프로젝트 대화의 ‘우리 팀’ 구분, 답글. 입력창 모양은 지금 대화 화면 그대로입니다.")


# ---------------------------------------------------------------- (e) viewer with 보내기 open
def viewer(invite: bool) -> str:
    if invite:
        picker = (f'<div class="sp-picker" data-mention-picker="invite"><div class="sp-picker-label">{T["not_member"]}</div>'
                  f'<div class="sp-picker-row" data-active><span class="sp-dash">{PLUS}</span><div><strong>mina@example.com</strong><br><span class="sp-muted">{T["invite_help"]}</span></div>'
                  f'<kbd>{T["invite_send"]}</kbd></div></div>')
        typed = f'{mention(DOYUN)} 립 컬러는 이 컷이 제일 자연스러워요. 메인으로 어때요? @mina@example.com<span class="sp-caret"></span>'
    else:
        picker = (f'<div class="sp-picker" data-mention-picker="members"><div class="sp-picker-label">{T["members"]}</div>'
                  f'<div class="sp-picker-row" data-active>{avatar(HARIN, "sm")}<div><strong>{HARIN}</strong> <span class="sp-muted">편집자</span></div><kbd>Enter</kbd></div>'
                  f'<div class="sp-picker-row">{avatar("이준서", "sm", "b")}<div><strong>이준서</strong> <span class="sp-muted">보기 전용</span></div><span></span></div></div>')
        typed = f'{mention(DOYUN)} 립 컬러는 이 컷이 제일 자연스러워요. 메인으로 어때요? @이<span class="sp-caret"></span>'
    acts = "".join(f'<button type="button" class="sp-act" aria-pressed="{"true" if a == T["send"] else "false"}">{a}</button>'
                   for a in ["이미지 스튜디오로", "꾸미기", "영상 만들기", T["send"], "비슷한 항목"])
    return (f'<div class="sp-scrim" data-viewer="mock"><div class="sp-viewer" role="dialog" aria-label="이미지">'
            f'<div class="sp-viewer-stage">{img("landing/cut-hands.webp")}</div>'
            f'<div class="sp-viewer-side"><div class="sp-viewer-top"><span class="sp-muted">생성 결과</span><span style="margin-left:auto"></span>'
            f'<button type="button" class="sp-icon-btn" aria-label="좋아요">{HEART}</button><a class="sp-icon-btn sp-plain" href="project.html" aria-label="닫기">{X}</a></div>'
            f'<button type="button" class="sp-where">{P1}{CHEV}</button>'
            f'<p class="sp-prompt-text">눈을 감은 모델이 파란 하트 향수병을 볼에 대고 있는 클로즈업. 창가에서 들어오는 부드러운 빛, 옅은 하늘색 배경.</p>'
            f'<div class="sp-acts">{acts}</div>'
            f'<div class="sp-send"><h3>{T["send"]}</h3><span class="sp-muted">{T["send_help"]}</span>'
            f'<div class="sp-earlier">{avatar(DOYUN, "sm", "b")}<p>배경이 조금 더 밝으면 좋겠어요.</p><span class="sp-muted sp-num">어제 · 답글 1</span></div>'
            f'<div class="sp-composer">{picker}<p class="sp-composer-text">{typed}</p>'
            f'<div class="sp-composer-foot"><span class="sp-muted">{T["send_hint"]}</span>'
            f'<a class="bs-btn sp-plain" data-variant="solid" data-size="sm" href="project-talk.html">{T["send"]}</a></div></div></div></div></div></div>')


VIEWER_BUILT = "‘보내기’ 전체(@멤버 고르기, 파일에 붙는 대화, 알림), ‘초대하고 보내기’, 파일의 프로젝트 옮기기. 지금의 ‘검수 · 공유’를 이 자리에서 바꿉니다."
page("viewer-send", "보내기", "projects", project_files, VIEWER_BUILT, viewer(False))
page("viewer-invite", "초대하고 보내기", "projects", project_files, VIEWER_BUILT, viewer(True))


# ---------------------------------------------------------------- (f) 알림함
def inbox_item(mark: str, name: str, frm: str, text: str, time: str, unread: bool, current: bool = False) -> str:
    cur = ' aria-current="true"' if current else ""
    dot = '<span class="sp-unread" aria-label="읽지 않음"></span>' if unread else ""
    f = f'<span class="sp-inbox-from"> · {frm}</span>' if frm else ""
    return (f'<li><a href="inbox.html" class="brc-inbox-item sp-plain"{cur}>{mark}'
            f'<span class="brc-inbox-text"><span class="brc-inbox-name">{name}{f}</span><span class="brc-inbox-line">{text}</span></span>'
            f'<span class="brc-inbox-side sp-inbox-side"><time>{time}</time>{dot}</span></a></li>')


def thumb_mark(path: str) -> str:
    return f'<span class="brc-inbox-mark sp-inbox-thumb">{img(path)}</span>'


def icon_mark(i: int) -> str:
    return f'<span class="brc-inbox-mark">{frag(f"inbox-icon-{i}")}</span>'


inbox_list = "".join([
    inbox_item(thumb_mark("landing/cut-hands.webp"), SEOA, P1, "립 컬러는 이 컷이 제일 자연스러워요. 메인으로 어때요?", "오후 2:31", True, True),
    inbox_item(thumb_mark("landing/look-street.webp"), HARIN, P2, "룩 3번 초안이에요. 걸음 속도 봐 주세요.", "오전 11:02", True),
    inbox_item(icon_mark(1), P3, "", "야기 팀: 시안 v2를 올렸습니다.", "어제", False),
    inbox_item(icon_mark(0), "일반 문의", "", "프로젝트와 상관없는 질문", "", False),
])
inbox_thread = msg(
    SEOA, "오후 2:31", f"{mention(DOYUN)} 립 컬러는 이 컷이 제일 자연스러워요. 메인으로 어때요?",
    asset_card("landing/cut-hands.webp", "이미지", f"{P1} · 생성 결과")
    + '<div class="sp-replies">' + msg(SEOA, "오후 2:33", "배경 톤은 지금 그대로 두려고 해요.", size="sm") + "</div>")
inbox = (f'<div class="brc-inbox" data-view="channel" data-room-inbox="true" style="--brc-fit-h: 856px;">'
         f'<nav class="brc-inbox-list">{frag("inbox-head")}<ul>{inbox_list}</ul></nav>'
         f'<div class="brc-inbox-pane"><section class="brc-channel" data-layout="fill">'
         f'<div class="brc-channel-head"><div class="brc-channel-title"><div class="brc-pane-head"><div class="sp-pane-file">{img("landing/cut-hands.webp")}'
         f'<div class="brc-pane-title"><h2>{P1}</h2><p>{SEOA} 님이 보낸 파일입니다. 멤버만 볼 수 있는 대화입니다.</p></div></div></div></div>'
         f'<div class="brc-pinned"><a class="brc-chip sp-plain" href="viewer-send.html"><span>{T["open_file"]}</span></a></div></div>'
         f'<div class="brc-channel-body"><div class="brc-stream-col"><div class="brc-scroll"><div class="brc-stream sp-pane-pad" role="log">'
         f'<div class="sp-thread"><div class="sp-day">오늘</div>{inbox_thread}</div></div></div>'
         f'{frag("composer").replace("일반 문의에 메시지 남기기", T["reply_ph"])}</div></div></section></div></div>')
page("inbox", "알림함", "inbox", inbox,
     "받은 공유가 알림함에 썸네일·보낸 사람·프로젝트와 함께 뜨는 것, 읽음 표시, 직접 만들기 레일의 ‘알림함’ 줄. 알림함의 틀은 지금 화면 그대로입니다.")


# ---------------------------------------------------------------- (g) studio head: project picker
def pop_row(thumb: str, title: str, sub: str, active: bool = False, right: str = "") -> str:
    a = " data-active" if active else ""
    return f'<div class="sp-pop-row"{a}>{thumb}<div><strong>{title}</strong><small>{sub}</small></div>{right}</div>'


pop = (f'<div class="sp-pop" role="listbox" data-project-picker="mock"><div class="sp-pop-search">{SEARCH}<span>{T["pop_search"]}</span></div>'
       + pop_row(img("landing/cut-hands.webp"), P1, "2시간 전", True, CHECK)
       + pop_row(img("landing/look-street.webp"), P2, "어제")
       + pop_row(img("landing/c-skin-ours.webp"), P3, "야기 팀과 · 오늘 오전")
       + pop_row(img("landing/c-garment-wide.webp"), P4, "11월 21일")
       + '<div class="sp-picker-sep"></div>'
       + pop_row(f'<span class="sp-dash">{FOLDER0}</span>', T["unfiled"], T["pop_unfiled_sub"])
       + pop_row(f'<span class="sp-dash">{PLUS}</span>', T["project_new"], "이름만 정하면 바로 시작합니다")
       + f'<p class="sp-pop-foot">{T["pop_foot"]}</p></div>')
chip = (f'<div class="sp-proj"><button type="button" class="sp-proj-chip" aria-haspopup="listbox" aria-expanded="true">'
        f'{img("landing/cut-hands.webp")}<span>{P1}</span>{CHEV}</button>{pop}</div>')
head = frag("studio-head").replace("</h1>", "</h1>" + chip, 1).replace("30,000", "24,360")
head = head.replace('<h1 class="bs-title">', '<div style="display:flex;align-items:center"><h1 class="bs-title">', 1).replace("</h1>" + chip, "</h1>" + chip + "</div>", 1)
studio_wall = wall([
    [("landing/cut-hands.webp", 1.79, ""), ("landing/grid-4.webp", 1.0, ""), ("landing/cut-beads.webp", 1.79, "")],
    [("landing/grid-5.webp", 1.0, ""), ("landing/cut-mark.webp", 1.79, ""), ("landing/highteen-product.webp", 0.75, ""), ("landing/grid-1.webp", 1.0, "")],
])
studio = (f'<div class="bs-page" data-brand-studio-v2="true" data-studio-tab="create" data-studio-screen="image">{head}'
          f'<div class="bs-studio" data-studio-mode="image" data-studio-phase="ready" data-studio-can-create=""><div class="bs-main">'
          f'<section class="bs-wall" data-studio-board="true" data-state="ready"><div class="sp-studio-wall">{studio_wall}</div></section>'
          f'{frag("studio-dock")}</div></div></div>')
page("studio-picker", "이미지 스튜디오 · 프로젝트 고르기", "image", studio,
     "스튜디오 머리말의 프로젝트 칩과 목록(네 스튜디오 공통), 고른 프로젝트에 자동 저장, 미분류. 입력창과 머리말은 지금 화면 그대로입니다.")


# ---------------------------------------------------------------- (d) assets regrouped
def hub_tile(path: str, kind_: str = "image", badge: str = "") -> str:
    b = f'<span class="sp-badge">{badge}</span>' if badge else ""
    return (f'<li class="asset-hub_tile___wppj" data-kind="{kind_}" data-compact=""><a class="asset-hub_tileOpen__XSQH4" href="viewer-send.html">'
            f'{img(path)}{b}</a></li>')


def sound_tile(title: str, length: str) -> str:
    return f'<li class="sp-sound-tile" data-kind="audio"><div class="sp-wave"></div><strong>{title}</strong><span class="sp-badge">{length}</span></li>'


def group(title: str, meta: str, tiles: str, actions: str = "") -> str:
    act = actions or f'<span class="asset-hub_groupMore__uaFLz">{T["see_all"]}<svg class="sp-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"></path></svg></span>'
    return (f'<section class="asset-hub_group__7L5h8"><div class="asset-hub_groupHead__7Dw1S"><h2 class="asset-hub_groupTitle__K6wOY">'
            f'<a class="asset-hub_groupOpen__YXXtn sp-plain" href="project.html">{title}</a></h2><span class="asset-hub_groupMeta__ptB4C">{meta}</span>{act}</div>{tiles}</section>')


brand_strip = ('<ul class="sp-brand-strip">'
               '<li class="sp-brand-set"><span class="sp-muted">로고</span><div><span class="sp-logo-tile">LUMIÈRE</span><span class="sp-logo-tile" data-dark>LUMIÈRE</span></div></li>'
               f'<li class="sp-brand-set"><span class="sp-muted">제품</span><div>{img("landing/grid-5.webp")}{img("brands/swap-product-luxury-bottle.jpg")}{img("landing/c-garment-ours.webp")}</div></li>'
               f'<li class="sp-brand-set"><span class="sp-muted">인물</span><div>{img("landing/c-skin-ours.webp")}{img("brands/slot-1-subject-editorial.jpg")}{img("landing/grid-8.webp")}</div></li></ul>')
covers = lambda inner: f'<ul class="asset-hub_covers__72RUt">{inner}</ul>'  # noqa: E731
groups = "".join([
    group(T["brand_material"], f'{T["brand_material_meta"]} · 9개', brand_strip),
    group(P1, "직접 만들기 · 이미지 24 · 영상 6 · 사운드 2", covers(
        hub_tile("landing/cut-hands.webp") + hub_tile("landing/cut-scent.webp", "video", "0:05") + hub_tile("landing/grid-4.webp")
        + hub_tile("landing/cut-beads.webp") + sound_tile("티저 배경 음악", "0:30") + hub_tile("landing/grid-5.webp"))),
    group(P2, "직접 만들기 · 이미지 38 · 영상 3", covers(
        hub_tile("landing/look-street.webp") + hub_tile("landing/look-knit.webp") + hub_tile("landing/look-sculpt.webp")
        + hub_tile("brands/house-french-blue-hero-1080p.jpg", "video", "0:08") + hub_tile("landing/look-carpet.webp") + hub_tile("studio/vto-garment.webp"))),
    group(P3, "야기 팀과 · 시안 3 · 납품본 5", covers(
        hub_tile("landing/entry-lead.jpg", "video", "0:12") + hub_tile("landing/c-skin-ours.webp") + hub_tile("landing/c-skin-wide.webp") + hub_tile("landing/grid-2.webp"))),
    group(T["unfiled"], "프로젝트 없이 만든 파일 · 14개", covers(
        hub_tile("brands/city-fashion.jpg") + hub_tile("brands/tea-editorial.jpg") + hub_tile("studio/vto-free-drape.webp")
        + hub_tile("landing/ad-denim.webp") + hub_tile("studio/vto-free-mirror.webp") + hub_tile("brands/y2k-flip-phone.jpg", "video", "0:06")),
        f'<span class="sp-group-actions"><a class="sp-link" href="#">{T["unfiled_cta"]}</a><a class="sp-link" href="#">{T["see_all"]}</a></span>'),
])
tabs_inner = "".join(
    f'<button type="button" role="tab" class="asset-hub_segBtn__P_pIH" aria-selected="{"true" if on else "false"}"><span>{label}</span>'
    + (f'<span class="asset-hub_segNum__HAfjg">{n}</span>' if n else "") + "</button>"
    for label, n, on in [(T["by_project"], "4", True), (T["brand_material"], "9", False), (T["unfiled"], "14", False), (T["all_files"], "", False)])
assets = frag("assets-main").replace("{{TABS}}", tabs_inner).replace("{{GROUPS}}", groups)
assets = assets.replace(">오디오<", ">사운드<")
page("assets", "에셋", "assets", assets,
     "프로젝트별·브랜드 자료·미분류로 다시 묶기, 사운드가 에셋에 보이는 것, ‘프로젝트로 옮기기’. 머리말과 필터는 지금 화면 그대로입니다.")

print("built", sorted(p.name for p in OUT.glob("*.html")))
