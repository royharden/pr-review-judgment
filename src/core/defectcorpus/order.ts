// Locale-independent deterministic ordering shared by core modules.

/** Compare by UTF-16 code units (what `Array.prototype.sort` does by default), never by locale. */
export function compareCodeUnits(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}
