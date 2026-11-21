"""Real-browser check that an open tab of the current editor never silently wipes v2's work
(review round 1, items 7 and 8; lib/brand-studio/editor-v2/film-session.ts).

The current editor reads the shared key only when it mounts, writes its whole film on every change,
and on mount first writes an EMPTY film and then the real one. Two pages of ONE browser context (so
they share the key and receive each other's `storage` events):

  (1) v2 builds a film (two uploaded clips) and saves it;
  (2) a tab of the current editor opens it (from now on that tab holds a stale copy);
  (3) v2 splits a cut at a frame and saves;
  (4) the stale tab changes something (the frame shape) and so writes its whole stale film over v2's;
  (5) v2 does not adopt it and does not write over it: it shows the bar with two choices, and editing
      goes on meanwhile without writing; "keep this screen's film" puts v2's cuts back in storage;
  (6) a freshly opened tab of the current editor writes its empty film first (recorded in that tab)
      and then the real one: v2 never shows fewer cuts, no bar, its cuts stay in storage.

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id> (v2 opens an organization's own film only when it is
listed), whose organization has at least two uploaded video clips. The id comes from the environment:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-two-tabs-check.py [out-dir]

Python Playwright with its own Chromium (full build) and a fresh profile; talks only to the local
address; never attaches to another browser. Prints PASS/FAIL lines, exits non-zero on any failure and
keeps 1440x900 captures of the bar in [out-dir].
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

# Every value a page writes to the key, as clip counts, in order (installed before the page's own code runs).
RECORD_WRITES = """((key) => {
  window.__writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, value) {
    if (name === key) { try { window.__writes.push(JSON.parse(value).clips.length); } catch { window.__writes.push(-1); } }
    return set.call(this, name, value);
  };
})"""

# In v2: the fewest cuts ever on screen, and whether the bar ever showed, sampled every 5 ms.
WATCH_V2 = """() => {
  window.__fewest = Infinity;
  window.__sawBar = false;
  window.__events = [];
  window.addEventListener('storage', (event) => { try { window.__events.push(JSON.parse(event.newValue).clips.length); } catch { window.__events.push(-1); } });
  setInterval(() => {
    window.__fewest = Math.min(window.__fewest, document.querySelectorAll('[data-editor-clip]').length);
    if (document.querySelector('[data-editor-conflict]')) window.__sawBar = true;
  }, 5);
}"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    if OUT:
        os.makedirs(OUT, exist_ok=True)
    editor = f'{BASE}/brand/studio/editor?organizationId={ORG}'
    classic = f'{BASE}/brand/studio/compose?classic=1&organizationId={ORG}'

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        errors = []

        def page_of():
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            return page

        v2 = page_of()
        stored = lambda: json.loads(v2.evaluate('(key) => localStorage.getItem(key)', KEY) or 'null')
        cuts_on_screen = lambda: v2.evaluate("() => [...document.querySelectorAll('[data-editor-clip]')].map((el) => el.dataset.clipId)")
        stored_ids = lambda film: [c['id'] for c in (film or {}).get('clips', [])]

        # (1) v2 builds a film of two uploaded clips.
        v2.goto(editor, wait_until='domcontentloaded', timeout=240000)
        v2.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=180000)
        check('v2 opens the organization’s own film (the list is set)', v2.get_attribute('[data-studio-editor-v2]', 'data-editor-mode') == 'real')
        v2.evaluate('(key) => localStorage.removeItem(key)', KEY)
        v2.reload(wait_until='domcontentloaded')
        v2.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=180000)
        sources = v2.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => el.dataset.editorSource)")
        if len(sources) < 2:
            check('at least two uploaded clips to build a film from', False, f'{len(sources)}')
            return finish(browser)
        for count, key in enumerate(sources[:2], start=1):
            v2.click(f'[data-editor-source="{key}"]')
            v2.wait_for_function(f'() => document.querySelectorAll("[data-editor-clip]").length === {count}', timeout=60000)
        v2.wait_for_timeout(900)
        built = stored()
        check('(1) v2 saved a film of two cuts', stored_ids(built) == cuts_on_screen() and len(stored_ids(built)) == 2, json.dumps(stored_ids(built)))

        # (2) A tab of the current editor opens it: from now on it holds a stale copy.
        old = page_of()
        old.goto(classic, wait_until='domcontentloaded', timeout=240000)
        old.wait_for_selector('[data-brand-studio-compose]', timeout=180000)
        old.wait_for_timeout(1500)

        # (3) v2 splits the first cut ten frames in, and saves.
        v2.bring_to_front()
        v2.evaluate('() => window.dispatchEvent(new Event("focus"))')
        for _ in range(10):
            v2.click('[data-editor-step="1"]')
        v2.click('[data-editor-split-button]')
        v2.wait_for_function('() => document.querySelectorAll("[data-editor-clip]").length === 3', timeout=10000)
        v2.wait_for_timeout(900)
        mine = cuts_on_screen()
        check('(3) v2’s split is saved: three cuts in storage', stored_ids(stored()) == mine and len(mine) == 3, json.dumps(mine))

        # (4) The stale tab changes the frame shape and writes its whole stale film.
        old.bring_to_front()
        old.click('[data-compose-aspect="1:1"]')
        old.wait_for_timeout(400)
        overwritten = stored()
        check('(4) the stale tab overwrote the key with its two-cut film', len(stored_ids(overwritten)) == 2 and overwritten['aspect'] == '1:1',
              f'{len(stored_ids(overwritten))} cuts, {overwritten["aspect"]}')

        # (5) v2: the bar, not an adoption and not a silent overwrite.
        v2.bring_to_front()
        try:
            v2.wait_for_selector('[data-editor-conflict]', timeout=8000)
            bar = True
        except Exception:
            bar = False
        check('(5) v2 shows the bar with two choices', bar and v2.locator('[data-editor-conflict-keep]').count() == 1 and v2.locator('[data-editor-conflict-open]').count() == 1)
        check('(5) v2 still shows its own three cuts (it did not open the stale film)', cuts_on_screen() == mine, json.dumps(cuts_on_screen()))
        check('(5) …and did not write over the other tab’s film by itself', stored_ids(stored()) == stored_ids(overwritten) and stored()['aspect'] == '1:1')
        if OUT:
            v2.screenshot(path=os.path.join(OUT, 'two-tabs-bar-1440.png'))
        # Editing goes on meanwhile, and nothing is written.
        for _ in range(5):
            v2.click('[data-editor-step="1"]')
        v2.click('[data-editor-split-button]')
        v2.wait_for_function('() => document.querySelectorAll("[data-editor-clip]").length === 4', timeout=10000)
        v2.wait_for_timeout(1200)
        check('(5) editing goes on meanwhile (a fourth cut) and nothing is written yet', len(cuts_on_screen()) == 4 and stored_ids(stored()) == stored_ids(overwritten),
              f'{len(cuts_on_screen())} cuts on screen, {len(stored_ids(stored()))} stored')
        mine = cuts_on_screen()
        v2.click('[data-editor-conflict-keep]')
        v2.wait_for_timeout(500)
        kept = stored()
        check('(5) “keep this screen’s film” writes v2’s cuts and shape back', stored_ids(kept) == mine and kept['aspect'] == '9:16' and v2.locator('[data-editor-conflict]').count() == 0,
              f'{len(stored_ids(kept))} cuts, {kept["aspect"]}')
        check('(5) every stored cut carries v2’s frame data', all('frameV2' in c for c in kept['clips']))

        # (6) A freshly opened tab of the current editor: its empty write at mount never empties v2.
        v2.evaluate(WATCH_V2)
        fresh = context.new_page()
        fresh.on('pageerror', lambda e: errors.append(str(e)))
        fresh.add_init_script(f'({RECORD_WRITES})({json.dumps(KEY)})')
        fresh.goto(classic, wait_until='domcontentloaded', timeout=240000)
        fresh.wait_for_selector('[data-brand-studio-compose]', timeout=180000)
        fresh.wait_for_timeout(1500)
        writes = fresh.evaluate('() => window.__writes')
        check('(6) the fresh tab wrote an empty film first, then the real one (the race is real)', len(writes) >= 2 and writes[0] == 0 and writes[-1] == len(mine), json.dumps(writes))
        v2.bring_to_front()
        v2.evaluate('() => window.dispatchEvent(new Event("focus"))')
        v2.wait_for_timeout(1500)
        events = v2.evaluate('() => window.__events')
        fewest = v2.evaluate('() => window.__fewest')
        check('(6) v2 heard the empty write', 0 in events, json.dumps(events))
        check('(6) v2 never showed fewer cuts and never put up the bar', fewest == len(mine) and not v2.evaluate('() => window.__sawBar'), f'fewest {fewest} of {len(mine)}')
        check('(6) v2’s cuts are still what storage holds', stored_ids(stored()) == mine == cuts_on_screen())

        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser)


def finish(browser):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
