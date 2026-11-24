"""Real-browser check of the per-organization switch for the editing studio v2
(`BRAND_STUDIO_EDITOR_V2_ORGS`, lib/flags.ts `brandStudioEditorV2DefaultFor`).

Run it twice against a local server started with BRAND_STUDIO_V2=on and BRAND_STUDIO_EDITOR_V2=on:

  listed    the server ALSO has BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id> (set for that run
            only; the id is never written into a file):
            - /brand/studio/compose?organizationId=… lands on /brand/studio/editor. The server decides it:
              the compose response carries the redirect and none of the current editor's markup, and
              the current editor's root never appears in the page;
            - …/compose?classic=1&organizationId=… shows the current editor, still after a reload, and
              its link "back to the new editor" (no tag) opens the new editor;
            - the new editor's way back opens the current editor (classic=1);
            - a clip= link through the compose address arrives in the new editor with the clip appended.
  unlisted  the server WITHOUT the variable (review round 1, item 2) and with BRAND_WORKSPACE_PROTOTYPE_LAYER=on
            (the link below is behind it since 2026-11-23): the compose address shows the
            current editor, and its link previews the SAMPLE film (`?sample=1`, the structure-preview tag,
            the sample notice as its tooltip). Opening the new editor's own address directly, with no
            `sample` and with a `clip=` link, also shows the sample film, and editing there leaves the
            film this browser keeps for the organization byte for byte as it was.

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-switch-check.py listed|unlisted <out-dir>

Python Playwright with its own Chromium and a fresh profile; talks only to the local address; never
attaches to another browser. Prints PASS/FAIL (and NOTE) lines, exits non-zero on any failure, and keeps
1440x900 and 1280x800 captures of the current editor's link in <out-dir>.
"""
import json
import os
import re
import sys
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
MODE = sys.argv[1] if len(sys.argv) > 1 else ''
OUT = sys.argv[2] if len(sys.argv) > 2 else None
results = []

COPY = {
    'try': '새 편집 스튜디오 미리 보기',
    'tag': '구조 시안',
    'sampleNote': '예시 영상으로 만든 시안입니다. 고친 내용은 저장되지 않습니다.',
    'back': '새 편집 스튜디오로 돌아가기',
    'note': '같은 영상을 새 화면에서 엽니다. 색, 사운드, 자막 공간은 아직 준비 중입니다.',
}
KEY = f'twings_studio_compose_v1:{ORG}'

# Reports to the script the moment the current editor's root is put into any page of this browser.
WATCH = """(() => {
  const seen = () => document.querySelector('[data-brand-studio-compose]');
  const report = () => { if (seen() && window.__reportCompose) window.__reportCompose(location.href); };
  new MutationObserver(report).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', report);
})();"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def note(name, detail=''):
    print('NOTE  ' + name + (f'  [{detail}]' if detail else ''), flush=True)


def query(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def redirect_of(response):
    """Where the server sent this document: its Location (3xx), or the redirect carried in a streamed page."""
    if response is None:
        return None, ''
    if 300 <= response['status'] < 400:
        return response['location'], ''
    body = response['body']
    for match in re.finditer(r'NEXT_REDIRECT;replace;([^;"<]+);30[78]', body):
        return match.group(1).replace('&amp;', '&').replace('\\u0026', '&'), body
    return None, body


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if MODE not in ('listed', 'unlisted') or not OUT:
        print('usage: editor-v2-switch-check.py listed|unlisted <out-dir>')
        sys.exit(2)
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    os.makedirs(OUT, exist_ok=True)
    compose = f'{BASE}/brand/studio/compose?organizationId={ORG}'
    classic = f'{BASE}/brand/studio/compose?classic=1&organizationId={ORG}'
    editor_path = '/brand/studio/editor'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        seen_compose = []
        context.expose_function('__reportCompose', lambda href: seen_compose.append(href))
        context.add_init_script(WATCH)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        log = []
        page.on('response', lambda r: log.append(r) if '/brand/studio/' in r.url and '/_next/' not in r.url else None)
        # Every document the browser asks for at the compose address, exactly as the server sent it
        # (status, Location, the whole body), then handed to the page unchanged.
        documents = []

        def capture(route):
            if route.request.resource_type != 'document':
                return route.continue_()
            response = route.fetch(max_redirects=0)
            documents.append({'url': route.request.url, 'status': response.status, 'location': response.headers.get('location'),
                              'body': response.body().decode('utf-8', 'replace')})
            route.fulfill(response=response)

        page.route(re.compile(r'/brand/studio/compose(\?|$)'), capture)

        def shot(name):
            for w, h in ((1440, 900), (1280, 800)):
                page.set_viewport_size({'width': w, 'height': h})
                page.wait_for_timeout(300)
                page.screenshot(path=os.path.join(OUT, f'{name}-{w}.png'))
            page.set_viewport_size({'width': 1440, 'height': 900})

        def wait_current():
            page.wait_for_selector('[data-brand-studio-compose]', timeout=180000)
            page.wait_for_timeout(800)

        def wait_v2():
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=180000)
            page.wait_for_timeout(800)

        def link():
            anchor = page.locator('[data-compose-editor-v2]')
            if not anchor.count():
                return None
            return {'href': anchor.get_attribute('href'), 'text': ' '.join(anchor.inner_text().split()), 'title': anchor.get_attribute('title'),
                    'tags': anchor.locator('span').count()}

        if MODE == 'unlisted':
            page.goto(compose, wait_until='domcontentloaded', timeout=240000)
            wait_current()
            first = documents[0] if documents else None
            check('unlisted: the compose address answers with the current editor itself',
                  first is not None and first['status'] == 200 and 'data-brand-studio-compose' in first['body'] and urlparse(page.url).path == '/brand/studio/compose',
                  f'status {first["status"] if first else "?"}, now at {urlparse(page.url).path}')
            found = link()
            check('unlisted: its link previews the sample film: “미리 보기” with the structure-preview tag, the sample notice as tooltip, sample=1, without classic',
                  found and found['text'] == f'{COPY["try"]} {COPY["tag"]}' and found['tags'] == 1 and found['title'] == COPY['sampleNote']
                  and urlparse(found['href']).path == editor_path and query(found['href']) == {'sample': '1', 'organizationId': ORG} and 'classic' not in found['href'],
                  json.dumps(found, ensure_ascii=False).replace(ORG, '<org>'))
            shot('switch-unlisted-current-editor')
            # Give the current editor a film with one uploaded clip: the thing that must not change.
            page.click('[data-compose-browser-filter="uploads"]')
            page.wait_for_timeout(400)
            page.locator('[data-compose-add-asset]').first.click()
            page.wait_for_selector('[data-compose-clip-card="0"]', timeout=15000)
            page.wait_for_timeout(800)
            # The film this browser keeps for the organization, as the current editor left it.
            kept = page.evaluate('(key) => localStorage.getItem(key)', KEY)
            check('unlisted: that film holds a clip', len(json.loads(kept or '{}').get('clips', [])) == 1)
            check('unlisted: the current editor keeps a film for the organization (the thing that must not change)', bool(kept), f'{len(kept or "")} characters')
            page.click('[data-compose-editor-v2]')
            wait_v2()
            check('unlisted: the link opens the sample film', urlparse(page.url).path == editor_path and page.get_attribute('[data-studio-editor-v2]', 'data-editor-mode') == 'sample')
            # Straight to the new editor's own address, with nothing that asks for the sample, and with a clip= link.
            sources = []
            # A real clip= link: one of the organization's own clips, taken from the film the current editor keeps.
            film = json.loads(kept or '{}')
            first_clip = next((c for c in film.get('clips', []) if c.get('assetId') or c.get('outputId')), {})
            clip_key = f'a:{first_clip["assetId"]}' if first_clip.get('assetId') else f'o:{first_clip.get("outputId", "")}'
            for label, address in (('no sample', f'{BASE}{editor_path}?organizationId={ORG}'),
                                   ('clip= link', f'{BASE}{editor_path}?organizationId={ORG}&clip={clip_key}'),
                                   ('sample=0', f'{BASE}{editor_path}?organizationId={ORG}&sample=0')):
                page.goto(address, wait_until='domcontentloaded', timeout=240000)
                wait_v2()
                mode = page.get_attribute('[data-studio-editor-v2]', 'data-editor-mode')
                sources.append(page.locator('[data-editor-source]').count())
                check(f'unlisted: the editor address directly ({label}) shows the sample film', mode == 'sample' and page.locator('[data-editor-notice]').count() == 1, f'mode {mode}')
                # Edit there: change the shape, split at the playhead, remove a cut, undo, redo.
                page.click('[data-editor-aspect="1:1"]')
                page.locator('[data-editor-step="1"]').click(click_count=6)
                page.click('[data-editor-split-button]')
                page.keyboard.press('Control+z')
                page.keyboard.press('Control+Shift+z')
                page.wait_for_timeout(1500)
                after = page.evaluate('(key) => localStorage.getItem(key)', KEY)
                check(f'unlisted: editing there ({label}) leaves the stored film byte for byte as it was', after == kept,
                      f'{len(kept or "")} → {len(after or "")} characters')
            check('unlisted: the sample film offers none of the organization’s clips', all(count == 0 for count in sources), json.dumps(sources))
            check('no page errors', not errors, '; '.join(errors[:3]))
            return finish(browser)

        # ── listed: the compose address goes to the new editor, decided on the server ──
        page.goto(compose, wait_until='domcontentloaded', timeout=240000)
        page.wait_for_url(re.compile(r'/brand/studio/editor\?'), timeout=180000)
        wait_v2()
        first = documents[0] if documents else None
        sent_to, body = redirect_of(first)
        hide = lambda text: (text or '').replace(ORG, '<org>')
        chain = [f'{r.status} {r.request.resource_type} {hide(urlparse(r.url).path + "?" + urlparse(r.url).query.split("&_rsc")[0])}' for r in log[:5]]
        print('      chain: ' + ' | '.join(chain), flush=True)
        is_http_redirect = first is not None and 300 <= first['status'] < 400
        check('listed: the compose address sends the person on from the server, to the new editor with the organization only',
              sent_to is not None and urlparse(sent_to).path == editor_path and query(sent_to) == {'organizationId': ORG},
              f'first response {first["status"] if first else "?"}, ' + ('Location ' if is_http_redirect else 'redirect carried in the streamed response: ') + hide(sent_to))
        if first is not None and not is_http_redirect:
            note('the HTTP status of that first response is not 3xx',
                 f'{first["status"]}: every /brand page streams behind app/(brand)/brand/loading.tsx, so Next.js sends the workspace shell and its loading line first and carries the page’s server redirect (307) in the stream, with a meta refresh for no-script')
        check('listed: no markup of the current editor was received', 'data-brand-studio-compose' not in body and 'data-compose-' not in body, f'{len(body)} bytes of the first response checked')
        check('listed: the current editor’s root never appeared in the page', not seen_compose, json.dumps(seen_compose))
        check('listed: it lands on the new editor with the organization and nothing else', urlparse(page.url).path == editor_path and query(page.url) == {'organizationId': ORG}
              and page.get_attribute('[data-studio-editor-v2]', 'data-editor-mode') == 'real', page.url.replace(ORG, '<org>'))

        # ── the new editor's way back opens the current editor and stays there ──
        back = page.get_attribute('[data-editor-current]', 'href')
        check('listed: the new editor’s way back carries classic=1', urlparse(back).path == '/brand/studio/compose' and query(back) == {'classic': '1', 'organizationId': ORG}, back.replace(ORG, '<org>'))
        page.click('[data-editor-current]')
        wait_current()
        check('listed: …and opens the current editor', urlparse(page.url).path == '/brand/studio/compose' and query(page.url).get('classic') == '1')
        page.reload(wait_until='domcontentloaded', timeout=240000)
        wait_current()
        check('listed: classic=1 keeps the current editor after a reload', urlparse(page.url).path == '/brand/studio/compose' and query(page.url).get('classic') == '1')
        found = link()
        check('listed: its link reads “back to the new editor”, no tag, the same-film tooltip, without classic',
              found and found['text'] == COPY['back'] and found['tags'] == 0 and found['title'] == COPY['note']
              and urlparse(found['href']).path == editor_path and 'classic' not in found['href'], json.dumps(found, ensure_ascii=False))
        shot('switch-listed-classic')
        page.click('[data-compose-editor-v2]')
        wait_v2()
        check('listed: that link opens the new editor', urlparse(page.url).path == editor_path)

        # ── a clip= link through the compose address ──
        before = page.locator('[data-editor-clip]').count()
        sources = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => el.dataset.editorSource)")
        clip = sources[-1] if sources else None
        seen_compose.clear()
        log.clear()
        documents.clear()
        linked = f'{compose}&clip={clip}'
        page.goto(linked, wait_until='domcontentloaded', timeout=240000)
        page.wait_for_url(re.compile(r'/brand/studio/editor\?'), timeout=180000)
        wait_v2()
        page.wait_for_function(f'() => document.querySelectorAll("[data-editor-clip]").length === {before + 1}', timeout=60000)
        page.wait_for_timeout(600)
        first = documents[0] if documents else None
        sent_to, body = redirect_of(first)
        check('listed: the compose address hands the clip= link to the new editor',
              sent_to is not None and urlparse(sent_to).path == editor_path and query(sent_to) == {'organizationId': ORG, 'clip': clip} and 'data-brand-studio-compose' not in body,
              f'first response {first["status"] if first else "?"}, sent to {(sent_to or "").replace(ORG, "<org>")}')
        last = page.locator('[data-editor-clip]').last.get_attribute('data-clip-id')
        stored = json.loads(page.evaluate('(key) => localStorage.getItem(key)', f'twings_studio_compose_v1:{ORG}') or 'null')
        added = next((c for c in (stored or {}).get('clips', []) if c['id'] == last), {})
        check('listed: …and it arrives with the clip appended, and the address is tidied',
              page.locator('[data-editor-clip]').count() == before + 1 and f'{"a" if added.get("assetId") else "o"}:{added.get("assetId") or added.get("outputId")}' == clip and 'clip=' not in page.url,
              f'{before} → {page.locator("[data-editor-clip]").count()} cuts, last cut from {clip}')
        check('listed: the current editor’s root never appeared on the way', not seen_compose, json.dumps(seen_compose))

        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser)


def finish(browser):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
