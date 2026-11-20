"""Real-browser round trip between the current editor and the editing studio v2 (V1).

Both editors keep the organization's film in this browser under one key. This script proves, on a
running local server with uploaded clips, that a film moves between them without losing a frame:

  (a) build a film in the CURRENT editor (/brand/studio/compose): add three clips, trim one, split one;
  (b) open v2: the same cuts in the same order, frames = round(seconds x fps);
  (c) in v2: split at a frame (leaving a piece shorter than the current editor's 0.3 s floor), trim an
      edge by one frame, move a cut;
  (d) open the current editor: it shows those cuts in tenths, and rewrites the key on load;
  (e) back in v2: every frame number from (c) is intact (and the preview shows the right frame);
  (f) trim one clip in the current editor: back in v2 only that cut is rebuilt from seconds.

Needs Python Playwright with Chromium (`pip install playwright && playwright install chromium`). It
launches its own browser with a fresh profile (so the key starts empty) and talks only to the address
below; it never attaches to another browser. Not part of the vitest suite. Run against a local server
started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and at least three uploaded video assets:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-roundtrip-check.py [capture-dir]

Prints PASS/FAIL lines and exits non-zero on any failure. With a capture directory it saves 1440x900
pictures of the real film in v2 (whole film and frame level), the empty film and a locked workspace.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
KEY = f'twings_studio_compose_v1:{ORG}'
results = []

if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
    sys.exit('EDITOR_BASE_URL must be a local address')
if not ORG:
    sys.exit('EDITOR_ORG_ID is required')

V2_STATE = """() => {
  const root = document.querySelector('[data-studio-editor-v2]');
  const preview = document.querySelector('[data-editor-preview]');
  return {
    mode: root && root.dataset.editorMode, status: root && root.dataset.editorStatus,
    fps: preview ? Number(preview.dataset.editorFps) : 0,
    playhead: preview ? Number(preview.dataset.editorPlayhead) : 0,
    clips: [...document.querySelectorAll('[data-editor-clip]')].map((el) => ({
      id: el.dataset.clipId, frames: Number(el.dataset.frames), inFrame: Number(el.dataset.inFrame),
      phase: Number(el.dataset.phase), speed: el.dataset.speed,
      sourceFps: Number(el.dataset.sourceFps), sourceFrames: Number(el.dataset.sourceFrames),
    })),
  };
}"""

DECODE = """() => {
  const video = document.querySelector('[data-editor-frame] video');
  if (!video || !video.videoWidth) return -1;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0);
  const sx = canvas.width / 640, sy = canvas.height / 360;
  const read = (i) => { const d = context.getImageData(Math.round((34 + 52 * i + 20) * sx), Math.round(306 * sy), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
  const white = read(0), dark = read(1);
  if (white < 170 || dark > 100) return -2;
  let number = 0;
  for (let bit = 0; bit < 9; bit += 1) number = number * 2 + (read(2 + bit) > (white + dark) / 2 ? 1 : 0);
  return number;
}"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''))


def media_frames(clip, fps):
    return max(1, int(clip['sourceFrames'] * fps / clip['sourceFps'] + 1e-9))


def expected_frames(stored, view, fps):
    """What v2 must derive from a stored clip: round(seconds x fps), never past the footage."""
    rate = stored.get('playbackRate') or 1
    in_frame = min(round(stored['trimStartSec'] * fps), media_frames(view, fps) - 1)
    wanted = max(1, round((stored['trimEndSec'] - stored['trimStartSec']) / rate * fps))
    return in_frame, min(wanted, media_frames(view, fps) - in_frame)


def frame_tuple(clip):
    return (clip['id'], clip['inFrame'], clip['phase'], clip['frames'], clip['speed'])


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        shot = lambda name: SHOTS and page.screenshot(path=os.path.join(SHOTS, name))
        stored = lambda: json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY) or 'null')

        def open_v2():
            page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=120000)
            page.wait_for_timeout(700)
            return page.evaluate(V2_STATE)

        def open_current():
            page.goto(f'{BASE}/brand/studio/compose?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-brand-studio-compose]', timeout=120000)
            page.wait_for_timeout(1200)

        def current_cuts():
            return page.evaluate("""() => [...document.querySelectorAll('[data-compose-clip-card]')].map((card) => {
              const i = card.dataset.composeClipCard;
              return { start: Number(document.querySelector(`[data-compose-trim-start="${i}"]`).value), end: Number(document.querySelector(`[data-compose-trim-end="${i}"]`).value) };
            })""")

        def press(key, times=1):
            for _ in range(times):
                page.keyboard.press(key)
            page.wait_for_timeout(90)

        # ── The empty film: v2 opens on a fresh browser with nothing stored ──
        empty = open_v2()
        check('v2 opens the organization’s film, not the sample film', empty['mode'] == 'real' and page.locator('[data-editor-notice]').count() == 0, json.dumps({k: empty[k] for k in ('mode', 'status')}))
        check('an empty film says what to do and draws no cuts', len(empty['clips']) == 0 and page.locator('[data-editor-empty]').count() == 1)
        shot('v2-real-empty.png')

        # ── (a) Build a film in the current editor ──
        open_current()
        page.click('[data-compose-browser-filter="uploads"]')
        page.wait_for_timeout(400)
        assets = page.evaluate("() => [...document.querySelectorAll('[data-compose-add-asset]')].map((el) => el.dataset.composeAddAsset)")
        # The frame-numbered sample clip, when it was uploaded (its name says so): its pictures carry their own numbers.
        page_labels_frame_assets = page.evaluate("""() => [...document.querySelectorAll('[data-compose-media-card]')]
          .filter((card) => /프레임|frame/i.test(card.textContent || ''))
          .map((card) => card.dataset.composeAssetCard).filter(Boolean)""")
        check('the current editor offers at least three uploaded clips', len(assets) >= 3, f'{len(assets)} assets')
        if len(assets) < 3:
            return finish(browser, errors)
        for index, asset in enumerate(assets[:3]):
            page.click(f'[data-compose-add-asset="{asset}"]')
            page.wait_for_selector(f'[data-compose-clip-card="{index}"]', timeout=15000)
            page.wait_for_timeout(250)
        page.fill('[data-compose-trim-start="1"]', '0.7')
        page.wait_for_timeout(250)
        page.fill('[data-compose-trim-end="1"]', '4.3')
        page.wait_for_timeout(250)
        page.click('[data-compose-clip-card="0"]')
        page.locator('[data-compose-stage] input[type="range"][step="0.1"]').first.fill('1.6')
        page.wait_for_timeout(250)
        page.click('[data-compose-split-playhead]')
        page.wait_for_selector('[data-compose-clip-card="3"]', timeout=15000)
        page.wait_for_timeout(600)
        built = stored()
        cuts_a = current_cuts()
        check('(a) the current editor holds four cuts: one trimmed, one split', built and len(built['clips']) == 4 and cuts_a[2]['start'] == 0.7 and cuts_a[2]['end'] == 4.3 and cuts_a[0]['end'] == 1.6 and cuts_a[1]['start'] == 1.6,
              json.dumps(cuts_a))
        check('(a) nothing it stored carries frame data yet', built and all('frameV2' not in c for c in built['clips']))

        # ── (b) v2 opens it: same cuts, same order, frames = round(seconds x fps) ──
        b = open_v2()
        fps = b['fps']
        ids_match = [c['id'] for c in b['clips']] == [c['id'] for c in built['clips']]
        derived_ok, details = True, []
        for stored_clip, view in zip(built['clips'], b['clips']):
            in_frame, frames = expected_frames(stored_clip, view, fps)
            details.append(f"{view['inFrame']}+{view['frames']} want {in_frame}+{frames}")
            derived_ok = derived_ok and view['inFrame'] == in_frame and view['frames'] == frames and view['speed'] == '1/1'
        check('(b) v2 shows the same cuts in the same order', ids_match and len(b['clips']) == 4, f'fps {fps}')
        check('(b) every cut is round(seconds x fps) on the film rate', fps in (24, 25, 30, 50, 60) and derived_ok, '; '.join(details))
        shot('v2-real-fit.png')
        check('(b) opening changes nothing in the store', stored() == built)

        # ── (c) Frame edits the tenths cannot hold ──
        page.mouse.click(700, 400)
        press('Home')
        press('ArrowDown')                 # first frame of cut 2
        press('ArrowRight', 7)             # 7 frames in: 0.29 s, under the current editor's floor
        press('s')                         # split
        press('Home')
        press('ArrowDown')
        press('ArrowLeft')                 # last frame of cut 1
        press('w')                         # cut the end off from here: one frame
        page.wait_for_timeout(300)
        before_move = page.evaluate(V2_STATE)
        last = page.locator('[data-editor-clip="5"]').bounding_box()
        first = page.locator('[data-editor-clip="1"]').bounding_box()
        page.mouse.move(last['x'] + last['width'] / 2, last['y'] + last['height'] / 2)
        page.mouse.down()
        for step in range(1, 13):
            x = last['x'] + last['width'] / 2 + (first['x'] + 4 - (last['x'] + last['width'] / 2)) * step / 12
            page.mouse.move(x, last['y'] + last['height'] / 2)
            page.wait_for_timeout(30)
        page.mouse.up()
        page.wait_for_timeout(900)
        c = page.evaluate(V2_STATE)
        moved = [x['id'] for x in c['clips']] == [before_move['clips'][4]['id']] + [x['id'] for x in before_move['clips'][:4]]
        check('(c) split at a frame leaves a 7-frame piece', len(c['clips']) == 5 and any(x['frames'] == 7 for x in c['clips']), json.dumps([x['frames'] for x in c['clips']]))
        check('(c) one-frame trim', before_move['clips'][0]['frames'] == b['clips'][0]['frames'] - 1, f"{b['clips'][0]['frames']} → {before_move['clips'][0]['frames']}")
        check('(c) a cut moved to the front', moved, json.dumps([x['id'][-6:] for x in c['clips']]))
        saved = stored()
        blocks = [x.get('frameV2') for x in saved['clips']] if saved else []
        check('(c) v2 wrote every cut with its exact frames', saved and all(blocks) and [(x['id'], bl['inFrame'], bl['phase'], bl['frames'], f"{bl['speedNum']}/{bl['speedDen']}") for x, bl in zip(saved['clips'], blocks)] == [frame_tuple(x) for x in c['clips']])
        check('(c) the store keeps the current editor’s 0.3 s floor in seconds', saved and all(x['trimEndSec'] - x['trimStartSec'] >= 0.3 - 1e-9 for x in saved['clips']))
        page.keyboard.press('Shift+F')
        page.wait_for_timeout(2500)
        shot('v2-real-frames.png')
        page.keyboard.press('Shift+Z')
        frames_c = [frame_tuple(x) for x in c['clips']]

        # ── (d) The current editor shows them in tenths and rewrites the key ──
        open_current()
        cuts_d = current_cuts()
        mirrors = [(x['frameV2']['mirror']['trimStartSec'], x['frameV2']['mirror']['trimEndSec']) for x in saved['clips']]
        tenths = all(abs(v * 10 - round(v * 10)) < 1e-9 for cut in cuts_d for v in (cut['start'], cut['end']))
        check('(d) the current editor shows the same five cuts in tenths', len(cuts_d) == 5 and tenths and [(x['start'], x['end']) for x in cuts_d] == mirrors, json.dumps(cuts_d))
        page.wait_for_timeout(800)
        rewritten = stored()
        check('(d) it rewrote the key and kept v2’s frame data on every cut', rewritten and len(rewritten['clips']) == 5 and all('frameV2' in x for x in rewritten['clips']))

        # ── (e) Back in v2: nothing lost ──
        e = open_v2()
        check('(e) every frame number from (c) is intact', [frame_tuple(x) for x in e['clips']] == frames_c, json.dumps([x[1:4] for x in [frame_tuple(y) for y in e['clips']]]))
        page.locator('[data-editor-workspace="color"]').click()
        page.wait_for_selector('[data-editor-locked="color"]', timeout=5000)
        check('(e) colour is locked with a way to the sample film', page.locator('[data-editor-sample-link="color"]').count() == 1 and page.locator('[data-editor-finding]').count() == 0)
        shot('v2-real-locked-color.png')
        page.locator('[data-editor-workspace="cut"]').click()
        page.wait_for_timeout(200)
        page.mouse.click(700, 400)
        # A frame-numbered clip among the cuts: the preview shows exactly the frame each such cut starts on.
        frame_assets = set(page_labels_frame_assets)
        asset_of = {x['id']: x.get('assetId') for x in stored()['clips']}
        decoded = []
        for index, clip in enumerate(e['clips']):
            if asset_of.get(clip['id']) not in frame_assets:
                continue
            press('Home')
            for _ in range(index):
                press('ArrowDown')
            number = -3
            for _ in range(20):
                page.wait_for_selector('[data-editor-preview][data-editor-settled]', timeout=15000)
                page.wait_for_timeout(150)
                number = page.evaluate(DECODE)
                if number == clip['inFrame'] and page.evaluate(V2_STATE)['playhead'] == sum(x['frames'] for x in e['clips'][:index]):
                    break
            decoded.append((index + 1, clip['inFrame'], number))
        if decoded:
            check('(e) the preview shows the exact first frame of each frame-numbered cut', all(want == got for _, want, got in decoded), json.dumps(decoded))
        else:
            print('SKIP  (e) no frame-numbered clip among the cuts (upload public/reel/studio-demo/frame-count-24.mp4 to check the picture)')

        # ── (f) Trim one clip in the current editor: only that cut is rebuilt ──
        open_current()
        cuts_f = current_cuts()
        target = max(range(len(cuts_f)), key=lambda i: cuts_f[i]['end'] - cuts_f[i]['start'])
        new_end = round(cuts_f[target]['end'] - 0.5, 1)
        page.fill(f'[data-compose-trim-end="{target}"]', f'{new_end}')
        page.wait_for_timeout(800)
        changed = stored()
        check('(f) the current editor trimmed one cut by half a second', changed['clips'][target]['trimEndSec'] == new_end, f'cut {target + 1} ends at {new_end}')
        f = open_v2()
        others_exact = all(frame_tuple(x) == frames_c[i] for i, x in enumerate(f['clips']) if i != target)
        in_frame, frames = expected_frames(changed['clips'][target], f['clips'][target], f['fps'])
        rebuilt = f['clips'][target]['inFrame'] == in_frame and f['clips'][target]['frames'] == frames
        check('(f) the cut the current editor trimmed is rebuilt from its seconds', rebuilt and frame_tuple(f['clips'][target]) != frames_c[target],
              f"{frames_c[target][1:4]} → {frame_tuple(f['clips'][target])[1:4]}, want in {in_frame} frames {frames}")
        check('(f) every other cut keeps its exact frames', others_exact and len(f['clips']) == 5)

        # ── (g) A clip= link puts the clip at the end once and tidies the address ──
        link_asset = assets[3] if len(assets) > 3 else assets[0]
        page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}&clip=a:{link_asset}', wait_until='domcontentloaded', timeout=240000)
        page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=120000)
        page.wait_for_function('() => document.querySelectorAll("[data-editor-clip]").length === 6', timeout=20000)
        page.wait_for_timeout(900)
        check('(g) clip= adds the clip at the end and leaves the address', 'clip=' not in page.url and len(page.evaluate(V2_STATE)['clips']) == 6, page.url.split('?')[-1])
        page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}&clip=a:{link_asset}', wait_until='domcontentloaded', timeout=240000)
        page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=120000)
        page.wait_for_timeout(1500)
        check('(g) the same link again does not add it twice', len(page.evaluate(V2_STATE)['clips']) == 6 and 'clip=' not in page.url)

        # ── (h) Another tab changes the film: v2 reads it again and starts its undo over ──
        page.mouse.click(700, 400)
        press('Home')
        press('ArrowRight', 3)
        press('s')
        page.wait_for_timeout(200)
        page.keyboard.press('Control+z')    # leaves an undo step behind, nothing waiting to be written
        page.wait_for_timeout(700)
        redo = page.locator('[data-editor-undo] + button')
        had_redo = not redo.is_disabled()
        before_tab = page.evaluate(V2_STATE)
        other = context.new_page()
        other.goto(f'{BASE}/brand/studio/compose?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
        other.wait_for_selector('[data-brand-studio-compose]', timeout=120000)
        other.wait_for_timeout(1200)
        other.fill('[data-compose-trim-start="0"]', '1')
        other.wait_for_timeout(1500)
        after_tab = page.evaluate(V2_STATE)
        check('(h) a change in another tab reaches v2 without a reload', after_tab['clips'][0]['inFrame'] == round(1 * after_tab['fps']) and after_tab['clips'][0] != before_tab['clips'][0] and after_tab['clips'][1:] == before_tab['clips'][1:],
              f"cut 1 in-frame {before_tab['clips'][0]['inFrame']} → {after_tab['clips'][0]['inFrame']}")
        check('(h) and v2 starts its undo history over', had_redo and redo.is_disabled() and page.locator('[data-editor-undo]').is_disabled(), f'redo before {had_redo}')
        other.close()

        # ── (i) "말로 편집" on a real film: the cut sentences work, the rest says it is not ready ──
        page.click('[data-editor-example="cut2"]')
        page.wait_for_selector('[data-editor-apply]', timeout=5000)
        page.click('[data-editor-apply]')
        page.wait_for_timeout(500)
        two = page.evaluate(V2_STATE)
        check('(i) "두 번째 컷을 2초로 줄여 줘" makes cut 2 exactly two seconds', two['clips'][1]['frames'] == 2 * two['fps'], str(two['clips'][1]['frames']))
        page.fill('[data-editor-assist-input]', '자막 만들어 줘')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        check('(i) a caption sentence is answered as not ready, with nothing to apply', page.locator('[data-editor-proposal]').count() == 1 and page.locator('[data-editor-apply]').count() == 0)

        # The same film at the smaller desktop width.
        page.set_viewport_size({'width': 1280, 'height': 800})
        page.wait_for_timeout(500)
        shot('v2-real-fit-1280.png')
        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser, errors)


def finish(browser, errors):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
