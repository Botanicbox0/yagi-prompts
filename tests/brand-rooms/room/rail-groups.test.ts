import { describe, expect, it } from 'vitest';
import {
  RAIL_GROUP,
  RAIL_HREF,
  dropInGroup,
  groupItems,
  groupedTabIds,
  moveInGroup,
  orderItems,
  railActive,
  railCreateLinks,
  railItems,
} from '@/components/brand-workspace/rail-model';
import { unreadFrom } from '@/components/brand-workspace/rail-activity';

/** docs/BRAND-ROOMS.md §2 — the rail in two groups, without React. */
describe('the two groups', () => {
  it('splits 직접 만들기 and 야기 팀과, with 메시지 at /brand/rooms (no studio review or brandKit)', () => {
    const all = railItems({ studio: true, creators: true, identity: true, rooms: true });
    expect(all).toEqual(['image', 'video', 'assets', 'campaigns', 'messages', 'creators']);
    expect(groupItems(all, [])).toEqual({ make: ['image', 'video', 'assets'], team: ['campaigns', 'messages', 'creators'] });
    expect(RAIL_HREF.messages).toBe('/brand/rooms');
    expect(RAIL_HREF.campaigns).toBe('/brand');
  });

  it('keeps the ungrouped rail exactly as it was when rooms are closed', () => {
    for (const rooms of [false, undefined]) {
      expect(railItems({ studio: true, creators: true, identity: true, rooms })).toEqual(['image', 'video', 'campaigns', 'creators', 'assets']);
    }
    expect(railItems({ studio: true, creators: true, identity: true })).not.toContain('messages');
  });

  it('shows a campaign-only guest 에셋 · 의뢰 · 메시지 and nothing of the studio', () => {
    const guest = railItems({ studio: false, creators: false, identity: false, rooms: true });
    expect(guest).toEqual(['assets', 'campaigns', 'messages']);
    expect(groupItems(guest, [])).toEqual({ make: ['assets'], team: ['campaigns', 'messages'] });
  });

  it('applies a saved order inside each group and never moves an item across groups', () => {
    const all = railItems({ studio: true, creators: true, identity: true, rooms: true });
    // An order saved by the ungrouped rail, with 의뢰 first and 에셋 before 이미지.
    const old = ['/brand', '/brand/library', '/brand/studio', '/brand/studio/video', '/brand/studio/review', '/brand/creators', '/brand/identity'];
    const groups = groupItems(all, old);
    expect(groups.make).toEqual(['assets', 'image', 'video']);
    expect(groups.team).toEqual(['campaigns', 'messages', 'creators']);
    for (const id of groups.make) expect(RAIL_GROUP[id]).toBe('make');
    for (const id of groups.team) expect(RAIL_GROUP[id]).toBe('team');
    // 크리에이터 saved first of all still stays with the team; 이미지 leads its own group.
    const creatorsFirst = groupItems(all, ['/brand/creators', '/brand', '/brand/studio']);
    expect(creatorsFirst.make[0]).toBe('image');
    expect(creatorsFirst.make).not.toContain('creators');
    expect(creatorsFirst.team[0]).toBe('creators');
    // orderItems itself is unchanged for the ungrouped rail.
    expect(orderItems(railItems({ studio: true, creators: true, identity: true }), ['/brand', '/brand/studio/video'])).toEqual([
      'image',
      'campaigns',
      'creators',
      'assets',
      'video',
    ]);
  });

  it('moves within a group and stops at its ends; a drop on the other group does nothing', () => {
    const groups = groupItems(railItems({ studio: true, creators: true, identity: true, rooms: true }), []);
    expect(moveInGroup(groups, 'assets', 1)).toEqual(['image', 'video', 'assets', 'campaigns', 'messages', 'creators']);
    expect(moveInGroup(groups, 'campaigns', -1)).toEqual(['image', 'video', 'assets', 'campaigns', 'messages', 'creators']);
    expect(moveInGroup(groups, 'messages', -1)).toEqual(['image', 'video', 'assets', 'messages', 'campaigns', 'creators']);
    expect(dropInGroup(groups, 'creators', 'campaigns')).toEqual(['image', 'video', 'assets', 'creators', 'campaigns', 'messages']);
    expect(dropInGroup(groups, 'creators', 'image')).toBeNull();
    expect(dropInGroup(groups, 'assets', 'messages')).toBeNull();
    // The saved list, read back, lands in the same groups.
    const saved = dropInGroup(groups, 'video', 'image')!.map((id) => RAIL_HREF[id]);
    expect(groupItems(railItems({ studio: true, creators: true, identity: true, rooms: true }), saved).make.slice(0, 2)).toEqual(['video', 'image']);
  });

  it('puts 이미지 · 영상 · 의뢰 · 메시지 on the phone bar', () => {
    const groups = groupItems(railItems({ studio: true, creators: true, identity: true, rooms: true }), []);
    expect(groupedTabIds([...groups.make, ...groups.team])).toEqual(['image', 'video', 'campaigns', 'messages']);
    expect(groupedTabIds(['assets', 'campaigns', 'messages'])).toEqual(['campaigns', 'messages', 'assets']);
  });
});

describe('the current item with rooms', () => {
  it('gives 메시지 the inbox only, and 의뢰 every project room', () => {
    expect(railActive('/brand/rooms', '/brand/rooms')).toBe(true);
    expect(railActive('/brand/rooms', '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11')).toBe(false);
    expect(railActive('/brand', '/brand/rooms/0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11')).toBe(true);
    expect(railActive('/brand', '/brand/rooms')).toBe(false);
    expect(railActive('/brand/rooms', '/brand/roomsx')).toBe(false);
    expect(railActive('/brand', '/brand/projects/new')).toBe(true);
  });
});

describe('the "+" menu', () => {
  it('ends with 캠페인 의뢰 without rooms, and with 야기 팀에 의뢰하기 apart from the rest with rooms', () => {
    expect(railCreateLinks(false).map((l) => [l.key, l.href])).toEqual([
      ['image', '/brand/studio'],
      ['video', '/brand/studio/video'],
      ['reverse', '/brand/studio/video?start=reverse'],
      ['campaign', '/brand/projects/new'],
    ]);
    expect(railCreateLinks(true).map((l) => [l.key, l.href])).toEqual([
      ['image', '/brand/studio'],
      ['video', '/brand/studio/video'],
      ['reverse', '/brand/studio/video?start=reverse'],
      ['commission', '/brand/projects/new'],
    ]);
  });
});

describe('the unread total', () => {
  it('reads the summary defensively: anything odd is zero', () => {
    expect(unreadFrom({ ok: true, unread: 4, channels: [] })).toBe(4);
    expect(unreadFrom({ ok: true, unread: 2.7, channels: [] })).toBe(2);
    expect(unreadFrom({ ok: false, unread: 4 })).toBe(0);
    expect(unreadFrom({ ok: true, unread: -1 })).toBe(0);
    expect(unreadFrom({ ok: true, unread: '3' })).toBe(0);
    expect(unreadFrom(null)).toBe(0);
    expect(unreadFrom('nope')).toBe(0);
  });
});
