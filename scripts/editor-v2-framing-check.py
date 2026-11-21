"""Real-browser check that a landscape clip in a vertical film looks the same in the current editor's
exported file, v2's preview and v2's exported file (review round 1, item 5;
lib/brand-studio/editor-v2/framing.ts mirrors the current exporter's private `drawVideoCover`).

  (1) the stored film: one landscape upload (1280x720) in a 9:16 film, two seconds, made the way the
      current editor stores it;
  (2) v2's preview: the picture is fitted inside (bars above and below, the exporter's #0B0C0E), its
      edges where the rule puts them (rows 656..1263 of 1920, as a share of the preview frame's height);
  (3) v2's export: ffmpeg reads the first and last picture rows at 0.5 s: 656 and 1263 (±2), the bars
      are #0B0C0E (within the encoder's rounding);
  (4) the current editor's own export of the same stored film: the same rows (±2).

Run against a local server started with BRAND_STUDIO_V2=on BRAND_STUDIO_EDITOR_V2=on and
BRAND_STUDIO_EDITOR_V2_ORGS=<the organization id> whose organization has a landscape video upload. The
id comes from the environment:

  EDITOR_BASE_URL=http://localhost:3611 EDITOR_ORG_ID=<organization id> python scripts/editor-v2-framing-check.py <out-dir>

Python Playwright with its own full Chromium and a fresh profile; talks only to the local address; never
attaches to another browser; ffmpeg on PATH. Prints PASS/FAIL lines with the measured rows, exits non-zero
on any failure, keeps both exported files and 1440x900 captures in <out-dir>.
"""
import io
import json
import os
import subprocess
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get('EDITOR_BASE_URL', 'http://localhost:3611')
ORG = os.environ.get('EDITOR_ORG_ID', '')
OUT = sys.argv[1] if len(sys.argv) > 1 else None
KEY = f'twings_studio_compose_v1:{ORG}'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
BAR = (11, 12, 14)  # #0B0C0E
results = []

SOURCES = """async () => {
  const out = [];
  for (const el of document.querySelectorAll('[data-editor-source]')) {
    const key = el.dataset.editorSource;
    if (!key.startsWith('a:')) continue;
    const text = el.textContent || '';
    if (/프레임|frame/i.test(text)) continue;
    const params = new URLSearchParams({ organizationId: ORG, source: 'asset', id: key.slice(2) });
    const src = `/api/brand-studio/compose?${params}`;
    const size = await new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata';
      v.onloadedmetadata = () => resolve([v.videoWidth, v.videoHeight, v.duration]);
      v.onerror = () => resolve(null);
      v.src = src;
    });
    if (size) out.push({ key, src, width: size[0], height: size[1], duration: size[2] });
  }
  return out;
}"""


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  [{detail}]' if detail else ''), flush=True)


def is_bar(pixel, tolerance=10):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel[:3], BAR))


def picture_rows(image):
    """First and last rows, down the middle third of the picture, that are not the bar colour."""
    width, height = image.size
    xs = [width * k // 12 for k in range(4, 9)]
    rows = [y for y in range(height) if any(not is_bar(image.getpixel((x, y))) for x in xs)]
    return (rows[0], rows[-1]) if rows else (None, None)


def frame_of(path, seconds):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{seconds:.3f}', '-i', path, '-vframes', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                         capture_output=True, check=True, creationflags=NO_WINDOW).stdout
    return Image.open(io.BytesIO(raw)).convert('RGB')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
        sys.exit('EDITOR_BASE_URL must be a local address')
    if not ORG or not OUT:
        sys.exit('EDITOR_ORG_ID and an out-dir are required')
    os.makedirs(OUT, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.environ.get('EDITOR_BROWSER_CHANNEL', 'chromium'))
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, accept_downloads=True)
        context.add_cookies([{'name': 'playbook.locale', 'value': 'ko', 'url': BASE}])
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith((BASE, 'data:', 'blob:')) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def open_v2():
            page.goto(f'{BASE}/brand/studio/editor?organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
            page.wait_for_selector('[data-studio-editor-v2][data-editor-status=ready]', timeout=240000)
            page.wait_for_timeout(800)

        # (1) The stored film: one landscape upload in a 9:16 film.
        open_v2()
        sources = page.evaluate(SOURCES.replace('ORG', json.dumps(ORG)))
        wide = next((s for s in sources if s['width'] > s['height']), None)
        check('the organization has a landscape upload', wide is not None, json.dumps([(s['width'], s['height']) for s in sources]))
        if not wide:
            return finish(browser, errors)
        asset = wide['key'][2:]
        film = {'version': 1, 'aspect': '9:16', 'captions': [], 'bgm': None,
                'clips': [{'id': 'framing-1', 'label': 'landscape', 'sourceKind': 'asset', 'assetId': asset, 'srcUrl': wide['src'], 'thumbUrl': None,
                           'durationSec': round(wide['duration'], 1), 'trimStartSec': 0, 'trimEndSec': 2, 'volume': 1, 'muted': False}]}
        page.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, json.dumps(film)])

        # (2) v2's preview.
        open_v2()
        page.wait_for_function("() => document.querySelector('[data-editor-preview] video')?.dataset.editorFraming === 'fit'", timeout=20000)
        page.wait_for_selector('[data-editor-preview][data-editor-settled]', timeout=20000)
        page.wait_for_timeout(500)
        box = page.locator('[data-editor-frame]').bounding_box()
        shot = Image.open(io.BytesIO(page.screenshot(clip=box))).convert('RGB')
        shot.save(os.path.join(OUT, 'framing-v2-preview.png'))
        top, bottom = picture_rows(shot)
        h = shot.size[1]
        want_top, want_bottom = 656 / 1920 * h, 1264 / 1920 * h
        check('(2) v2’s preview fits the picture inside, bars on the exporter’s colour',
              top is not None and is_bar(shot.getpixel((shot.size[0] // 2, 2))) and is_bar(shot.getpixel((shot.size[0] // 2, h - 3))),
              f'top-left {shot.getpixel((shot.size[0] // 2, 2))}')
        check('(2) …with the picture where the rule puts it (rows 656..1263 of 1920, as a share of the preview)',
              top is not None and abs(top - want_top) <= 2 and abs(bottom + 1 - want_bottom) <= 2,
              f'preview {h}px tall: picture rows {top}..{bottom}, rule {want_top:.1f}..{want_bottom - 1:.1f}')
        page.screenshot(path=os.path.join(OUT, 'framing-v2-1440.png'))

        # (3) v2's export.
        page.click('[data-editor-export]')
        page.wait_for_selector('[data-editor-export-sheet]', timeout=5000)
        with page.expect_download(timeout=600000) as info:
            page.click('[data-editor-export-start]')
            page.wait_for_selector('[data-editor-export-sheet][data-editor-export-status=done], [data-editor-export-sheet][data-editor-export-status=failed]', timeout=600000)
        v2_path = os.path.join(OUT, 'framing-v2.mp4')
        info.value.save_as(v2_path)
        v2_frame = frame_of(v2_path, 0.5)
        v2_frame.save(os.path.join(OUT, 'framing-v2-file-0.5s.png'))
        v2_rows = picture_rows(v2_frame)
        check('(3) v2’s file: picture rows 656..1263 of 1920, bars #0B0C0E', v2_frame.size == (1080, 1920) and v2_rows[0] is not None
              and abs(v2_rows[0] - 656) <= 2 and abs(v2_rows[1] - 1263) <= 2 and is_bar(v2_frame.getpixel((540, 100)), 6) and is_bar(v2_frame.getpixel((540, 1820)), 6),
              f'{v2_frame.size}, rows {v2_rows}, bar {v2_frame.getpixel((540, 100))}')

        # (4) The current editor's own export of the same stored film.
        page.goto(f'{BASE}/brand/studio/compose?classic=1&organizationId={ORG}', wait_until='domcontentloaded', timeout=240000)
        page.wait_for_selector('[data-brand-studio-compose]', timeout=240000)
        page.wait_for_timeout(1500)
        with page.expect_download(timeout=600000) as info:
            page.click('[data-compose-export]')
        current_path = os.path.join(OUT, 'framing-current-editor.mp4')
        info.value.save_as(current_path)
        current_frame = frame_of(current_path, 0.5)
        current_frame.save(os.path.join(OUT, 'framing-current-file-0.5s.png'))
        current_rows = picture_rows(current_frame)
        check('(4) the current editor’s file: the same picture rows (±2) and the same bars',
              current_frame.size == (1080, 1920) and current_rows[0] is not None and abs(current_rows[0] - v2_rows[0]) <= 2 and abs(current_rows[1] - v2_rows[1]) <= 2
              and is_bar(current_frame.getpixel((540, 100)), 6),
              f'current {current_rows} vs v2 {v2_rows}, bar {current_frame.getpixel((540, 100))}')
        check('no page errors', not errors, '; '.join(errors[:3]))
        return finish(browser, errors)


def finish(browser, errors):
    browser.close()
    failed = [name for name, ok, _ in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
