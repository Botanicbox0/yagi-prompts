/** Colour values of the layer editor: one spelling (#RRGGBB, upper case) and the recent list. */

/** "#abc", "abc", "#AABBCC" → "#AABBCC"; anything else → null. */
export function normalizeHex(input: string): string | null {
  const value = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toUpperCase()}`;
  return null;
}

/** Puts a colour first in the recent list, without duplicates, at most `max` long. */
export function pushRecent(list: readonly string[], color: string, max = 8): string[] {
  const hex = normalizeHex(color);
  if (!hex) return [...list];
  return [hex, ...list.filter((c) => c !== hex)].slice(0, max);
}

/** Relative luminance, for picking a readable check mark on a swatch. */
export function isLight(hex: string): boolean {
  const value = normalizeHex(hex);
  if (!value) return true;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.5;
}
