"""Real-browser proof of the export's decoder path (spec F): frames from a decoder fed from the file, not from
a <video> sent to each frame and confirmed by the screen.

Parts (all by default, or name some):
  sources   generated frame-numbered sources (24, 25, 30, 23.976, 29.97, 60 fps; B-frames; fragmented; a
            30 fps source in a 24 fps film; a variable-frame-rate file whose every picture shows its own number;
            90° and 270° phone-style rotation; non-square pixels; HEVC if this Chromium decodes it; WebM, which
            must fall back): each film exported through the decoder path AND the seek path (forced with
            ?exportPath=), the picture numbers read back with ffmpeg and compared with the expected ones and
            with each other, and the two files compared pixel by pixel (mean difference per channel);
  fallback  the decoder configuration refused (VideoDecoder.isConfigSupported stubbed in the page): the seek
            path makes the file, and in the "visible but one frame a second" state (the in-page stand-in of
            scripts/editor-v2-covered-window-check.py) the sheet says the window is slow; the same state on the
            decoder path: no such line, and it finishes at full speed;
  error     a decoder error injected in the middle of a cut: the rest of that source is taken by seeking and
            the file is still exact;
  c3        the production shape (spec E addendum C3): three sources of 4.06 s, 4.06 s and 5.06 s at 24 fps
            (97 + 97 + 121 pictures), each cut to its end, exported in a front window and in a covered window
            of a page nothing drives;
  times     the standard four-clip film (665 frames) and a generated 60 s 1080p film, seek path vs decoder path,
            in a front window, a covered window, a minimised window and a background tab of a page NOTHING
            drives (spec F: the script starts Playwright's own Chromium as a separate process with a fresh
            profile and a free debugging port, connects over CDP to set up and press export, disconnects, then
            hides the window through Windows by its own handle; an in-page log records animation frames,
            visibility and progress), each twice; bytes read for pictures vs file sizes; peak memory of the
            browser's processes (working set, sampled every ~1.5 s).

  EDITOR_BASE_URL=http://localhost:3621 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-decoder-check.py <out-dir> <media-dir> [part ...]

The server runs with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id>
(local mode, proven first with the covered-window check's guard). Generated sources are uploaded to that
organization through the local API and deleted at the end.
Python Playwright with its own Chromium and fresh profiles; localhost only; CDP only to a Chromium process this
script started; ffmpeg/ffprobe and numpy on PATH. Prints PASS/FAIL and MEASURE lines; exits non-zero on failure.
Windows only for the window parts (ctypes). Leaves no browser running.
"""
import ctypes
import ctypes.wintypes
import importlib.util
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

import numpy as np
from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3621')
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
MEDIA = sys.argv[2] if len(sys.argv) > 2 else None
PARTS = set(sys.argv[3:]) or {'sources', 'fallback', 'error', 'c3', 'times'}
REPEATS = int(os.environ.get('EDITOR_REPEATS', '2'))
KEY = f'twings_studio_compose_v1:{ORG}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
results = []

# The covered-window check's helpers: the "visible, one frame a second" stand-in and the C3 sources.
_spec = importlib.util.spec_from_file_location('covered_window_check', os.path.join(ROOT, 'scripts', 'editor-v2-covered-window-check.py'))
cw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cw)


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def measure(text):
    print('MEASURE  ' + text, flush=True)


def run(args, **kw):
    return subprocess.run(args, capture_output=True, check=True, creationflags=NO_WINDOW, **kw)


# ── Generated sources: every picture carries its number as nine squares (as frame-count-24.mp4 does) ──

def squares(scale):
    """The frame-count clip's squares (white, dark, bits 8..0 of the frame number), scaled from 640×360."""
    box, step, x0, y0 = round(40 * scale), round(52 * scale), round(34 * scale), round(286 * scale)
    parts = [f'drawbox=x={x0}:y={y0}:w={box}:h={box}:color=white:t=fill', f'drawbox=x={x0 + step}:y={y0}:w={box}:h={box}:color=0x26262b:t=fill']
    for i, bit in enumerate(range(8, -1, -1)):
        x = x0 + step * (i + 2)
        parts.append(f'drawbox=x={x}:y={y0}:w={box}:h={box}:color=0x26262b:t=fill')
        parts.append(f"drawbox=x={x}:y={y0}:w={box}:h={box}:color=white:t=fill:enable='eq(mod(floor(n/{2 ** bit}),2),1)'")
    return ','.join(parts)


def numbered(path, rate, frames, width=640, height=360, encode=('-c:v', 'libx264', '-bf', '0', '-g', '24', '-pix_fmt', 'yuv420p'), post='', out=(), sound=None):
    """A colourful test picture (testsrc2) with the frame number in squares, `frames` pictures at `rate`."""
    if os.path.exists(path):
        return path
    inputs = ['-f', 'lavfi', '-i', f'testsrc2=s={width}x{height}:r={rate}']
    maps = ['-map', '0:v']
    if sound:
        inputs += ['-f', 'lavfi', '-i', f'sine=frequency=440:sample_rate=48000:duration={sound}']
        maps += ['-map', '1:a', '-c:a', 'aac', '-b:a', '128k']
    vf = squares(width / 640) + (',' + post if post else '')
    run(['ffmpeg', '-v', 'error', '-y', *inputs, *maps, '-vf', vf, '-frames:v', str(frames), *encode, *out, path])
    return path


def make_media(folder):
    os.makedirs(folder, exist_ok=True)
    m = lambda name: os.path.join(folder, name)
    files = {}
    for label, rate, frames in [('24', '24', 120), ('25', '25', 125), ('30', '30', 150), ('23.976', '24000/1001', 120), ('29.97', '30000/1001', 150), ('60', '60', 300)]:
        files[f'n{label}'] = numbered(m(f'n{label}.mp4'), rate, frames, out=('-movflags', '+faststart'))
    files['bframes'] = numbered(m('bframes30.mp4'), '30', 150, encode=('-c:v', 'libx264', '-bf', '3', '-g', '30', '-pix_fmt', 'yuv420p'))
    files['frag'] = numbered(m('frag24.mp4'), '24', 120, out=('-movflags', 'frag_keyframe+empty_moov+default_base_moof'))
    # Variable frame rate: 24 pictures at 1/24 s, 30 at 1/30 s, 12 at 1/12 s, each with its own number.
    if not os.path.exists(m('vfr.mp4')):
        # A fine time base first (the source's 1/24 would round the times), and the encoder keeps it.
        expr = 'if(lt(N\\,24)\\,N/24\\,if(lt(N\\,54)\\,1+(N-24)/30\\,2+(N-54)/12))/TB'
        numbered(m('vfr.mp4'), '24', 66, post=f'settb=1/12000,setpts={expr}', out=('-fps_mode', 'passthrough', '-enc_time_base', '1/12000', '-video_track_timescale', '12000'))
    files['vfr'] = m('vfr.mp4')
    for turn in (90, 270):
        path = m(f'rot{turn}.mp4')
        if not os.path.exists(path):
            # -display_rotation turns counter-clockwise: 90 clockwise is -90.
            run(['ffmpeg', '-v', 'error', '-y', '-display_rotation', str(-turn), '-i', files['n24'], '-c', 'copy', path])
        files[f'rot{turn}'] = path
    files['sar'] = numbered(m('sar43.mp4'), '24', 120, post='scale=480:360,setsar=4/3')
    files['hevc'] = numbered(m('hevc.mp4'), '24', 120, encode=('-c:v', 'libx265', '-tag:v', 'hvc1', '-x265-params', 'log-level=error:bframes=0', '-pix_fmt', 'yuv420p'))
    files['webm'] = numbered(m('vp9.webm'), '24', 120, encode=('-c:v', 'libvpx-vp9', '-b:v', '1M', '-pix_fmt', 'yuv420p'))
    return files


def long_media(folder):
    """Three 20 s 1080p sources with sound, 3 Mb/s (480 pictures each: the squares hold numbers up to 511)."""
    paths = []
    for i in range(3):
        # 3 Mb/s keeps each under 10 MB: the local development server cuts request bodies above that (it
        # clones them through middleware), so a larger upload arrives short and is refused.
        path = os.path.join(folder, f'long3m-{i + 1}.mp4')
        numbered(path, '24', 480, 1920, 1080, encode=('-c:v', 'libx264', '-preset', 'fast', '-b:v', '3M', '-maxrate', '3.5M', '-bufsize', '6M', '-bf', '2', '-g', '48', '-pix_fmt', 'yuv420p'), out=('-movflags', '+faststart'), sound=20)
        paths.append(path)
    return paths


def frame_times(path):
    """Presentation times of every picture, in seconds, in presentation order (ffprobe)."""
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'json', path]).stdout
    times = sorted(float(f.get('pts_time') or f.get('best_effort_timestamp_time')) for f in json.loads(out)['frames'])
    return times


def probe(path):
    out = run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,r_frame_rate,nb_read_frames,width,height,duration', '-of', 'json', path]).stdout
    return json.loads(out)['streams']


# ── Reading the exported file ──

SQUARE_X = [34 + 52 * i + 20 for i in range(11)]
SQUARE_Y = 306


def decode_numbers(path, frame_w, frame_h, rect):
    """Frame numbers from the squares, where the 640×360-based source sits in the output at `rect` (x, y, w, h)."""
    rx, ry, rw, rh = rect
    sx, sy = rw / 640, rh / 360
    y = round(ry + SQUARE_Y * sy)
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={frame_w}:2:0:{y - y % 2}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, creationflags=NO_WINDOW)
    size = frame_w * 2 * 3
    numbers = []
    while True:
        frame = proc.stdout.read(size)
        if len(frame) < size:
            break
        row = frame[frame_w * 3 * (y % 2): frame_w * 3 * (y % 2 + 1)]

        def level(i):
            x = round(rx + SQUARE_X[i] * sx)
            return (row[x * 3] + row[x * 3 + 1] + row[x * 3 + 2]) / 3

        white, dark = level(0), level(1)
        if white < 170 or dark > 100:
            numbers.append(-1)
            continue
        n = 0
        for bit in range(9):
            n = n * 2 + (1 if level(2 + bit) > (white + dark) / 2 else 0)
        numbers.append(n)
    proc.wait()
    return numbers


def pixel_difference(a, b, width, height):
    """Mean absolute and mean signed difference per channel (R, G, B) over every frame of two files of one size."""
    procs = [subprocess.Popen(['ffmpeg', '-v', 'error', '-i', p, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, creationflags=NO_WINDOW) for p in (a, b)]
    size = width * height * 3
    absolute = np.zeros(3)
    signed = np.zeros(3)
    frames = 0
    while True:
        fa, fb = (proc.stdout.read(size) for proc in procs)
        if len(fa) < size or len(fb) < size:
            break
        da = np.frombuffer(fa, np.uint8).reshape(-1, 3).astype(np.int16)
        db = np.frombuffer(fb, np.uint8).reshape(-1, 3).astype(np.int16)
        d = da - db
        absolute += np.abs(d).mean(axis=0)
        signed += d.mean(axis=0)
        frames += 1
    for proc in procs:
        proc.stdout.close()
        proc.wait()
    return (absolute / max(1, frames)).round(3).tolist(), (signed / max(1, frames)).round(3).tolist(), frames


def expected_even(cut_frames, source_fps, film_fps, source_frames):
    """frames.ts for a whole cut from frame 0: film frame o shows source frame floor(o × rate / fps)."""
    return [min(source_frames - 1, math.floor(o * source_fps / film_fps + 1e-9)) for o in range(cut_frames)]


def expected_by_time(cut_frames, film_fps, times):
    """The picture whose span holds the film frame's moment, on the file's own timestamps."""
    rel = [t - times[0] for t in times]
    out = []
    for o in range(cut_frames):
        moment = o / film_fps + 1e-6
        k = max(i for i, t in enumerate(rel) if t <= moment)
        out.append(k)
    return out


# ── The organization: uploads and stored films ──

API = f'{BASE}/api/brand-studio'
HEADERS = {'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': BASE}
uploaded = []


def upload(context, name, path, width, height, seconds):
    data = open(path, 'rb').read()
    mime = 'video/webm' if path.endswith('.webm') else 'video/mp4'
    reserved = context.request.post(API, data=json.dumps({'operation': 'asset.reserve', 'input': {'organizationId': ORG, 'requestId': os.urandom(16).hex(), 'name': name, 'mime': mime, 'sizeBytes': len(data)}}), headers=HEADERS).json()
    reserved = reserved.get('data', reserved)
    if 'id' not in reserved:
        raise SystemExit(f'upload of {name} refused: {json.dumps(reserved)[:300]}')
    uploaded.append(reserved['id'])
    target = reserved.get('url') if reserved.get('direct') else None
    if target and not target.startswith(BASE):
        raise SystemExit('refusing a non-local upload address')
    if target:
        put = context.request.put(target, data=data, headers={'Content-Type': mime})
    else:
        put = context.request.post(f'{API}/assets/{reserved["id"]}?organizationId={ORG}', data=data, headers={'Content-Type': mime, 'Origin': BASE})
    if not put.ok:
        raise SystemExit(f'upload failed: {put.status}')
    context.request.post(API, data=json.dumps({'operation': 'asset.complete', 'input': {'organizationId': ORG, 'assetId': reserved['id'], 'width': width, 'height': height, 'seconds': round(seconds, 1)}}), headers=HEADERS)
    return reserved['id']


def delete_uploads(context):
    for asset in uploaded:
        context.request.post(API, data=json.dumps({'operation': 'asset.delete', 'input': {'organizationId': ORG, 'assetId': asset}}), headers=HEADERS)


def src_of(asset_id):
    return '/api/brand-studio/compose?' + urllib.parse.urlencode({'organizationId': ORG, 'source': 'asset', 'id': asset_id})


def stored_film(cuts, aspect='16:9'):
    """A film as the current editor stores it: each cut (asset id, label, length in s, trim from–to in s)."""
    return {'version': 1, 'aspect': aspect, 'captions': [], 'bgm': None,
            'clips': [{'id': f'cut-{i}', 'label': label, 'sourceKind': 'asset', 'assetId': asset, 'srcUrl': src_of(asset), 'thumbUrl': None,
                       'durationSec': seconds, 'trimStartSec': start, 'trimEndSec': end, 'volume': 1, 'muted': False}
                      for i, (asset, label, seconds, start, end) in enumerate(cuts)]}


STATE = """() => {
  const preview = document.querySelector('[data-editor-preview]');
  return { fps: preview ? Number(preview.dataset.editorFps) : 0, cuts: [...document.querySelectorAll('[data-editor-clip]')].map((el) => Number(el.dataset.frames)) };
}"""

DONE_INFO = """() => {
  const s = document.querySelector('[data-editor-export-sheet]');
  const d = document.querySelector('[data-editor-export-done]');
  const f = document.querySelector('[data-editor-export-failed]');
  return { status: s && s.dataset.editorExportStatus, ms: d ? Number(d.dataset.editorExportMs) : null, path: d ? d.dataset.editorExportPath : null,
    paths: d ? JSON.parse(d.dataset.editorExportPaths || '[]') : [], failed: f ? f.dataset.editorExportFailed + ': ' + f.textContent : null,
    warnings: [...document.querySelectorAll('[data-editor-export-warning]')].map((el) => el.dataset.editorExportWarning) };
}"""


def editor_url(path=''):
    return f'{BASE}/brand/studio/editor?organizationId={ORG}' + (f'&exportPath={path}' if path else '')


def open_film(page, film, path=''):
    page.goto(BASE + '/brand/library', wait_until='domcontentloaded', timeout=300000) if page.url == 'about:blank' else None
    page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film)])
    page.goto(editor_url(path), wait_until='domcontentloaded', timeout=300000)
    page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=300000)
    page.wait_for_timeout(600)
    return page.evaluate(STATE)


def export_driven(page, name, watch_slow=False):
    """Presses export in a page Playwright drives; returns the outcome, the time and the file."""
    page.click('[data-editor-export]')
    page.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
    looks = []
    started = time.time()
    if page.locator('[data-editor-export-start][disabled]').count():
        page.wait_for_timeout(3000)
    if page.locator('[data-editor-export-start][disabled]').count():
        blocked = page.locator('[data-editor-export-blocked]')
        reason = (blocked.get_attribute('data-editor-export-blocked') + ': ' + blocked.inner_text()) if blocked.count() else '?'
        page.keyboard.press('Escape')
        return {'status': 'refused', 'ms': None, 'path': None, 'paths': [], 'failed': reason, 'warnings': [], 'took': 0.0, 'looks': [], 'file': None}
    page.click('[data-editor-export-start]')
    while True:
        info = page.evaluate("""() => { const s = document.querySelector('[data-editor-export-sheet]'); const p = document.querySelector('[data-editor-export-progress]');
          return { status: s && s.dataset.editorExportStatus, progress: p ? p.dataset.editorExportProgress : null, now: p ? p.dataset.editorExportPathNow : null, slow: !!document.querySelector('[data-editor-export-slow]') }; }""")
        info['t'] = round(time.time() - started, 2)
        looks.append(info)
        if info['status'] not in ('running', 'idle') or time.time() - started > 1200:
            break
        time.sleep(0.25 if watch_slow else 0.15)
    took = time.time() - started
    outcome = page.evaluate(DONE_INFO)
    outcome.update({'took': took, 'looks': looks, 'file': None})
    if outcome['status'] == 'done':
        with page.expect_download(timeout=60000) as download:
            page.click('[data-editor-export-again]')
        outcome['file'] = os.path.join(OUT, f'{name}.mp4')
        download.value.save_as(outcome['file'])
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    return outcome


def path_line(name, outcome):
    if outcome['status'] != 'done':
        measure(f'{name}: {outcome["status"]} after {outcome["took"]:.1f} s: {outcome["failed"]}')
    measure(f'{name}: path {outcome["path"]} ' + json.dumps([{k: e[k] for k in ("clip", "path", "reason", "decoded", "seeked", "bytesRead", "fileBytes")} for e in outcome['paths']], ensure_ascii=False))


# ── Parts ──

def part_sources(page, context, media):
    films = []
    ids = {}

    def add(key, name, width, height, seconds):
        if key not in ids:
            ids[key] = upload(context, name, media[key], width, height, seconds)
        return ids[key]

    for key, rate in [('n24', 24), ('n25', 25), ('n30', 30), ('n23.976', 24000 / 1001), ('n29.97', 30000 / 1001), ('n60', 60), ('bframes', 30), ('frag', 24)]:
        count = {'n24': 120, 'n25': 125, 'n30': 150, 'n23.976': 120, 'n29.97': 150, 'n60': 300, 'bframes': 150, 'frag': 120}[key]
        seconds = count / rate
        asset = add(key, f'decoder-check {key}.mp4', 640, 360, seconds)
        films.append((key, stored_film([(asset, key, seconds, 0, seconds)]), 'even', rate, count))
    # A 30 fps source in a 24 fps film: the first cut sets the film's rate.
    a24, a30 = ids['n24'], ids['n30']
    films.append(('30-in-24', stored_film([(a24, 'n24', 5, 0, 1), (a30, 'n30', 5, 0, 5)]), 'mixed', 30, 150))
    vfr_times = frame_times(media['vfr'])
    films.append(('vfr', stored_film([(add('vfr', 'decoder-check vfr.mp4', 640, 360, 3), 'vfr', 3, 0, 3)]), 'vfr', None, len(vfr_times)))
    for key in ('rot90', 'rot270'):
        films.append((key, stored_film([(add(key, f'decoder-check {key}.mp4', 360, 640, 5), key, 5, 0, 5)]), 'pixels', 24, 120))
    films.append(('sar', stored_film([(add('sar', 'decoder-check sar.mp4', 640, 360, 5), 'sar', 5, 0, 5)]), 'even', 24, 120))
    films.append(('hevc', stored_film([(add('hevc', 'decoder-check hevc.mp4', 640, 360, 5), 'hevc', 5, 0, 5)]), 'even', 24, 120))
    # The asset API takes no WebM upload: an MP4 stand-in is uploaded and this browser is served the WebM
    # bytes at its address (Range honoured), as a WebM from elsewhere would reach the editor.
    webm_asset = upload(context, 'decoder-check webm stand-in.mp4', media['n24'], 640, 360, 5)
    webm_bytes = open(media['webm'], 'rb').read()

    def serve_webm(route):
        rng = route.request.headers.get('range')
        headers = {'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes'}
        if rng and rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            start, end = int(a or 0), min(int(b) if b else len(webm_bytes) - 1, len(webm_bytes) - 1)
            return route.fulfill(status=206, body=webm_bytes[start:end + 1], headers={**headers, 'Content-Range': f'bytes {start}-{end}/{len(webm_bytes)}'})
        return route.fulfill(status=200, body=webm_bytes, headers=headers)

    context.route(re.compile(r'.*/api/brand-studio/compose\?.*id=' + webm_asset + r'.*'), serve_webm)
    films.append(('webm', stored_film([(webm_asset, 'webm', 5, 0, 5)]), 'even', 24, 120))

    hevc = page.evaluate("""async () => ({ element: document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L63.90"'),
      decoder: typeof VideoDecoder !== 'undefined' && (await VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L63.90', codedWidth: 640, codedHeight: 360 }).catch(() => ({ supported: false }))).supported })""")
    measure(f'HEVC on this Chromium: <video> canPlayType "{hevc["element"]}", VideoDecoder supported {hevc["decoder"]}')

    for name, film, kind, rate, count in films:
        if name == 'hevc' and not hevc['element'] and not hevc['decoder']:
            measure('hevc: this Chromium decodes HEVC neither in <video> nor in VideoDecoder: not run')
            continue
        state = open_film(page, film)
        fps = state['fps']
        outcomes = {}
        for path in ('decoder', 'seek') if name != 'webm' else ('', 'seek'):
            open_film(page, film, path)
            outcomes[path or 'auto'] = export_driven(page, f'src-{name}-{path or "auto"}')
            path_line(f'{name} ({path or "auto"})', outcomes[path or 'auto'])
        main = outcomes.get('decoder') or outcomes['auto']
        seek = outcomes['seek']
        total = sum(state['cuts'])
        if name == 'webm':
            check('webm: the decoder path cannot read it, so the file comes from seeking, and is done', main['status'] == 'done' and main['path'] == 'seek' and (main['paths'][0]['reason'] or '').startswith('container'),
                  f'{main["status"]} {main["path"]} {main["paths"][0]["reason"] if main["paths"] else ""}')
        else:
            check(f'{name}: the decoder path made the whole file', main['status'] == 'done' and main['path'] == 'decoder', f'{main["status"]} {main["path"]} {main["failed"] or ""}')
        if kind in ('even', 'mixed', 'vfr'):
            if kind == 'mixed':
                expected = list(range(state['cuts'][0])) + expected_even(state['cuts'][1], rate, fps, count)
            elif kind == 'vfr':
                expected = expected_by_time(total, fps, vfr_times)
            else:
                expected = expected_even(total, rate, fps, count)
            rect = (0, 0, 1920, 1080)
            numbers = {k: decode_numbers(o['file'], 1920, 1080, rect) if o['file'] else [] for k, o in outcomes.items()}
            for k, got in numbers.items():
                wrong = [(i, n, e) for i, (n, e) in enumerate(zip(got, expected)) if n != e]
                line = f'{name} ({k}): {len(got)} frames, film {fps} fps, cuts {state["cuts"]}, {len(wrong)} wrong {wrong[:4]}'
                if k == 'seek' and kind == 'vfr':
                    measure(line + ' (the seek path, for comparison: it numbers frames by an even rate)')
                else:
                    check(f'{name} ({k}): every frame shows the picture it should', len(got) == len(expected) and not wrong, line)
            if kind != 'vfr' and outcomes['seek']['file'] and main['file']:
                same = numbers['seek'] == numbers.get('decoder', numbers.get('auto'))
                check(f'{name}: decoder path and seek path give the same picture number on every frame', same, f'{len(numbers["seek"])} frames')
        if main['file'] and seek['file']:
            mad, bias, frames = pixel_difference(main['file'], seek['file'], 1920, 1080)
            measure(f'{name}: pixels, decoder path vs seek path over {frames} frames: mean |difference| per channel R,G,B {mad}, mean signed difference {bias}')
            check(f'{name}: same picture on both paths (mean |difference| under 2 of 255 per channel, no shift over 1)', max(mad) < 2 and max(abs(x) for x in bias) < 1, f'{mad} {bias}')
        if kind == 'pixels' and main['file']:
            # The turned picture is upright and fitted: pillarboxed in the 16:9 film (its width is about 1080 × 9/16).
            out = run(['ffmpeg', '-v', 'error', '-i', main['file'], '-vf', 'select=eq(n\\,0)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout
            frame = np.frombuffer(out, np.uint8).reshape(1080, 1920)
            columns = np.where(frame.mean(axis=0) > 20)[0]
            measure(f'{name}: picture spans columns {columns.min()}–{columns.max()} of 1920 (an upright 9:16 picture fitted in 1080 rows is 608 wide)')
            check(f'{name}: drawn upright and fitted like the <video> draws it', abs((columns.max() - columns.min() + 1) - 608) <= 4, f'{columns.max() - columns.min() + 1} px wide')


def part_fallback(browser, media, ids_holder):
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    page = context.new_page()
    page.add_init_script(cw.THROTTLE)
    page.add_init_script("""(() => { try { if (localStorage.getItem('__ev2-refuse-decoder') === '1' && typeof VideoDecoder !== 'undefined') VideoDecoder.isConfigSupported = async (config) => ({ supported: false, config }); } catch {} })();""")
    asset = ids_holder.get('n24') or upload(context, 'decoder-check n24.mp4', media['n24'], 640, 360, 5)
    ids_holder['n24'] = asset
    film = stored_film([(asset, 'n24', 5, 0, 5)])
    for refuse, label in ((True, 'decoder refused → seek path'), (False, 'decoder path')):
        page.goto(BASE + '/brand/library', wait_until='domcontentloaded', timeout=300000)
        page.evaluate("(v) => { localStorage.setItem('__ev2-refuse-decoder', v); localStorage.setItem('__ev2-throttle', '0'); }", '1' if refuse else '0')
        open_film(page, film)
        page.evaluate('() => window.__ev2SetThrottle(true)')
        outcome = export_driven(page, f'fallback-{"refused" if refuse else "decoder"}', watch_slow=True)
        page.evaluate('() => window.__ev2SetThrottle(false)')
        path_line(f'one frame a second, {label}', outcome)
        running = [l for l in outcome['looks'] if l['status'] == 'running' and l['t'] >= 2.5]
        slow = sum(1 for l in running if l['slow'])
        numbers = decode_numbers(outcome['file'], 1920, 1080, (0, 0, 1920, 1080)) if outcome['file'] else []
        wrong = [(i, n) for i, n in enumerate(numbers) if n != i]
        measure(f'one frame a second, {label}: {outcome["status"]} in {outcome["took"]:.1f} s; slow line in {slow} of {len(running)} looks from 2.5 s on; {len(numbers)} frames, {len(wrong)} wrong')
        if refuse:
            check('config refused: the seek path makes the file', outcome['path'] == 'seek' and outcome['paths'][0]['reason'] == 'codec-unsupported', json.dumps(outcome['paths'])[:200])
            check('config refused, one frame a second: the slow line is shown while it runs (every look from 2.5 s on)', len(running) > 0 and slow == len(running), f'{slow}/{len(running)}')
        else:
            check('decoder path, one frame a second: no slow line at any time', not any(l['slow'] for l in outcome['looks']), f'{sum(1 for l in outcome["looks"] if l["slow"])} looks with the line')
            check('decoder path, one frame a second: finishes at full speed (under 10 s for 120 frames)', outcome['status'] == 'done' and outcome['took'] < 10, f'{outcome["took"]:.1f} s')
        check(f'{label}: the file is frame-exact', len(numbers) == 120 and not wrong, f'{len(numbers)} frames, {wrong[:4]}')
    context.close()


INJECT_ERROR = """(() => {
  try { if (localStorage.getItem('__ev2-inject-error') !== '1') return; } catch { return; }
  const Real = VideoDecoder;
  window.__ev2Injected = 0;
  window.VideoDecoder = class extends Real {
    constructor(init) { super(init); this.__error = init.error; this.__fed = 0; }
    decode(chunk) {
      this.__fed += 1;
      if (this.__fed === 40 && window.__ev2Injected === 0) { window.__ev2Injected = 1; this.__error(new DOMException('injected decode error', 'EncodingError')); return; }
      return super.decode(chunk);
    }
  };
})();"""


def part_error(browser, media, ids_holder):
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    page = context.new_page()
    page.add_init_script(INJECT_ERROR)
    asset = ids_holder.get('n24') or upload(context, 'decoder-check n24.mp4', media['n24'], 640, 360, 5)
    ids_holder['n24'] = asset
    page.goto(BASE + '/brand/library', wait_until='domcontentloaded', timeout=300000)
    page.evaluate("() => localStorage.setItem('__ev2-inject-error', '1')")
    open_film(page, stored_film([(asset, 'n24', 5, 0, 5)]))
    outcome = export_driven(page, 'error-injected')
    injected = page.evaluate('() => window.__ev2Injected')
    page.evaluate("() => localStorage.removeItem('__ev2-inject-error')")
    path_line('decode error injected at the 40th sample', outcome)
    numbers = decode_numbers(outcome['file'], 1920, 1080, (0, 0, 1920, 1080)) if outcome['file'] else []
    wrong = [(i, n) for i, n in enumerate(numbers) if n != i]
    entry = outcome['paths'][0] if outcome['paths'] else {}
    check('an injected decode error moves the rest of the cut to seeking (both paths drew frames)', injected == 1 and entry.get('decoded', 0) > 0 and entry.get('seeked', 0) > 0 and (entry.get('reason') or '').startswith('error'),
          json.dumps(entry)[:240])
    check('and the file is still exact', outcome['status'] == 'done' and len(numbers) == 120 and not wrong, f'{len(numbers)} frames, {wrong[:4]}')
    context.close()


# ── A page nothing drives: an own Chromium process, CDP only while setting up and reading ──

user32 = ctypes.windll.user32 if os.name == 'nt' else None
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

# A plain window of this script's own, always on top, over the browser window. (A borderless one is not
# counted as covering by Chrome's occlusion check: measured, the page stayed visible under it.)
COVER = r"""
import ctypes, sys, tkinter as tk
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
x, y, w, h = map(int, sys.argv[1:5])
r = tk.Tk(); r.title('cover'); r.geometry(f'{w}x{h}+{x}+{y}'); r.attributes('-topmost', True); r.configure(bg='#4a4f5a')
r.lift(); r.focus_force(); r.after(1500, lambda: (r.lift(), r.focus_force())); r.mainloop()
"""

PAGE_LOG = """() => {
  if (window.__ev2Log) return;
  const log = window.__ev2Log = { raf: [], vis: [[performance.now(), document.visibilityState]], progress: [], start: null, done: null };
  const tick = () => { log.raf.push(performance.now()); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => log.vis.push([performance.now(), document.visibilityState]));
  const seen = () => {
    const s = document.querySelector('[data-editor-export-sheet]');
    const p = document.querySelector('[data-editor-export-progress]');
    const value = (s ? s.dataset.editorExportStatus : '') + '|' + (p ? p.dataset.editorExportProgress : '');
    const last = log.progress[log.progress.length - 1];
    if (!last || last[1] !== value) log.progress.push([performance.now(), value, document.visibilityState, !!document.querySelector('[data-editor-export-slow]')]);
    if (s && s.dataset.editorExportStatus === 'done' && log.done === null) log.done = performance.now();
  };
  new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-editor-export-progress', 'data-editor-export-status'] });
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('[data-editor-export-start]')) log.start = performance.now(); }, true);
}"""


START_DELAY_MS = 3000


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class OwnChromium:
    """Playwright's bundled Chromium started as this script's own process: fresh profile, its own debugging port."""

    def __init__(self, executable, downloads):
        self.port = free_port()
        if self.port == 9333:
            self.port = free_port()
        self.profile = tempfile.mkdtemp(prefix='ev2-decoder-')
        os.makedirs(os.path.join(self.profile, 'Default'), exist_ok=True)
        self.downloads = os.path.normpath(downloads)
        os.makedirs(self.downloads, exist_ok=True)
        # Downloads go to the check's folder without asking, and a second automatic download is not held back.
        with open(os.path.join(self.profile, 'Default', 'Preferences'), 'w') as f:
            json.dump({'download': {'default_directory': self.downloads, 'prompt_for_download': False, 'directory_upgrade': True},
                       'profile': {'exit_type': 'Normal', 'default_content_setting_values': {'automatic_downloads': 1}}}, f)
        self.proc = subprocess.Popen([executable, f'--remote-debugging-port={self.port}', f'--user-data-dir={self.profile}', '--no-first-run', '--no-default-browser-check',
                                      '--window-position=60,40', '--window-size=1460,980', 'about:blank'])
        for _ in range(100):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{self.port}/json/version', timeout=1).read()
                return
            except Exception:
                time.sleep(0.2)
        raise SystemExit('own Chromium did not open its debugging port')

    def hwnd(self):
        found = []
        proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def each(handle, _):
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
            if pid.value == self.proc.pid and user32.IsWindowVisible(handle):
                name = ctypes.create_unicode_buffer(64)
                user32.GetClassNameW(handle, name, 64)
                title = ctypes.create_unicode_buffer(256)
                user32.GetWindowTextW(handle, title, 256)
                if name.value == 'Chrome_WidgetWin_1' and title.value:
                    found.append(handle)
            return True

        user32.EnumWindows(proc(each), 0)
        return found[0] if found else None

    def rect(self):
        r = ctypes.wintypes.RECT()
        user32.GetWindowRect(self.hwnd(), ctypes.byref(r))
        return r.left, r.top, r.right - r.left, r.bottom - r.top

    def show(self, state):
        handle = self.hwnd()
        user32.ShowWindow(handle, {'minimise': 6, 'restore': 9}[state])

    def on_top(self, on):
        """Keeps this window above the desktop's other windows (another program's window in front of it would
        hide the page too); a cover window opened later, also on top, still covers it."""
        user32.SetWindowPos(self.hwnd(), -1 if on else -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)

    def memory(self):
        """Working set of the browser's processes: total and the largest one, in bytes."""
        script = (f"$ids = @({self.proc.pid}) + @(Get-CimInstance Win32_Process -Filter 'ParentProcessId={self.proc.pid}' | ForEach-Object {{ $_.ProcessId }}); "
                  "$m = Get-Process -Id $ids -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum -Maximum; \"$($m.Sum) $($m.Maximum)\"")
        try:
            out = subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW).stdout.split()
            return int(out[0]), int(out[1])
        except Exception:
            return None

    def close(self):
        try:
            subprocess.run(['taskkill', '/PID', str(self.proc.pid), '/T', '/F'], capture_output=True, creationflags=NO_WINDOW)
        except Exception:
            pass
        self.proc.wait(timeout=30)
        shutil.rmtree(self.profile, ignore_errors=True)


def newest_download(folder, after):
    files = [os.path.join(folder, f) for f in os.listdir(folder) if f.endswith('.mp4')]
    files = [f for f in files if os.path.getmtime(f) >= after]
    return max(files, key=os.path.getmtime) if files else None


def unattended_export(p, own, film, path, state, hidden_cap, name):
    """Sets up and presses export over CDP, disconnects, hides the window `state` (front/covered/minimised/
    background) with no one driving the page, waits, shows it again, reconnects and reads the page's own log."""
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{own.port}')
    context = browser.contexts[0]
    page = next((pg for pg in context.pages if pg.url.startswith(BASE)), None) or context.pages[0]
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    for extra in [pg for pg in context.pages if pg != page]:
        extra.close()
    open_film(page, film, path)
    page.evaluate(PAGE_LOG)
    own.show('restore')
    own.on_top(True)
    page.bring_to_front()
    page.click('[data-editor-export]')
    page.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
    page.wait_for_timeout(300)
    # The page presses export itself, a few seconds from now: by then nothing drives it and its window is
    # hidden, so the whole export runs hidden (a page Playwright drives stays visible, spec E's finding).
    # In a window that is to be hidden it waits (up to 15 s more) until the page really is hidden.
    page.evaluate("""([delay, hide]) => setTimeout(() => {
      const go = () => document.querySelector('[data-editor-export-start]').click();
      if (!hide || document.visibilityState === 'hidden') return go();
      let done = false;
      const once = () => { if (!done) { done = true; go(); } };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') once(); });
      setTimeout(once, 15000);
    }, delay)""", [START_DELAY_MS, state != 'front'])
    clicked = time.time()
    if state == 'background':
        context.new_page()  # a new tab in front: the editor's tab is now a background tab
    browser.close()  # disconnects; the browser and its pages keep running, driven by nothing
    time.sleep(0.3)
    cover = None
    if state == 'minimise':
        own.show('minimise')
    elif state == 'covered':
        x, y, w, h = own.rect()
        cover = subprocess.Popen([sys.executable, '-c', COVER, str(x - 40), str(y - 40), str(w + 80), str(h + 80)], creationflags=NO_WINDOW)
    peak = [0, 0]
    stop = threading.Event()

    def sample():
        while not stop.is_set():
            m = own.memory()
            if m:
                peak[0], peak[1] = max(peak[0], m[0]), max(peak[1], m[1])
            stop.wait(1.0)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    deadline = clicked + START_DELAY_MS / 1000 + (hidden_cap if state != 'front' else 300)
    file = None
    while time.time() < deadline:
        file = newest_download(own.downloads, clicked)
        if file and not os.path.exists(file + '.crdownload'):
            break
        file = None
        time.sleep(0.5)
    hidden_for = time.time() - clicked
    if cover:
        cover.kill()
    if state == 'minimise':
        own.show('restore')
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{own.port}')
    context = browser.contexts[0]
    page = next(pg for pg in context.pages if pg.url.startswith(BASE))
    page.bring_to_front()
    page.wait_for_function("() => { const s = document.querySelector('[data-editor-export-sheet]'); return s && s.dataset.editorExportStatus !== 'running'; }", timeout=1200000, polling=500)
    own.on_top(False)
    stop.set()
    sampler.join()
    log = page.evaluate('() => window.__ev2Log')
    info = page.evaluate(DONE_INFO)
    file = file or newest_download(own.downloads, clicked)
    target = os.path.join(OUT, f'{name}.mp4')
    if file:
        shutil.move(file, target)
        file = target
    elif info['status'] == 'done':
        # A download that comes while this script is attached is not delivered to the folder: the finished
        # file is read from the page's own blob instead, in slices.
        with open(target, 'wb') as f:
            size = page.evaluate("async () => (await (await fetch(document.querySelector('[data-editor-export-again]').href)).blob()).size")
            for start in range(0, size, 4 * 2 ** 20):
                chunk = page.evaluate('''async ([start, end]) => {
                  const blob = await (await fetch(document.querySelector('[data-editor-export-again]').href)).blob();
                  const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
                  let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                  return btoa(text);
                }''', [start, min(size, start + 4 * 2 ** 20)])
                f.write(__import__('base64').b64decode(chunk))
        file = target
    browser.close()
    return log, info, file, hidden_for, peak


def hidden_export(p, own, film, path, state, cap, name, frames):
    """`unattended_export`, run once more when the page's own log shows it never went hidden (Chrome's
    occlusion check does not always count the cover window at once). Returns the summary and the run's facts."""
    for attempt in (1, 2):
        log, info, file, hidden_for, peak = unattended_export(p, own, film, path, state, cap, name)
        s = summarise(log, info, hidden_for, frames)
        if state == 'front' or s['became_hidden'] or attempt == 2:
            s['attempts'] = attempt
            return s, info, file, peak
        measure(f'{name}: the page did not go hidden; once more')


def summarise(log, info, hidden_for, frames):
    """What the page's own log says: the hidden state, frames made while hidden, the time to the end."""
    start = log['start'] or (log['progress'][0][0] if log['progress'] else 0)
    hidden_spans = []
    opened = None
    for t, state in log['vis']:
        if state == 'hidden' and opened is None:
            opened = t
        elif state == 'visible' and opened is not None:
            hidden_spans.append((opened, t))
            opened = None
    if opened is not None:
        hidden_spans.append((opened, float('inf')))
    in_hidden = lambda t: any(a <= t < b for a, b in hidden_spans)
    raf_hidden = sum(1 for t in log['raf'] if in_hidden(t) and t >= start)
    hidden_ms = sum(min(b, log['done'] or b) - max(a, start) for a, b in hidden_spans if b > start and (log['done'] is None or a < log['done']))
    video = [(t, v) for t, v, _, _ in log['progress'] if '|' in v and '/' in v.split('|')[1]]
    done_hidden = [int(v.split('|')[1].split('/')[0]) for t, v in video if in_hidden(t)]
    finished_hidden = log['done'] is not None and in_hidden(log['done'] - 1)
    slow_lines = sum(1 for _, _, _, slow in log['progress'] if slow)
    return {
        'ms': info['ms'], 'path': info['path'], 'hidden_s': round(hidden_ms / 1000, 1) if hidden_spans else 0, 'raf_while_hidden': raf_hidden,
        'frames_while_hidden': (max(done_hidden) - min(done_hidden)) if done_hidden else 0, 'finished_while_hidden': finished_hidden,
        'became_hidden': bool(hidden_spans), 'slow_lines': slow_lines, 'status': info['status'], 'warnings': info['warnings'], 'paths': info['paths'],
    }


def part_times(p, browser, media, holder):
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    page = context.new_page()
    page.goto(editor_url(), wait_until='domcontentloaded', timeout=300000)
    page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=300000)
    sources = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => ({ key: el.dataset.editorSource, text: (el.textContent || '').trim() }))")
    named = {}
    for s in sources:
        for tag in ('c1', 'c2', 'c3'):
            if f'{tag} ' in s['text'] and s['key'].startswith('a:'):
                named[tag] = s['key'][2:]
        if ('프레임' in s['text'] or 'frame' in s['text'].lower()) and s['key'].startswith('a:'):
            named['frame'] = s['key'][2:]
    films = []
    if all(k in named for k in ('c1', 'frame', 'c2', 'c3')):
        # The real-export check's film: c1, the frame-numbered upload, c2, c3, each whole, 9:16 (665 frames).
        lengths = {}
        for key in ('c1', 'frame', 'c2', 'c3'):
            data = context.request.get(BASE + src_of(named[key])).body()
            tmp = os.path.join(OUT, f'standard-{key}.mp4')
            open(tmp, 'wb').write(data)
            lengths[key] = (float(probe(tmp)[0].get('duration') or 0), len(data))
        film = stored_film([(named[k], k, round(lengths[k][0], 3), 0, round(lengths[k][0], 3)) for k in ('c1', 'frame', 'c2', 'c3')], aspect='9:16')
        state = open_film(page, film)
        measure(f'standard film: cuts {state["cuts"]} = {sum(state["cuts"])} frames at {state["fps"]} fps; file sizes {[lengths[k][1] for k in ("c1", "frame", "c2", "c3")]} bytes')
        films.append(('standard', film, sum(state['cuts']), sum(v[1] for v in lengths.values())))
    else:
        measure(f'standard film: the organization lacks c1/c2/c3/frame uploads ({sorted(named)}): not run')
    long_paths = long_media(MEDIA)
    long_ids = [upload(context, f'decoder-check long{i + 1}.mp4', path, 1920, 1080, 20) for i, path in enumerate(long_paths)]
    long_film = stored_film([(asset, f'long{i + 1}', 20, 0, 20) for i, asset in enumerate(long_ids)])
    state = open_film(page, long_film)
    measure(f'long film: cuts {state["cuts"]} = {sum(state["cuts"])} frames at {state["fps"]} fps, 1080p, file sizes {[os.path.getsize(x) for x in long_paths]} bytes')
    films.append(('long', long_film, sum(state['cuts']), sum(os.path.getsize(x) for x in long_paths)))
    context.close()

    table = []
    park()
    own = OwnChromium(p.chromium.executable_path, os.path.join(OUT, 'downloads'))
    try:
        for film_name, film, frames, bytes_total in films:
            for path in ('seek', 'decoder'):
                for state in ('front', 'covered', 'minimise', 'background'):
                    for repeat in range(REPEATS):
                        cap = 45 if path == 'seek' else 300
                        s, info, file, peak = hidden_export(p, own, film, path, state, cap, f'times-{film_name}-{path}-{state}-{repeat + 1}', frames)
                        numbers_ok = None
                        if film_name == 'long' and file:
                            numbers = decode_numbers(file, 1920, 1080, (0, 0, 1920, 1080))
                            expected = [k for _ in range(3) for k in range(480)]
                            numbers_ok = numbers == expected
                        read = sum(e['bytesRead'] for e in s['paths'])
                        row = {'film': film_name, 'path': path, 'state': state, 'run': repeat + 1, 'seconds': (s['ms'] or 0) / 1000, 'status': s['status'], 'made_by': s['path'],
                               'became_hidden': s['became_hidden'], 'hidden_s': s['hidden_s'], 'raf_while_hidden': s['raf_while_hidden'], 'frames_while_hidden': s['frames_while_hidden'],
                               'finished_while_hidden': s['finished_while_hidden'], 'slow_line_seen': s['slow_lines'] > 0, 'picture_bytes_read': read, 'source_bytes': bytes_total,
                               'peak_ws_total_mb': round(peak[0] / 2 ** 20), 'peak_ws_largest_mb': round(peak[1] / 2 ** 20), 'numbers_ok': numbers_ok}
                        table.append(row)
                        measure('times ' + json.dumps(row))
                        if state != 'front':
                            check(f'times {film_name} {path} {state} #{repeat + 1}: the page really was hidden with no animation frames', s['became_hidden'] and s['raf_while_hidden'] == 0,
                                  f'hidden {s["hidden_s"]} s, {s["raf_while_hidden"]} animation frames while hidden')
                        if path == 'decoder':
                            check(f'times {film_name} decoder {state} #{repeat + 1}: finished, made by the decoder path' + (' while hidden' if state != 'front' else ''),
                                  s['status'] == 'done' and s['path'] == 'decoder' and (state == 'front' or s['finished_while_hidden']), f'{row["seconds"]:.1f} s')
                        if numbers_ok is not None:
                            check(f'times {film_name} {path} {state} #{repeat + 1}: frame-exact (1440 numbers)', numbers_ok)
    finally:
        own.close()
    with open(os.path.join(OUT, 'times.json'), 'w') as f:
        json.dump(table, f, indent=1)
    for film_name, *_ in films:
        for path in ('seek', 'decoder'):
            cells = []
            for state in ('front', 'covered', 'minimise', 'background'):
                rows = [r for r in table if r['film'] == film_name and r['path'] == path and r['state'] == state]
                cells.append(f'{state} ' + '/'.join(f'{r["seconds"]:.1f}' for r in rows) + ' s' + (' (hidden: ' + '/'.join(str(r['frames_while_hidden']) for r in rows) + ' frames)' if state != 'front' else ''))
            measure(f'TABLE {film_name} {path}: ' + '; '.join(cells))


DRIVEN = []


def park():
    """Minimises the window of the browser this script drives, once its pages are set up: it would otherwise
    come back in front of the unattended window when a cover window closes, and cover it (measured: a "front"
    run went hidden). Not before: a page opened in a minimised browser did not read its clips' rates."""
    page = DRIVEN[0]
    cdp = page.context.new_cdp_session(page)
    window = cdp.send('Browser.getWindowForTarget')
    cdp.send('Browser.setWindowBounds', {'windowId': window['windowId'], 'bounds': {'windowState': 'minimized'}})
    cdp.detach()


def part_c3(p, browser, media):
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    page = context.new_page()
    page.goto(BASE + '/brand/library', wait_until='domcontentloaded', timeout=300000)
    made = cw.make_c3(MEDIA)
    cuts = []
    for name, first, count in cw.C3_SOURCES:
        path, seconds = made[name]
        asset = upload(context, f'decoder-check {name}.mp4', path, 640, 360, seconds)
        cuts.append((asset, name, round(seconds, 1), 0, round(seconds, 1)))
    film = stored_film(cuts)
    state = open_film(page, film)
    expected = [k for _, first, n in cw.C3_SOURCES for k in range(first, first + n)]
    measure(f'c3: cuts {state["cuts"]} at {state["fps"]} fps (pictures {[n for _, _, n in cw.C3_SOURCES]})')
    check('c3: each cut is its source whole (the real number of pictures)', state['cuts'] == [n for _, _, n in cw.C3_SOURCES], json.dumps(state['cuts']))
    context.close()
    park()
    own = OwnChromium(p.chromium.executable_path, os.path.join(OUT, 'downloads'))
    try:
        for path in ('decoder', 'seek'):
            for state_name in ('front', 'covered'):
                for repeat in range(REPEATS):
                    s, info, file, peak = hidden_export(p, own, film, path, state_name, 45 if path == 'seek' else 300, f'c3-{path}-{state_name}-{repeat + 1}', len(expected))
                    numbers = decode_numbers(file, 1920, 1080, (0, 0, 1920, 1080)) if file else []
                    wrong = [(i, n, e) for i, (n, e) in enumerate(zip(numbers, expected)) if n != e]
                    ends = [numbers[i - 1] if 0 < i <= len(numbers) else None for i in (97, 194, 315)]
                    measure(f'c3 {path} {state_name} #{repeat + 1}: {s["status"]} in {(s["ms"] or 0) / 1000:.1f} s (made by {s["path"]}), hidden {s["hidden_s"]} s with {s["raf_while_hidden"]} animation frames, '
                            f'{s["frames_while_hidden"]} frames made while hidden, finished while hidden {s["finished_while_hidden"]}; {len(numbers)} frames, {len(wrong)} wrong; '
                            f'last picture of each cut {ends}; warnings {s["warnings"]}; slow line seen {s["slow_lines"] > 0}')
                    if path == 'decoder':
                        check(f'c3 decoder {state_name} #{repeat + 1}: finishes' + (' while covered' if state_name == 'covered' else '') + ', every frame right, each cut ends on its last real picture, nothing filled',
                              s['status'] == 'done' and len(numbers) == len(expected) and not wrong and ends == [96, 196, 120] and 'lastFrame' not in s['warnings']
                              and (state_name == 'front' or s['finished_while_hidden']), f'{len(numbers)} frames, {len(wrong)} wrong, ends {ends}')
                    if state_name == 'covered':
                        check(f'c3 {path} covered #{repeat + 1}: the page really was hidden with no animation frames', s['became_hidden'] and s['raf_while_hidden'] == 0, f'{s["hidden_s"]} s, {s["raf_while_hidden"]} frames')
    finally:
        own.close()


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not OUT or not MEDIA:
        sys.exit('usage: editor-v2-decoder-check.py <out-dir> <media-dir> [part ...]')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    os.makedirs(OUT, exist_ok=True)
    media = make_media(MEDIA)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'), args=['--window-position=40,40', '--window-size=1460,980'])
        # The covered-window check's guard: uploads are made and deleted only on a local-mode server.
        if not cw.proves_local_mode(browser):
            check('local mode proven before creating or deleting uploads', False, 'a request with no session was not signed in as the development identity')
            browser.close()
            sys.exit(1)
        measure('the server is in local mode (a request with no session is signed in as the development identity)')
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route(re.compile(r'.*'), lambda route: route.fallback() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/brand/library', wait_until='domcontentloaded', timeout=300000)
        holder = {}
        try:
            if 'sources' in PARTS:
                part_sources(page, context, media)
            if 'fallback' in PARTS:
                part_fallback(browser, media, holder)
            if 'error' in PARTS:
                part_error(browser, media, holder)
            DRIVEN.append(page)
            if 'c3' in PARTS:
                part_c3(p, browser, media)
            if 'times' in PARTS:
                part_times(p, browser, media, holder)
            check('no page errors', not errors, '; '.join(errors[:3]))
        finally:
            try:
                delete_uploads(context)
            finally:
                browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
