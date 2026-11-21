"""Real-browser check of the editor in a window that does not draw live (spec E addendum, C1 and C2 (a)).

Production (2026-11-21): a Chrome window covered by another window stayed `visibilityState: visible` and
focused, but requestAnimationFrame fired about once a second and a playing video's
requestVideoFrameCallback once a second. Clips added there never got their frame rate (measured by
playback), and the export, which waits for each picture the same way, crawled.

  (0) the state itself, first: requestAnimationFrame and a playing video's frame callbacks per 2 s, in a
      headed Chromium launched without Playwright's anti-throttling flags, live vs covered by another
      window of its own vs minimised. Twice: a page Playwright drives, and a page it does not drive
      (created through the browser's own target API; its title carries the numbers out). Then the state
      production showed, applied inside the page (`--throttle`: requestAnimationFrame and
      requestVideoFrameCallback answered once a second, the page still visible) — used for (2)-(5) when the
      real window does not reproduce it; the report says which;
  (1) the frame facts: container (lib/brand-studio/editor-v2/container.ts) vs playback measurement vs
      ffprobe, on generated files (24, 25, 30, 23.976, 29.97, 60 fps, B-frames, variable rate, an edit list
      that trims leading frames, moov at the end, MOV) and on the organization's uploaded clips;
  (2) adding a clip: time from the click to the cut on the timeline and to its frame data in storage,
      live and in the reduced state;
  (3) a stored cut without frame data (the production state) heals on open in the reduced state: rate
      known, export not refused;
  (4) exporting in the reduced state: it finishes, the file is frame-exact (frame k shows source frame
      k, read back with ffmpeg), the time it took, and whether the sheet said the window is slow;
  (5) back to live in the middle of an export: the line goes away and the frames come faster.

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id> whose organization has the frame-numbered upload:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-covered-window-check.py <out-dir> <media-dir> [before]

`before` runs (0) and (2)-(5) only, against a checkout older than the container reader.

<media-dir> holds the generated files of part (1) (made here with ffmpeg when missing). Headed Python
Playwright with its own full Chromium and a fresh profile; localhost only; never attaches to another
browser; ffmpeg/ffprobe and node on PATH. Prints PASS/FAIL and MEASURE lines; exits non-zero on failure.
Closes its windows when done.
"""
import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.parse

from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
MEDIA = sys.argv[2] if len(sys.argv) > 2 else None
# `before`: the code under test predates the container reader; part (1) is skipped.
BEFORE = len(sys.argv) > 3 and sys.argv[3] == 'before'
KEY = f'twings_studio_compose_v1:{ORG}'
ROOT = os.environ.get('EDITOR_REPO_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
# Playwright's defaults that keep a covered or background window drawing live.
ANTI_THROTTLING = ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
results = []

# The production state, inside the page: requestAnimationFrame and requestVideoFrameCallback are answered
# on a once-a-second beat while `window.__ev2Throttle` is true (timers and the page's visibility untouched).
THROTTLE = r"""(() => {
  if (window.__ev2ThrottleInstalled) return;
  window.__ev2ThrottleInstalled = true;
  try { window.__ev2Throttle = localStorage.getItem('__ev2-throttle') === '1'; } catch { window.__ev2Throttle = false; }
  const raf = window.requestAnimationFrame.bind(window);
  const cancelRaf = window.cancelAnimationFrame.bind(window);
  const proto = HTMLVideoElement.prototype;
  const rvfc = proto.requestVideoFrameCallback;
  const cancelRvfc = proto.cancelVideoFrameCallback;
  let next = 1;
  const frames = new Map();
  const videos = new Map();
  window.requestAnimationFrame = (callback) => {
    if (!window.__ev2Throttle) return raf(callback);
    const id = -(next++);
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => (id < 0 ? frames.delete(id) : cancelRaf(id));
  proto.requestVideoFrameCallback = function (callback) {
    if (!window.__ev2Throttle) return rvfc.call(this, callback);
    const id = -(next++);
    const entry = { video: this, callback, latest: null, handle: 0 };
    const watch = (now, metadata) => { entry.latest = metadata; entry.handle = rvfc.call(entry.video, watch); };
    entry.handle = rvfc.call(this, watch);
    videos.set(id, entry);
    return id;
  };
  proto.cancelVideoFrameCallback = function (id) {
    if (id >= 0) return cancelRvfc.call(this, id);
    const entry = videos.get(id);
    if (entry) { cancelRvfc.call(entry.video, entry.handle); videos.delete(id); }
  };
  const beat = () => {
    const now = performance.now();
    const due = [...frames.values()];
    frames.clear();
    const shown = [...videos.entries()].filter(([, entry]) => entry.latest);
    for (const [id, entry] of shown) { videos.delete(id); cancelRvfc.call(entry.video, entry.handle); }
    for (const callback of due) callback(now);
    for (const [, entry] of shown) entry.callback(now, entry.latest);
  };
  setInterval(beat, 1000);
  window.__ev2SetThrottle = (on) => { window.__ev2Throttle = on; try { localStorage.setItem('__ev2-throttle', on ? '1' : '0'); } catch {} if (!on) beat(); };
})();"""

CADENCE = """async () => {
  let n = 0; const t0 = performance.now();
  await new Promise((r) => { const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); setTimeout(r, 2600); });
  let v = document.getElementById('cadence-video');
  if (!v) {
    v = document.createElement('video'); v.id = 'cadence-video'; v.muted = true; v.loop = true; v.playsInline = true;
    v.src = '/reel/studio-demo/frame-count-24.mp4'; v.style.cssText = 'position:fixed;right:8px;bottom:8px;width:160px;height:90px;z-index:9';
    document.body.appendChild(v); await v.play().catch(() => {});
  }
  const times = []; const s0 = performance.now();
  await new Promise((r) => { const cb = (now, m) => { times.push(+m.mediaTime.toFixed(3)); if (performance.now() - s0 < 2000) v.requestVideoFrameCallback(cb); else r(); }; v.requestVideoFrameCallback(cb); setTimeout(r, 2600); });
  v.remove();
  return { raf2s: n, rvfc2s: times.length, mediaTimes: times.slice(0, 4), visibility: document.visibilityState };
}"""

RAW_PAGE = """<!doctype html><title>start</title><body style="background:#ddd"><video id=v autoplay muted loop playsinline style="width:320px;height:180px" src="BASE/reel/studio-demo/frame-count-24.mp4"></video><script>
const v = document.getElementById('v'); v.play().catch(() => {});
let raf = [], vf = [];
const f = () => { raf.push(performance.now()); requestAnimationFrame(f); }; requestAnimationFrame(f);
const g = (now, m) => { vf.push(performance.now()); v.requestVideoFrameCallback(g); }; v.requestVideoFrameCallback(g);
setInterval(() => { const t = performance.now(); raf = raf.filter((x) => x > t - 2000); vf = vf.filter((x) => x > t - 2000);
  document.title = JSON.stringify({ raf2s: raf.length, rvfc2s: vf.length, visibility: document.visibilityState }); }, 250);
</script>""".replace('BASE', BASE)

PLAYBACK_RATE = """async (url) => {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:36px';
  document.body.appendChild(v);
  const times = [];
  await new Promise((resolve) => {
    v.addEventListener('loadeddata', () => { const cb = (n, m) => { times.push(m.mediaTime); if (times.length < 13) v.requestVideoFrameCallback(cb); else resolve(); }; v.requestVideoFrameCallback(cb); v.play(); }, { once: true });
    v.addEventListener('error', resolve, { once: true }); v.addEventListener('ended', resolve, { once: true });
    setTimeout(resolve, 8000); v.src = url;
  });
  const gaps = []; for (let i = 1; i < times.length; i++) { const g = times[i] - times[i - 1]; if (g > 1e-4 && g < 0.5) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const mid = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const out = { fps: mid ? 1 / mid : null, duration: v.duration, first: times[0] ?? null, frames: times.length };
  v.remove();
  return out;
}"""

STATE = """() => {
  const root = document.querySelector('[data-studio-editor-v2]');
  const preview = document.querySelector('[data-editor-preview]');
  return {
    status: root && root.dataset.editorStatus, fps: preview ? Number(preview.dataset.editorFps) : 0,
    cuts: [...document.querySelectorAll('[data-editor-clip]')].map((el) => Number(el.dataset.frames)),
  };
}"""

SQUARE_X = [34 + 52 * i + 20 for i in range(11)]
SQUARE_Y = 306


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def measure(text):
    print('MEASURE  ' + text, flush=True)


def run(args, **kw):
    return subprocess.run(args, capture_output=True, check=True, creationflags=NO_WINDOW, **kw)


def ffprobe(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-count_frames', '-show_entries', 'stream=r_frame_rate,nb_frames,nb_read_frames,start_time', '-of', 'json', path]).stdout
    s = json.loads(out)['streams'][0]
    num, den = (int(x) for x in s['r_frame_rate'].split('/'))
    return {'fps': num / den, 'rate': s['r_frame_rate'], 'samples': int(s.get('nb_frames') or 0), 'decoded': int(s.get('nb_read_frames') or 0), 'start': float(s.get('start_time') or 0)}


def container(paths):
    """The container reader's answers, through node with the repository's own TypeScript."""
    if not paths:
        return []
    code = ("import { readFileSync } from 'node:fs';"
            "const { timingOfFile } = await import('./lib/brand-studio/editor-v2/container.ts');"
            "for (const f of process.argv.slice(1)) console.log(JSON.stringify(await timingOfFile(new Uint8Array(readFileSync(f)))));")
    node = 'node.exe' if os.name == 'nt' else 'node'
    out = run([node, '--import', 'tsx', '--input-type=module', '-e', code, *paths], cwd=ROOT).stdout.decode()
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def make_media(folder):
    os.makedirs(folder, exist_ok=True)
    clip = os.path.join(ROOT, 'public', 'reel', 'studio-demo', 'frame-count-24.mp4')
    files = {}

    def make(name, args):
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            run(['ffmpeg', '-v', 'error', '-y', *args, path])
        files[name] = path

    for label, rate in [('24', '24'), ('25', '25'), ('30', '30'), ('23.976', '24000/1001'), ('29.97', '30000/1001'), ('60', '60')]:
        make(f'r{label}.mp4', ['-f', 'lavfi', '-i', f'testsrc2=s=320x180:r={rate}:d=2', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
    make('bframes30.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-c:v', 'libx264', '-bf', '3', '-pix_fmt', 'yuv420p'])
    make('vfr.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=1', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]',
                     '-map', '[v]', '-fps_mode', 'vfr', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p'])
    make('trimmed.mp4', ['-ss', '0.3', '-i', clip, '-t', '2', '-c', 'copy'])
    make('tail-moov.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p'])
    make('r30.mov', ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', '-f', 'mov'])
    return files


# Sources like the video studio's results: a picture track that is not a whole number of frames long in a
# container whose sound runs a little longer (spec E addendum C3). Name, first frame number, pictures.
C3_SOURCES = [('c3-a 4.06s', 0, 97), ('c3-b 4.06s', 100, 97), ('c3-c 5.06s', 0, 121)]


def make_c3(folder):
    clip = os.path.join(ROOT, 'public', 'reel', 'studio-demo', 'frame-count-24.mp4')
    out = {}
    for name, first, count in C3_SOURCES:
        path = os.path.join(folder, re.sub('[^a-z0-9.-]+', '-', name) + '.mp4')
        seconds = 5.06 if count == 121 else 4.06
        if not os.path.exists(path):
            run(['ffmpeg', '-v', 'error', '-y', '-i', clip, '-f', 'lavfi', '-i', f'sine=frequency=440:sample_rate=48000:duration={seconds}',
                 '-vf', f'select=between(n\\,{first}\\,{first + count - 1}),setpts=N/24/TB', '-frames:v', str(count), '-map', '0:v', '-map', '1:a',
                 '-c:v', 'libx264', '-bf', '0', '-g', '24', '-pix_fmt', 'yuv420p', '-r', '24', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path])
        out[name] = (path, seconds)
    return out


def upload_c3(page, context, media):
    """Uploads the C3 sources to the organization through the local API, once (by name)."""
    names = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => (el.textContent || '').trim())")
    api = f'{BASE}/api/brand-studio'
    for name, (path, seconds) in make_c3(MEDIA).items():
        if any(name in n for n in names):
            continue
        data = open(path, 'rb').read()
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': BASE}
        reserved = context.request.post(api, data=json.dumps({'operation': 'asset.reserve', 'input': {'organizationId': ORG, 'requestId': os.urandom(16).hex(), 'name': name + '.mp4', 'mime': 'video/mp4', 'sizeBytes': len(data)}}), headers=headers).json()
        reserved = reserved.get('data', reserved)
        target = reserved.get('url') if reserved.get('direct') else None
        if target and not target.startswith(BASE):
            raise SystemExit('refusing a non-local upload address')
        if target:
            put = context.request.put(target, data=data, headers={'Content-Type': 'video/mp4'})
        else:
            put = context.request.post(f'{api}/assets/{reserved["id"]}?organizationId={ORG}', data=data, headers={'Content-Type': 'video/mp4', 'Origin': BASE})
        if not put.ok:
            raise SystemExit(f'upload failed: {put.status}')
        # The length the asset view carries, rounded the way a view shows it (4.1 s, 5.1 s).
        context.request.post(api, data=json.dumps({'operation': 'asset.complete', 'input': {'organizationId': ORG, 'assetId': reserved['id'], 'width': 640, 'height': 360, 'seconds': round(seconds, 1)}}), headers=headers)
        print(f'      uploaded {name}', flush=True)


def decode_numbers(path, width, height):
    sx, sy = width / 640, height / 360
    y = round(SQUARE_Y * sy)
    rows, top = 4, (y - 2) // 2 * 2
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={width}:{rows}:0:{top}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE, creationflags=NO_WINDOW)
    size = width * rows * 3
    numbers = []
    while True:
        frame = proc.stdout.read(size)
        if len(frame) < size:
            break
        row = frame[width * 3 * (y - top): width * 3 * (y - top + 1)]

        def level(i):
            x = round(SQUARE_X[i] * sx)
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


def serve_bytes(files):
    def serve(route):
        url = route.request.url
        if url.endswith('/__cw/'):
            return route.fulfill(status=200, body='<!doctype html><title>check</title><body style="background:#eee">', headers={'Content-Type': 'text/html'})
        name = urllib.parse.unquote(url.rsplit('/', 1)[1])
        body = files.get(name)
        if body is None:
            return route.fulfill(status=404, body='')
        ctype = 'video/quicktime' if name.endswith('.mov') else 'video/mp4'
        rng = route.request.headers.get('range')
        if rng and rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            start, end = int(a or 0), min(int(b) if b else len(body) - 1, len(body) - 1)
            return route.fulfill(status=206, body=body[start:end + 1], headers={'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {start}-{end}/{len(body)}'})
        return route.fulfill(status=200, body=body, headers={'Content-Type': ctype, 'Accept-Ranges': 'bytes'})
    return serve


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not OUT or not MEDIA:
        sys.exit('usage: editor-v2-covered-window-check.py <out-dir> <media-dir>')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG:
        sys.exit('EDITOR_ORG_ID is required')
    os.makedirs(OUT, exist_ok=True)
    media = make_media(MEDIA)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'), ignore_default_args=ANTI_THROTTLING,
                                    args=['--window-position=40,40', '--window-size=1460,980'])
        try:
            run_checks(browser, media)
        finally:
            browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


def run_checks(browser, media):
    cdp = browser.new_browser_cdp_session()

    def window_of(context, page):
        target = context.new_cdp_session(page).send('Target.getTargetInfo')['targetInfo']['targetId']
        return cdp.send('Browser.getWindowForTarget', {'targetId': target})

    # ── (0) The state itself: first a page Playwright does not drive, alone in the browser ──
    raw = cdp.send('Target.createTarget', {'url': 'data:text/html,' + urllib.parse.quote(RAW_PAGE), 'newWindow': True})['targetId']
    raw_window = cdp.send('Browser.getWindowForTarget', {'targetId': raw})
    raw_title = lambda: json.loads(next(t['title'] for t in cdp.send('Target.getTargets')['targetInfos'] if t['targetId'] == raw) or '{}')
    time.sleep(4)
    live_raw = raw_title()

    # A window of our own to cover the page with.
    cover_context = browser.new_context(viewport=None)
    cover = cover_context.new_page()
    cover.goto('about:blank')
    cover_window = window_of(cover_context, cover)

    def cover_up(window):
        bounds = {k: window['bounds'][k] for k in ('left', 'top', 'width', 'height')}
        cdp.send('Browser.setWindowBounds', {'windowId': cover_window['windowId'], 'bounds': {'windowState': 'normal'}})
        cdp.send('Browser.setWindowBounds', {'windowId': cover_window['windowId'], 'bounds': bounds})
        cover.bring_to_front()
        time.sleep(3)

    def uncover():
        cdp.send('Browser.setWindowBounds', {'windowId': cover_window['windowId'], 'bounds': {'windowState': 'minimized'}})
        time.sleep(2)

    def set_state(window, state):
        cdp.send('Browser.setWindowBounds', {'windowId': window['windowId'], 'bounds': {'windowState': state}})
        time.sleep(3)

    cover_up(raw_window)
    covered_raw = raw_title()
    uncover()
    set_state(raw_window, 'minimized')
    minimised_raw = raw_title()
    set_state(raw_window, 'normal')
    measure(f'(0) a page Playwright does not drive: live {live_raw}; covered by another window {covered_raw}; minimised {minimised_raw}')
    cdp.send('Target.closeTarget', {'targetId': raw})

    context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
    context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
    context.add_init_script(THROTTLE)
    files = {name: open(path, 'rb').read() for name, path in media.items()}
    context.route('**/*', lambda route: serve_bytes(files)(route) if '/__cw/' in route.request.url else (route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort()))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/__cw/')
    window = window_of(context, page)
    live = page.evaluate(CADENCE)
    cover_up(window)
    covered = page.evaluate(CADENCE)
    uncover()
    set_state(window, 'minimized')
    minimised = page.evaluate(CADENCE)
    set_state(window, 'normal')
    page.bring_to_front()
    page.evaluate('() => window.__ev2SetThrottle(true)')
    shimmed = page.evaluate(CADENCE)
    page.evaluate('() => window.__ev2SetThrottle(false)')
    measure(f'(0) a page Playwright drives: live {live}; covered {covered}; minimised {minimised}; with the production state applied in the page {shimmed}')
    reproduced = covered['raf2s'] <= 4 or minimised['raf2s'] <= 4
    measure('(0) the production state (visible, about one animation frame a second) ' + ('IS reproduced by the real window' if reproduced else
            'is NOT reproduced by covering or minimising a window Playwright drives (it keeps every page it drives drawing live); '
            'the in-page state (requestAnimationFrame and requestVideoFrameCallback once a second, page visible) is used for (2)-(5)'))
    check('(0) the in-page state matches production: about 1 animation frame and 1 video frame per second, page visible',
          shimmed['raf2s'] <= 3 and shimmed['rvfc2s'] <= 3 and shimmed['visibility'] == 'visible', json.dumps(shimmed))
    throttle = (lambda on: page.evaluate('(on) => window.__ev2SetThrottle(on)', on)) if not reproduced else (lambda on: (cover_up(window) if on else uncover()))

    # ── (1) Frame facts: container vs playback vs ffprobe ──
    names = [] if BEFORE else sorted(media)
    answers = dict(zip(names, container([media[n] for n in names])))
    for name in names:
        probe = ffprobe(media[name])
        answer = answers[name]
        video = answer.get('timing', {}).get('video') if answer.get('ok') else None
        played = page.evaluate(PLAYBACK_RATE, f'{BASE}/__cw/{urllib.parse.quote(name)}')
        measure(f'(1) {name}: ffprobe r_frame_rate {probe["rate"]} ({probe["fps"]:.6f}), samples {probe["samples"]}, decoded {probe["decoded"]}, start {probe["start"]:.6f} | '
                f'container ' + (f'{video["fpsNum"]}/{video["fpsDen"]} ({video["fps"]:.6f}), frames {video["frames"]}, variable {video["variable"]}, start {video["firstSec"]:.6f}' if video else json.dumps(answer)) +
                f' | playback {played["fps"]:.6f} fps, first mediaTime {played["first"]}' if played.get('fps') else f' | playback: no rate ({json.dumps(played)})')
        if video:
            same_rate = abs(video['fps'] - probe['fps']) < 1e-6 or (video['variable'] and name == 'vfr.mp4')
            check(f'(1) {name}: container rate, frame count and start agree with ffprobe', same_rate and video['frames'] == probe['decoded'] and abs(video['firstSec'] - probe['start']) < 1e-3,
                  f'rate {video["fps"]:.6f} vs {probe["fps"]:.6f}, frames {video["frames"]} vs decoded {probe["decoded"]} (samples {probe["samples"]}), start {video["firstSec"]:.6f} vs {probe["start"]:.6f}')
        else:
            check(f'(1) {name}: container read', False, json.dumps(answer))

    # The organization's uploaded clips, as the editor reads them.
    def open_v2():
        page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
        page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=300000)
        page.wait_for_timeout(500)

    page.evaluate('(key) => localStorage.removeItem(key)', KEY)
    open_v2()
    sources = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => ({ key: el.dataset.editorSource, text: (el.textContent || '').trim().slice(0, 40) }))")
    uploads = [s for s in sources if s['key'].startswith('a:')]
    fixture_paths = []
    for index, source in enumerate(uploads):
        url = f'{BASE}/api/brand-studio/compose?' + urllib.parse.urlencode({'organizationId': ORG, 'source': 'asset', 'id': source['key'][2:]})
        data = context.request.get(url).body()
        path = os.path.join(OUT, f'upload-{index + 1}.mp4')
        open(path, 'wb').write(data)
        fixture_paths.append((source, path, url))
    for (source, path, url), answer in zip(fixture_paths, [] if BEFORE else container([path for _, path, _ in fixture_paths])):
        probe = ffprobe(path)
        video = answer.get('timing', {}).get('video') if answer.get('ok') else None
        played = page.evaluate(PLAYBACK_RATE, url)
        label = 'frame-numbered upload' if re.search('프레임|frame', source['text'], re.I) else f'upload {os.path.basename(path)}'
        measure(f'(1) {label}: ffprobe {probe["rate"]}, decoded {probe["decoded"]}, start {probe["start"]:.6f} | container ' +
                (f'{video["fpsNum"]}/{video["fpsDen"]}, frames {video["frames"]}, variable {video["variable"]}, start {video["firstSec"]:.6f}' if video else json.dumps(answer)) +
                (f' | playback {played["fps"]:.6f}' if played.get('fps') else ' | playback: no rate'))
        if video:
            check(f'(1) {label}: container agrees with ffprobe', abs(video['fps'] - probe['fps']) < 1e-6 and video['frames'] == probe['decoded'] and abs(video['firstSec'] - probe['start']) < 1e-3)

    frame_clip = next((s['key'] for s in uploads if re.search('프레임|frame', s['text'], re.I)), None)
    check('the organization has the frame-numbered upload', frame_clip is not None, json.dumps([s['text'] for s in uploads]))
    if not frame_clip:
        return
    stored = lambda: json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY) or 'null')

    # ── (2) Adding a clip, live and reduced ──
    def add_clip(label, reduced):
        page.evaluate('(key) => localStorage.removeItem(key)', KEY)
        open_v2()
        throttle(reduced)
        started = time.time()
        page.click(f'[data-editor-source="{frame_clip}"]', timeout=120000)
        try:
            page.wait_for_function('() => document.querySelectorAll("[data-editor-clip]").length === 1', timeout=120000, polling=200)
            on_timeline = time.time() - started
        except Exception:
            on_timeline = None
        saved_at = None
        deadline = time.time() + 60
        while time.time() < deadline:
            film = stored()
            if film and film.get('clips') and 'fps' in (film['clips'][0].get('frameV2') or {}):
                saved_at = time.time() - started
                break
            time.sleep(0.2)
        film = stored() or {}
        block = (film.get('clips') or [{}])[0].get('frameV2') or {}
        throttle(False)
        measure(f'(2) add a clip, {label}: on the timeline after ' + (f'{on_timeline:.2f} s' if on_timeline is not None else 'NOT within 120 s') +
                ', frame data stored after ' + (f'{saved_at:.2f} s' if saved_at is not None else 'NOT within 60 s') + f' (stored block: sourceFps {block.get("sourceFps")}, sourceFrames {block.get("sourceFrames")})')
        return on_timeline, saved_at, block

    live_add = add_clip('live window', False)
    slow_add = add_clip('reduced refresh', True)
    check('(2) reduced refresh: the clip is on the timeline within 2 s', slow_add[0] is not None and slow_add[0] < 2, f'{slow_add[0]}')
    check('(2) reduced refresh: its frame data (24 fps, 240 frames) is stored', slow_add[2].get('sourceFps') == 24 and slow_add[2].get('sourceFrames') == 240, json.dumps(slow_add[2]))

    # ── (3) A stored cut without frame data heals on open ──
    clip_id = frame_clip[2:]
    src = '/api/brand-studio/compose?' + urllib.parse.urlencode({'organizationId': ORG, 'source': 'asset', 'id': clip_id})
    bare = {'version': 1, 'aspect': '16:9', 'captions': [], 'bgm': None,
            'clips': [{'id': 'covered-cut', 'label': 'covered cut', 'sourceKind': 'asset', 'assetId': clip_id, 'srcUrl': src, 'thumbUrl': None,
                       'durationSec': 10, 'trimStartSec': 0, 'trimEndSec': 1, 'volume': 1, 'muted': False}]}
    page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(bare)])
    throttle(True)
    started = time.time()
    open_v2()
    opened = time.time() - started
    page.click('[data-editor-export]', timeout=60000)
    page.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
    blocked = page.locator('[data-editor-export-blocked]')
    blocked_as = blocked.get_attribute('data-editor-export-blocked') if blocked.count() else None
    state = page.evaluate(STATE)
    measure(f'(3) a stored cut without frame data, opened in the reduced state: ready after {opened:.1f} s, cuts {state["cuts"]} at {state["fps"]} fps, export ' + (f'refused ({blocked_as})' if blocked_as else 'allowed'))
    check('(3) it heals on open: rate read, the cut on its frames, export not refused', not blocked_as and state['cuts'] == [24] and state['fps'] == 24, f'blocked {blocked_as}, {state}')

    # ── (4) Export in the reduced state ──
    def export(name, uncover_after=None):
        samples = []
        started = time.time()
        if page.locator('[data-editor-export-start][disabled]').count():
            blocked = page.locator('[data-editor-export-blocked]')
            return 'refused: ' + (blocked.inner_text() if blocked.count() else '?'), None, [], 0.0, None
        page.click('[data-editor-export-start]')
        page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=running]', timeout=60000)
        uncovered_at = None
        while True:
            info = page.evaluate("""() => { const s = document.querySelector('[data-editor-export-sheet]'); const p = document.querySelector('[data-editor-export-progress]');
              return { status: s && s.dataset.editorExportStatus, progress: p ? p.dataset.editorExportProgress : null, slow: !!document.querySelector('[data-editor-export-slow]') }; }""")
            info['t'] = round(time.time() - started, 2)
            samples.append(info)
            if info['status'] != 'running':
                break
            done = int(info['progress'].split('/')[0]) if info['progress'] and '/' in info['progress'] else None
            if uncover_after is not None and uncovered_at is None and done is not None and done >= uncover_after:
                throttle(False)
                uncovered_at = info['t']
            if time.time() - started > 1500:
                break
            time.sleep(0.5)
        status = samples[-1]['status']
        path = None
        if status == 'done':
            with page.expect_download(timeout=60000) as info:
                page.click('[data-editor-export-again]')
            path = os.path.join(OUT, f'{name}.mp4')
            info.value.save_as(path)
        return status, path, samples, time.time() - started, uncovered_at

    status, path, samples, took, _ = export('covered-export')
    throttle(False)
    # The line needs one long gap between animation frames to know (a second or two at one frame a second).
    settled = [s for s in samples if s['status'] == 'running' and s['t'] >= 2.5]
    slow_seen = sum(1 for s in settled if s['slow'])
    running = len(settled)
    first_line = next((s['t'] for s in samples if s['slow']), None)
    measure(f'(4) the line first seen {first_line} s after export started')
    check('(4) the export finishes in the reduced state', status == 'done', f'{status} after {took:.1f} s')
    check('(4) the sheet said the window is slow while it was (every look from 2.5 s on)', running > 0 and slow_seen == running, f'{slow_seen} of {running} looks')
    if path:
        numbers = decode_numbers(path, 1920, 1080)
        mismatches = [(k, n) for k, n in enumerate(numbers) if n != k]
        check('(4) the file is frame-exact: frame k shows source frame k', len(numbers) == 24 and not mismatches, f'{len(numbers)} frames, mismatches {mismatches[:5]}')
        measure(f'(4) export of 24 frames in the reduced state: {took:.1f} s ({24 / took:.2f} frames/s)')

    # ── (5) Back to live in the middle ──
    page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps({**bare, 'clips': [{**bare['clips'][0], 'trimEndSec': 3}]})])
    open_v2()
    page.click('[data-editor-export]')
    page.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
    throttle(True)
    status, path, samples, took, uncovered_at = export('uncovered-midway', uncover_after=8)
    throttle(False)

    def rate(window):
        points = [(s['t'], int(s['progress'].split('/')[0])) for s in window if s['progress'] and '/' in s['progress']]
        return (points[-1][1] - points[0][1]) / (points[-1][0] - points[0][0]) if len(points) > 1 and points[-1][0] > points[0][0] else None

    before = [s for s in samples if uncovered_at is None or s['t'] <= uncovered_at]
    after = [s for s in samples if uncovered_at is not None and s['t'] > uncovered_at + 1.5 and s['status'] == 'running']
    rb = rate(before)
    at_uncover = next((int(s['progress'].split('/')[0]) for s in reversed(before) if s['progress'] and '/' in s['progress']), None)
    # Frames left when it went live, over the time it then took to the last frame (the video phase's end).
    video_end = next((s['t'] for s in samples if s['progress'] and '/' not in s['progress'] or s['status'] != 'running'), took)
    ra = (72 - at_uncover) / max(0.05, video_end - uncovered_at) if at_uncover is not None and uncovered_at is not None else None
    line_after = any(s['slow'] for s in after)
    measure(f'(5) export of 72 frames, back to live at {uncovered_at} s: {rb} frames/s before, {ra} frames/s after; line shown after: {line_after}; total {took:.1f} s')
    slow_before = sum(1 for s in before if s['status'] == 'running' and s['slow'])
    check('(5) back to live: the line was there, goes away, and the frames come faster', status == 'done' and uncovered_at is not None and slow_before > 0 and not line_after and rb is not None and ra is not None and ra > rb * 3,
          f'status {status}, {rb} → {ra} frames/s')
    if path:
        numbers = decode_numbers(path, 1920, 1080)
        mismatches = [(k, n) for k, n in enumerate(numbers) if n != k]
        check('(5) that file is frame-exact too', len(numbers) == 72 and not mismatches, f'{len(numbers)} frames, mismatches {mismatches[:5]}')
    # ── (6) The last frame of a cut (addendum C3): sources whose length is not a whole number of frames ──
    upload_c3(page, context, media)
    open_v2()
    page.evaluate('(key) => localStorage.removeItem(key)', KEY)
    open_v2()
    bin_items = page.evaluate("() => [...document.querySelectorAll('[data-editor-source]')].map((el) => ({ key: el.dataset.editorSource, text: (el.textContent || '').trim() }))")
    keys = [next((b['key'] for b in bin_items if name in b['text']), None) for name, _, _ in C3_SOURCES]
    check('(6) the three generated sources are uploads of the organization', all(keys), json.dumps(keys))
    if all(keys):
        for count, key in enumerate(keys, start=1):
            page.click(f'[data-editor-source="{key}"]')
            page.wait_for_function(f'() => document.querySelectorAll("[data-editor-clip]").length === {count}', timeout=120000)
        page.click('[data-editor-aspect="16:9"]')
        page.wait_for_timeout(800)
        cuts = page.evaluate(STATE)['cuts']
        measure(f'(6) three sources added whole: cuts {cuts} frames (ffprobe: {[n for _, _, n in C3_SOURCES]} pictures)')
        check('(6) each cut is its source whole: the real number of pictures', cuts == [n for _, _, n in C3_SOURCES], json.dumps(cuts))
        expected = [k for _, first, n in C3_SOURCES for k in range(first, first + n)]
        for label, reduced in (('front window', False), ('reduced refresh', True)):
            page.click('[data-editor-export]')
            page.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
            throttle(reduced)
            status, path, samples, took, _ = export(f'c3-three-cuts-{"slow" if reduced else "front"}')
            throttle(False)
            numbers = decode_numbers(path, 1920, 1080) if path else []
            mismatches = [(k, n, e) for k, (n, e) in enumerate(zip(numbers, expected)) if n != e]
            failed_text = page.locator('[data-editor-export-failed]').inner_text() if page.locator('[data-editor-export-failed]').count() else ''
            measure(f'(6) three cuts to their ends, {label}: {status} after {took:.1f} s, {len(numbers)} frames, mismatches {len(mismatches)} {mismatches[:3]} {failed_text}')
            check(f'(6) {label}: the export finishes and every frame is the right picture, each cut ending on its source\'s last real one',
                  status == 'done' and len(numbers) == len(expected) and not mismatches, f'{status}, {len(numbers)}/{len(expected)} frames, {len(mismatches)} mismatches')
            page.keyboard.press('Escape')
            page.wait_for_timeout(300)

        # A film stored with one picture too many (the old measurement's 98 for a 97-picture file).
        film = stored()
        phantom = json.loads(json.dumps(film))
        # As production stored them: the clip's length is the view's 4.1 s, the old measurement counted
        # round(4.1 x 24) = 98 pictures, and the cut ran to the 98th.
        for clip in phantom['clips'][:2]:
            block = clip['frameV2']
            block['sourceFrames'] += 1
            block['frames'] += 1
            clip['durationSec'] = block['durationSec'] = 4.1
            clip['trimEndSec'] = round((block['frames']) / 24 + 1e-9, 1)
            block['mirror']['trimEndSec'] = clip['trimEndSec']
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(phantom)])
        throttle(True)
        open_v2()
        healed = page.evaluate(STATE)['cuts']
        measure(f'(6) a film stored with one picture too many in its first two cuts ({[c["frameV2"]["frames"] for c in phantom["clips"]]}): opens as {healed}')
        check('(6) it heals on open: the cuts end on the real last picture', healed == [n for _, _, n in C3_SOURCES], json.dumps(healed))
        # Opened (and healed) in the reduced state; exported in front (the reduced export is (6) above).
        throttle(False)
        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=60000)
        status, path, samples, took, _ = export('c3-phantom-healed')
        numbers = decode_numbers(path, 1920, 1080) if path else []
        mismatches = [(k, n, e) for k, (n, e) in enumerate(zip(numbers, expected)) if n != e]
        check('(6) and exports frame-exact', status == 'done' and len(numbers) == len(expected) and not mismatches, f'{status} after {took:.1f} s, {len(numbers)} frames, {len(mismatches)} mismatches')
        # The next write stores the corrected frame data.
        page.keyboard.press('Escape')
        page.click('[data-editor-aspect="9:16"]')
        page.wait_for_timeout(400)
        page.click('[data-editor-aspect="16:9"]')
        page.wait_for_timeout(1200)
        after = stored()
        blocks = [(c.get('frameV2') or {}).get('sourceFrames') for c in after['clips']]
        check('(6) the corrected frame data is what the next write stores', blocks == [n for _, _, n in C3_SOURCES], json.dumps(blocks))

    # Leave the organization's uploads as they were found (the other checks take the first uploads they see).
    for key in [k for k in keys if k]:
        context.request.post(f'{BASE}/api/brand-studio', data=json.dumps({'operation': 'asset.delete', 'input': {'organizationId': ORG, 'assetId': key[2:]}}),
                             headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': BASE})

    check('no page errors', not errors, '; '.join(errors[:3]))


if __name__ == '__main__':
    main()
