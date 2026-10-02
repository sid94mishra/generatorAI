// testID helper (03 §1.5): kebab-case `<part>-<element>[-<id>]`. Existing ids are kept verbatim when ported.
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function tid(part: string, element: string, id?: string): string {
  const value = id === undefined ? `${part}-${element}` : `${part}-${element}-${id}`;
  if (typeof __DEV__ !== 'undefined' && __DEV__ && !KEBAB.test(`${part}-${element}`)) console.warn(`[tid] not kebab-case: ${value}`);
  return value;
}
