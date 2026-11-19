import { describe, expect, it } from 'vitest';
import {
  RAIL_MODE_MAX,
  defaultRailMode,
  parseRailModeCookie,
  pathRailMode,
  railModeItems,
  railModeSwitchTarget,
  railModes,
  rememberRailMode,
  rememberedRailMode,
  resolveRailMode,
  RAIL_MODE_FOLLOWS_ATTRIBUTE,
  railModeSwitchEffect,
} from '@/components/brand-workspace/rail-mode';
import { RAIL_HREF, groupItems, railItems } from '@/components/brand-workspace/rail-model';

/**
 * The rail's two modes (founder 2026-11-20): 직접 만들기 | 야기 팀과, opening where this person left off for
 * this brand. The rule lives in components/brand-workspace/rail-mode.ts.
 */
const MAKER = { studio: true, studioShowroom: false, rooms: true };
const PROJECT_ONLY = { studio: false, studioShowroom: true, rooms: true };
const TEAM_ONLY = { studio: false, studioShowroom: false, rooms: true };
const ORG = 'a0000000-0000-4000-8000-00000000000a';
const OTHER = 'b0000000-0000-4000-8000-00000000000b';

describe('which sides a brand has', () => {
  it('has no modes at all while rooms are closed', () => {
    expect(railModes({ studio: true, rooms: false })).toEqual([]);
    expect(resolveRailMode({ studio: true, rooms: false, path: '/brand/studio' })).toBeNull();
  });

  it('gives a brand with the studio, or its showroom, both sides', () => {
    expect(railModes(MAKER)).toEqual(['make', 'team']);
    expect(railModes(PROJECT_ONLY)).toEqual(['make', 'team']);
  });

  it('gives a brand without the studio only 야기 팀과, whatever the path or the cookie says', () => {
    expect(railModes(TEAM_ONLY)).toEqual(['team']);
    for (const path of ['/brand/studio', '/brand/home', '/brand']) {
      expect(resolveRailMode({ ...TEAM_ONLY, path, remembered: 'make' }), path).toBe('team');
    }
  });
});

describe('first visit', () => {
  it('opens a brand that makes things itself on 직접 만들기', () => {
    expect(defaultRailMode(MAKER)).toBe('make');
    expect(resolveRailMode({ ...MAKER, path: '/brand/home' })).toBe('make');
  });

  it('opens a project-only brand (self_studio denied) on 야기 팀과', () => {
    expect(defaultRailMode(PROJECT_ONLY)).toBe('team');
    expect(resolveRailMode({ ...PROJECT_ONLY, path: '/brand/library' })).toBe('team');
  });
});

describe('the remembered mode', () => {
  it('wins on a page both sides share', () => {
    for (const path of ['/brand/home', '/brand/library', '/brand/members', '/brand/settings', '/brand/usage']) {
      expect(resolveRailMode({ ...MAKER, path, remembered: 'team' }), path).toBe('team');
      expect(resolveRailMode({ ...PROJECT_ONLY, path, remembered: 'make' }), path).toBe('make');
    }
  });

  it('is per brand and survives a round trip through the cookie', () => {
    let memory = parseRailModeCookie(rememberRailMode({}, ORG, 'team'));
    memory = parseRailModeCookie(rememberRailMode(memory, OTHER, 'make'));
    expect(rememberedRailMode(memory, ORG)).toBe('team');
    expect(rememberedRailMode(memory, OTHER)).toBe('make');
    expect(rememberedRailMode(memory, ORG.toUpperCase())).toBe('team');
    expect(rememberedRailMode(memory, null)).toBeNull();
    memory = parseRailModeCookie(rememberRailMode(memory, ORG, 'make'));
    expect(rememberedRailMode(memory, ORG)).toBe('make');
    // The last brand used comes first.
    expect(Object.keys(memory)).toEqual([ORG, OTHER]);
  });

  it('keeps the newest brands only', () => {
    let raw = '';
    for (let i = 0; i < RAIL_MODE_MAX + 5; i += 1) {
      raw = rememberRailMode(parseRailModeCookie(raw), `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'team');
    }
    const memory = parseRailModeCookie(raw);
    expect(Object.keys(memory)).toHaveLength(RAIL_MODE_MAX);
    expect(rememberedRailMode(memory, `c0000000-0000-4000-8000-${String(RAIL_MODE_MAX + 4).padStart(12, '0')}`)).toBe('team');
    expect(rememberedRailMode(memory, 'c0000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('falls back to the default when the cookie is missing, blocked or malformed', () => {
    for (const raw of [undefined, null, '', 'garbage', `${ORG}:both`, `nope:team`, '%E0%A4%A']) {
      const remembered = rememberedRailMode(parseRailModeCookie(raw), ORG);
      expect(remembered, String(raw)).toBeNull();
      expect(resolveRailMode({ ...MAKER, path: '/brand/home', remembered })).toBe('make');
      expect(resolveRailMode({ ...PROJECT_ONLY, path: '/brand/home', remembered })).toBe('team');
    }
  });
});

describe('a page that belongs to one side', () => {
  it('knows the side of every rail address', () => {
    expect(pathRailMode('/brand/studio')).toBe('make');
    expect(pathRailMode('/brand/studio/video')).toBe('make');
    expect(pathRailMode('/brand/studio/compose?x=1')).toBe('make');
    expect(pathRailMode('/brand/studio/workflows/abc')).toBe('make');
    expect(pathRailMode('/brand/identity')).toBe('make');
    expect(pathRailMode('/brand')).toBe('team');
    expect(pathRailMode('/brand/projects/new')).toBe('team');
    expect(pathRailMode('/brand/rooms')).toBe('team');
    expect(pathRailMode('/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11')).toBe('team');
    expect(pathRailMode('/brand/creators')).toBe('team');
    for (const shared of ['/brand/home', '/brand/library', '/brand/members', '/brand/settings', '/brand/usage', '/brand/invite/x', '/brand/start']) {
      expect(pathRailMode(shared), shared).toBeNull();
    }
    // No prefix confusion.
    expect(pathRailMode('/brand/studiox')).toBeNull();
    expect(pathRailMode('/brandx')).toBeNull();
  });

  it('flips the rail to match a deep link, over the remembered side', () => {
    expect(resolveRailMode({ ...MAKER, path: '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11', remembered: 'make' })).toBe('team');
    expect(resolveRailMode({ ...MAKER, path: '/brand', remembered: 'make' })).toBe('team');
    expect(resolveRailMode({ ...PROJECT_ONLY, path: '/brand/studio/video', remembered: 'team' })).toBe('make');
  });

  it('has every rail item on the side its address belongs to, so no page sits outside its rail', () => {
    const groups = groupItems(railItems({ ...MAKER, creators: false, identity: false }), []);
    for (const mode of ['make', 'team'] as const) {
      for (const id of railModeItems(groups, mode)) {
        const side = pathRailMode(RAIL_HREF[id]);
        expect(side === null || side === mode, `${mode} ${id}`).toBe(true);
      }
    }
  });
});

describe('items per mode', () => {
  it('splits a maker brand and keeps 에셋 on both sides', () => {
    const groups = groupItems(railItems({ ...MAKER, creators: false, identity: false }), []);
    expect(railModeItems(groups, 'make')).toEqual(['image', 'video', 'compose', 'workflows', 'assets']);
    expect(railModeItems(groups, 'team')).toEqual(['campaigns', 'messages', 'assets']);
  });

  it('gives a project-only brand the showroom on 직접 만들기', () => {
    const groups = groupItems(railItems({ ...PROJECT_ONLY, creators: false, identity: false }), []);
    expect(railModeItems(groups, 'make')).toEqual(['image', 'video', 'compose', 'workflows', 'assets']);
    expect(railModeItems(groups, 'team')).toEqual(['campaigns', 'messages', 'assets']);
  });

  it('applies the saved order inside a mode only', () => {
    const order = ['/brand/rooms', '/brand', '/brand/studio/video', '/brand/studio'];
    const groups = groupItems(railItems({ ...MAKER, creators: false, identity: false }), order);
    expect(railModeItems(groups, 'team')).toEqual(['messages', 'campaigns', 'assets']);
    const make = railModeItems(groups, 'make');
    expect(make[0]).toBe('video');
    expect(make.indexOf('video')).toBeLessThan(make.indexOf('image'));
    expect(make).not.toContain('campaigns');
  });
});

describe('switching', () => {
  const groups = groupItems(railItems({ ...MAKER, creators: false, identity: false }), []);
  const href = (id: keyof typeof RAIL_HREF) => RAIL_HREF[id];

  it('stays on a shared page', () => {
    expect(railModeSwitchTarget('/brand/home', 'team', railModeItems(groups, 'team'), href)).toBeNull();
    expect(railModeSwitchTarget('/brand/library', 'make', railModeItems(groups, 'make'), href)).toBeNull();
  });

  it("opens the new side's first item from a page of the other side", () => {
    expect(railModeSwitchTarget('/brand/studio/video', 'team', railModeItems(groups, 'team'), href)).toBe('/brand');
    expect(railModeSwitchTarget('/brand/rooms', 'make', railModeItems(groups, 'make'), href)).toBe('/brand/studio');
  });

  it('never opens 에셋 as the landing of 야기 팀과 while a team item exists', () => {
    expect(railModeSwitchTarget('/brand/studio', 'team', ['assets', 'campaigns', 'messages'], href)).toBe('/brand');
  });
});

describe('what a switch does to the page (production defect 2026-11-20: home content stayed on the old side)', () => {
  const groups = groupItems(railItems({ ...MAKER, creators: false, identity: false }), []);
  const href = (id: keyof typeof RAIL_HREF) => RAIL_HREF[id];

  it('refreshes a shared page whose content follows the mode (the home), in both directions', () => {
    expect(railModeSwitchEffect({ path: '/brand/home', next: 'make', items: railModeItems(groups, 'make'), hrefOf: href, pageFollowsMode: true })).toEqual({ kind: 'refresh' });
    expect(railModeSwitchEffect({ path: '/brand/home', next: 'team', items: railModeItems(groups, 'team'), hrefOf: href, pageFollowsMode: true })).toEqual({ kind: 'refresh' });
  });

  it('leaves a shared page alone when nothing on it depends on the mode', () => {
    for (const path of ['/brand/library', '/brand/members', '/brand/settings']) {
      expect(railModeSwitchEffect({ path, next: 'team', items: railModeItems(groups, 'team'), hrefOf: href, pageFollowsMode: false }), path).toEqual({ kind: 'none' });
    }
  });

  it("opens the new side's first page from a page of the other side, whatever the marker says", () => {
    expect(railModeSwitchEffect({ path: '/brand/studio/video', next: 'team', items: railModeItems(groups, 'team'), hrefOf: href, pageFollowsMode: true })).toEqual({ kind: 'navigate', href: '/brand' });
    expect(railModeSwitchEffect({ path: '/brand/rooms', next: 'make', items: railModeItems(groups, 'make'), hrefOf: href, pageFollowsMode: false })).toEqual({ kind: 'navigate', href: '/brand/studio' });
  });

  it('is wired into the rail: a refresh goes through the router, and both homes carry the marker', async () => {
    const { readFileSync } = await import('node:fs');
    const rail = readFileSync('components/brand-workspace/rail-nav.tsx', 'utf8');
    expect(rail).toContain('railModeSwitchEffect(');
    expect(rail).toMatch(/router\.refresh\(\)/);
    expect(rail).toContain('RAIL_MODE_FOLLOWS_ATTRIBUTE');
    for (const file of ['components/brand-workspace/home/home-view.tsx', 'components/brand-workspace/home/team-home.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toContain(RAIL_MODE_FOLLOWS_ATTRIBUTE);
    }
  });
});
