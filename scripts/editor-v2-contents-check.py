"""Real-browser check that what a real film's file carries is visible before export (review round 1,
item 6; lib/brand-studio/editor-v2/film-contents.ts).

A film stored the way the current editor stores it, with one uploaded clip, a caption, a colour preset,
music, a sound effect and a still image over the picture. In v2:

  - the film panel (cut workspace, nothing selected) names what the film carries, music and effects
    marked as not heard in this preview;
  - the export sheet lists "이 파일에 들어가는 것" with the cuts, and keeps its "not included" list;
  - the preview shows the colour grade (the current editor's own CSS approximation, on the picture) and
    the still image where the export draws it, and the caption.

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id>. The id comes from the environment:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-contents-check.py <out-dir>

Python Playwright with its own full Chromium and a fresh profile; localhost only; never attaches to another
browser. Nothing is exported (the music here is a label only). Prints PASS/FAIL lines, exits non-zero on
any failure, keeps 1440x900 captures in <out-dir>.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = f'twings_studio_compose_v1:{ORG}'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG or not OUT:
        sys.exit('EDITOR_ORG_ID and an out-dir are required')
    os.makedirs(OUT, exist_ok=True)
    editor = f'{BASE}/brand/studio/editor?organizationId={ORG}'
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def open_v2():
            page.goto(editor, wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=240000)
            page.wait_for_timeout(800)

        open_v2()
        source = page.evaluate("""() => {
          const el = [...document.querySelectorAll('[data-editor-source]')].find((b) => b.dataset.editorSource.startsWith('a:') && !/프레임|frame/i.test(b.textContent || ''));
          return el ? { key: el.dataset.editorSource } : null;
        }""")
        check('an uploaded clip', source is not None)
        if not source:
            return finish(browser, errors)
        # A still image the app itself serves (a sample poster): the overlay must really load for the position check.
        still_url = '/reel/studio-demo/designed-format.jpg'
        asset = source['key'][2:]
        src = f'/api/brand-studio/compose?organizationId={ORG}&source=asset&id={asset}'
        film = {
            'version': 1, 'aspect': '9:16',
            'clips': [{'id': 'contents-1', 'label': 'clip', 'sourceKind': 'asset', 'assetId': asset, 'srcUrl': src, 'thumbUrl': None,
                       'durationSec': 4, 'trimStartSec': 0, 'trimEndSec': 3, 'volume': 1, 'muted': False}],
            'captions': [{'id': 'k1', 'text': '첫 장면', 'startSec': 0, 'endSec': 2, 'position': 'bottom', 'size': 'md'}],
            'bgm': {'label': 'Morning walk', 'sourceKind': 'asset', 'assetId': 'm', 'srcUrl': '/not-played.mp3', 'durationSec': 60, 'trimStartSec': 0, 'volume': 0.4},
            'colorGrade': {'enabled': True, 'scope': 'full_timeline', 'presetId': 'kodak-2383-warm', 'intensity': 0.85, 'skinProtect': 0.7, 'grain': 2, 'halation': 0.04},
            'sfxClips': [{'id': 'fx', 'label': 'whoosh', 'sourceKind': 'asset', 'assetId': 'f', 'srcUrl': '/not-played-fx.mp3', 'startSec': 1, 'durationSec': 0.5, 'volume': 0.9}],
            'overlays': [{'id': 'still-1', 'label': 'logo', 'sourceKind': 'asset', 'assetId': 'l', 'srcUrl': still_url, 'mediaKind': 'image',
                          'startSec': 0, 'endSec': 3, 'x': 0.75, 'y': 0.15, 'scale': 0.3, 'opacity': 1}],
        }
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film)])
        open_v2()

        panel = page.locator('[data-editor-film-contents]')
        rows = page.evaluate("() => [...document.querySelectorAll('[data-editor-film-contents] [data-editor-contents-row]')].map((li) => [li.dataset.editorContentsRow, li.textContent])")
        check('the film panel names what the film carries (no cuts row there)', panel.count() == 1 and [r[0] for r in rows] == ['captions', 'grade', 'music', 'effects', 'stills'], json.dumps(rows, ensure_ascii=False))
        texts = dict(rows)
        check('…the colour as the current editor names it, music and effects marked as not heard here',
              texts.get('grade') == '색: 2383 필름 웜' and texts.get('music') == '음악: Morning walk · 이 미리 보기에서는 들리지 않습니다'
              and texts.get('effects') == '효과음 1개 · 이 미리 보기에서는 들리지 않습니다', json.dumps(texts, ensure_ascii=False))
        grade = page.get_attribute('[data-editor-preview] video', 'data-editor-grade')
        style_filter = page.evaluate("() => document.querySelector('[data-editor-preview] video').style.filter")
        check('the preview shows the colour grade on the picture (the current editor’s own CSS approximation)', bool(grade) and grade != 'none' and style_filter == grade, grade)
        still = page.locator('[data-editor-still="still-1"]')
        page.wait_for_function("() => { const img = document.querySelector('[data-editor-still=\"still-1\"]'); return !!img && img.complete && img.naturalWidth > 0; }", timeout=15000)
        frame_box = page.locator('[data-editor-frame]').bounding_box()
        still_box = still.bounding_box() if still.count() else None
        centre = still_box and ((still_box['x'] + still_box['width'] / 2 - frame_box['x']) / frame_box['width'], (still_box['y'] + still_box['height'] / 2 - frame_box['y']) / frame_box['height'], still_box['width'] / frame_box['width'])
        check('the still image is over the picture where the export draws it (centre 0.75, 0.15; 0.3 of the width)',
              centre is not None and abs(centre[0] - 0.75) < 0.01 and abs(centre[1] - 0.15) < 0.01 and abs(centre[2] - 0.3) < 0.01, json.dumps(centre and [round(v, 3) for v in centre]))
        check('the caption shows', page.locator('[data-editor-caption]').count() == 1)
        page.screenshot(path=os.path.join(OUT, 'contents-panel-1440.png'))

        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
        page.wait_for_timeout(300)
        sheet = page.evaluate("() => [...document.querySelectorAll('[data-editor-export-contents] [data-editor-contents-row]')].map((li) => li.dataset.editorContentsRow)")
        check('the export sheet lists what goes into the file, the cuts first', sheet == ['cuts', 'captions', 'grade', 'music', 'effects', 'stills'], json.dumps(sheet))
        page.screenshot(path=os.path.join(OUT, 'contents-export-sheet-1440.png'))
        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser, errors)


def finish(browser, errors):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
