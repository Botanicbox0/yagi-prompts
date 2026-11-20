"""Real-browser check of the editing studio v2 prototype's frame accuracy.

Proves, on a running server, that the preview shows exactly the frame the playhead is on. The sample
clip `m7` (public/reel/studio-demo/frame-count-24.mp4) carries its own frame number in every frame as
nine black or white squares; this script puts the playhead on frames by keyboard, reads the squares
back from the preview's pixels and compares them with the frame the editor says it is on. It also
checks the frame-level zoom, the split, the shortcut settings and that typing never triggers a shortcut.

Needs Python Playwright with Chromium (`pip install playwright && playwright install chromium`). It
launches its own browser with a fresh profile and talks only to the address below. Not part of the
vitest suite: run it against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on.

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-frame-check.py [capture-dir]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
results = []

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

STATE = """() => {
  const preview = document.querySelector('[data-editor-preview]');
  const timeline = document.querySelector('[data-editor-timeline]');
  return {
    playhead: Number(preview.dataset.editorPlayhead), source: Number(preview.dataset.editorSourceFrame), fps: Number(preview.dataset.editorFps),
    timecode: document.querySelector('[data-editor-timecode]').textContent,
    cuts: [...document.querySelectorAll('[data-editor-clip]')].map((el) => Number(el.dataset.frames)),
    ppf: Number(timeline.dataset.editorPpf), thumbs: timeline.dataset.editorThumbs || '0:0',
  };
}"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        url = f'{BASE}/brand/studio/editor' + (f'?organizationId={ORG}' if ORG else '')
        page.goto(url, wait_until='domcontentloaded', timeout=180000)
        page.wait_for_selector('[data-studio-editor-v2]', timeout=90000)
        page.wait_for_timeout(1500)
        state = lambda: page.evaluate(STATE)
        shot = lambda name: SHOTS and page.screenshot(path=os.path.join(SHOTS, name))

        def settled():
            page.wait_for_selector('[data-editor-preview][data-editor-settled]', timeout=15000)
            page.wait_for_timeout(120)

        def shown():
            settled()
            return page.evaluate(DECODE)

        def press(key, times=1):
            for _ in range(times):
                page.keyboard.press(key)
            page.wait_for_timeout(80)

        first = state()
        check('film runs on a whole-frame time base', first['fps'] == 24 and sum(first['cuts']) == 454, json.dumps(first['cuts']))
        check('timecode shows frames', first['timecode'] == '0:00:00', first['timecode'])
        shot('frames-01-fit.png')

        # The frame-numbered clip goes on the end: cut 5, source frames 0..119.
        page.click('[data-editor-material=m7]')
        page.wait_for_timeout(300)
        start = 454
        press('End')
        check('End lands on the last frame and shows it', state()['playhead'] == start + 119 and shown() == 119, f"playhead {state()['playhead']} shows {shown()}")
        press('ArrowUp')
        check('previous cut lands on the first frame of the cut', state()['playhead'] == start and shown() == 0, f"playhead {state()['playhead']} shows {shown()}")

        # One frame per arrow, ten with Shift: every stop must show its own number.
        ok, seen = True, []
        at = 0
        for key, delta, times in [('ArrowRight', 1, 5), ('Shift+ArrowRight', 10, 3), ('ArrowLeft', -1, 4), ('ArrowRight', 1, 7), ('Shift+ArrowLeft', -10, 1), ('ArrowRight', 1, 2)]:
            for _ in range(times):
                press(key)
                at += delta
                number = shown()
                current = state()
                seen.append(number)
                ok = ok and number == at and current['playhead'] == start + at and current['source'] == at
        check('each step shows exactly the frame the playhead is on', ok, f'{len(seen)} stops: {seen}')
        here = start + at
        check('timecode follows the frame', state()['timecode'] == f'{here // 24 // 60}:{here // 24 % 60:02d}:{here % 24:02d}', state()['timecode'])

        # Split at the playhead with the everyday key: two pieces that meet on this frame.
        before = state()
        press('Control+b')
        after = state()
        check('Ctrl+B splits at the playhead into two pieces that meet there',
              len(after['cuts']) == len(before['cuts']) + 1 and after['cuts'][-2] == at and after['cuts'][-1] == 120 - at and shown() == at,
              f"cuts {after['cuts'][-2:]} at frame {at}, shows {shown()}")
        press('ArrowLeft')
        check('last frame of the left piece is the frame before the cut', shown() == at - 1, str(shown()))
        press('ArrowRight')
        press('ArrowDown')
        press('ArrowUp')
        check('cut-to-cut stepping lands on the first frame of the right piece', state()['playhead'] == start + at and shown() == at, str(shown()))
        press('Control+z')
        check('undo restores the cut', state()['cuts'] == before['cuts'], json.dumps(state()['cuts'][-2:]))

        # W: cut off the end from the playhead. The frame under the playhead is the first one removed.
        press('w')
        check('W cuts the end off at the playhead frame', state()['cuts'][-1] == at, json.dumps(state()['cuts'][-1:]))
        press('Control+z')

        # Typing must never reach the editor's keys.
        cuts = state()['cuts']
        page.click('[data-editor-assist-input]')
        page.keyboard.type('s q w b k l', delay=15)
        page.keyboard.press('Control+b')
        check('typing in a text field triggers no shortcut', state()['cuts'] == cuts and state()['playhead'] == start + at, json.dumps(state()['cuts'][-2:]))
        page.fill('[data-editor-assist-input]', '')
        page.mouse.click(700, 300)

        # Frame level: one frame at least 60 px wide, a frame ruler, one picture per frame.
        press('Shift+F')
        page.wait_for_timeout(2500)
        deep = state()
        labels = page.evaluate("() => [...document.querySelectorAll('[data-editor-ruler] span[data-label]')].map((el) => el.textContent)")
        tiles = page.evaluate("() => [...document.querySelectorAll('[data-editor-timeline] i[data-frame]')].map((el) => [Number(el.dataset.frame), el.dataset.ready !== undefined, el.getBoundingClientRect().width])")
        frames = [t[0] for t in tiles]
        check('frame level makes one frame at least 60 px wide', deep['ppf'] >= 60, f"{deep['ppf']} px")
        check('ruler counts frames at frame level', any(label.endswith('f') for label in labels), ' '.join(labels[:8]))
        check('filmstrip shows one decoded picture per frame for the visible range',
              len(tiles) > 8 and all(t[1] for t in tiles) and all(b - a == 1 for a, b in zip(frames, frames[1:]) if b - a < 5) and all(t[2] >= 59 or i == len(tiles) - 1 for i, t in enumerate(tiles)),
              f'{len(tiles)} tiles, frames {frames[0]}..{frames[-1]}')
        shot('frames-03-frame-level.png')

        # Ctrl + wheel zooms around the pointer: the frame under it stays put.
        box = page.locator('[data-editor-ruler]').bounding_box()
        strip = page.evaluate("() => { const s = document.querySelector('[data-editor-timeline] [data-editor-ruler]').parentElement.parentElement; const r = s.getBoundingClientRect(); return { left: r.left, width: r.width, scroll: s.scrollLeft }; }")
        px = strip['left'] + strip['width'] * 0.6
        under = lambda: page.evaluate("(x) => { const s = document.querySelector('[data-editor-timeline] [data-editor-ruler]').parentElement.parentElement; const t = document.querySelector('[data-editor-timeline]'); return (s.scrollLeft + x - s.getBoundingClientRect().left) / Number(t.dataset.editorPpf); }", px)
        frame_before = under()
        page.mouse.move(px, box['y'] + 50)
        page.keyboard.down('Control')
        for _ in range(6):
            page.mouse.wheel(0, 120)
            page.wait_for_timeout(70)
        page.keyboard.up('Control')
        page.wait_for_timeout(600)
        mid = state()
        check('Ctrl+wheel zooms out around the pointer', mid['ppf'] < deep['ppf'] and abs(under() - frame_before) < 1.5, f"{deep['ppf']} → {mid['ppf']} px, frame under pointer {frame_before:.1f} → {under():.1f}")
        shot('frames-02-mid.png')
        press('Shift+Z')
        page.wait_for_timeout(400)
        fit = state()
        check('one key shows the whole film again', fit['ppf'] < 4, f"{fit['ppf']} px")

        # Shuttle: L plays, K stops on a whole frame.
        press('Home')
        press('l')
        page.wait_for_timeout(900)
        press('k')
        stopped = state()
        check('L plays and K stops on a whole frame', stopped['playhead'] > 3 and float(stopped['playhead']).is_integer(), str(stopped['playhead']))

        # Memory of the per-frame filmstrip: walk the whole film at frame level.
        press('Home')
        press('Shift+F')
        total = sum(state()['cuts'])
        for target in range(0, total, 12):
            page.evaluate("(frame) => { const s = document.querySelector('[data-editor-timeline] [data-editor-ruler]').parentElement.parentElement; s.scrollLeft = frame * Number(document.querySelector('[data-editor-timeline]').dataset.editorPpf); }", target)
            page.wait_for_timeout(260)
        page.wait_for_timeout(1500)
        pictures, size = [int(v) for v in state()['thumbs'].split(':')]
        check('per-frame pictures stay small', pictures > 200 and size / max(1, pictures) < 12000, f'{pictures} pictures, {size / 1024 / 1024:.2f} MB, {size / max(1, pictures) / 1024:.1f} KB each')

        # Shortcut settings: rebind, conflict warning, reserved key, reset.
        press('Home')
        press('Shift+Z')
        press('Shift+Slash')
        page.wait_for_selector('[data-editor-shortcuts]', timeout=5000)
        page.click('[data-editor-shortcut-slot="trimStart:0"]')
        page.keyboard.press('s')
        page.wait_for_timeout(200)
        warned = page.locator('[data-editor-shortcut-notice=taken]').count() == 1
        check('a key another action holds raises a warning naming it', warned, page.locator('[data-editor-shortcut-notice]').first.inner_text() if warned else '')
        shot('frames-05-shortcuts-conflict.png')
        page.click('[data-editor-shortcut-take]')
        page.wait_for_timeout(150)
        slot = lambda key: page.locator(f'[data-editor-shortcut-slot="{key}"]').inner_text().strip()
        check('taking the key moves it', slot('trimStart:0') == 'S' and 'S' not in [slot('split:0'), slot('split:1')], f"trimStart={slot('trimStart:0')} split={slot('split:0')}")
        page.click('[data-editor-shortcut-slot="split:0"]')
        page.keyboard.press('Control+w')
        page.wait_for_timeout(200)
        check('a key the browser keeps is refused with a reason', page.locator('[data-editor-shortcut-notice=reserved]').count() == 1, slot('split:0'))
        page.click('[data-editor-shortcut-slot="split:0"]')
        page.keyboard.press('Control+k')
        page.wait_for_timeout(150)
        check('a free key is assigned', slot('split:0') == 'Ctrl K', slot('split:0'))
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        press('ArrowDown')
        press('ArrowRight', 9)
        cuts = state()['cuts']
        press('Control+k')
        check('the new key works', len(state()['cuts']) == len(cuts) + 1, json.dumps(state()['cuts'][:3]))
        press('Control+z')
        page.reload(wait_until='domcontentloaded')
        page.wait_for_selector('[data-studio-editor-v2]', timeout=90000)
        page.wait_for_timeout(1200)
        press('Shift+Slash')
        page.wait_for_selector('[data-editor-shortcuts]', timeout=5000)
        check('the keys are still there after a reload', slot('split:0') == 'Ctrl K' and slot('trimStart:0') == 'S', f"{slot('split:0')} / {slot('trimStart:0')}")
        page.click('[data-editor-shortcut-reset-all]')
        page.wait_for_timeout(150)
        check('reset brings the set keys back', slot('split:0') == 'Ctrl B' and slot('trimStart:0') == 'Q', f"{slot('split:0')} / {slot('trimStart:0')}")
        page.click('[data-editor-shortcut-set=pro]')
        page.wait_for_timeout(150)
        check('the second ready-made set splits with Ctrl+K', slot('split:0') == 'Ctrl K', slot('split:0'))
        page.click('[data-editor-shortcut-set=everyday]')

        check('no page errors', not errors, '; '.join(errors[:3]))
        browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
