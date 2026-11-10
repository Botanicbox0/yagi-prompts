#!/usr/bin/env node
/**
 * The team's command line for project rooms (docs/BRAND-ROOMS.md §5, docs/BRAND-ROOMS-CLI.md).
 *
 *   node scripts/twings-room.mjs storyboard push --project <uuid> --title "…" --dir <folder>
 *        [--share] [--version-of <storyboardId>] [--env-file <path>]
 *   node scripts/twings-room.mjs review push --project <uuid> --title "…" --file <path>
 *        [--version-of <reviewId>] [--env-file <path>]
 *
 * Reads the folder's pictures (`01.png, 02.jpg …`, jpg/png/webp, sorted by name with numbers by value)
 * and their words from `board.json` (an array of { scene, shot, description, camera, audio, seconds },
 * one per picture) or `board.md` (one `## ` section per picture; `key: value` lines for scene, shot,
 * camera, audio, seconds; every other line is the description). Makes a draft board as the YAGI team,
 * uploads each picture, then shares it when `--share` is given. Prints the board's admin and brand
 * addresses.
 *
 * `review push` puts one deliverable (a film mp4/mov up to 200 MB, or a picture png/jpg/webp up to
 * 50 MB) in front of the brand in the project's room, or as the next version of `--version-of`.
 *
 * Plain Node, no dependencies. Environment (from the process, or from --env-file; values never printed):
 *   ROOM_INGEST_URL            the app origin or the full door, e.g. https://twings.app or
 *                              http://localhost:3320/api/brand-rooms/ingest
 *   BRAND_ROOM_INGEST_SECRET   the same secret the app holds
 *   ROOM_ADMIN_ORIGIN          optional; default admin.twings.app for twings.app, else the same origin
 *   ROOM_BRAND_ORIGIN          optional; default brand.twings.app for twings.app, else the same origin
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIMES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const BYTES_MAX = 25 * 1024 * 1024;
const CUTS_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Deliverables (lib/brand-rooms/deliveries.ts DELIVERY_LIMITS): films 200 MB, pictures 50 MB. */
const DELIVERY_MIMES = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const DELIVERY_FILM_MAX = 200_000_000;
const DELIVERY_PICTURE_MAX = 50_000_000;

const USAGE = `Usage:
  node scripts/twings-room.mjs storyboard push --project <uuid> --title "<title>" --dir <folder>
       [--share] [--version-of <storyboardId>] [--env-file <path>]

  node scripts/twings-room.mjs review push --project <uuid> --title "<title>" --file <path>
       [--version-of <reviewId>] [--env-file <path>]

  The folder holds the pictures (01.png, 02.jpg, ...) and board.json or board.md with their words.
  A review file is a film (mp4, mov; up to 200 MB) or a picture (png, jpg, webp; up to 50 MB).
  Needs ROOM_INGEST_URL and BRAND_ROOM_INGEST_SECRET (from the environment or --env-file).`;

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === 'share' || name === 'help') flags[name] = true;
    else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
      flags[name] = value;
      i += 1;
    }
  }
  return { positional, flags };
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function loadEnvFile(path) {
  if (!existsSync(path)) fail(`env file not found: ${path}`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

/* ------------------------------------------------------------------ the folder */

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function pictureFiles(dir) {
  return readdirSync(dir)
    .filter((name) => MIMES[extname(name).toLowerCase()] && statSync(join(dir, name)).isFile())
    .sort((a, b) => collator.compare(a, b));
}

const KEYS = {
  scene: 'scene',
  장면: 'scene',
  shot: 'shot',
  cut: 'shot',
  컷: 'shot',
  camera: 'camera',
  카메라: 'camera',
  audio: 'audio',
  sound: 'audio',
  dialogue: 'audio',
  사운드: 'audio',
  대사: 'audio',
  seconds: 'seconds',
  length: 'seconds',
  duration: 'seconds',
  길이: 'seconds',
  description: 'description',
  설명: 'description',
};

function seconds(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).trim().replace(/\s*(?:s|sec|seconds|초)$/i, ''));
  if (!Number.isFinite(n) || n < 0 || n > 600) throw new Error(`seconds must be 0–600, got "${value}"`);
  return Math.round(n * 10) / 10;
}

function cleanCut(raw, where) {
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: each cut must be an object`);
  const text = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  return {
    scene: text(raw.scene),
    shot: text(raw.shot),
    description: text(raw.description) ?? '',
    camera: text(raw.camera),
    audio: text(raw.audio ?? raw.sound),
    seconds: seconds(raw.seconds ?? raw.length ?? null),
  };
}

/** board.md: one `## ` section per cut, `key: value` lines, every other line the description. */
export function parseBoardMarkdown(source) {
  const cuts = [];
  let title = null;
  let current = null;
  const flush = () => {
    if (!current) return;
    current.description = current.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    delete current.lines;
    cuts.push(current);
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^#\s+/.test(line) && !current && title === null) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (/^##\s+/.test(line)) {
      flush();
      current = { lines: [] };
      continue;
    }
    if (!current) continue;
    const kv = /^\s*([^:：]{1,20})\s*[:：]\s*(.*)$/.exec(line);
    const key = kv ? KEYS[kv[1].trim().toLowerCase()] : undefined;
    if (key && key !== 'description') current[key] = kv[2].trim();
    else current.lines.push(key === 'description' ? kv[2] : line);
  }
  flush();
  return { title, cuts: cuts.map((c, i) => cleanCut(c, `board.md section ${i + 1}`)) };
}

export function readBoardText(dir) {
  const json = join(dir, 'board.json');
  const md = join(dir, 'board.md');
  if (existsSync(json)) {
    const data = JSON.parse(readFileSync(json, 'utf8'));
    const list = Array.isArray(data) ? data : data?.cuts;
    if (!Array.isArray(list)) throw new Error('board.json must be an array of cuts');
    return { title: Array.isArray(data) ? null : (data.title ?? null), cuts: list.map((c, i) => cleanCut(c, `board.json item ${i + 1}`)) };
  }
  if (existsSync(md)) return parseBoardMarkdown(readFileSync(md, 'utf8'));
  return { title: null, cuts: null };
}

/* ------------------------------------------------------------------ the door */

function endpoints() {
  const raw = (process.env.ROOM_INGEST_URL ?? '').trim();
  const secret = (process.env.BRAND_ROOM_INGEST_SECRET ?? '').trim();
  if (!raw || !secret) fail('ROOM_INGEST_URL and BRAND_ROOM_INGEST_SECRET are required (environment or --env-file).');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('ROOM_INGEST_URL is not an address.');
  }
  const door = url.pathname.replace(/\/+$/, '').endsWith('/api/brand-rooms/ingest') ? `${url.origin}${url.pathname.replace(/\/+$/, '')}` : `${url.origin}/api/brand-rooms/ingest`;
  const production = /(^|\.)twings\.app$/i.test(url.hostname);
  const adminOrigin = (process.env.ROOM_ADMIN_ORIGIN ?? '').trim() || (production ? 'https://admin.twings.app' : url.origin);
  const brandOrigin = (process.env.ROOM_BRAND_ORIGIN ?? '').trim() || (production ? 'https://brand.twings.app' : url.origin);
  return { origin: url.origin, door, secret, adminOrigin, brandOrigin };
}

async function call(api, operation, input) {
  const res = await fetch(api.door, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${api.secret}` },
    body: JSON.stringify({ operation, input }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* reported by status below */
  }
  if (!res.ok || !json?.ok) {
    const hint = res.status === 404 ? ' (wrong secret or address, rooms closed, or the project is not open to rooms)' : '';
    throw new Error(`${operation} -> ${res.status} ${json?.code ?? ''}${hint}`.trim());
  }
  return json;
}

/** A signed address takes a plain PUT; this app's own local address wants the same Bearer secret. */
async function upload(api, target, bytes, mime, { what, localMethod = 'POST' }) {
  const res = target.direct
    ? await fetch(target.url, { method: 'PUT', headers: { 'content-type': mime }, body: bytes })
    : await fetch(new URL(target.url, api.origin), {
        method: localMethod,
        headers: { 'content-type': mime, authorization: `Bearer ${api.secret}` },
        body: bytes,
      });
  if (!res.ok) throw new Error(`upload of ${what} -> ${res.status}${res.status === 413 ? ' (too large)' : ''}`);
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/* ------------------------------------------------------------------ storyboard push */

async function storyboardPush(flags) {
  const project = flags.project;
  if (!project || !UUID.test(project)) fail('--project <uuid> is required.');
  if (flags['version-of'] && !UUID.test(flags['version-of'])) fail('--version-of takes a storyboard id.');
  if (!flags.dir) fail('--dir <folder> is required.');
  const dir = resolve(flags.dir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`not a folder: ${dir}`);
  const names = pictureFiles(dir);
  if (names.length === 0) fail('no pictures (png, jpg, webp) in the folder.');
  if (names.length > CUTS_MAX) fail(`${names.length} pictures; a board holds at most ${CUTS_MAX}.`);
  let words;
  try {
    words = readBoardText(dir);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const title = (flags.title ?? words.title ?? '').trim();
  if (!title) fail('--title is required (or a "# Title" line at the top of board.md).');
  if (words.cuts && words.cuts.length !== names.length) {
    fail(`${names.length} pictures but ${words.cuts.length} cuts of text; make them match (one text per picture, in name order).`);
  }
  const pictures = names.map((name) => {
    const path = join(dir, name);
    const size = statSync(path).size;
    if (size > BYTES_MAX) fail(`${name} is larger than 25 MB.`);
    if (size === 0) fail(`${name} is empty.`);
    return { name, path, size, mime: MIMES[extname(name).toLowerCase()] };
  });

  const api = endpoints();
  const pushed = await call(api, 'storyboard.push', {
    projectId: project,
    title,
    versionOf: flags['version-of'] ?? null,
    cuts: pictures.map((p, i) => ({ ...(words.cuts?.[i] ?? {}), mime: p.mime, sizeBytes: p.size })),
  });
  console.log(`Board ${pushed.storyboardId} (v${pushed.version}): uploading ${pictures.length} pictures...`);
  await inBatches(pushed.uploads, 4, async (target) => {
    const picture = pictures[target.idx];
    await upload(api, target, readFileSync(picture.path), picture.mime, { what: `cut ${target.idx + 1}` });
  });

  let finished = null;
  const failed = [];
  for (let round = 0; round < 60; round += 1) {
    finished = await call(api, 'storyboard.finish', { storyboardId: pushed.storyboardId, share: Boolean(flags.share) });
    failed.push(...(finished.failed ?? []));
    if (finished.remaining === 0) break;
  }
  for (const f of failed) {
    const at = pushed.uploads.findIndex((u) => u.frameId === f.frameId);
    console.error(`  dropped: ${at >= 0 ? pictures[at].name : f.frameId} (${f.code})`);
  }
  console.log(`Done: ${finished.cuts} cuts, ${finished.status === 'draft' ? 'saved as a draft (the brand cannot see it yet)' : 'shared with the brand'}.`);
  console.log(`  admin: ${api.adminOrigin}${pushed.adminPath}`);
  console.log(`  brand: ${api.brandOrigin}${pushed.brandPath}`);
  if (finished.remaining > 0) fail(`${finished.remaining} cuts are still waiting for their picture; run the command again.`, 1);
  if (failed.length > 0) process.exitCode = 1;
}

/* ------------------------------------------------------------------ review push */

const MB = (bytes) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${Math.round((bytes / 1_000_000) * 10) / 10} MB`);

/** What is wrong with a deliverable before any byte moves, as a sentence; null when it can go. */
export function reviewFileProblem(name, sizeBytes) {
  const mime = DELIVERY_MIMES[extname(name).toLowerCase()];
  if (!mime) return `${name} is not a film (mp4, mov) or a picture (png, jpg, webp).`;
  if (!(sizeBytes > 0)) return `${name} is empty.`;
  const film = mime.startsWith('video/');
  const max = film ? DELIVERY_FILM_MAX : DELIVERY_PICTURE_MAX;
  if (sizeBytes > max) return `${name} is ${MB(sizeBytes)}; a ${film ? 'film' : 'picture'} can be at most ${MB(max)}. Export a smaller file and try again.`;
  return null;
}

async function reviewPush(flags) {
  const project = flags.project;
  if (!project || !UUID.test(project)) fail('--project <uuid> is required.');
  if (flags['version-of'] && !UUID.test(flags['version-of'])) fail('--version-of takes a review id.');
  const title = (flags.title ?? '').trim();
  if (!title) fail('--title is required.');
  if (!flags.file) fail('--file <path> is required.');
  const path = resolve(flags.file);
  if (!existsSync(path) || !statSync(path).isFile()) fail(`not a file: ${path}`);
  const name = basename(path);
  const size = statSync(path).size;
  const problem = reviewFileProblem(name, size);
  if (problem) fail(problem);
  const mime = DELIVERY_MIMES[extname(name).toLowerCase()];

  const api = endpoints();
  const target = await call(api, 'review.push', { projectId: project, mime, sizeBytes: size });
  console.log(`Uploading ${name} (${MB(size)})...`);
  await upload(api, target, readFileSync(path), mime, { what: name, localMethod: 'PUT' });
  const done = await call(api, 'review.finish', {
    projectId: project,
    title,
    stagingKey: target.key,
    versionOf: flags['version-of'] ?? null,
    name,
  });
  console.log(`Done: "${title}" v${done.version}${done.existing ? ' (this file was already there)' : ''}, ready for the brand to review.`);
  console.log(`  admin: ${api.adminOrigin}${done.adminPath}`);
  console.log(`  brand: ${api.brandOrigin}${done.brandPath}`);
}

/* ------------------------------------------------------------------ main */

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags['env-file']) loadEnvFile(flags['env-file']);
  const [noun, verb] = positional;
  if (flags.help || !noun) {
    console.log(USAGE);
    return;
  }
  if (noun === 'storyboard' && verb === 'push') return storyboardPush(flags);
  if (noun === 'review' && verb === 'push') return reviewPush(flags);
  fail(`unknown command: ${positional.join(' ')}\n\n${USAGE}`);
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
