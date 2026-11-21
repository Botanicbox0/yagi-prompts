"""Real-browser check: the exported file's sound sits where its picture is (spec E, items B1 and B2).

Generated sources (ffmpeg, lavfi; nothing downloaded), each with a single white frame and a 1 kHz beep at
the same movie time:
  s1 plain                      picture and sound from 0 (ffmpeg's AAC writes an encoder delay of 1024
                                samples, hidden by an edit list)
  s2 picture late               picture behind a 0.5 s empty edit, sound from 0
  s3 both late                  both from 0.5 s (-output_ts_offset)
  s4 sound late                 sound behind a 0.3 s empty edit
  s5 B-frames                   x264 with three B-frames: the picture's edit list starts at media time > 0
  s6 edit before the picture    s5 with the picture's edit moved to media time 0, two frames before its first
                                picture (review round 1 of part E, sound case (a))
  s7 sound delay, no skip       s1 with the sound's edit set to media time 0: the AAC encoder delay (1024
                                samples) is played, and nothing in the file says so (case (b)); the export
                                must keep the file's own offset, as Chromium plays it
  s8 edit inside a picture      s1 with the picture's edit starting half a frame into its first picture
                                (case (a), the other placement)
For each: a v2 film of that one cut (2.5 s from its first frame), exported; in the file, ffmpeg finds the
white frame and the beep's first sample: sound − picture, target within ±10 ms. Then one film of two cuts
from different sources (s2 for 1.5 s, then s3 from 0.5 s to 2.0 s): both events.

  (0) what the browser does (with `after`): per file, ffprobe's stream start times, the container reader's
      (lib/brand-studio/editor-v2/container.ts), Chromium's decodeAudioData sample 0 (movie time of the
      beep minus its sample index) and the first frame's requestVideoFrameCallback mediaTime; and the
      file's own offset as Chromium plays it (the white frame's mediaTime against the beep, placed by the
      reader's sound start), which is what the export must keep;
  (3) the exported file itself (B2): its sound track's edit list and ffprobe start times; and Chromium's
      own reading of it: decodeAudioData's beep against the white frame's mediaTime.

The generated files are served only inside this browser by Playwright routing in place of uploaded clips'
addresses. Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id>, whose organization has at least two uploaded videos:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-sound-sync-check.py <out-dir> <media-dir> [before]

`before` skips (0) and (3) (for a checkout older than the container reader). Python Playwright with its own
full Chromium and a fresh profile; localhost only; never attaches to another browser; ffmpeg/ffprobe and
node on PATH. Prints PASS/FAIL and MEASURE lines; exits non-zero on failure.
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
MEDIA = sys.argv[2] if len(sys.argv) > 2 else None
BEFORE = len(sys.argv) > 3 and sys.argv[3] == 'before'
KEY = f'twings_studio_compose_v1:{ORG}'
ROOT = os.environ.get('EDITOR_REPO_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
TARGET_MS = 10.0
results = []

# name, file, movie time of the white frame and the beep, the white frame's index among the picture's frames
SOURCES = [
    ('s1 plain', 's1-plain.mp4', 1.0, 24),
    ('s2 picture late', 's2-video-late.mp4', 1.5, 24),
    ('s3 both late', 's3-both-late.mp4', 1.5, 24),
    ('s4 sound late', 's4-sound-late.mp4', 1.0, 24),
    ('s5 B-frames', 's5-bframes.mp4', 1.0, 24),
    ('s6 edit before the picture', 's6-edit-before-picture.mp4', 1.0, 24),
    ('s7 sound delay, no skip', 's7-sound-delay-kept.mp4', 1.0, 24),
    ('s8 edit inside a picture', 's8-edit-inside-picture.mp4', 1.0, 24),
]
# Where each file's own timeline puts its beep, when that is not where its picture's flash is: s7 plays the
# encoder delay, so its beep sits 1024 samples (21.3 ms) after the flash in the file itself.
SOUND_EVENT = {'s7-sound-delay-kept.mp4': 1.0 + 1024 / 48000}


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def measure(text):
    print('MEASURE  ' + text, flush=True)


def run(args, **kw):
    return subprocess.run(args, capture_output=True, check=True, creationflags=NO_WINDOW, **kw)


def set_edit_media_time(path, handler, media_time):
    """Sets the media_time of the (single, normal) edit of the `handler` track in place; the sizes do not change."""
    data = bytearray(open(path, 'rb').read())

    def walk(start, end, in_track):
        at = start
        while at + 8 <= end:
            size, kind = struct.unpack('>I4s', data[at:at + 8])
            kind = kind.decode('latin1')
            if size == 0:
                size = end - at
            if kind == 'moov' and walk(at + 8, at + size, False):
                return True
            if kind == 'trak':
                hdlr = data.find(b'hdlr', at, at + size)
                if hdlr >= 0 and data[hdlr + 12:hdlr + 16] == handler.encode() and walk(at + 8, at + size, True):
                    return True
            if kind == 'edts' and in_track and walk(at + 8, at + size, True):
                return True
            if kind == 'elst' and in_track:
                assert data[at + 8] == 0 and struct.unpack('>I', data[at + 12:at + 16])[0] >= 1
                rows = struct.unpack('>I', data[at + 12:at + 16])[0]
                row = at + 16 + (rows - 1) * 12
                data[row + 4:row + 8] = struct.pack('>i', media_time)
                return True
            at += size
        return False

    assert walk(0, len(data), False), f'no {handler} edit list in {path}'
    open(path, 'wb').write(data)


def make_sources(folder):
    os.makedirs(folder, exist_ok=True)
    ff = lambda *args: run(['ffmpeg', '-v', 'error', '-y', *args])
    v24, v24b = os.path.join(folder, '_v24.mp4'), os.path.join(folder, '_v24b.mp4')
    for path, bf in ((v24, 0), (v24b, 3)):
        if not os.path.exists(path):
            ff('-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=3', '-vf', "drawbox=enable='eq(n,24)':x=0:y=0:w=iw:h=ih:color=white:t=fill",
               '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '24', '-bf', str(bf), path)
    beeps = {}
    for at in (700, 1000, 1500):
        beeps[at] = os.path.join(folder, f'_b{at}.wav')
        if not os.path.exists(beeps[at]):
            ff('-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.05', '-af', f'adelay={at}|{at},apad=whole_dur=3.5', '-ac', '2', beeps[at])
    aac = ['-c:a', 'aac', '-b:a', '128k']
    recipes = {
        's1-plain.mp4': ['-i', v24, '-i', beeps[1000], '-map', '0:v', '-map', '1:a', '-c:v', 'copy', *aac],
        's2-video-late.mp4': ['-itsoffset', '0.5', '-i', v24, '-i', beeps[1500], '-map', '0:v', '-map', '1:a', '-c:v', 'copy', *aac],
        's3-both-late.mp4': ['-i', v24, '-i', beeps[1000], '-map', '0:v', '-map', '1:a', '-c:v', 'copy', *aac, '-output_ts_offset', '0.5'],
        's4-sound-late.mp4': ['-i', v24, '-itsoffset', '0.3', '-i', beeps[700], '-map', '0:v', '-map', '1:a', '-c:v', 'copy', *aac],
        's5-bframes.mp4': ['-i', v24b, '-i', beeps[1000], '-map', '0:v', '-map', '1:a', '-c:v', 'copy', *aac],
    }
    for name, args in recipes.items():
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            ff(*args, path)
    # (a) the picture's edit two frames before its first picture; (b) the encoder delay played.
    for name, base, handler in (('s6-edit-before-picture.mp4', 's5-bframes.mp4', 'vide'), ('s7-sound-delay-kept.mp4', 's1-plain.mp4', 'soun')):
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            open(path, 'wb').write(open(os.path.join(folder, base), 'rb').read())
            set_edit_media_time(path, handler, 0)
        recipes[name] = []
    # (a), the other placement: the picture's edit half a frame into its first picture.
    path = os.path.join(folder, 's8-edit-inside-picture.mp4')
    if not os.path.exists(path):
        base = os.path.join(folder, 's1-plain.mp4')
        probe = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=time_base,r_frame_rate', '-of', 'json', base]).stdout)['streams'][0]
        ticks = int(probe['time_base'].split('/')[1]) * int(probe['r_frame_rate'].split('/')[1]) // int(probe['r_frame_rate'].split('/')[0])
        open(path, 'wb').write(open(base, 'rb').read())
        set_edit_media_time(path, 'vide', ticks // 2)
    recipes['s8-edit-inside-picture.mp4'] = []
    return {name: os.path.join(folder, name) for name in recipes}


def ffprobe_starts(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', path]).stdout
    return {s['codec_type']: float(s.get('start_time', 'nan')) for s in json.loads(out)['streams']}


def container(paths):
    code = ("import { readFileSync } from 'node:fs';"
            "const { timingOfFile } = await import('./lib/brand-studio/editor-v2/container.ts');"
            "for (const f of process.argv.slice(1)) console.log(JSON.stringify(await timingOfFile(new Uint8Array(readFileSync(f)))));")
    out = run(['node', '--import', 'tsx', '--input-type=module', '-e', code, *paths], cwd=ROOT).stdout.decode()
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def events(path):
    """White frames (index runs) and beep onsets (sample indices) in an exported file, read with ffmpeg."""
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,r_frame_rate', '-of', 'json', path]).stdout)['streams']
    video = next(s for s in probe if s['codec_type'] == 'video')
    num, den = (int(x) for x in video['r_frame_rate'].split('/'))
    raw = run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'crop=iw/4:ih/8:iw*3/8:ih*7/16,scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout
    levels = [sum(raw[i:i + 64]) / 64 for i in range(0, len(raw), 64)]
    flashes = [i for i, level in enumerate(levels) if level > 128 and (i == 0 or levels[i - 1] <= 128)]
    pcm = run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']).stdout
    samples = struct.unpack(f'<{len(pcm) // 2}h', pcm)
    onsets, quiet = [], 4800
    for i, x in enumerate(samples):
        if abs(x) > 1500:
            if quiet >= 4800:
                onsets.append(i)
            quiet = 0
        else:
            quiet += 1
    return num / den, flashes, onsets


def audio_edits(path):
    """The sound track's edit list entries (segment duration, media time), straight from the boxes."""
    data = open(path, 'rb').read()
    found, handler = [], None

    def walk(start, end):
        nonlocal handler
        at = start
        while at + 8 <= end:
            size, kind = struct.unpack('>I4s', data[at:at + 8])
            kind = kind.decode('latin1')
            head = 8
            if size == 1:
                size, head = struct.unpack('>Q', data[at + 8:at + 16])[0], 16
            if size == 0:
                size = end - at
            if kind == 'trak':
                handler, edits = None, []
                walk_trak(at + head, at + size, edits)
                if handler == 'soun':
                    found.extend(edits)
            elif kind == 'moov':
                walk(at + head, at + size)
            at += size

    def walk_trak(start, end, edits):
        nonlocal handler
        at = start
        while at + 8 <= end:
            size, kind = struct.unpack('>I4s', data[at:at + 8])
            kind = kind.decode('latin1')
            if kind in ('edts', 'mdia'):
                walk_trak(at + 8, at + size, edits)
            elif kind == 'hdlr':
                handler = data[at + 16:at + 20].decode('latin1')
            elif kind == 'elst':
                version, count = data[at + 8], struct.unpack('>I', data[at + 12:at + 16])[0]
                p = at + 16
                for _ in range(count):
                    if version == 1:
                        d, m = struct.unpack('>Qq', data[p:p + 16])
                        p += 20
                    else:
                        d, m = struct.unpack('>Ii', data[p:p + 8])
                        p += 12
                    edits.append((d, m))
            at += size

    walk(0, len(data))
    return found


BROWSER_FACTS = """async ({ url, fps, eventSec }) => {
  const bytes = await (await fetch(url)).arrayBuffer();
  const out = {};
  try {
    const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.slice(0));
    const d = buf.getChannelData(0); let i = 0; while (i < d.length && Math.abs(d[i]) <= 0.04) i += 1;
    out.beepSample = i < d.length ? i : null; out.length = buf.length;
    out.sample0 = out.beepSample === null ? null : eventSec - out.beepSample / 48000;
  } catch (e) { out.decode = String(e); }
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; document.body.appendChild(v);
  await new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', r, { once: true }); v.src = url; v.load(); });
  out.firstMediaTime = await new Promise((resolve) => { let s = false, m = null; const d = () => { if (s && m !== null) resolve(m); };
    v.requestVideoFrameCallback((n, md) => { m = md.mediaTime; d(); }); v.addEventListener('seeked', () => { s = true; d(); }, { once: true }); v.currentTime = 0.5 / fps; });
  v.remove();
  return out;
}"""

# Chromium's own reading of an exported file: the beep's sample in decodeAudioData, the white frame's mediaTime.
EXPORTED = """async ({ url, fps, frames }) => {
  const bytes = await (await fetch(url)).arrayBuffer();
  const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.slice(0));
  const d = buf.getChannelData(0); let i = 0; while (i < d.length && Math.abs(d[i]) <= 0.04) i += 1;
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; document.body.appendChild(v);
  await new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); v.src = url; v.load(); });
  const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d');
  const at = (t) => new Promise((resolve) => { let s = false, m = null; const done = () => { if (s && m !== null) resolve(m); };
    v.requestVideoFrameCallback((n, md) => { m = md.mediaTime; done(); }); v.addEventListener('seeked', () => { s = true; done(); }, { once: true }); v.currentTime = t; });
  let flash = null;
  for (let k = 0; k < frames && flash === null; k += 1) {
    const mt = await at((k + 0.5) / fps);
    g.drawImage(v, 0, 0, 16, 16); const px = g.getImageData(4, 4, 8, 8).data; let sum = 0; for (let j = 0; j < px.length; j += 4) sum += px[j];
    if (sum / (px.length / 4) > 128) flash = mt;
  }
  v.remove();
  return { beepSec: i < d.length ? i / buf.sampleRate : null, flashMediaTime: flash, length: buf.length };
}"""


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not OUT or not MEDIA:
        sys.exit('usage: editor-v2-sound-sync-check.py <out-dir> <media-dir> [before]')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    os.makedirs(OUT, exist_ok=True)
    files = make_sources(MEDIA)
    bodies = {name: open(path, 'rb').read() for name, path in files.items()}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        try:
            run_checks(browser, files, bodies)
        finally:
            browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


def serve(body):
    def handler(route):
        rng = route.request.headers.get('range')
        if route.request.method == 'HEAD':
            return route.fulfill(status=200, headers={'Content-Length': str(len(body)), 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes'}, body='')
        if rng and rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            start, end = int(a or 0), min(int(b) if b else len(body) - 1, len(body) - 1)
            if start >= len(body):
                return route.fulfill(status=416, body='')
            return route.fulfill(status=206, body=body[start:end + 1], headers={'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {start}-{end}/{len(body)}'})
        return route.fulfill(status=200, body=body, headers={'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes'})
    return handler


def run_checks(browser, files, bodies):
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    probe_files = {}
    own_offset = {}
    context.route('**/*', lambda route: (serve(probe_files[route.request.url.rsplit('/', 1)[1]])(route) if '/__sync/' in route.request.url and route.request.url.rsplit('/', 1)[1] in probe_files
                                         else route.fulfill(status=200, body='<!doctype html><body>', headers={'Content-Type': 'text/html'}) if route.request.url.endswith('/__sync/')
                                         else route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort()))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ── (0) What the browser does, against the container ──
    if not BEFORE:
        page.goto(f'{BASE}/__sync/')
        names = [name for _, name, _, _ in SOURCES]
        answers = dict(zip(names, container([files[n] for n in names])))
        for label, name, event, _ in SOURCES:
            probe_files[name] = bodies[name]
            facts = page.evaluate(BROWSER_FACTS, {'url': f'{BASE}/__sync/{name}', 'fps': 24, 'eventSec': SOUND_EVENT.get(name, event)})
            starts = ffprobe_starts(files[name])
            timing = answers[name].get('timing') or {}
            video = timing.get('video') or {}
            sound = timing.get('sound') if isinstance(timing.get('sound'), dict) else {}
            played = page.evaluate(EXPORTED, {'url': f'{BASE}/__sync/{name}', 'fps': 24, 'frames': 60})
            if played.get('beepSec') is not None and played.get('flashMediaTime') is not None and 'firstSec' in sound:
                own_offset[name] = (sound['firstSec'] + played['beepSec'] - played['flashMediaTime']) * 1000
            measure(f'(0) {label}: as Chromium plays it, the white frame at mediaTime {played.get("flashMediaTime")}, the beep at movie time '
                    f'{(sound.get("firstSec", 0) + (played.get("beepSec") or 0)):.6f}: the file’s own offset {own_offset.get(name, float("nan")):+.1f} ms')
            measure(f'(0) {label}: ffprobe video {starts.get("video"):.6f} / audio {starts.get("audio"):.6f} | container video {video.get("firstSec")} / sound {sound.get("firstSec")} | '
                    f'Chromium first frame mediaTime {facts.get("firstMediaTime")}, decodeAudioData sample 0 at movie time {facts.get("sample0"):.6f} '
                    f'(beep at sample {facts.get("beepSample")} of {facts.get("length")})')
            check(f'(0) {label}: the reader agrees with ffprobe and Chromium (video start = first frame mediaTime; sound start = decodeAudioData sample 0, within 1 ms)',
                  answers[name].get('ok') and abs(video['firstSec'] - starts['video']) < 1e-3 and abs(sound['firstSec'] - starts['audio']) < 1e-3
                  and abs(video['firstSec'] - facts['firstMediaTime']) < 1e-3 and abs(sound['firstSec'] - facts['sample0']) < 1e-3,
                  json.dumps({'reader': [video.get('firstSec'), sound.get('firstSec')], 'ffprobe': [starts.get('video'), starts.get('audio')], 'chromium': [facts.get('firstMediaTime'), facts.get('sample0')]}))

    def open_v2():
        page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
        page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=240000)
        page.wait_for_timeout(500)

    def export(name):
        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=10000)
        download = None
        try:
            with page.expect_download(timeout=300000) as info:
                page.click('[data-editor-export-start]')
                page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=done], [data-editor-export-sheet][data-editor-export-status=failed]', timeout=300000)
            download = info.value
        except Exception:
            pass
        status = page.get_attribute('[data-editor-export-sheet]', 'data-editor-export-status')
        warnings = page.evaluate("() => [...document.querySelectorAll('[data-editor-export-warning]')].map((el) => el.dataset.editorExportWarning + ': ' + el.textContent)")
        if download is None or status != 'done':
            return status, None, warnings
        path = os.path.join(OUT, f'{name}.mp4')
        download.save_as(path)
        return status, path, warnings

    open_v2()
    uploads = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => el.dataset.editorSource).filter((k) => k.startsWith('a:'))")
    check('the organization has two uploads to stand in for', len(uploads) >= 2, str(len(uploads)))
    if len(uploads) < 2:
        return
    stand_in = [u[2:] for u in uploads[:2]]
    address = lambda asset: '/api/brand-studio/compose?' + urllib.parse.urlencode({'organizationId': ORG, 'source': 'asset', 'id': asset})
    pattern = lambda asset: re.compile(r'/api/brand-studio/compose\?.*id=' + re.escape(asset))

    def clip(cid, asset, start, end):
        return {'id': cid, 'label': cid, 'sourceKind': 'asset', 'assetId': asset, 'srcUrl': address(asset), 'thumbUrl': None, 'durationSec': 3,
                'trimStartSec': start, 'trimEndSec': end, 'volume': 1, 'muted': False}

    table = []
    # ── (1) One cut per source ──
    for label, name, event, flash_index in SOURCES:
        handler = serve(bodies[name])
        context.route(pattern(stand_in[0]), handler)
        film = {'version': 1, 'aspect': '16:9', 'captions': [], 'bgm': None, 'clips': [clip('sync-cut', stand_in[0], 0, 2.5)]}
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film)])
        open_v2()
        status, path, warnings = export('sync-' + name.replace('.mp4', ''))
        context.unroute(pattern(stand_in[0]), handler)
        if not path:
            check(f'(1) {label}: exported', False, f'status {status}')
            continue
        fps, flashes, onsets = events(path)
        if not flashes or not onsets:
            check(f'(1) {label}: white frame and beep found', False, f'{flashes} {onsets}')
            continue
        error = (onsets[0] / 48000 - flashes[0] / fps) * 1000
        table.append((label, error))
        measure(f'(1) {label}: white frame {flashes[0]} ({flashes[0] / fps * 1000:.1f} ms), beep at sample {onsets[0]} ({onsets[0] / 48:.1f} ms): sound − picture {error:+.1f} ms; warnings {warnings}')
        own = own_offset.get(name)
        if own is not None:
            measure(f'(1) {label}: the export {error:+.1f} ms against the file’s own {own:+.1f} ms as Chromium plays it')
        if name in SOUND_EVENT:
            # The file itself plays its beep this much after its flash (Chromium and ffmpeg alike); nothing in
            # the file says why, so the export keeps it: within 1 ms of the file's own offset.
            own = (SOUND_EVENT[name] - event) * 1000
            check(f'(1) {label}: the export keeps the file’s own offset ({own:+.1f} ms) within 1 ms', abs(error - own) <= 1, f'{error:+.1f} ms')
        elif own is not None and abs(own) > TARGET_MS:
            # The file itself is out of step as Chromium plays it: the export keeps what the person saw.
            check(f'(1) {label}: the export keeps the file’s own offset as Chromium plays it ({own:+.1f} ms) within 1 ms', abs(error - own) <= 1, f'{error:+.1f} ms')
        else:
            check(f'(1) {label}: sound − picture within ±{TARGET_MS:.0f} ms', abs(error) <= TARGET_MS, f'{error:+.1f} ms')

    # ── (2) Two cuts from different sources: the second cut's offset matters ──
    first, second = serve(bodies['s2-video-late.mp4']), serve(bodies['s3-both-late.mp4'])
    context.route(pattern(stand_in[0]), first)
    context.route(pattern(stand_in[1]), second)
    film = {'version': 1, 'aspect': '16:9', 'captions': [], 'bgm': None, 'clips': [clip('sync-a', stand_in[0], 0, 1.5), clip('sync-b', stand_in[1], 0.5, 2.0)]}
    page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film)])
    open_v2()
    status, path, warnings = export('sync-two-cuts')
    context.unroute(pattern(stand_in[0]), first)
    context.unroute(pattern(stand_in[1]), second)
    if path:
        fps, flashes, onsets = events(path)
        pairs = list(zip(flashes, onsets))
        errors_ms = [(o / 48000 - f / fps) * 1000 for f, o in pairs]
        measure(f'(2) two cuts (s2 0–1.5 s, then s3 0.5–2.0 s): white frames {flashes}, beeps {onsets}: sound − picture {[f"{e:+.1f}" for e in errors_ms]} ms')
        check(f'(2) two cuts: both events within ±{TARGET_MS:.0f} ms', len(pairs) == 2 and flashes == [24, 48] and all(abs(e) <= TARGET_MS for e in errors_ms), f'{flashes} {[round(e, 1) for e in errors_ms]}')
    else:
        check('(2) two cuts: exported', False, f'status {status}')

    measure('(1)+(2) table: ' + '; '.join(f'{label} {error:+.1f} ms' for label, error in table))

    # ── (3) The exported file itself (B2) ──
    if not BEFORE:
        path = os.path.join(OUT, 'sync-s1-plain.mp4')
        if os.path.exists(path):
            edits = audio_edits(path)
            starts = ffprobe_starts(path)
            measure(f'(3) exported s1: sound track edit list {edits or "none"}; ffprobe start video {starts.get("video")}, audio {starts.get("audio")}')
            probe_files['exported.mp4'] = open(path, 'rb').read()
            page.goto(f'{BASE}/__sync/')
            seen = page.evaluate(EXPORTED, {'url': f'{BASE}/__sync/exported.mp4', 'fps': 24, 'frames': 60})
            if seen['beepSec'] is not None and seen['flashMediaTime'] is not None:
                chromium = (seen['beepSec'] - seen['flashMediaTime']) * 1000
                measure(f'(3) Chromium reading the exported s1: beep at {seen["beepSec"] * 1000:.1f} ms of its decoded sound, white frame at mediaTime {seen["flashMediaTime"] * 1000:.1f} ms: sound − picture {chromium:+.1f} ms')
                check(f'(3) Chromium’s own reading of the exported file agrees within ±{TARGET_MS:.0f} ms', abs(chromium) <= TARGET_MS, f'{chromium:+.1f} ms')
            else:
                check('(3) Chromium found the beep and the white frame in the exported file', False, json.dumps(seen))
    check('no page errors', not errors, '; '.join(errors[:3]))


if __name__ == '__main__':
    main()
