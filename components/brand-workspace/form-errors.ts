/**
 * Server validation answers with the first failing zod path, dotted (`criteria.maxFollowers`,
 * `referenceLinks.1.url`). The forms post flat, repeated field names, so this maps a path back to
 * the control that produced it. Kept free of React so the mapping and the focus timing are testable.
 */
const NESTED: Record<string, (rest: string[]) => { name: string; index: number } | null> = {
  // `criteria` is assembled from flat inputs in ActionForm; its keys are the input names.
  criteria: ([key]) => (key ? { name: key, index: 0 } : null),
  // One row per reference: `referenceLinks.N.url|note` is the Nth referenceUrl/referenceNote input.
  referenceLinks: ([index, key]) => ({
    name: key === 'note' ? 'referenceNote' : 'referenceUrl',
    index: /^\d+$/.test(index ?? '') ? Number(index) : 0,
  }),
};

export function fieldForPath(path: string): { name: string; index: number } | null {
  const [head, ...rest] = path.split('.');
  if (!head || !/^[A-Za-z][\w]*$/.test(head)) return null;
  const mapped = NESTED[head]?.(rest);
  if (mapped) return /^[A-Za-z][\w]*$/.test(mapped.name) ? mapped : null;
  return { name: head, index: /^\d+$/.test(rest[0] ?? '') ? Number(rest[0]) : 0 };
}

interface FieldNode {
  tagName: string;
  parentElement: FieldNode | null;
  disabled?: boolean;
  open?: boolean;
  focus(): void;
  setAttribute(name: string, value: string): void;
}

/**
 * `rows` translates a submitted array index back to its DOM row when the form dropped rows before
 * posting: blank reference rows are filtered out, so `referenceLinks.0` is the first NON-EMPTY row.
 * An index with no known row marks nothing rather than guessing the wrong input.
 */
export function locateField(
  form: { querySelectorAll(selector: string): ArrayLike<unknown> },
  path: string,
  rows: Partial<Record<string, readonly number[]>> = {},
): FieldNode | null {
  const target = fieldForPath(path);
  if (!target) return null;
  const submitted = rows[path.split('.')[0]!];
  const index = submitted ? submitted[target.index] : target.index;
  if (index === undefined) return null;
  return (form.querySelectorAll(`[name="${target.name}"]`)[index] as FieldNode | undefined) ?? null;
}

/** Open every enclosing `<details>` so the marked field is visible, not folded away. */
export function revealField(field: FieldNode): void {
  for (let node = field.parentElement; node; node = node.parentElement)
    if (node.tagName === 'DETAILS') node.open = true;
}

/** A control inside a disabled fieldset cannot take focus; the browser silently ignores it. */
export function isFocusBlocked(field: FieldNode): boolean {
  for (let node: FieldNode | null = field; node; node = node.parentElement)
    if (node.disabled && (node === field || node.tagName === 'FIELDSET')) return true;
  return false;
}

/**
 * Holds the invalid field until the form re-enables. Call `flush` after each commit; it focuses once
 * the control is focusable and then forgets it, so a later re-render never steals focus.
 */
export function createFieldFocus() {
  let pending: FieldNode | null = null;
  return {
    request(field: FieldNode) { pending = field; },
    clear() { pending = null; },
    flush(): boolean {
      if (!pending || isFocusBlocked(pending)) return false;
      const field = pending;
      pending = null;
      field.focus();
      return true;
    },
  };
}
