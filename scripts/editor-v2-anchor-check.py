"""Real-browser check: captions, a still overlay and a sound effect land on the same moment of the same cut in
the current editor's file and in v2's file (spec E, item A; lib/brand-studio/editor-v2/cut-anchor.ts).

The film: six cuts of the frame-numbered upload (every picture shows its own number), 37/53/29/61/43/19
frames at 24 fps from source frames 0, 20, 40, 60, 80, 100 (each cut starts on a lower number than
the one before ends, so the cuts can be told apart in the file) — lengths no tenth of a second holds. It is
stored the way v2 stores it, then opened and saved by the current editor, so both editors hold the same
stored film. Into it (as the current editor stores them): a caption 0.3 s into the sixth cut, one 0.5 s
into the third, a still overlay 0.25 s into the third, and a sound effect (a 1 kHz beep) 0.2 s into the
sixth.

Exported from the current editor (three times: it seeks to each 1/30 s and may land on either side of a
picture) and from v2. In each file, with ffmpeg: the first frame showing each caption (white text in its
box above the picture's middle, where the frame-numbered clip is dark) and its last; the overlay's first
frame (red); each read as "the n-th picture of that cut" from the picture's own number. The sound effect's
first sample against the cut's first picture. Pass: the two editors agree within one frame (1/24 s) for
each caption start. Also v2's preview: at the caption's frame the caption is on, one frame earlier it is not.

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id> whose organization has the frame-numbered upload:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-anchor-check.py <out-dir>

The overlay picture and the effect's sound are generated here (ffmpeg) and served only inside this browser
by Playwright routing. Python Playwright with its own full Chromium and a fresh profile; localhost only;
never attaches to another browser. Prints PASS/FAIL and MEASURE lines; exits non-zero on failure.
"""
import json
import os
import re
import struct
import subprocess
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = f'twings_studio_compose_v1:{ORG}'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
FPS = 24
LENGTHS = [37, 53, 29, 61, 43, 19]
INS = [0, 20, 40, 60, 80, 100]
results = []

SQUARE_X = [34 + 52 * i + 20 for i in range(11)]
SQUARE_Y = 306


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def measure(text):
    print('MEASURE  ' + text, flush=True)


def run(args):
    return subprocess.run(args, capture_output=True, check=True, creationflags=NO_WINDOW)


def tenths(value):
    return round(value * 10 + 1e-9) / 10


def stored_film(src):
    """The six cuts as v2 stores them (frameV2 blocks; seconds as the current editor normalises them)."""
    clips = []
    for i, (start, frames) in enumerate(zip(INS, LENGTHS)):
        trim_start, trim_end = tenths(start / FPS), tenths((start + frames) / FPS)
        clips.append({
            'id': f'anchor-{i + 1}', 'label': f'cut {i + 1}', 'sourceKind': 'asset', 'assetId': src['id'], 'srcUrl': src['url'], 'thumbUrl': None,
            'durationSec': 10, 'trimStartSec': trim_start, 'trimEndSec': trim_end, 'volume': 1, 'muted': False,
            'frameV2': {'fps': FPS, 'inFrame': start, 'phase': 0, 'frames': frames, 'speedNum': 1, 'speedDen': 1, 'sourceFps': 24, 'sourceFrames': 240,
                        'srcUrl': src['url'], 'durationSec': 10, 'mirror': {'trimStartSec': trim_start, 'trimEndSec': trim_end, 'playbackRate': 1}},
        })
    return {'version': 1, 'aspect': '16:9', 'clips': clips, 'captions': [], 'bgm': None, 'colorGrade': None}


def current_layout(film):
    """The current editor's timeline (lib/brand-studio/compose/timeline.ts timelineSpans) for these cuts."""
    cursor, spans = 0.0, []
    for clip in film['clips']:
        duration = max(0.3, tenths(clip['trimEndSec'] - clip['trimStartSec']))
        start, end = tenths(cursor), tenths(cursor + duration)
        spans.append((start, end))
        cursor = end
    return spans


def numbers_and_marks(path):
    """Per frame of the file: the picture's number, whether caption text is on, whether the red overlay is on."""
    probe = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', path]).stdout)['streams'][0]
    width, height = int(probe['width']), int(probe['height'])
    num, den = (int(x) for x in probe['r_frame_rate'].split('/'))
    w, h = 480, 270
    raw = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={w}:{h}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout
    size = w * h * 3
    sx, sy = w / 640, h / 360
    out = []
    for f in range(len(raw) // size):
        px = raw[f * size:(f + 1) * size]
        at = lambda x, y: px[(y * w + x) * 3:(y * w + x) * 3 + 3]
        level = lambda x, y: sum(at(x, y)) / 3

        def square(i):
            x, y = round(SQUARE_X[i] * sx), round(SQUARE_Y * sy)
            return sum(level(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)) / 9

        white, dark = square(0), square(1)
        number = -1
        if white > 150 and dark < 110:
            number = 0
            for bit in range(9):
                number = number * 2 + (1 if square(2 + bit) > (white + dark) / 2 else 0)
        # Caption text: bright pixels in the top box, left of the picture's middle (dark in the clip).
        caption = sum(1 for y in range(int(h * 0.10), int(h * 0.21)) for x in range(int(w * 0.08), int(w * 0.26)) if level(x, y) > 200)
        red = sum(1 for y in range(int(h * 0.42), int(h * 0.58)) for x in range(int(w * 0.07), int(w * 0.17)) if (lambda p: p[0] > 180 and p[1] < 90 and p[2] < 90)(at(x, y)))
        out.append((number, caption > 6, red > 20))
    pcm = run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']).stdout
    samples = struct.unpack(f'<{len(pcm) // 2}h', pcm)
    beep = next((i for i, x in enumerate(samples) if abs(x) > 1500), None)
    return num / den, out, beep


def cut_runs(frames):
    """Output frame ranges per cut: a cut starts where the picture number jumps backwards or by more than 3."""
    runs, start = [], 0
    for i in range(1, len(frames) + 1):
        if i == len(frames) or frames[i][0] < 0 or frames[i - 1][0] < 0 or frames[i][0] < frames[i - 1][0] or frames[i][0] - frames[i - 1][0] > 3:
            runs.append((start, i))
            start = i
    return [r for r in runs if r[1] - r[0] >= 3]


def analyse(name, path):
    fps, frames, beep = numbers_and_marks(path)
    runs = cut_runs(frames)
    facts = {'fps': fps, 'cuts': len(runs)}

    def in_cut(index):
        for k, (a, b) in enumerate(runs):
            if a <= index < b:
                return k, frames[index][0] - frames[a][0], index - a
        return None, None, None

    caption_frames = [i for i, f in enumerate(frames) if f[1]]
    groups = []
    for i in caption_frames:
        if groups and i == groups[-1][1] + 1:
            groups[-1][1] = i
        else:
            groups.append([i, i])
    facts['captions'] = []
    for a, b in groups:
        k, n, _ = in_cut(a)
        kb, nb, _ = in_cut(b)
        facts['captions'].append({'cut': k + 1 if k is not None else None, 'firstPicture': n, 'lastCut': kb + 1 if kb is not None else None, 'lastPicture': nb, 'frames': (a, b)})
    red = [i for i, f in enumerate(frames) if f[2]]
    if red:
        k, n, _ = in_cut(red[0])
        facts['overlay'] = {'cut': k + 1 if k is not None else None, 'firstPicture': n}
    if beep is not None and len(runs) >= 6:
        cut_start = runs[5][0] / fps
        facts['effect'] = {'ms after the sixth cut’s first picture': round((beep / 48000 - cut_start) * 1000, 1)}
    measure(f'{name}: {json.dumps(facts, ensure_ascii=False)}')
    return facts


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not OUT:
        sys.exit('usage: editor-v2-anchor-check.py <out-dir>')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    os.makedirs(OUT, exist_ok=True)
    png, wav = os.path.join(OUT, 'overlay.png'), os.path.join(OUT, 'effect.wav')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=200x200:d=1', '-frames:v', '1', png])
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.06', '-ac', '2', wav])
    media = {'overlay.png': (open(png, 'rb').read(), 'image/png'), 'effect.wav': (open(wav, 'rb').read(), 'audio/wav')}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])

        def route(r):
            url = r.request.url
            if '/__anchor/' in url:
                body, ctype = media[url.rsplit('/', 1)[1].split('?')[0]]
                return r.fulfill(status=200, body=body, headers={'Content-Type': ctype, 'Access-Control-Allow-Origin': '*'})
            return r.continue_() if url.startswith((BASE, 'data:', 'blob:')) else r.abort()

        context.route('**/*', route)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        stored = lambda: json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY) or 'null')

        def open_v2():
            page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=240000)
            page.wait_for_timeout(800)

        def open_current():
            page.goto(f'{BASE}/brand/studio/compose?classic=1&organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-brand-studio-compose]', timeout=240000)
            page.wait_for_timeout(1500)

        open_v2()
        sources = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => ({ key: el.dataset.editorSource, text: (el.textContent || '').trim() }))")
        clip = next((s['key'] for s in sources if s['key'].startswith('a:') and re.search('프레임|frame', s['text'], re.I)), None)
        check('the organization has the frame-numbered upload', clip is not None)
        if not clip:
            return finish(browser)
        src = {'id': clip[2:], 'url': '/api/brand-studio/compose?' + urllib.parse.urlencode({'organizationId': ORG, 'source': 'asset', 'id': clip[2:]})}
        film = stored_film(src)
        spans = current_layout(film)
        at = lambda cut, offset: round(spans[cut][0] + offset, 3)
        film['captions'] = [
            {'id': 'cap-six', 'text': 'WWWWWWWWWWWWWWWWWWWWWWWW', 'startSec': at(5, 0.3), 'endSec': at(5, 0.6), 'position': 'top', 'size': 'lg'},
            {'id': 'cap-three', 'text': 'WWWWWWWWWWWWWWWWWWWWWWWW', 'startSec': at(2, 0.5), 'endSec': at(2, 0.9), 'position': 'top', 'size': 'lg'},
        ]
        film['overlays'] = [{'id': 'ov', 'label': 'red', 'sourceKind': 'asset', 'srcUrl': f'{BASE}/__anchor/overlay.png', 'mediaKind': 'image',
                             'startSec': at(2, 0.25), 'endSec': at(2, 0.6), 'x': 0.12, 'y': 0.5, 'scale': 0.1, 'opacity': 1}]
        film['sfxClips'] = [{'id': 'fx', 'label': 'beep', 'sourceKind': 'asset', 'srcUrl': f'{BASE}/__anchor/effect.wav', 'startSec': at(5, 0.2), 'durationSec': 0.06, 'volume': 1}]
        measure(f'the current editor’s layout of the six cuts: {spans}; v2: {[sum(LENGTHS[:i]) for i in range(6)]} frames, ends {sum(LENGTHS)}')
        measure(f'stored: caption six {film["captions"][0]["startSec"]} s (0.3 s into cut 6), caption three {film["captions"][1]["startSec"]} s (0.5 s into cut 3), '
                f'overlay {film["overlays"][0]["startSec"]} s (0.25 s into cut 3), effect {film["sfxClips"][0]["startSec"]} s (0.2 s into cut 6)')
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film)])

        # Both editors hold the same stored film: the current editor opens it and writes it back.
        open_current()
        held = stored()
        check('the current editor kept the cuts, captions, overlay and effect', held and len(held['clips']) == 6 and len(held.get('captions') or []) == 2
              and len(held.get('overlays') or []) == 1 and len(held.get('sfxClips') or []) == 1, json.dumps({k: len(held.get(k) or []) for k in ('clips', 'captions', 'overlays', 'sfxClips')}) if held else 'none')

        current = []
        for attempt in range(3):
            open_current()
            with page.expect_download(timeout=600000) as info:
                page.click('[data-compose-export]')
            path = os.path.join(OUT, f'current-{attempt + 1}.mp4')
            info.value.save_as(path)
            current.append(analyse(f'current editor export {attempt + 1}', path))

        open_v2()
        cuts = page.evaluate("() => [...document.querySelectorAll('[data-editor-clip]')].map((el) => Number(el.dataset.frames))")
        check('v2 opens the same six cuts on their exact frames', cuts == LENGTHS, json.dumps(cuts))
        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=10000)
        with page.expect_download(timeout=600000) as info:
            page.click('[data-editor-export-start]')
            page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=done], [data-editor-export-sheet][data-editor-export-status=failed]', timeout=600000)
        v2_path = os.path.join(OUT, 'v2.mp4')
        info.value.save_as(v2_path)
        v2 = analyse('v2 export', v2_path)
        page.keyboard.press('Escape')

        # The stored intent: each thing's offset into its cut, in pictures of that cut, from the values as the
        # current editor holds them (it rounds overlay times to tenths when it loads them: 3.95 s becomes 4.0 s).
        caps = {c['id']: c for c in held['captions']}
        into = lambda sec, cut: round((sec - spans[cut][0]) * FPS + 1e-9)
        intent = {'cap-six': into(caps['cap-six']['startSec'], 5), 'cap-three': into(caps['cap-three']['startSec'], 2),
                  'overlay': into(held['overlays'][0]['startSec'], 2), 'effect ms': round((held['sfxClips'][0]['startSec'] - spans[5][0]) * 1000, 1)}
        measure(f'held by the current editor: captions {[(c["startSec"], c["endSec"]) for c in held["captions"]]}, overlay {held["overlays"][0]["startSec"]}–{held["overlays"][0]["endSec"]}, effect {held["sfxClips"][0]["startSec"]}')
        measure(f'stored intent (pictures into the cut): caption six {intent["cap-six"]}, caption three {intent["cap-three"]}, overlay {intent["overlay"]}; effect {intent["effect ms"]} ms')

        def caption_in(facts, cut):
            return next((c for c in facts['captions'] if c['cut'] == cut), None)

        for label, cut, key in (('caption in the sixth cut', 6, 'cap-six'), ('caption in the third cut', 3, 'cap-three')):
            ours = caption_in(v2, cut)
            theirs = [caption_in(c, cut) for c in current]
            starts = [t['firstPicture'] for t in theirs if t]
            spread = (max(starts) - min(starts)) if starts else None
            measure(f'{label}: v2 starts on picture {ours and ours["firstPicture"]} of the cut (ends {ours and (ours["lastCut"], ours["lastPicture"])}); '
                    f'the current editor on {starts} over three exports (spread {spread}; ends {[t and (t["lastCut"], t["lastPicture"]) for t in theirs]}); intent {intent[key]}')
            check(f'{label}: v2 and the current editor start it on the same picture of the cut, within one frame',
                  ours is not None and starts and all(abs(ours['firstPicture'] - s) <= 1 for s in starts), f'v2 {ours and ours["firstPicture"]}, current {starts}')
            check(f'{label}: v2 starts it at the stored offset into its cut, within one frame', ours is not None and abs(ours['firstPicture'] - intent[key]) <= 1,
                  f'v2 {ours and ours["firstPicture"]}, intent {intent[key]}')
        ov = v2.get('overlay')
        measure(f'overlay: v2 first picture {ov}; current editor {[c.get("overlay") for c in current]}; intent cut 3 picture {intent["overlay"]}')
        check('overlay: v2 shows it from its stored offset into the third cut, within one frame', ov is not None and ov['cut'] == 3 and abs(ov['firstPicture'] - intent['overlay']) <= 1, json.dumps(ov))
        theirs = [c.get('overlay') for c in current]
        check('overlay: v2 and the current editor start it on the same picture of the third cut, within one frame', ov is not None and all(t and t['cut'] == 3 and abs(t['firstPicture'] - ov['firstPicture']) <= 1 for t in theirs), json.dumps(theirs))
        fx = v2.get('effect')
        measure(f'effect: v2 {fx}; current editor {[c.get("effect") for c in current]}; intent 200 ms')
        check('effect: v2 starts it at its stored offset after the sixth cut’s first picture, within 10 ms', fx is not None and abs(fx['ms after the sixth cut’s first picture'] - intent['effect ms']) <= 10, json.dumps(fx))
        check('effect: v2 and the current editor agree within 10 ms', fx is not None and all(c.get('effect') and abs(c['effect']['ms after the sixth cut’s first picture'] - fx['ms after the sixth cut’s first picture']) <= 10 for c in current))

        # v2's preview: on at the caption's frame, off one frame earlier.
        page.click('[data-editor-caption-item="cap-six"]')
        page.wait_for_timeout(600)
        at_frame = page.evaluate("() => ({ playhead: Number(document.querySelector('[data-editor-preview]').dataset.editorPlayhead), on: document.querySelectorAll('[data-editor-preview] [data-editor-caption]').length })")
        page.keyboard.press('ArrowLeft')
        page.wait_for_timeout(600)
        before = page.evaluate("() => ({ playhead: Number(document.querySelector('[data-editor-preview]').dataset.editorPlayhead), on: document.querySelectorAll('[data-editor-preview] [data-editor-caption]').length })")
        measure(f'v2 preview: at frame {at_frame["playhead"]} captions shown {at_frame["on"]}; at frame {before["playhead"]} captions shown {before["on"]}')
        check('v2 preview: the caption is on at its mapped frame and off one frame earlier', at_frame['on'] == 1 and before['on'] == 0 and before['playhead'] == at_frame['playhead'] - 1
              and at_frame['playhead'] == sum(LENGTHS[:5]) + intent['cap-six'], f'{at_frame} {before}')
        page.screenshot(path=os.path.join(OUT, 'v2-preview-caption-1440.png'))
        after = stored()
        check('nothing stored moved: captions, overlay and effect as stored', after and after.get('captions') == held.get('captions') and after.get('overlays') == held.get('overlays') and after.get('sfxClips') == held.get('sfxClips'))
        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser)


def finish(browser):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
