// GitHub PR helper for a PC without `gh`: uses the git credential stored for github.com and never prints it.
// Usage: node scripts/gh-pr.mjs checks <pr>... | create <head> <base> "<title>" <bodyfile|branch:path> | merge <pr> [title] | comment <pr> <file> | body <pr> <file> | retarget <pr> <base> | close <pr>
//   node gh-api.mjs checks <pr>...            -> check runs + mergeable state per PR
//   node gh-api.mjs merge <pr> "<title>"      -> merge PR with a merge commit (only if mergeable and checks green)
import { execSync } from 'node:child_process';

const REPO = 'Botanicbox0/yagi-prompts';
const cwd = process.cwd();
const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const cred = execSync('git credential fill', { cwd, env, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true });
const token = cred.split(/\r?\n/).find((l) => l.startsWith('password='))?.slice('password='.length);
if (!token) { console.log('no credential'); process.exit(1); }
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'twings-gh-script', ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'checks') {
  for (const n of args) {
    const pr = await api(`/repos/${REPO}/pulls/${n}`);
    if (!pr.ok) { console.log(`#${n}: ${pr.status} ${pr.data.message ?? ''}`); continue; }
    const sha = pr.data.head.sha;
    const checks = await api(`/repos/${REPO}/commits/${sha}/check-runs?per_page=50`);
    const runs = (checks.data.check_runs ?? []).map((c) => `${c.name}=${c.status}/${c.conclusion ?? '-'}`);
    console.log(`#${n} ${pr.data.state} mergeable=${pr.data.mergeable} mergeable_state=${pr.data.mergeable_state} head=${sha.slice(0, 7)} base=${pr.data.base.ref}`);
    console.log(`    checks(${runs.length}): ${runs.join(' | ') || '(none)'}`);
  }
} else if (cmd === 'merge') {
  const [n, title] = args;
  const pr = await api(`/repos/${REPO}/pulls/${n}`);
  if (!pr.ok) { console.log(`#${n}: ${pr.status} ${pr.data.message ?? ''}`); process.exit(1); }
  const sha = pr.data.head.sha;
  const checks = await api(`/repos/${REPO}/commits/${sha}/check-runs?per_page=50`);
  const runs = checks.data.check_runs ?? [];
  const bad = runs.filter((c) => c.status !== 'completed' || !['success', 'skipped', 'neutral'].includes(c.conclusion));
  if (bad.length) { console.log(`refusing: ${bad.map((c) => `${c.name}=${c.status}/${c.conclusion}`).join(', ')}`); process.exit(1); }
  if (pr.data.mergeable !== true) { console.log(`refusing: mergeable=${pr.data.mergeable} (${pr.data.mergeable_state})`); process.exit(1); }
  const res = await api(`/repos/${REPO}/pulls/${n}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'merge', commit_title: title ?? `Merge pull request #${n} from ${pr.data.head.label}`, sha }) });
  console.log(res.ok ? `merged #${n}: ${res.data.sha}` : `FAIL ${res.status}: ${res.data.message ?? ''}`);
} else if (cmd === 'comment') {
  const [n, file] = args;
  const body = (await import('node:fs')).readFileSync(file, 'utf8');
  const res = await api(`/repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  console.log(res.ok ? `commented #${n}: ${res.data.html_url}` : `FAIL ${res.status}: ${res.data.message ?? ''}`);
} else if (cmd === 'create') {
  const [head, base, title, bodyRef] = args; // bodyRef = "branch:path" (git show) or a local file
  let body = '';
  if (bodyRef?.includes(':') && !/^[A-Za-z]:\\/.test(bodyRef)) {
    body = execSync(`git show origin/${bodyRef}`, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } else if (bodyRef) body = (await import('node:fs')).readFileSync(bodyRef, 'utf8');
  if (!body.includes('Generated with [Claude Code]')) body = body.trimEnd() + '\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)';
  const res = await api(`/repos/${REPO}/pulls`, { method: 'POST', body: JSON.stringify({ title, head, base, body }) });
  console.log(res.ok ? `OK #${res.data.number} ${res.data.html_url}` : `FAIL ${res.status}: ${(res.data.errors ?? []).map((e) => e.message).join('; ') || res.data.message || ''}`);
} else if (cmd === 'retarget') {
  const [n, base] = args;
  const res = await api(`/repos/${REPO}/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ base }) });
  console.log(res.ok ? `retargeted #${n} -> ${res.data.base.ref}` : `FAIL ${res.status}: ${res.data.message ?? ''}`);
} else if (cmd === 'body') {
  // Replace a PR's description with a local file (the same text `create` takes).
  const [n, file] = args;
  const body = (await import('node:fs')).readFileSync(file, 'utf8');
  const res = await api(`/repos/${REPO}/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  console.log(res.ok ? `updated body #${n}` : `FAIL ${res.status}: ${res.data.message ?? ''}`);
} else if (cmd === 'close') {
  const [n] = args;
  const res = await api(`/repos/${REPO}/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
  console.log(res.ok ? `closed #${n}` : `FAIL ${res.status}: ${res.data.message ?? ''}`);
} else {
  console.log('usage: checks <pr>... | merge <pr> [title] | comment <pr> <file> | body <pr> <file> | retarget <pr> <base> | close <pr>');
}
