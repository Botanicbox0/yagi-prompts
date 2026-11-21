"""Real-browser proof of the founder's completion criteria for the editing studio v2 (V1) on the
organization's REAL film (docs/BRAND-EDITING-STUDIO-V2.md §11 V1):

  (1) a film made of four uploaded clips exports to a file that plays to the end in Chrome;
  (2) the frame-numbered clip cut at frame N exports with N-1 followed by N, read back with ffmpeg;
      and after the left piece is deleted, the film's frame at that position shows N;
  (3) (export side) a film made in the CURRENT editor opens in v2 and its caption and colour grade
      reach the exported file (the stored film travels with the export as `extras`).

Steps, on a running local server whose organization has uploaded clips, among them the frame-numbered
sample `public/reel/studio-demo/frame-count-24.mp4` (every frame carries its number as nine squares):

  (1) empty the stored film; in v2 add four uploaded clips (the frame-numbered one second); export
      through the sheet; ffprobe on disk: the film's rate, its frame count, an AAC track as long as the
      picture within one frame, each cut's own sound in its place; play the file to the end in the page.
  (2) switch the film to 16:9 (so the squares are not cropped), split the frame-numbered cut at its
      frame N with Ctrl+B, export, decode every frame's number with ffmpeg: frame start+k shows k, and
      around the cut N-1 is followed by N. Delete the left piece, export again: the frame at the cut's
      old start now shows N, and every following frame its own number.
  (3) empty the stored film; in the current editor add one clip, one caption (0-2.5 s) and a colour
      preset; open v2 and export (file X). Remove the caption in the current editor, export from v2
      again (Y); reset the colour in the current editor, export again (Z). With ffmpeg: X and Y differ
      only in a band of rows at 1.0 s (the caption) and not at all at 4.0 s (after it); Y and Z differ
      everywhere and Y is warmer (the colour grade).

Needs Python Playwright with the full Chromium build (`playwright install chromium`; the headless
shell crashes on the first video encode) and ffmpeg/ffprobe on PATH. Launches its own browser with a
fresh profile and talks only to the local address below; never attaches to another browser. The server
must run with BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id> (v2 opens an organization's own film
only when it is listed; review round 1, item 2); the id comes from the environment at run time.

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-real-export-check.py <out-dir>

Prints PASS/FAIL lines with the measured values, exits non-zero on any failure, and keeps every
exported file and the 1440x900 / 1280x800 captures in <out-dir>.
"""
import json
import os
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')

# Spec F: EDITOR_EXPORT_PATH=seek|decoder forces the export's picture path (`?exportPath=` on the editor page),
# and every finished export says which path made its pictures.
EXPORT_PATH = os.environ.get('EDITOR_EXPORT_PATH', '')
PATH_QUERY = f'&exportPath={EXPORT_PATH}' if EXPORT_PATH in ('seek', 'decoder') else ''


def report_path(page):
    info = page.evaluate("() => { const d = document.querySelector('[data-editor-export-done]'); return d ? [d.dataset.editorExportPath, d.dataset.editorExportPaths] : null; }")
    if info:
        print(f'MEASURE  export made by the {info[0]} path {info[1]}', flush=True)
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = f'twings_studio_compose_v1:{ORG}'
SPLIT_N = 37            # a frame no tenth of a second can hold (37 / 24 = 1.5417 s)
results = []
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

STATE = """() => {
  const root = document.querySelector('[data-studio-editor-v2]');
  const preview = document.querySelector('[data-editor-preview]');
  return {
    mode: root && root.dataset.editorMode, status: root && root.dataset.editorStatus,
    fps: preview ? Number(preview.dataset.editorFps) : 0,
    playhead: preview ? Number(preview.dataset.editorPlayhead) : 0,
    source: preview ? Number(preview.dataset.editorSourceFrame) : -1,
    cuts: [...document.querySelectorAll('[data-editor-clip]')].map((el) => Number(el.dataset.frames)),
    ids: [...document.querySelectorAll('[data-editor-clip]')].map((el) => el.dataset.clipId),
    captions: document.querySelectorAll('[data-editor-caption]').length,
  };
}"""

# Where the nine squares sit in the 640x360 source (scripts/editor-v2-frame-check.py): square i is read
# at x = 34 + 52 i + 20, y = 306. Square 0 is always white, square 1 always black, 2..10 are the bits.
SQUARE_X = [34 + 52 * i + 20 for i in range(11)]
SQUARE_Y = 306


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def note(text):
    print('      ' + text, flush=True)


def run(args):
    return subprocess.run(args, capture_output=True, check=True, creationflags=NO_WINDOW)


def probe(path):
    out = run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
               'stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,time_base,nb_frames,nb_read_frames,duration,sample_rate,channels',
               '-of', 'json', path]).stdout
    streams = json.loads(out)['streams']
    return next(s for s in streams if s['codec_type'] == 'video'), next((s for s in streams if s['codec_type'] == 'audio'), None)


def mean_volume(path, start, seconds):
    """ffmpeg's volumedetect mean level (dB) of the file's sound between start and start + seconds."""
    out = subprocess.run(['ffmpeg', '-v', 'info', '-ss', f'{start:.3f}', '-t', f'{seconds:.3f}', '-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
                         capture_output=True, creationflags=NO_WINDOW).stderr.decode('utf-8', 'replace')
    match = re.search(r'mean_volume:\s*(-?[\d.]+|-inf)\s*dB', out)
    return float(match.group(1)) if match and match.group(1) != '-inf' else -200.0


def decode_numbers(path, width, height):
    """Every frame's nine-square number (or -1 when the squares are not there), read with ffmpeg from the file."""
    sx, sy = width / 640, height / 360
    y = round(SQUARE_Y * sy)
    rows, top = 4, (y - 2) // 2 * 2
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={width}:{rows}:0:{top}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                            stdout=subprocess.PIPE, creationflags=NO_WINDOW)
    size = width * rows * 3
    numbers = []
    while True:
        frame = proc.stdout.read(size)
        if len(frame) < size:
            break
        line = y - top
        row = frame[width * 3 * line: width * 3 * (line + 1)]

        def level(i):
            x = round(SQUARE_X[i] * sx)
            return (row[x * 3] + row[x * 3 + 1] + row[x * 3 + 2]) / 3

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


def frame_pixels(path, index, width=270, height=480):
    """Film frame `index` of the file, scaled down, as RGB bytes (ffmpeg on disk)."""
    return run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'select=eq(n\\,{index}),scale={width}:{height}:flags=area', '-vframes', '1',
                '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout


def row_diffs(a, b, width=270):
    """Mean absolute difference of each row of two equal pictures."""
    stride = width * 3
    return [sum(abs(a[i] - b[i]) for i in range(r * stride, (r + 1) * stride)) / stride for r in range(len(a) // stride)]


def warmth(pixels):
    """Mean red minus mean blue."""
    n = len(pixels) // 3
    return (sum(pixels[0::3]) - sum(pixels[2::3])) / n


PLAY = """async () => {
  const href = document.querySelector('[data-editor-export-again]').href;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px';
  document.body.appendChild(v);
  const errors = [];
  v.addEventListener('error', () => errors.push(v.error ? v.error.code + ' ' + v.error.message : 'error'));
  const ended = new Promise((resolve) => v.addEventListener('ended', () => resolve(true), { once: true }));
  v.src = href;
  await v.play().catch((e) => errors.push(String(e)));
  const ok = await Promise.race([ended, new Promise((r) => setTimeout(() => r(false), 90000))]);
  const out = { ended: ok, errors, duration: v.duration, currentTime: v.currentTime };
  v.remove();
  return out;
}"""


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not OUT:
        print('usage: editor-v2-real-export-check.py <out-dir>')
        sys.exit(2)
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        # The full Chromium build: Playwright's default headless shell crashes on the first H.264 encode.
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        state = lambda: page.evaluate(STATE)
        stored = lambda: json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY) or 'null')

        def shot(name, sizes=((1440, 900), (1280, 800))):
            for w, h in sizes:
                page.set_viewport_size({'width': w, 'height': h})
                page.wait_for_timeout(250)
                page.screenshot(path=os.path.join(OUT, f'{name}-{w}.png'))
            page.set_viewport_size({'width': 1440, 'height': 900})
            page.wait_for_timeout(150)

        def press(key, times=1):
            for _ in range(times):
                page.keyboard.press(key)
            page.wait_for_timeout(90)

        def open_v2():
            page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}{PATH_QUERY}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=180000)
            page.wait_for_timeout(700)

        def open_current():
            page.goto(f'{BASE}/brand/studio/compose?classic=1&organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-brand-studio-compose]', timeout=180000)
            page.wait_for_timeout(1200)

        def empty_film():
            page.evaluate('(key) => localStorage.removeItem(key)', KEY)

        def click_cut(number):
            box = page.locator(f'[data-editor-clip="{number}"]').bounding_box()
            page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.wait_for_timeout(150)

        def export(name, captures=None):
            """Exports through the sheet; returns (path, frames on screen) or (None, ...) when it failed."""
            if not page.locator('[data-editor-export-sheet]').count():
                page.click('[data-editor-export]')
            page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
            page.wait_for_timeout(300)
            frames = sum(state()['cuts'])
            if captures:
                shot(f'{captures}-before')
            started = time.time()

            class Stopped(Exception):
                pass

            try:
                with page.expect_download(timeout=900000) as info:
                    page.click('[data-editor-export-start]')
                    page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=running]', timeout=15000)
                    if captures:
                        page.wait_for_function("() => { const el = document.querySelector('[data-editor-export-progress]'); return !el || !/^\\d+\\//.test(el.dataset.editorExportProgress) || Number(el.dataset.editorExportProgress.split('/')[0]) > 60; }", timeout=120000)
                        shot(f'{captures}-during')
                    page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=done], [data-editor-export-sheet][data-editor-export-status=failed]', timeout=900000)
                    report_path(page)
                    if page.get_attribute('[data-editor-export-sheet]', 'data-editor-export-status') != 'done':
                        raise Stopped()
            except Stopped:
                failed = page.locator('[data-editor-export-failed]')
                check(f'{name}: export finished', False, failed.inner_text() if failed.count() else '?')
                page.screenshot(path=os.path.join(OUT, f'{name}-failed.png'))
                return None, frames
            download = info.value
            path = os.path.join(OUT, f'{name}.mp4')
            download.save_as(path)
            ms = int(page.get_attribute('[data-editor-export-done]', 'data-editor-export-ms') or 0)
            check(f'{name}: export finished', True, f'{frames} frames, {time.time() - started:.1f} s wall clock, {ms / 1000:.1f} s inside the exporter, {os.path.getsize(path)} bytes')
            if captures:
                shot(f'{captures}-after')
            return path, frames

        def file_facts(name, path, frames, fps, size):
            video, audio = probe(path)
            note(f'ffprobe video: codec={video["codec_name"]} {video["width"]}x{video["height"]} r={video["r_frame_rate"]} avg={video["avg_frame_rate"]} '
                 f'nb_frames={video.get("nb_frames")} nb_read_frames={video.get("nb_read_frames")} duration={video.get("duration")}')
            note('ffprobe audio: ' + (f'codec={audio["codec_name"]} {audio["sample_rate"]} Hz {audio["channels"]} ch duration={audio.get("duration")}' if audio else 'none'))
            check(f'{name}: frame rate is the film’s ({fps}/1)', video['r_frame_rate'] == f'{fps}/1' and video['avg_frame_rate'] == f'{fps}/1', f'r={video["r_frame_rate"]} avg={video["avg_frame_rate"]}')
            check(f'{name}: frame count is the film’s ({frames})', int(video['nb_read_frames']) == frames and int(video['nb_frames']) == frames,
                  f'read {video["nb_read_frames"]}, header {video["nb_frames"]}')
            check(f'{name}: picture is {size[0]}x{size[1]}', (int(video['width']), int(video['height'])) == size, f'{video["width"]}x{video["height"]}')
            vdur = float(video['duration'])
            adur = float(audio['duration']) if audio else -1
            check(f'{name}: an AAC sound track as long as the picture within one frame', bool(audio) and audio['codec_name'] == 'aac' and abs(adur - vdur) <= 1 / fps,
                  f'audio {adur:.6f} s, video {vdur:.6f} s, diff {(adur - vdur) * 1000:.1f} ms')
            return video, audio

        # ── (1) Four uploaded clips, exported, read back, played to the end ──
        open_v2()
        empty_film()
        open_v2()
        first = state()
        check('(1) the stored film is empty: v2 shows the empty state', first['mode'] == 'real' and first['cuts'] == [] and page.locator('[data-editor-empty]').count() == 1,
              json.dumps({k: first[k] for k in ('mode', 'status', 'cuts')}))
        shot('real-empty')
        sources = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => ({ key: el.dataset.editorSource, text: el.textContent || '' }))")
        # The clips the local seed uploads are named "c1 …" to "c4 …"; the frame-numbered one says so in its name.
        frame_clip = next((s['key'] for s in sources if re.search('프레임|frame', s['text'], re.I)), None)
        named = {}
        for s in sources:
            match = re.search(r'(?<![A-Za-z])(c[1-4]) ', s['text'])
            if match and s['key'].startswith('a:'):
                named.setdefault(match.group(1), s['key'])
        picks = [named.get('c1'), frame_clip, named.get('c2'), named.get('c3')]
        check('(1) the organization has the frame-numbered clip and three other uploaded clips', all(picks), json.dumps(picks))
        if not all(picks):
            return finish(browser)
        for count, key in enumerate(picks, start=1):
            page.click(f'[data-editor-source="{key}"]')
            page.wait_for_function(f'() => document.querySelectorAll("[data-editor-clip]").length === {count}', timeout=60000)
            page.wait_for_timeout(300)
        page.wait_for_timeout(800)
        one = state()
        fps = one['fps']
        check('(1) four uploaded clips on the film, at the first clip’s rate', len(one['cuts']) == 4 and fps == 24, f'cuts {one["cuts"]} at {fps} fps, total {sum(one["cuts"])}')
        frame_start = one['cuts'][0]
        frame_len = one['cuts'][1]
        saved = stored()
        check('(1) v2 saved the four cuts with their frames', saved and len(saved['clips']) == 4 and all('frameV2' in c for c in saved['clips']))
        shot('real-fit')
        page.mouse.click(700, 400)
        page.keyboard.press('Shift+F')
        page.wait_for_timeout(2500)
        shot('real-frames')
        page.keyboard.press('Shift+Z')
        page.wait_for_timeout(300)
        page.locator('[data-editor-workspace="color"]').click()
        page.wait_for_selector('[data-editor-locked="color"]', timeout=5000)
        shot('real-locked-color')
        page.locator('[data-editor-workspace="cut"]').click()
        page.wait_for_timeout(300)

        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
        page.wait_for_timeout(300)
        sheet_text = page.locator('[data-editor-export-sheet]').inner_text()
        check('(1) the sheet says nothing of the sample film and names nothing as left out', '내보내기 전에' not in sheet_text and '고칠 것' not in sheet_text and page.locator('[data-editor-export-missing]').count() == 0,
              sheet_text.replace('\n', ' | ')[:160])
        path1, total1 = export('real-1-four-clips', captures='real-export')
        if not path1:
            return finish(browser)
        file_facts('(1)', path1, total1, fps, (1080, 1920))
        silent_end = (frame_start + frame_len) / fps          # the first two clips carry no sound
        quiet = mean_volume(path1, 0.2, silent_end - 0.4)
        loud = mean_volume(path1, silent_end + 0.2, one['cuts'][2] / fps - 0.4)
        check('(1) each cut’s own sound is in its place: the silent clips are silent, the clip with sound is heard',
              quiet < -80 and loud > -60, f'0.2–{silent_end - 0.2:.2f} s mean {quiet:.1f} dB, {silent_end + 0.2:.2f}–{silent_end + one["cuts"][2] / fps - 0.2:.2f} s mean {loud:.1f} dB')
        played = page.evaluate(PLAY)
        check('(1) the file plays to the end in the browser (ended, no error)', played['ended'] and not played['errors'], json.dumps(played))

        # ── (2) The frame-numbered cut, split at frame N ──
        press('Escape')            # closes the sheet
        press('Escape')            # and lets go of any selected cut, so the panel shows the whole film
        page.click('[data-editor-aspect="16:9"]')
        page.wait_for_timeout(400)
        page.mouse.click(700, 400)
        press('Home')
        press('ArrowDown')
        press('Shift+ArrowRight', SPLIT_N // 10)
        press('ArrowRight', SPLIT_N % 10)
        at = state()
        cut_at = frame_start + SPLIT_N
        check(f'(2) the playhead is on film frame {cut_at}, source frame {SPLIT_N} of the frame-numbered cut', at['playhead'] == cut_at and at['source'] == SPLIT_N,
              f'playhead {at["playhead"]}, source {at["source"]}')
        press('Control+b')
        page.wait_for_timeout(300)
        two = state()
        check('(2) Ctrl+B cut it in two at that frame', two['cuts'][:3] == [frame_start, SPLIT_N, frame_len - SPLIT_N], json.dumps(two['cuts']))
        path2, total2 = export('real-2-split')
        if not path2:
            return finish(browser)
        video2, _ = file_facts('(2)', path2, total2, fps, (1920, 1080))
        numbers = decode_numbers(path2, int(video2['width']), int(video2['height']))
        check('(2) ffmpeg decoded every frame of the file', len(numbers) == total2, f'{len(numbers)} frames')
        wrong = [(frame_start + k, numbers[frame_start + k] if frame_start + k < len(numbers) else None, k) for k in range(frame_len) if frame_start + k >= len(numbers) or numbers[frame_start + k] != k]
        check('(2) every frame of the frame-numbered cut shows its own source number', not wrong, f'{frame_len} frames checked, mismatches {wrong[:6]}')
        note(f'around the cut (film {cut_at - 3}..{cut_at + 2}): {numbers[cut_at - 3: cut_at + 3]}')
        check(f'(2) at the cut, N-1 is followed by N ({SPLIT_N - 1} then {SPLIT_N})', numbers[cut_at - 1: cut_at + 1] == [SPLIT_N - 1, SPLIT_N],
              f'film {cut_at - 1}: {numbers[cut_at - 1]}, film {cut_at}: {numbers[cut_at]}')

        press('Escape')
        click_cut(2)
        press('Delete')
        page.wait_for_timeout(300)
        three = state()
        check('(2) the left piece is deleted', three['cuts'][:2] == [frame_start, frame_len - SPLIT_N] and len(three['cuts']) == 4, json.dumps(three['cuts']))
        path3, total3 = export('real-3-left-piece-deleted')
        if not path3:
            return finish(browser)
        video3, _ = file_facts('(2b)', path3, total3, fps, (1920, 1080))
        numbers = decode_numbers(path3, int(video3['width']), int(video3['height']))
        note(f'at the old cut position (film {frame_start - 2}..{frame_start + 3}): {numbers[frame_start - 2: frame_start + 4]}')
        check(f'(2) the film’s frame at that position now shows N ({SPLIT_N})', numbers[frame_start] == SPLIT_N, f'film {frame_start}: {numbers[frame_start]}')
        rest = [(frame_start + k, numbers[frame_start + k], SPLIT_N + k) for k in range(frame_len - SPLIT_N) if numbers[frame_start + k] != SPLIT_N + k]
        check('(2) and every following frame of that piece shows its own number', not rest, f'{frame_len - SPLIT_N} frames checked, mismatches {rest[:6]}')
        press('Escape')

        # ── (3) A film from the current editor: its caption and colour grade reach the file ──
        empty_film()
        open_current()
        check('(3) the current editor opens on an empty film', page.locator('[data-compose-clip-card]').count() == 0)
        page.click('[data-compose-browser-filter="uploads"]')
        page.wait_for_timeout(400)
        page.click(f'[data-compose-add-asset="{named["c1"][2:]}"]')
        page.wait_for_selector('[data-compose-clip-card="0"]', timeout=15000)
        page.wait_for_timeout(400)
        page.click('[data-compose-source-tab="captions"]')
        page.fill('[data-compose-caption-input]', 'TWINGS 자막 확인')
        page.click('[data-compose-caption-add]')
        page.wait_for_selector('[data-compose-caption-row="0"]', timeout=5000)
        page.click('[data-compose-source-tab="color"]')
        page.click('[data-compose-grade-preset="kodak-2383-warm"]')
        page.wait_for_timeout(900)
        made = stored()
        caption = (made or {}).get('captions', [{}])[0] if made and made.get('captions') else {}
        check('(3) the current editor stored one clip, one caption and a colour preset',
              made and len(made['clips']) == 1 and len(made['captions']) == 1 and (made.get('colorGrade') or {}).get('presetId') == 'kodak-2383-warm',
              json.dumps({'caption': [caption.get('startSec'), caption.get('endSec'), caption.get('position')], 'grade': {k: (made.get('colorGrade') or {}).get(k) for k in ('scope', 'presetId', 'intensity')}}))
        open_v2()
        film3 = state()
        check('(3) v2 opens it: one cut and the caption on the caption lane', len(film3['cuts']) == 1 and film3['captions'] == 1, json.dumps({k: film3[k] for k in ('cuts', 'captions')}))
        path_x, _ = export('real-4-caption-and-colour')
        open_current()
        page.click('[data-compose-source-tab="captions"]')
        page.locator('[data-compose-caption-row="0"] button').last.click()
        page.wait_for_timeout(900)
        check('(3) the caption is removed in the current editor', len(stored()['captions']) == 0)
        open_v2()
        path_y, _ = export('real-5-colour-only')
        open_current()
        page.click('[data-compose-source-tab="color"]')
        page.click('[data-compose-grade-reset]')
        page.wait_for_timeout(900)
        check('(3) the colour is reset in the current editor', not (stored().get('colorGrade') or {}).get('enabled'))
        open_v2()
        path_z, _ = export('real-6-plain')
        if not (path_x and path_y and path_z):
            return finish(browser)
        on_x, on_y = frame_pixels(path_x, 24), frame_pixels(path_y, 24)       # 1.0 s, inside the caption
        after_x, after_y = frame_pixels(path_x, 96), frame_pixels(path_y, 96)  # 4.0 s, after it
        rows = row_diffs(on_x, on_y)
        marked = [r for r, d in enumerate(rows) if d > 4]
        rows_after = row_diffs(after_x, after_y)
        check('(3) the caption is in the picture at its time: at 1.0 s the file with it differs from the one without it in one band of rows',
              max(rows) > 15 and 0 < len(marked) < len(rows) * 0.25 and max(marked) - min(marked) < len(rows) * 0.3,
              f'max row diff {max(rows):.1f}, rows over 4: {len(marked)} of {len(rows)} (rows {min(marked) if marked else "-"}–{max(marked) if marked else "-"})')
        check('(3) and not after it: at 4.0 s no band differs (only encoder noise)', max(rows_after) < 4,
              f'max row diff {max(rows_after):.2f}, mean {sum(rows_after) / len(rows_after):.2f}')
        plain = frame_pixels(path_z, 96)
        graded_diff = sum(row_diffs(after_y, plain)) / len(rows)
        warm_y, warm_z = warmth(after_y), warmth(plain)
        check('(3) the colour preset is in the picture: graded and plain files differ everywhere, the graded one is warmer',
              graded_diff > 4 and warm_y - warm_z > 3, f'mean diff {graded_diff:.1f}, red minus blue {warm_y:.1f} graded vs {warm_z:.1f} plain')

        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser)


def finish(browser):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
