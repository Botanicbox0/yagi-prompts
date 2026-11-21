"""Real-browser check that a guessed frame rate is never stored and is measured again
(review round 1, item 3; lib/brand-studio/editor-v2/stored.ts, components/brand-studio/editor-v2/measure-fps.ts).

The failure it reproduces: a clip whose rate cannot be measured on a visit (a background tab, a slow
network, the time limit) used to get frame data at the film's stand-in 30 fps, and because footage
with frame data is never measured again, a 24 fps source stayed at 30 for good and its exports failed.

  (1) a film made in the current editor (no frame data) holds the frame-numbered 24 fps clip;
  (2) the clip's media is blocked in this browser, v2 opens the film and the person changes its shape:
      nothing frame-based may be stored for that clip, the screen says the rate is not read yet, and the
      export refuses before it starts, naming the clip;
  (3) unblocked, the next visible visit measures 24: the film runs at 24, frame data is stored at 24;
  (4) the export works: ffprobe on disk reads 24 fps and the film's frame count, and the nine-square
      numbers read back are the source's own frames;
  (5) a page that is hidden while it opens (visibility simulated in the page): the clip's own boxes are
      read at once whatever the page's state (spec E addendum C1), so it opens at 24 fps while hidden;
      and with those reads refused (a file the reader cannot read), the playback measurement does not burn
      its time limit: it is still opening after longer than the first limit and measures 24 once shown.

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id>, whose organization has the frame-numbered sample
(`public/reel/studio-demo/frame-count-24.mp4`) uploaded. The id comes from the environment:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-rate-check.py <out-dir>

Python Playwright with its own full Chromium and a fresh profile; talks only to the local address;
never attaches to another browser; ffmpeg/ffprobe on PATH. Prints PASS/FAIL (and NOTE) lines with the
stored values, exits non-zero on any failure, keeps the exported file and 1440x900 captures in <out-dir>.
"""
import json
import os
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = f'twings_studio_compose_v1:{ORG}'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
SQUARE_X = [34 + 52 * i + 20 for i in range(11)]
SQUARE_Y = 306
results = []

HIDE_UNTIL_SHOWN = """(() => {
  let hidden = true;
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return hidden ? 'hidden' : 'visible'; } });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return hidden; } });
  window.__show = () => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); };
})();"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def note(text):
    print('NOTE  ' + text, flush=True)


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,r_frame_rate,nb_read_frames,width,height', '-of', 'json', path],
                         capture_output=True, check=True, creationflags=NO_WINDOW).stdout
    return next(s for s in json.loads(out)['streams'] if s['codec_type'] == 'video')


def decode_numbers(path, width, height):
    """Every frame's nine-square number read with ffmpeg (the squares scale with the picture; 16:9 shows them whole)."""
    sx, sy = width / 640, height / 360
    y = round(SQUARE_Y * sy)
    rows, top = 4, (y - 2) // 2 * 2
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={width}:{rows}:0:{top}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                            stdout=subprocess.PIPE, creationflags=NO_WINDOW)
    size, numbers = width * rows * 3, []
    while True:
        frame = proc.stdout.read(size)
        if len(frame) < size:
            break
        row = frame[width * 3 * (y - top): width * 3 * (y - top + 1)]
        level = lambda i: sum(row[round(SQUARE_X[i] * sx) * 3: round(SQUARE_X[i] * sx) * 3 + 3]) / 3
        white, dark = level(0), level(1)
        if white < 170 or dark > 100:
            numbers.append(-1)
            continue
        number = 0
        for bit in range(9):
            number = number * 2 + (1 if level(2 + bit) > (white + dark) / 2 else 0)
        numbers.append(number)
    proc.wait()
    return numbers


def block_of(film):
    clip = (film or {}).get('clips', [{}])[0]
    return clip.get('frameV2')


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
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        errors = []
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        stored = lambda: json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY) or 'null')

        def open_v2(target=None):
            target = target or page
            target.goto(editor, wait_until='domcontentloaded', timeout=240000)
            target.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=240000)
            target.wait_for_timeout(600)

        # (1) The frame-numbered clip, as the current editor would store it: seconds only, no frame data.
        open_v2()
        sources = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => ({ key: el.dataset.editorSource, text: el.textContent || '' }))")
        frame_key = next((s['key'] for s in sources if re.search('프레임|frame', s['text'], re.I)), None)
        check('the organization has the frame-numbered clip', frame_key is not None and frame_key.startswith('a:'), frame_key and frame_key[:2])
        if not frame_key:
            return finish(browser, errors)
        asset = frame_key[2:]
        src = f'/api/brand-studio/compose?organizationId={ORG}&source=asset&id={asset}'
        legacy = {'version': 1, 'aspect': '16:9', 'captions': [], 'bgm': None,
                  'clips': [{'id': 'rate-check-1', 'label': 'frame-count-24', 'sourceKind': 'asset', 'assetId': asset, 'srcUrl': src, 'thumbUrl': None,
                             'durationSec': 10, 'trimStartSec': 0, 'trimEndSec': 10, 'volume': 1, 'muted': False}]}
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(legacy)])

        # (2) Block the clip's media in this browser: measuring it fails on this visit.
        media = re.compile(r'/api/brand-studio/compose\?.*id=' + re.escape(asset))
        blocked_hits = []
        context.route(media, lambda route: (blocked_hits.append(route.request.url), route.abort()))
        open_v2()
        fps_shown = page.get_attribute('[data-editor-preview]', 'data-editor-fps')
        note(f'blocked visit: the film shows at {fps_shown} fps; {len(blocked_hits)} media requests blocked')
        page.click('[data-editor-aspect="1:1"]')
        page.wait_for_timeout(900)
        after_edit = stored()
        block = block_of(after_edit)
        note('blocked visit, after an edit, stored frame data: ' + json.dumps({k: block.get(k) for k in ('fps', 'sourceFps', 'rateGuessed')} if block else None))
        check('(2) blocked visit: nothing frame-based is stored from the guess', after_edit and after_edit['aspect'] == '1:1' and (block is None or 'fps' not in block) and 'rateGuessed' not in json.dumps(after_edit),
              json.dumps(block))
        check('(2) blocked visit: the screen says the rate is not read yet (tentative film rate)',
              page.locator('[data-editor-fps-tentative]').count() == 1 and page.locator('[data-editor-rate-tentative]').count() == 1)
        page.click('[data-editor-clip="1"]')
        page.wait_for_timeout(200)
        check('(2) blocked visit: the cut’s inspector says its rate is not read yet', page.locator('[data-editor-rate-unknown]').count() == 1)
        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
        refusal = page.locator('[data-editor-export-blocked="rate"]')
        check('(2) blocked visit: export refuses before it starts, naming the clip',
              refusal.count() == 1 and 'frame-count-24' in refusal.inner_text() and page.locator('[data-editor-export-start]').is_disabled(),
              refusal.inner_text() if refusal.count() else 'no refusal')
        page.screenshot(path=os.path.join(OUT, 'rate-blocked-export-1440.png'))

        # (3) Unblocked: the next visible visit measures it.
        context.unroute(media)
        open_v2()
        fps_now = page.get_attribute('[data-editor-preview]', 'data-editor-fps')
        check('(3) next visible visit: the clip is measured and the film runs at 24 fps', fps_now == '24' and page.locator('[data-editor-fps-tentative]').count() == 0, f'{fps_now} fps')
        page.click('[data-editor-aspect="16:9"]')
        page.wait_for_timeout(900)
        block = block_of(stored())
        note('visible visit, after an edit, stored frame data: ' + json.dumps({k: block.get(k) for k in ('fps', 'sourceFps', 'sourceFrames', 'frames')} if block else None))
        check('(3) frame data is stored at the measured rate', block is not None and block.get('fps') == 24 and block.get('sourceFps') == 24 and block.get('sourceFrames') == 240 and 'rateGuessed' not in block,
              json.dumps(block and {k: block.get(k) for k in ('fps', 'sourceFps', 'sourceFrames')}))

        # (4) The export works and reads back as the source's own frames.
        if not page.locator('[data-editor-export-sheet]').count():
            page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
        check('(4) the export is allowed', page.locator('[data-editor-export-blocked]').count() == 0)
        started = time.time()
        with page.expect_download(timeout=600000) as info:
            page.click('[data-editor-export-start]')
            page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=done], [data-editor-export-sheet][data-editor-export-status=failed]', timeout=600000)
        if page.get_attribute('[data-editor-export-sheet]', 'data-editor-export-status') != 'done':
            check('(4) export finished', False, page.locator('[data-editor-export-failed]').inner_text())
            return finish(browser, errors)
        path = os.path.join(OUT, 'rate-check.mp4')
        info.value.save_as(path)
        video = probe(path)
        numbers = decode_numbers(path, int(video['width']), int(video['height']))
        expected = list(range(240))
        check('(4) export finished; ffprobe reads 24 fps and 240 frames', video['r_frame_rate'] == '24/1' and int(video['nb_read_frames']) == 240,
              f'{video["r_frame_rate"]}, {video["nb_read_frames"]} frames, {time.time() - started:.1f} s')
        check('(4) every frame of the file is the source’s own frame (nine-square numbers 0..239)', numbers == expected,
              f'first {numbers[:6]}, last {numbers[-3:]}, mismatches {sum(1 for a, b in zip(numbers, expected) if a != b)}')

        # (5) A page hidden while it opens. First as it is now: the clip's boxes are read at once (C1).
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(legacy)])
        boxes_page = context.new_page()
        boxes_page.on('pageerror', lambda e: errors.append(str(e)))
        boxes_page.add_init_script(HIDE_UNTIL_SHOWN)
        boxes_page.goto(editor, wait_until='domcontentloaded', timeout=240000)
        boxes_page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=60000)
        check('(5) hidden while it opens: the clip is read from its own file at once, the film runs at 24 fps',
              boxes_page.get_attribute('[data-editor-preview]', 'data-editor-fps') == '24' and boxes_page.locator('[data-editor-fps-tentative]').count() == 0,
              boxes_page.get_attribute('[data-editor-preview]', 'data-editor-fps'))
        boxes_page.close()
        # Then the playback measurement (the reader's own requests for the clip refused): it waits instead of
        # burning the limit, then measures.
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(legacy)])
        hidden = context.new_page()
        hidden.route(media, lambda route: route.abort() if route.request.resource_type == 'fetch' and route.request.headers.get('range') else route.continue_())
        hidden.on('pageerror', lambda e: errors.append(str(e)))
        hidden.add_init_script(HIDE_UNTIL_SHOWN)
        hidden.goto(editor, wait_until='domcontentloaded', timeout=240000)
        hidden.wait_for_selector('[data-studio-editor-v2]', timeout=240000)
        hidden.wait_for_timeout(10000)
        status = hidden.get_attribute('[data-studio-editor-v2]', 'data-editor-status')
        check('(5) hidden for 10 s (longer than the first 8 s limit): still opening, the limit was not spent', status == 'loading', status)
        hidden.evaluate('() => window.__show()')
        hidden.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=60000)
        hidden.wait_for_timeout(500)
        check('(5) once shown it measures: 24 fps, nothing tentative', hidden.get_attribute('[data-editor-preview]', 'data-editor-fps') == '24' and hidden.locator('[data-editor-fps-tentative]').count() == 0,
              hidden.get_attribute('[data-editor-preview]', 'data-editor-fps'))
        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser, errors)


def finish(browser, errors):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
