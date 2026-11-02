/** LTR admin menus need only a horizontal adjustment; document scroll never participates. */
export function adminNavScrollLeft({ scrollLeft, clientWidth, scrollWidth, itemLeft, itemRight }: {
  scrollLeft: number; clientWidth: number; scrollWidth: number; itemLeft: number; itemRight: number;
}): number {
  const maximum = Math.max(0, scrollWidth - clientWidth);
  if (maximum === 0 || clientWidth <= 0) return 0;
  const padding = 8;
  let next = scrollLeft;
  if (itemLeft < scrollLeft + padding || itemRight - itemLeft > clientWidth - padding * 2) next = itemLeft - padding;
  else if (itemRight > scrollLeft + clientWidth - padding) next = itemRight - clientWidth + padding;
  return Math.min(maximum, Math.max(0, next));
}
