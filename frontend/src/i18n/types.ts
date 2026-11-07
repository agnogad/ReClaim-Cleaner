import type { Messages } from "./en";

/**
 * Shape of a community translation. Keys may be missing (English is shown instead), and
 * languages with more plural forms may add `_zero`, `_two`, `_few` and `_many` keys that
 * English does not need. Turkish stays fully typed against English in tr.ts.
 */
export type Translation = Loose<Messages>;

type Loose<T> = { [K in keyof T]?: T[K] extends string ? string : Loose<T[K]> } & { [key: string]: unknown };
