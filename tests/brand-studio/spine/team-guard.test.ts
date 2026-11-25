import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAM_PROJECTS } from '@/lib/brands/project-origin';

/**
 * docs/BRAND-PROJECT-SPINE.md §3.4, the guard. A brand's own studio project (`origin = 'self'`) must never reach
 * the YAGI-team side. Every file under lib/ and app/ that names `brand_projects` is listed below with each line
 * that names it in code, and the reason that line cannot list, count or notify a self project:
 *   a — limited by `client_visible` (a self row is always hidden: table check `brand_projects_self_hidden`);
 *   b — takes a project id from a staff, admin or worker caller (or a team-side source): it MUST carry
 *       `TEAM_PROJECTS`, so a brand's own project answers exactly like a missing one (fix round F1);
 *   c — a multi-row read that does not look at `client_visible`, now limited by `TEAM_PROJECTS`
 *       (lib/brands/project-origin.ts);
 *   d — the spine itself, meant to see self rows (lib/brand-studio/brand-projects.ts, and the assets page's member
 *       reads in lib/brand-studio/brand-project-files.ts, which use only the spine's fragments and are dispatched by
 *       the studio service alone: tests/brand-studio/spine/assets-page.test.ts);
 *   e — cannot return or count a self row for another stated reason.
 * The test fails when a file appears or disappears, when a listed file gains or loses a line that names the
 * table (classify it here), or when a line of class a / c loses its predicate. Comment lines are not counted.
 */
type Cls = 'a' | 'b' | 'c' | 'e';
type Use = [match: string, cls: Cls, why: string];

const SPINE = new Set(['lib/brand-studio/brand-projects.ts', 'lib/brand-studio/brand-project-files.ts']);
const COMMENTS_ONLY = new Set([
  'lib/brand-studio/contracts.ts',
  'lib/brands/workspace/campaign-terms.ts',
  'lib/brands/workspace/intake-brief.ts',
  'lib/flags.ts',
]);

const FILES: Record<string, Use[]> = {
  'app/(admin)/admin/inquiries/page.tsx': [['from public.brand_projects p', 'e', "status = 'requested' and intake_brief is not null: a self row is active and has no brief"]],
  'app/api/brand-studio/share-bridge/route.ts': [
    ['select id, title from brand_projects', 'a', 'the chosen project: client_visible = true'],
    ['select id, title from brand_projects', 'a', "the review's linked project: client_visible = true"],
    ['select id, title from brand_projects', 'a', 'the review room by title: client_visible = true (a self row with that title never matches)'],
    ['insert into brand_projects (', 'e', "inserts a team review room (origin defaults to 'team', client_visible true)"],
    ['select id, title, status from brand_projects', 'a', '"add to a YAGI project" list: client_visible = true'],
  ],
  'lib/admin/brand-org-list.ts': [
    ["hasTables(sql, ['brand_projects'])", 'e', 'table-existence probe, reads no row'],
    ['from brand_projects p', 'c', 'admin organization list: project count per organization'],
  ],
  'lib/brand-rooms/access.ts': [
    ['join brand_projects p on p.id = g.project_id', 'a', 'room seat of a guest: p.client_visible'],
    ['select id, title from brand_projects where id = $1', 'a', 'requireRoomProject: client_visible (posting to a self id is refused)'],
    ['select id from brand_projects where id = $1', 'a', 'roomAudience: client_visible'],
  ],
  'lib/brand-rooms/deliveries.ts': [['from brand_projects tp where tp.id = $1', 'b', 'the delivery ingest (command line, secret-gated)']],
  'lib/brand-rooms/invites.ts': [['from brand_projects tp where tp.id = $1', 'b', 'staff desk guests (also after staffReader)']],
  'lib/brand-rooms/messages.ts': [
    ['from brand_projects p', 'a', "the brand's channel list and unread counts: p.client_visible"],
    ['from brand_projects where id = $1', 'a', 'staffReader: client_visible'],
    ['from brand_projects p', 'a', 'staff overview, new requests: p.client_visible'],
    ['left join brand_projects p on p.id = m0.project_id', 'a', 'staff overview, channels: project null or p.client_visible'],
    ['from brand_projects p where p.id = $1', 'b', 'staff desk (also after staffReader)'],
    ['from brand_projects p', 'a', 'staff channels of one organization: p.client_visible'],
  ],
  'lib/brand-rooms/notices.ts': [['from brand_projects tp where tp.id = any($1::uuid[])', 'b', 'ids of brand_room_notices rows (written only after roomAudience); the predicate is a belt']],
  'lib/brand-rooms/overview.ts': [
    ['from brand_projects where id = $1', 'a', 'room overview: client_visible'],
    ['from brand_projects where id = $1', 'a', 'room overview: client_visible'],
  ],
  'lib/brand-rooms/pulse.ts': [['select id from brand_projects where id = $1', 'a', 'pulse: client_visible']],
  'lib/brand-rooms/shares.ts': [['select id from brand_projects where id = $1', 'a', 'staff share scope: client_visible']],
  'lib/brand-rooms/storyboards.ts': [
    ['from brand_projects tp where tp.id = $1 and tp.organization_id = $2', 'b', 'lockProject: customer (after requireRoomProject), staff or ingest id'],
    ['from brand_projects p join brand_organizations o', 'c', 'staff storyboard list: project picker'],
    ['from brand_projects p where p.id = s.project_id', 'e', "a board's own project: boards are made only on team projects (lockProject)"],
    ['join brand_projects p on p.organization_id = o.id', 'e', "one board's own project (detail)"],
    ['select tp.organization_id from brand_projects tp where tp.id = $1', 'b', 'staffCreateStoryboard: staff body id'],
    ['select tp.organization_id from brand_projects tp where tp.id = $1', 'b', 'storyboard ingest (command line, secret-gated)'],
  ],
  'lib/brand-studio/access.ts': [['join brand_projects p on p.id = g.project_id', 'a', 'studio seat of a guest: p.client_visible']],
  'lib/brand-studio/asset-projects.ts': [['join brand_projects p on p.id = r.project_id', 'a', "the asset hub's team group: p.client_visible"]],
  'lib/brand-studio/handoff.ts': [['select id from brand_projects where id = $1', 'a', 'handoff.campaign: client_visible']],
  'lib/brand-studio/repo.ts': [['select id, title from brand_projects where organization_id = $1 and client_visible', 'a', '"add to a YAGI project" list (campaignsOf)']],
  'lib/brand-studio/review.ts': [
    ['from brand_projects tp where tp.id = $1', 'b', 'staffDeliveryGate: staff / ingest id'],
    ['from brand_projects p join brand_organizations o', 'c', 'staff delivery projects'],
  ],
  'lib/brands/billing/access.ts': [['join brand_projects p on p.id = g.project_id', 'a', 'billing seat of a guest: p.client_visible']],
  'lib/brands/creator-pool.ts': [['join brand_projects p on p.id=l.project_id', 'a', 'invitable campaigns: client_visible, through campaign links']],
  'lib/brands/identity/project-direction.ts': [['select organization_id from brand_projects where id = $1', 'e', 'only checks the organization of an id; returns nothing and tells nobody']],
  'lib/brands/project-origin.ts': [["(table_name = 'brand_projects' and column_name = 'origin')", 'e', 'the column probe (information_schema); reads no project row']],
  'lib/brands/production/service.ts': [
    ['from brand_projects tp where tp.id=$1', 'b', 'admin production contract: admin form id'],
    ['from brand_production_t', 'e', "left join through a contract's template; contracts exist only on team projects"],
  ],
  'lib/brands/shortlist/service.ts': [
    ['select tp.id,tp.organization_id,tp.status from brand_projects tp', 'b', 'shortlist import: staff / worker id'],
    ['update brand_projects tp set updated_at=now()', 'b', 'same import, by id'],
    ['select tp.shortlist_criteria from brand_projects tp', 'b', 'staff shortlist page by URL id (no candidates read for a missing or own project)'],
    ['select tp.id from brand_projects tp', 'b', 'staff triage by id'],
    ['update brand_projects tp set shortlist_criteria', 'b', 'staff criteria by id'],
  ],
  'lib/brands/storage-quota.ts': [
    ["tableExists(sql, 'brand_projects')", 'e', 'table-existence probe, reads no row'],
    ['from brand_projects p', 'c', 'retention clock: open projects and the last completed one'],
  ],
  'lib/brands/upload-gate.ts': [
    ['from brand_projects bp', 'c', 'upload approval re-check (staffTeamProject): a project made by a team account, team projects only'],
    ["tableExists(sql, 'brand_projects')", 'e', 'table-existence probe, reads no row'],
    ['from brand_projects bp', 'e', "origin/main's statement, kept exactly (tests/brands/workspace-approval-parity.test.ts); a row it finds approves only after the re-check above (tested in team-side.test.ts, switch off and on)"],
  ],
  'lib/brands/usage/core.ts': [
    ['from brand_projects p join brand_organizations o', 'a', 'usage seat: refuses unless client_visible'],
    ['select tp.* from brand_projects tp where tp.id=$1', 'b', 'staff fallback: staff page by URL id'],
  ],
  'lib/brands/usage/service.ts': [
    ['join brand_projects p on p.id=c.p', 'e', 'driven by brand_usage_cases, created only through the seat (client_visible)'],
    ['join brand_projects p on p.id=c.project_id', 'e', 'driven by brand_usage_cases (as above)'],
  ],
  'lib/brands/workspace/inbox.ts': [['join brand_projects p on p.id = latest.project_id', 'e', 'driven by brand_messages; a self project has none']],
  'lib/brands/workspace/service.ts': [
    ['from brand_projects p', 'b', 'project(): every branch (customer, studio, staff by URL id) team projects only; the customer branch also needs client_visible'],
    ['select 1 from brand_projects cp', 'e', 'correlated to the one project already authorized'],
    ['from brand_projects p join brand_organizations o', 'c', "loadBrandWorkspace, the staff branch (a brand's projects)"],
    ['from brand_projects p join brand_organizations o', 'a', 'loadBrandWorkspace, the customer branch: p.client_visible'],
    ['from brand_projects p join brand_organizations o', 'a', 'loadBrandWorkspaceChoices, the customer branch: p.client_visible'],
    ['from brand_projects p where', 'c', 'loadBrandWorkspaceChoices, the staff branch: project -> organization map'],
    ['from brand_projects p join brand_organizations o', 'c', 'loadStudioWorkspace (staff): every project'],
    ['select id from brand_projects where organization_id=$1 and created_by=$2 and request_id=$3', 'e', 'a team request replayed by its own key; self rows use namespaced derived keys'],
    ['select count(*)::int as n from brand_projects p where organization_id=$1', 'c', "a team request's daily budget (20): team projects only; the brand's own projects have their own count (§4.5, lib/brand-studio/brand-projects.ts)"],
    ['insert into brand_projects(', 'e', "inserts a team request (origin defaults to 'team')"],
    ['update brand_projects set intake_brief', 'e', 'the row just inserted in the same call'],
    ['update brand_projects set client_visible=false where id=$1', 'e', 'the row just inserted (a staff-made team project)'],
    ["sourceTable: 'brand_projects'", 'e', 'a label on a team notice of a team request, not a query'],
    ['update brand_projects tp set intake_brief', 'b', 'attachIntakeBriefFiles: after project({write})'],
    ['update brand_projects tp set status=$1', 'b', 'activateBrandProject: staff by id'],
    ['update brand_projects tp set cover_attachment_id', 'b', 'setBrandProjectCover: staff by id'],
    ['left join brand_projects p on p.id=i.project_id', 'a', 'invitations: title only when client_visible; driven by brand_invites'],
    ['join brand_projects p on p.id=g.project_id', 'e', 'pending shared campaigns: `not client_visible`, but joined to brand_project_members, which a self project never has'],
    ['from brand_projects tp where tp.id=$1 and tp.organization_id=$2', 'b', 'an invitation project id (issued only for client_visible projects)'],
    ['update brand_projects tp set client_visible=$1', 'b', 'setBrandProjectVisibility: staff by id (the table check also refuses showing a self row)'],
    ['join brand_projects c on c.id=m.project_id', 'e', 'joined to brand_project_members, which a self project never has'],
    ['brand_projects c on c.id=i.project_id', 'e', 'driven by brand_invites (issued only for client_visible projects)'],
    ['join brand_projects p on p.id=g.project_id', 'a', 'logo access of a guest: p.client_visible'],
  ],
  'lib/campaigns/collaboration/service.ts': [
    ['select tp.* from brand_projects tp where tp.id=$1', 'b', 'projectAccess: every branch team projects only (the studio branch is staff); the customer branch also needs client_visible'],
    ['join brand_projects p on', 'e', 'through campaign collaboration links (team campaigns only)'],
    ['join campaign_collaboration_links l on l.campaign_id=c.id join b', 'e', 'through campaign collaboration links (team campaigns only)'],
    ['from brand_projects p join brand_organizations o', 'e', "admin binding options: production_mode = 'creator' (a self row is 'studio')"],
  ],
  'lib/campaigns/funding/core.ts': [['select * from brand_projects where id=$1 for share', 'a', 'funding seat: refuses unless client_visible']],
  'lib/campaigns/funding/service.ts': [
    ['join brand_projects p on p.id=l.project_id', 'e', 'through campaign collaboration links'],
    ['join brand_projects p on p.id=c.project_id', 'e', 'driven by campaign_funding_cases'],
    ['select 1 from brand_projects p join brand_memberships m', 'a', 'reward proposal: p.client_visible'],
  ],
  'lib/campaigns/production-admin.ts': [
    ['select c.id as "contractId"', 'e', 'through production contracts (team projects only)'],
    ['select a.id,a.name,a.project_id as "projectId"', 'e', 'project ids taken from the contracts above'],
  ],
  'lib/campaigns/production.ts': [
    ['join brand_projects p on p.id=c.project_id', 'e', "through a contract, and production_mode = 'creator'"],
    ['join brand_projects bp on bp.id=bc.project_id', 'e', 'through production contracts'],
    ['from brand_projects bp join brand_production_contracts c', 'e', 'through production contracts'],
  ],
};

const ROOT = process.cwd();
const WINDOW = 8;
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|--)/.test(line);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    const stat = statSync(path.join(ROOT, rel));
    if (stat.isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const naming = [...filesUnder('lib'), ...filesUnder('app')].filter((file) => readFileSync(path.join(ROOT, file), 'utf8').includes('brand_projects')).sort();

describe('every file that names brand_projects is classified', () => {
  it('the list of files is exactly the classified list', () => {
    expect(naming).toEqual([...Object.keys(FILES), ...SPINE, ...COMMENTS_ONLY].sort());
  });

  it('files listed as comments-only name the table in comments only', () => {
    for (const file of COMMENTS_ONLY) {
      const code = readFileSync(path.join(ROOT, file), 'utf8').split('\n').filter((line) => line.includes('brand_projects') && !isComment(line));
      expect(code, file).toEqual([]);
    }
  });

  for (const [file, uses] of Object.entries(FILES)) {
    it(`${file}: every line is classified and keeps its predicate`, () => {
      const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      const at = lines.flatMap((line, i) => (line.includes('brand_projects') && !isComment(line) ? [i] : []));
      expect(at.length, `${file}: lines naming brand_projects (classify a new one in this test)`).toBe(uses.length);
      at.forEach((index, n) => {
        const [match, cls, why] = uses[n]!;
        expect(lines[index], `${file}:${index + 1} (${why})`).toContain(match);
        // The statement around the line: a few lines before (a predicate built just above it) and the rest of it.
        const window = lines.slice(Math.max(0, index - 6), index + WINDOW).join('\n');
        if (cls === 'a') expect(window, `${file}:${index + 1} must stay limited by client_visible`).toContain('client_visible');
        if (cls === 'c') expect(window, `${file}:${index + 1} must use TEAM_PROJECTS`).toContain('TEAM_PROJECTS(');
        // A read or write by id carries the predicate in its own statement: on the line or the next one.
        if (cls === 'b') expect(lines.slice(index, index + 2).join('\n'), `${file}:${index + 1} must use TEAM_PROJECTS`).toContain('TEAM_PROJECTS(');
      });
    });
  }
});

describe('TEAM_PROJECTS', () => {
  it('is null-safe and needs no origin column', () => {
    expect(TEAM_PROJECTS('p')).toBe("coalesce(to_jsonb(p) ->> 'origin', 'team') = 'team'");
    expect(TEAM_PROJECTS('bp')).toContain('to_jsonb(bp)');
    for (const bad of ['p; drop table x', 'P', '1p', '']) expect(() => TEAM_PROJECTS(bad)).toThrow();
  });
});
