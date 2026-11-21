"""Real-browser check of the export's sound safety (review round 1, item 10; components/brand-studio/
editor-v2/export-film.ts, lib/brand-studio/editor-v2/media-probe.ts).

  (1) a clip that HAS a sound track the browser cannot decode: the export finishes and the sheet names
      the clip in a warning (here the export's own read of an uploaded clip with sound is served with its
      sound codec name changed, so the track is still declared but cannot be decoded; the picture is the
      real file). A clip with no sound track at all gets no warning;
  (2) sources that add up to more than the limit: the export does not start and says so plainly (only files
      read whole for their sound count: a clip with no sound track is not; here
      the export's size question about one source is answered with 2 GiB);
  (3) measurement, not a pass/fail: a source whose first frame is not at 0. Three generated files, each
      with a white flash and a 1 kHz beep at the same media time: first frame at 0; video starting at
      0.5 s with sound at 0; both starting at 0.5 s. Each is exported from v2 and read back with ffmpeg:
      how far the beep lands from the flash.

The generated files are made here with ffmpeg (lavfi, nothing downloaded) and served only inside this
browser by Playwright routing in place of an uploaded clip's address.

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id>, whose organization has an uploaded video with sound and
one without. The id comes from the environment:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-export-safety-check.py <out-dir>

Python Playwright with its own full Chromium and a fresh profile; localhost only; never attaches to another
browser; ffmpeg/ffprobe on PATH. Prints PASS/FAIL and MEASURE lines, exits non-zero on any failure.
"""
import json
import os
import re
import struct
import subprocess
import sys

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
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
results = []

SOURCES = """async () => {
  const out = [];
  for (const el of document.querySelectorAll('[data-editor-source]')) {
    const key = el.dataset.editorSource;
    if (!key.startsWith('a:')) continue;
    const params = new URLSearchParams({ organizationId: ORG, source: 'asset', id: key.slice(2) });
    const src = `/api/brand-studio/compose?${params}`;
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    const text = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 4096)));
    let sound = false;
    for (let i = 0; i + 4 <= bytes.length; i += 1) if (bytes[i] === 0x73 && bytes[i + 1] === 0x6f && bytes[i + 2] === 0x75 && bytes[i + 3] === 0x6e) { sound = true; break; }
    out.push({ key, src, sound, label: (el.textContent || '').trim().slice(0, 40), mp4: text.includes('ftyp') });
  }
  return out;
}"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def measure(text):
    print('MEASURE  ' + text, flush=True)


def run(args):
    return subprocess.run(args, capture_output=True, check=True, creationflags=NO_WINDOW)


def make_offset_files(folder):
    """Three 3 s files at 24 fps: flash on source frame 24, a 1 kHz beep at the same media time."""
    v = os.path.join(folder, 'v.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=3', '-vf',
         "drawbox=enable='eq(n,24)':x=0:y=0:w=iw:h=ih:color=white:t=fill", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24', '-bf', '0', v])
    beep = lambda at, out: run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.05', '-af',
                                f'adelay={at}|{at},apad=whole_dur=3.5', '-ac', '2', out])
    b1000, b1500 = os.path.join(folder, 'b1000.wav'), os.path.join(folder, 'b1500.wav')
    beep(1000, b1000)
    beep(1500, b1500)
    files = {
        'first frame at 0': os.path.join(folder, 'plain.mp4'),
        'video at 0.5 s, sound at 0': os.path.join(folder, 'video-late.mp4'),
        'both at 0.5 s': os.path.join(folder, 'both-late.mp4'),
    }
    run(['ffmpeg', '-v', 'error', '-y', '-i', v, '-i', b1000, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', files['first frame at 0']])
    run(['ffmpeg', '-v', 'error', '-y', '-itsoffset', '0.5', '-i', v, '-i', b1500, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', files['video at 0.5 s, sound at 0']])
    run(['ffmpeg', '-v', 'error', '-y', '-i', v, '-i', b1000, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-output_ts_offset', '0.5', files['both at 0.5 s']])
    return files


def flash_and_beep(path):
    """The first frame whose centre is white, and the first sample of the beep, in the exported file."""
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate', '-of', 'json', path]).stdout)['streams']
    video = next(s for s in probe if s['codec_type'] == 'video')
    num, den = (int(x) for x in video['r_frame_rate'].split('/'))
    fps = num / den
    raw = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'crop=iw/4:ih/8:iw*3/8:ih*7/16,scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout
    frames = [raw[i:i + 64] for i in range(0, len(raw), 64)]
    flash = next((i for i, f in enumerate(frames) if sum(f) / 64 > 128), None)
    pcm = run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']).stdout
    samples = struct.unpack(f'<{len(pcm) // 2}h', pcm)
    beep = next((i for i, x in enumerate(samples) if abs(x) > 1500), None)
    return fps, flash, beep


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG or not OUT:
        sys.exit('EDITOR_ORG_ID and an out-dir are required')
    os.makedirs(OUT, exist_ok=True)
    offset_files = make_offset_files(OUT)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def open_v2():
            page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}{PATH_QUERY}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=240000)
            page.wait_for_timeout(700)

        def film_of(asset, src, seconds, aspect='16:9', duration=None):
            return {'version': 1, 'aspect': aspect, 'captions': [], 'bgm': None,
                    'clips': [{'id': f'safety-{asset[:6]}', 'label': 'safety clip', 'sourceKind': 'asset', 'assetId': asset, 'srcUrl': src, 'thumbUrl': None,
                               'durationSec': duration or seconds, 'trimStartSec': 0, 'trimEndSec': seconds, 'volume': 1, 'muted': False}]}

        def export(name):
            if not page.locator('[data-editor-export-sheet]').count():
                page.click('[data-editor-export]')
            page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
            page.wait_for_timeout(300)
            download = None
            try:
                with page.expect_download(timeout=20000) as info:
                    page.click('[data-editor-export-start]')
                    page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=done], [data-editor-export-sheet][data-editor-export-status=failed]', timeout=300000)
                    report_path(page)
                download = info.value
            except Exception:
                pass
            status = page.get_attribute('[data-editor-export-sheet]', 'data-editor-export-status')
            path = None
            if download is not None and status == 'done':
                path = os.path.join(OUT, f'{name}.mp4')
                download.save_as(path)
            return status, path

        open_v2()
        sources = page.evaluate(SOURCES.replace('ORG', json.dumps(ORG)))
        with_sound = next((s for s in sources if s['sound'] and s['mp4']), None)
        without = next((s for s in sources if not s['sound'] and s['mp4'] and not re.search('프레임|frame', s['label'], re.I)), None)
        check('the organization has an uploaded clip with sound and one without', with_sound is not None and without is not None,
              json.dumps([(s['sound'], s['mp4']) for s in sources]))
        if not with_sound or not without:
            return finish(browser, errors)

        # (1) A sound track that cannot be decoded: the export's own read of the clip (a GET without Range)
        # gets the same file with its sound re-encoded as AC-3, which this browser does not decode.
        asset = with_sound['key'][2:]
        media = re.compile(r'/api/brand-studio/compose\?.*id=' + re.escape(asset))
        undecodable = {}

        def broken_sound(route):
            if route.request.method != 'GET' or route.request.headers.get('range'):
                return route.continue_()
            if 'body' not in undecodable:
                original, changed = os.path.join(OUT, 'with-sound.mp4'), os.path.join(OUT, 'with-sound-ac3.mp4')
                open(original, 'wb').write(route.fetch().body())
                run(['ffmpeg', '-v', 'error', '-y', '-i', original, '-c:v', 'copy', '-c:a', 'ac3', changed])
                undecodable['body'] = open(changed, 'rb').read()
            route.fulfill(status=200, body=undecodable['body'], headers={'Content-Type': 'video/mp4'})

        context.route(media, broken_sound)
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film_of(asset, with_sound['src'], 2, duration=6))])
        open_v2()
        status, path = export('safety-undecodable-sound')
        warning = page.locator('[data-editor-export-warning="sound"]')
        check('(1) a sound track that cannot be decoded: the export finishes and names the clip', status == 'done' and warning.count() == 1 and 'safety clip' in warning.inner_text(),
              warning.inner_text() if warning.count() else f'status {status}, no warning')
        page.screenshot(path=os.path.join(OUT, 'safety-warning-1440.png'))
        context.unroute(media, broken_sound)

        # …and a clip with no sound track gets no warning.
        asset_quiet = without['key'][2:]
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film_of(asset_quiet, without['src'], 2, duration=4))])
        open_v2()
        status, path = export('safety-no-sound-track')
        check('(1) a clip with no sound track: done, no warning', status == 'done' and page.locator('[data-editor-export-warning]').count() == 0, f'status {status}')

        # (2) More than the limit: the size question is answered with 2 GiB. Only files the export reads whole
        # for their sound count (spec F): a clip whose own boxes have no sound track is not read for sound.
        heavy = re.compile(r'/api/brand-studio/compose\?.*id=' + re.escape(asset_quiet))

        def huge(route):
            if route.request.method == 'HEAD':
                return route.fulfill(status=200, headers={'Content-Length': str(2 * 1024 ** 3), 'Content-Type': 'video/mp4'}, body='')
            return route.continue_()

        context.route(heavy, huge)
        open_v2()
        status, _ = export('safety-silent-not-limited')
        check('(2) a clip with no sound track is not read whole for sound: its size does not stop the export', status == 'done', f'status {status}')
        context.unroute(heavy, huge)
        loud = re.compile(r'/api/brand-studio/compose\?.*id=' + re.escape(asset))
        context.route(loud, huge)
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film_of(asset, with_sound['src'], 2, duration=6))])
        open_v2()
        status, _ = export('safety-too-large')
        failed = page.locator('[data-editor-export-failed="memory"]')
        check('(2) sources over the limit: the export does not start and says why', status == 'failed' and failed.count() == 1 and '2.0 GB' in failed.inner_text() and '1.0 GB' in failed.inner_text(),
              failed.inner_text() if failed.count() else f'status {status}')
        page.screenshot(path=os.path.join(OUT, 'safety-too-large-1440.png'))
        context.unroute(loud, huge)

        # (3) First frame not at 0: export each generated file in place of the clip, read flash and beep back.
        def server_of(body):
            def serve(route):
                rng = route.request.headers.get('range')
                if route.request.method == 'HEAD':
                    return route.fulfill(status=200, headers={'Content-Length': str(len(body)), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes'}, body='')
                if rng and rng.startswith('bytes='):
                    a, _, b = rng[6:].partition('-')
                    start, end = int(a or 0), min(int(b) if b else len(body) - 1, len(body) - 1)
                    return route.fulfill(status=206, body=body[start:end + 1], headers={'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {start}-{end}/{len(body)}'})
                return route.fulfill(status=200, body=body, headers={'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes'})
            return serve

        for name, file in offset_files.items():
            serve = server_of(open(file, 'rb').read())
            context.route(heavy, serve)
            page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film_of(asset_quiet, without['src'], 2.5, duration=3))])
            open_v2()
            status, path = export('offset-' + re.sub('[^a-z0-9]+', '-', name))
            context.unroute(heavy, serve)
            if status != 'done' or not path:
                check(f'(3) {name}: exported', False, f'status {status}')
                continue
            fps, flash, beep = flash_and_beep(path)
            if flash is None or beep is None:
                check(f'(3) {name}: flash and beep found', False, f'flash {flash}, beep {beep}')
                continue
            error_ms = (beep / 48000 - flash / fps) * 1000
            measure(f'{name}: flash on film frame {flash} ({flash / fps * 1000:.1f} ms), beep at sample {beep} ({beep / 48:.1f} ms): sound {error_ms:+.1f} ms from the picture')
        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser, errors)


def finish(browser, errors):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
