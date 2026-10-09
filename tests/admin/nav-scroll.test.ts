import { describe, expect, it } from 'vitest';
import { adminNavScrollLeft } from '@/lib/admin/nav-scroll';
const viewport = { scrollLeft: 100, clientWidth: 300, scrollWidth: 800 };
describe('admin mobile navigation horizontal position', () => {
  it('leaves a fully visible item and a non-scrolling navigation unchanged', () => {
    expect(adminNavScrollLeft({ ...viewport, itemLeft: 140, itemRight: 230 })).toBe(100);
    expect(adminNavScrollLeft({ ...viewport, scrollLeft: 0, scrollWidth: 300, itemLeft: 0, itemRight: 120 })).toBe(0);
  });
  it('reveals a clipped item on either side without exceeding scroll bounds', () => {
    expect(adminNavScrollLeft({ ...viewport, itemLeft: 20, itemRight: 110 })).toBe(12);
    expect(adminNavScrollLeft({ ...viewport, itemLeft: 430, itemRight: 520 })).toBe(228);
    expect(adminNavScrollLeft({ ...viewport, itemLeft: 750, itemRight: 800 })).toBe(500);
    expect(adminNavScrollLeft({ ...viewport, itemLeft: 0, itemRight: 90 })).toBe(0);
  });
});
