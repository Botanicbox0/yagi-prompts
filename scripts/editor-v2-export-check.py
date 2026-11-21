"""Real-browser proof that the editing studio v2 export is frame-exact.

Drives the editor at /brand/studio/editor on a running server like a person would: adds the sample clip
`m7` (public/reel/studio-demo/frame-count-24.mp4, every frame carries its own number as nine black or white
squares), splits it three times with Ctrl+B, deletes a middle piece, sets one piece to 0.5x and another to
2x in the cut panel, drags one piece in front of another, then exports through the sheet. While the export
runs it deletes a cut (the file must be made from the film as it was when export was pressed) and undoes it.

The downloaded file is then read back ON DISK with ffprobe and ffmpeg (not by the browser): the frame rate
must be the film's, the frame count the film's, every frame must last exactly 1/24 s, there must be an AAC
sound track as long as the picture, and every frame that belongs to an m7 piece must show exactly the
source frame number the timeline put there. Finally the same file is played to the end in the browser.

Needs Python Playwright with Chromium (the full build: `playwright install chromium`), and ffmpeg/ffprobe on PATH. Launches its own browser with a fresh
profile and talks only to the address below. Not part of the vitest suite.

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-export-check.py <out-dir>

Keeps the exported file and 1440x900 captures of the sheet during and after the export in <out-dir>.
"""
import json
import os
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
FPS = 24
results = []

STATE = """() => {
  const preview = document.querySelector('[data-editor-preview]');
  return {
    playhead: Number(preview.dataset.editorPlayhead), source: Number(preview.dataset.editorSourceFrame), fps: Number(preview.dataset.editorFps),
    cuts: [...document.querySelectorAll('[data-editor-clip]')].map((el) => Number(el.dataset.frames)),
  };
}"""

# Where the nine squares sit in the 640x360 source (scripts/editor-v2-frame-check.py, DECODE): square i is
# read at x = 34 + 52 i + 20, y = 306. Square 0 is always white, square 1 always black, 2..10 are the bits.
SQUARE_X = [34 + 52 * i + 20 for i in range(11)]
SQUARE_Y = 306


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def run(args):
    return subprocess.run(args, capture_output=True, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def probe(path):
    out = run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
               'stream=index,codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,time_base,nb_frames,nb_read_frames,duration,sample_rate,channels',
               '-of', 'json', path]).stdout
    return json.loads(out)['streams']


def packet_durations(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=duration', '-of', 'csv=p=0', path]).stdout.decode()
    return [int(line.strip().rstrip(',')) for line in out.splitlines() if line.strip()]


def decode_numbers(path, width, height):
    """Every frame's nine-square number (or -1 when the squares are not there), read with ffmpeg from the file."""
    sx, sy = width / 640, height / 360
    y = round(SQUARE_Y * sy)
    # Four rows from an even line: 4:2:0 pictures are cropped on even lines and heights only.
    rows, top = 4, (y - 2) // 2 * 2
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={width}:{rows}:0:{top}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                            stdout=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    size = width * rows * 3
    numbers = []
    while True:
        frame = proc.stdout.read(size)
        if len(frame) < size:
            break
        line = y - top
        row = frame[width * 3 * line: width * 3 * (line + 1)]  # the line through the squares' middle

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


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not OUT:
        print('usage: editor-v2-export-check.py <out-dir>')
        sys.exit(2)
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        # The full Chromium build in new headless mode: Playwright's default headless shell crashes the
        # page on the first H.264 encode (measured 2026-11-21, shell 149), the full build does not.
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        # The sample film (`?sample=1`); the organization's own film is exported by editor-v2-real-export-check.py.
        url = f'{BASE}/brand/studio/editor?sample=1' + (f'&organizationId={ORG}' if ORG else '') + PATH_QUERY
        page.goto(url, wait_until='domcontentloaded', timeout=180000)
        page.wait_for_selector('[data-studio-editor-v2]', timeout=90000)
        page.wait_for_timeout(1500)
        state = lambda: page.evaluate(STATE)

        def press(key, times=1):
            for _ in range(times):
                page.keyboard.press(key)
            page.wait_for_timeout(80)

        def click_cut(number):
            box = page.locator(f'[data-editor-clip="{number}"]').bounding_box()
            page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            page.wait_for_timeout(150)

        def speed(label):
            page.locator('[role=group][aria-label="속도"] button', has_text=label).click()
            page.wait_for_timeout(150)

        first = state()
        base_total = sum(first['cuts'])
        check('sample film opens at 24 fps', first['fps'] == FPS and base_total == 454, json.dumps(first['cuts']))

        # ── Real edits ──
        page.click('[data-editor-material=m7]')
        page.wait_for_timeout(300)
        start = base_total
        press('End')
        press('ArrowUp')
        check('playhead on the first frame of the m7 cut', state()['playhead'] == start, str(state()['playhead']))
        for _ in range(3):
            press('Shift+ArrowRight', 3)
            press('Control+b')
        cuts = state()['cuts']
        check('three Ctrl+B splits give four m7 pieces of 30 frames', cuts[4:] == [30, 30, 30, 30], json.dumps(cuts))
        click_cut(6)
        press('Delete')
        cuts = state()['cuts']
        check('the second piece (source 30-59) is deleted', cuts[4:] == [30, 30, 30], json.dumps(cuts))
        click_cut(6)
        speed('0.5×')
        click_cut(7)
        speed('2×')
        cuts = state()['cuts']
        check('0.5x doubles one piece, 2x halves another', cuts[4:] == [30, 60, 15], json.dumps(cuts))
        # Drag the 2x piece (cut 7) in front of the first m7 piece (cut 5).
        a = page.locator('[data-editor-clip="7"]').bounding_box()
        b = page.locator('[data-editor-clip="5"]').bounding_box()
        page.mouse.move(a['x'] + a['width'] / 2, a['y'] + a['height'] / 2)
        page.mouse.down()
        for step in range(1, 13):
            page.mouse.move(a['x'] + a['width'] / 2 + (b['x'] + 4 - (a['x'] + a['width'] / 2)) * step / 12, a['y'] + a['height'] / 2)
            page.wait_for_timeout(30)
        page.mouse.up()
        page.wait_for_timeout(250)
        press('Escape')
        cuts = state()['cuts']
        check('drag moves the 2x piece in front', cuts == [113, 113, 120, 108, 15, 30, 60], json.dumps(cuts))
        total = sum(cuts)
        # One more split that stays in place: the 1x piece at its source frame 15 (film frame start + 30).
        split_at = start + 30
        press('End')
        press('ArrowLeft', total - 1 - split_at)
        press('Control+b')
        cuts = state()['cuts']
        final_cuts = [113, 113, 120, 108, 15, 15, 15, 60]
        check('a split inside the 1x piece leaves both halves side by side', cuts == final_cuts and state()['playhead'] == split_at, json.dumps(cuts))

        # What the timeline must show on every film frame of the m7 pieces, in order.
        expected = {}
        frame = start
        for n in range(90, 120, 2):           # 2x piece: every other number
            expected[frame] = n
            frame += 1
        for n in range(0, 30):                # 1x piece
            expected[frame] = n
            frame += 1
        for n in range(60, 90):               # 0.5x piece: each number twice
            expected[frame] = n
            expected[frame + 1] = n
            frame += 2
        check('the plan covers the film', frame == total, f'{frame} / {total}')

        # The editor itself agrees with the expectation at a few frames (playhead + its source frame readout).
        agree = []
        for target in [start, start + 14, start + 15, start + 44, start + 45, start + 46, total - 1]:
            press('End')
            press('ArrowLeft', total - 1 - target)
            agree.append((target, state()['playhead'], state()['source'], expected[target]))
        check('the timeline shows the expected source frames', all(p == t and s == e for t, p, s, e in agree), str(agree))

        # ── Export through the sheet ──
        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
        check('sheet states shape, frame rate and length', page.locator('[data-editor-export-length]').inner_text() == f'{total // FPS // 60}:{total // FPS % 60:02d}:{total % FPS:02d}',
              page.locator('[data-editor-export-sheet] dl').inner_text().replace('\n', ' | '))
        page.screenshot(path=os.path.join(OUT, 'export-sheet-before.png'))
        started = time.time()
        console = []
        page.on('console', lambda m: console.append(m.text) if 'editor export' in m.text else None)

        class Stopped(Exception):
            pass

        try:
            with page.expect_download(timeout=600000) as download_info:
                page.click('[data-editor-export-start]')
                page.wait_for_selector('[data-editor-export-status=running]', timeout=10000)
                page.wait_for_function("() => { const el = document.querySelector('[data-editor-export-progress]'); return !el || !/^\\d+\\//.test(el.dataset.editorExportProgress) || Number(el.dataset.editorExportProgress.split('/')[0]) > 150; }", timeout=120000)
                page.screenshot(path=os.path.join(OUT, 'export-sheet-running.png'))
                # Edit while exporting: delete the first cut. The file must still be the film as it was.
                click_cut(1)
                press('Delete')
                during = state()['cuts']
                check('editing goes on while the export runs', len(during) == len(final_cuts) - 1, json.dumps(during))
                press('Control+z')
                page.wait_for_selector('[data-editor-export-status=done], [data-editor-export-status=failed]', timeout=600000)
                report_path(page)
                if page.get_attribute('[data-editor-export-sheet]', 'data-editor-export-status') != 'done':
                    raise Stopped()
        except Stopped:
            failed = page.locator('[data-editor-export-failed]')
            check('export finished', False, (failed.inner_text() if failed.count() else '?') + ' | ' + ' / '.join(console))
            page.screenshot(path=os.path.join(OUT, 'export-sheet-failed.png'))
            browser.close()
            sys.exit(1)
        download = download_info.value
        took = time.time() - started
        status = page.get_attribute('[data-editor-export-sheet]', 'data-editor-export-status')
        check('export finished', status == 'done', status)
        ms = page.get_attribute('[data-editor-export-done]', 'data-editor-export-ms') if status == 'done' else None
        check(f'export time for a {total / FPS:.2f} s film', status == 'done', f'{took:.1f} s wall clock, {int(ms or 0) / 1000:.1f} s inside the exporter')
        path = os.path.join(OUT, download.suggested_filename)
        download.save_as(path)
        page.screenshot(path=os.path.join(OUT, 'export-sheet-done.png'))
        check('restored after undo', state()['cuts'] == final_cuts, json.dumps(state()['cuts']))

        # ── Read the file back on disk ──
        streams = probe(path)
        video = next(s for s in streams if s['codec_type'] == 'video')
        audio = next((s for s in streams if s['codec_type'] == 'audio'), None)
        print('      ffprobe video: ' + json.dumps(video))
        print('      ffprobe audio: ' + json.dumps(audio))
        check('video is H.264 at the film rate (24/1)', video['codec_name'] == 'h264' and video['r_frame_rate'] == '24/1' and video['avg_frame_rate'] == '24/1',
              f"{video['codec_name']} {video.get('profile')} r={video['r_frame_rate']} avg={video['avg_frame_rate']}")
        check('frame count equals the film', int(video['nb_read_frames']) == total and int(video['nb_frames']) == total, f"read {video['nb_read_frames']}, header {video['nb_frames']}, film {total}")
        check('size is the 16:9 output', (video['width'], video['height']) == (1920, 1080), f"{video['width']}x{video['height']}")
        durations = packet_durations(path)
        tb = video['time_base']
        check('every frame lasts exactly 1/24 s', tb == '1/90000' and len(durations) == total and set(durations) == {3750}, f'time base {tb}, {len(durations)} packets, durations {sorted(set(durations))}')
        vdur = float(video['duration'])
        check('picture length is total / 24', abs(vdur - total / FPS) < 1e-6, f'{vdur:.6f} s vs {total / FPS:.6f} s')
        check('there is an AAC sound track, 48 kHz stereo', bool(audio) and audio['codec_name'] == 'aac' and audio['sample_rate'] == '48000' and audio['channels'] == 2,
              json.dumps(audio and {k: audio[k] for k in ('codec_name', 'sample_rate', 'channels')}))
        adur = float(audio['duration']) if audio else -1
        check('sound is as long as the picture within one frame', audio is not None and abs(adur - vdur) <= 1 / FPS, f'audio {adur:.6f} s, video {vdur:.6f} s, diff {(adur - vdur) * 1000:.1f} ms')

        numbers = decode_numbers(path, int(video['width']), int(video['height']))
        check('ffmpeg decoded every frame', len(numbers) == total, f'{len(numbers)} frames')
        wrong = [(f, numbers[f] if f < len(numbers) else None, n) for f, n in sorted(expected.items()) if f >= len(numbers) or numbers[f] != n]
        check('every m7 frame shows exactly the planned source frame', not wrong and len(expected) == 105, f'{len(expected)} frames checked, mismatches {wrong[:8]}')
        seg = lambda a, b: numbers[a:b]
        print(f'      around the cut 4 | 2x piece  (film {start - 2}..{start + 3}): {seg(start - 2, start + 4)}')
        print(f'      2x piece                    (film {start}..{start + 14}): {seg(start, start + 15)}')
        print(f'      2x | 1x piece   (film {start + 12}..{start + 17}): {seg(start + 12, start + 18)}')
        print(f'      1x | 0.5x piece (film {start + 42}..{start + 49}): {seg(start + 42, start + 50)}')
        print(f'      end of 0.5x piece (film {total - 6}..{total - 1}): {seg(total - 6, total)}')
        check('2x piece shows every other number 90..118', seg(start, start + 15) == list(range(90, 120, 2)), str(seg(start, start + 15)))
        print(f'      split inside the 1x piece (film {split_at - 3}..{split_at + 2}): {seg(split_at - 3, split_at + 3)}')
        check('1x halves show 0..14 then 15..29, each once', seg(start + 15, start + 45) == list(range(0, 30)), str(seg(start + 15, start + 45)))
        check('at the split, N-1 is followed by N', seg(split_at - 1, split_at + 1) == [14, 15], f'film {split_at - 1}: {numbers[split_at - 1]}, film {split_at}: {numbers[split_at]}')
        check('0.5x piece shows each number twice 60..89', seg(start + 45, total) == [n for n in range(60, 90) for _ in (0, 1)], str(seg(start + 45, start + 51)) + '...')

        # ── Play the same file to the end in the browser ──
        size_page = page.evaluate("async () => (await (await fetch(document.querySelector('[data-editor-export-again]').href)).blob()).size")
        check('the page still holds the same file', size_page == os.path.getsize(path), f'{size_page} bytes in the page, {os.path.getsize(path)} on disk')
        played = page.evaluate("""async () => {
          const href = document.querySelector('[data-editor-export-again]').href;
          const v = document.createElement('video');
          v.muted = true; v.playsInline = true; v.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px';
          document.body.appendChild(v);
          const errors = [];
          v.addEventListener('error', () => errors.push(v.error ? v.error.code + ' ' + v.error.message : 'error'));
          const ended = new Promise((resolve) => v.addEventListener('ended', () => resolve(true), { once: true }));
          v.src = href;
          const t0 = performance.now();
          await v.play().catch((e) => errors.push(String(e)));
          const ok = await Promise.race([ended, new Promise((r) => setTimeout(() => r(false), 60000))]);
          const out = { ended: ok, errors, duration: v.duration, currentTime: v.currentTime, ms: Math.round(performance.now() - t0) };
          v.remove();
          return out;
        }""")
        check('the file plays to the end in the browser (ended, no error)', played['ended'] and not played['errors'], json.dumps(played))

        # ── Sound placement: the sample footage is silent, so the file cannot show where a cut's sound
        # lands. This hands the browser the exporter's own calls for the three m7 pieces (start on the
        # cut's first sample from its first frame, stop half a sample before the next cut, at the cut's
        # speed) over a ramp, and reads back the first and last sample written and where they were read.
        pieces = [(start * 2000, (start + 15) * 2000, 90 / 24, 2.0), ((start + 15) * 2000, (start + 45) * 2000, 0.0, 1.0), ((start + 45) * 2000, total * 2000, 60 / 24, 0.5)]
        placed = page.evaluate("""async ({ pieces, length }) => {
          const sr = 48000, out = [];
          for (const [s, e, offset, rate] of pieces) {
            const ctx = new OfflineAudioContext(1, length, sr);
            const buffer = ctx.createBuffer(1, 10 * sr, sr);
            const d = buffer.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = 1 + i / 1e6;
            const src = ctx.createBufferSource();
            src.buffer = buffer; src.playbackRate.value = rate; src.connect(ctx.destination);
            src.start(s / sr, offset);
            src.stop((e - 0.5) / sr);
            const r = (await ctx.startRendering()).getChannelData(0);
            let first = -1, last = -1;
            for (let i = 0; i < r.length; i++) if (r[i] !== 0) { if (first < 0) first = i; last = i; }
            out.push({ first, end: last + 1, readFirst: (r[first] - 1) * 1e6, readLast: (r[last] - 1) * 1e6 });
          }
          return out;
        }""", {'pieces': pieces, 'length': total * 2000})
        ok = all(p['first'] == s and p['end'] == e and abs(p['readFirst'] - o * 48000) < 0.5 and abs(p['readLast'] - (o * 48000 + (e - 1 - s) * r)) < 0.5
                 for p, (s, e, o, r) in zip(placed, pieces))
        check('the browser writes each m7 piece’s sound on exactly its planned samples', ok,
              '; '.join(f"[{p['first']}, {p['end']}) read {p['readFirst']:.1f}..{p['readLast']:.1f} (planned [{s}, {e}) from {o * 48000:.0f} at {r}x)" for p, (s, e, o, r) in zip(placed, pieces)))

        check('no page errors', not errors, '; '.join(errors[:3]))
        browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
