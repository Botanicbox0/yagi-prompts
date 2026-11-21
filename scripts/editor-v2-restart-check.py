"""Spec G, A1/A2 on a real screen: the export on the seek path in a minimised window that nothing drives. After
about 90 s idle the browser takes the video encoder back (QuotaExceededError, measured); once the window is shown
again the export starts again from frame 0, says so, and finishes with every frame right.

  EDITOR_BASE_URL=http://localhost:3621 EDITOR_ORG_ID=<organization id> [HIDE_S=150] python scripts/editor-v2-restart-check.py <out-dir> <media-dir>

Python Playwright's own Chromium, started by this script with a fresh profile and its own debugging port (the
`times` method of scripts/editor-v2-decoder-check.py); localhost only. Uploads two generated frame-numbered clips
(local mode proven first with the covered-window check's guard) and deletes them at the end. Windows only.
Prints PASS/FAIL and MEASURE lines; exits non-zero on failure.
"""
import importlib.util
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIDE_S = int(os.environ.get('HIDE_S', '150'))
_spec = importlib.util.spec_from_file_location('decoder_check', os.path.join(ROOT, 'scripts', 'editor-v2-decoder-check.py'))
dc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dc)
OUT = dc.OUT
from playwright.sync_api import sync_playwright  # noqa: E402

# Every WebCodecs codec the page makes, wrapped: its error callback (name, message, visibility) and what its
# encode() threw. Measurement only.
CODEC_LOG = """() => {
  if (window.__codecLog) return 'already';
  const log = window.__codecLog = { codecs: [], thrown: [] };
  const now = () => performance.now();
  for (const name of ['VideoEncoder', 'VideoDecoder', 'AudioEncoder']) {
    const Orig = window[name];
    if (!Orig) continue;
    let n = 0;
    const work = name.endsWith('Encoder') ? 'encode' : 'decode';
    const Wrapped = class extends Orig {
      constructor(init) {
        const rec = { id: name + '#' + (++n), created: now(), lastWork: null, works: 0, error: null, closedByCaller: null, config: null, label: null };
        let self = null;
        super({ ...init, error: (e) => {
          rec.error = { name: e && e.name, message: e && e.message, at: now(), vis: document.visibilityState,
            idleMs: rec.lastWork === null ? null : Math.round(now() - rec.lastWork), state: self ? self.state : null };
          return init.error(e);
        } });
        self = this;
        log.codecs.push(rec);
        this.__rec = rec;
      }
      configure(config) {
        this.__rec.config = { codec: config.codec, hw: config.hardwareAcceleration || 'no-preference' };
        return super.configure(config);
      }
      [work](...args) {
        const before = this.__rec.lastWork;
        this.__rec.lastWork = now();
        this.__rec.works += 1;
        try { return super[work](...args); } catch (e) {
          log.thrown.push({ id: this.__rec.id, op: work, name: e && e.name, message: e && e.message, at: now(), vis: document.visibilityState,
            state: this.state, idleMs: before === null ? null : Math.round(now() - before) });
          throw e;
        }
      }
      flush() { this.__rec.lastWork = now(); return super.flush(); }
      close() { if (this.__rec.closedByCaller === null) this.__rec.closedByCaller = now(); return super.close(); }
    };
    window[name] = Wrapped;
  }
  return 'patched';
}"""

STATES = """() => ({ now: performance.now(), vis: document.visibilityState, start: window.__probeStart || null,
  log: window.__codecLog, states: (window.__probeHeld || []).map((c) => ({ label: c.__rec.label, state: c.state })), visLog: window.__ev2Log ? window.__ev2Log.vis : null })"""



def line(text):
    print(text, flush=True)


def connect(p, own):
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{own.port}')
    context = browser.contexts[0]
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': dc.BASE}])
    page = next((pg for pg in context.pages if pg.url.startswith(dc.BASE)), None) or context.pages[0]
    for extra in [pg for pg in context.pages if pg != page]:
        extra.close()
    return browser, context, page


def report_codecs(tag, got):
    start = got['start'] or 0
    for rec in got['log']['codecs']:
        err = rec['error']
        line(f'MEASURE {tag} {rec["label"] or rec["id"]} {rec["config"]}: works {rec["works"]}, '
             + (f'error {err["name"]} "{err["message"]}" at +{(err["at"] - start) / 1000:.1f} s, idle {err["idleMs"] / 1000 if err["idleMs"] is not None else None} s, '
                f'visibility {err["vis"]}, state {err["state"]}' if err else 'no error')
             + (f', closed by caller at +{(rec["closedByCaller"] - start) / 1000:.1f} s' if rec['closedByCaller'] else ''))
    for t in got['log']['thrown']:
        line(f'MEASURE {tag} thrown by {t["id"]}.{t["op"]}(): {t["name"]} "{t["message"]}" visibility {t["vis"]}, state {t["state"]}, idle before {t["idleMs"]} ms')
    if got.get('states'):
        line(f'MEASURE {tag} states at the end: {json.dumps(got["states"])}')


def report_codecs(tag, got):
    start = got['start'] or 0
    for rec in got['log']['codecs']:
        err = rec['error']
        line(f'MEASURE {tag} {rec["label"] or rec["id"]} {rec["config"]}: works {rec["works"]}, '
             + (f'error {err["name"]} "{err["message"]}" at +{(err["at"] - start) / 1000:.1f} s, idle {err["idleMs"] / 1000 if err["idleMs"] is not None else None} s, '
                f'visibility {err["vis"]}, state {err["state"]}' if err else 'no error')
             + (f', closed by caller at +{(rec["closedByCaller"] - start) / 1000:.1f} s' if rec['closedByCaller'] else ''))
    for t in got['log']['thrown']:
        line(f'MEASURE {tag} thrown by {t["id"]}.{t["op"]}(): {t["name"]} "{t["message"]}" visibility {t["vis"]}, state {t["state"]}, idle before {t["idleMs"]} ms')
    if got.get('states'):
        line(f'MEASURE {tag} states at the end: {json.dumps(got["states"])}')


def main():
    if not OUT or not dc.MEDIA:
        sys.exit('usage: editor-v2-restart-check.py <out-dir> <media-dir>')
    if not dc.BASE.startswith(('http://localhost:', 'http://127.0.0.1:')) or not dc.ORG:
        sys.exit('local only, EDITOR_ORG_ID required')
    os.makedirs(OUT, exist_ok=True)
    media = dc.make_media(dc.MEDIA)
    dc.keep_display_on(True)
    with sync_playwright() as p:
        driven = p.chromium.launch(headless=True)
        if not dc.cw.proves_local_mode(driven):
            sys.exit('local mode not proven: nothing uploaded')
        line('MEASURE the server is in local mode')
        context = driven.new_context()
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': dc.BASE}])
        page = context.new_page()
        page.goto(dc.BASE + '/brand/library', wait_until='domcontentloaded', timeout=300000)
        ids = {key: dc.upload(context, f'decoder-check a2 {key}.mp4', media[key], 640, 360, 5) for key in ('n24', 'n25')}
        film = dc.stored_film([(ids['n24'], 'n24', 5, 0, 5), (ids['n25'], 'n25', 5, 0, 5), (ids['n24'], 'n24 again', 5, 0, 5)])
        own = dc.OwnChromium(p.chromium.executable_path, os.path.join(OUT, 'downloads'))
        try:
            browser, ctx, pg = connect(p, own)
            dc.window_state(browser, ctx, pg, 'normal')
            state = dc.open_film(pg, film, 'seek')
            line(f'MEASURE film: cuts {state["cuts"]} at {state["fps"]} fps, ?exportPath=seek')
            pg.evaluate(dc.PAGE_LOG)
            pg.evaluate(CODEC_LOG)
            pg.evaluate("""() => { window.__errors = []; window.addEventListener('error', (e) => window.__errors.push([performance.now(), 'error ' + String(e.message)])); window.addEventListener('unhandledrejection', (e) => window.__errors.push([performance.now(), 'rejection ' + String(e.reason && (e.reason.stack || e.reason.message || e.reason))]));
              const warn = console.warn, error = console.error; console.warn = (...a) => { window.__errors.push([performance.now(), 'warn ' + a.map(String).join(' ')]); warn(...a); }; console.error = (...a) => { window.__errors.push([performance.now(), 'console.error ' + a.map((x) => x && x.stack ? x.stack : String(x)).join(' ')]); error(...a); };
              window.__sheetLog = []; new MutationObserver(() => { const s = document.querySelector('[data-editor-export-sheet]'); const v = s ? s.dataset.editorExportStatus : 'gone'; const l = window.__sheetLog; if (!l.length || l[l.length - 1][1] !== v) l.push([performance.now(), v]); }).observe(document.body, { subtree: true, childList: true, attributes: true }); }""")
            own.on_top(True)
            pg.bring_to_front()
            pg.click('[data-editor-export]')
            pg.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
            pg.wait_for_timeout(300)
            pg.evaluate("""() => {
              const go = () => { window.__pressed = performance.now(); document.querySelector('[data-editor-export-start]').click(); };
              if (document.visibilityState === 'hidden') return go();
              let done = false;
              const once = () => { if (!done) { done = true; go(); } };
              document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') once(); });
              setTimeout(once, 15000);
            }""")
            own.on_top(False)
            dc.window_state(browser, ctx, pg, 'minimized')
            browser.close()
            time.sleep(HIDE_S)
            browser, ctx, pg = connect(p, own)
            mid = pg.evaluate("() => { const r = document.querySelector('[data-editor-export-progress]'); return r ? { progress: r.dataset.editorExportProgress, restarts: r.dataset.editorExportRestarts, line: !!document.querySelector('[data-editor-export-restarted]') } : null; }")
            line(f'MEASURE after {HIDE_S} s hidden, before showing: {json.dumps(mid)}')
            dc.window_state(browser, ctx, pg, 'normal')
            own.on_top(True)
            pg.bring_to_front()
            seen = []
            started = time.time()
            while time.time() - started < 300:
                look = pg.evaluate("() => { const s = document.querySelector('[data-editor-export-sheet]'); const r = document.querySelector('[data-editor-export-progress]'); return { status: s && s.dataset.editorExportStatus, progress: r ? r.dataset.editorExportProgress : null, restarts: r ? r.dataset.editorExportRestarts : null, line: !!document.querySelector('[data-editor-export-restarted]') }; }")
                if not seen or seen[-1] != look:
                    seen.append(look)
                if look['status'] not in ('running',):
                    break
                time.sleep(0.5)
            own.on_top(False)
            line(f'MEASURE what the sheet showed after showing the window (first 6 changes): {json.dumps(seen[:6])}')
            pg.screenshot(path=os.path.join(OUT, 'after-show.png'))
            for t, text in pg.evaluate('() => window.__errors || []'):
                line(f'MEASURE page said at {t / 1000:.1f} s: {text[:600]}')
            line(f'MEASURE sheet status over time: {json.dumps(pg.evaluate("() => window.__sheetLog"))}')
            line(f'MEASURE url now: {pg.url[:80]}')
            info = pg.evaluate(dc.DONE_INFO)
            restarts = pg.evaluate("() => { const d = document.querySelector('[data-editor-export-done]'); return d ? d.dataset.editorExportRestarts : null; }")
            got = pg.evaluate(STATES)
            vis = pg.evaluate('() => window.__ev2Log.vis')
            pressed = pg.evaluate('() => window.__pressed || null')
            line(f'MEASURE end: {json.dumps(info, ensure_ascii=False)}; restarts {restarts}; visibility {vis}; pressed {pressed}')
            got['start'] = pressed
            report_codecs('a2', got)
            file = None
            if info['status'] == 'done':
                file = os.path.join(OUT, 'a2-restarted.mp4')
                with open(file, 'wb') as f:
                    size = pg.evaluate("async () => (await (await fetch(document.querySelector('[data-editor-export-again]').href)).blob()).size")
                    for start in range(0, size, 4 * 2 ** 20):
                        chunk = pg.evaluate('''async ([start, end]) => {
                          const blob = await (await fetch(document.querySelector('[data-editor-export-again]').href)).blob();
                          const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
                          let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                          return btoa(text);
                        }''', [start, min(size, start + 4 * 2 ** 20)])
                        f.write(__import__('base64').b64decode(chunk))
            browser.close()
            expected = dc.expected_even(state['cuts'][0], 24, state['fps'], 120) + dc.expected_even(state['cuts'][1], 25, state['fps'], 125) + dc.expected_even(state['cuts'][2], 24, state['fps'], 120)
            numbers = dc.decode_numbers(file, 1920, 1080, (0, 0, 1920, 1080)) if file else []
            wrong = [(i, n, e) for i, (n, e) in enumerate(zip(numbers, expected)) if n != e]
            line(f'MEASURE file: {len(numbers)} frames for {len(expected)}, {len(wrong)} wrong {wrong[:4]}')
            reclaimed = [c for c in got['log']['codecs'] if c['error'] and c['error']['name'] == 'QuotaExceededError']
            dc.check('A2: the encoder was taken back while hidden (QuotaExceededError)', len(reclaimed) >= 1, f'{len(reclaimed)} codec(s)')
            dc.check('A2: the export started again once the window was shown and finished', info['status'] == 'done' and restarts == '1', f'{info["status"]} restarts {restarts} {info["failed"]}')
            dc.check('A2: the sheet said why, with the count back at 0', any(s['line'] and s['restarts'] == '1' for s in seen) or (mid or {}).get('line') is True, json.dumps(seen[:3]))
            dc.check('A2: every frame of the file is right', len(numbers) == len(expected) and not wrong, f'{len(numbers)} frames, {len(wrong)} wrong')
            dc.check('A2: no raw "closed codec" error reached the page', not got['log']['thrown'], json.dumps(got['log']['thrown'])[:200])
        finally:
            own.close()
            dc.delete_uploads(context)
            driven.close()
            dc.keep_display_on(False)
    failed = [name for name, ok, _ in dc.results if not ok]
    print(f'\n{len(dc.results) - len(failed)}/{len(dc.results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
