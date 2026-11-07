import { describe, expect, it } from "vitest";
import i18n, { applyPlatformWording, linuxWording, TRANSLATIONS } from ".";
import { de } from "./de";
import { en } from "./en";
import { tr } from "./tr";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const WINDOWS_WORDS = /Windows|Explorer|Recycle Bin|UAC|PowerShell|AppData|Prefetch|C:\\/;
const { linux, ...base } = en;
const enMap = flatten(base as unknown as Tree);
const overlay = flatten(linux as unknown as Tree);

// Sections and keys that belong to pages, panels and actions Linux does not show. `common.commandHint`
// and `common.runCommand` go with the Run button, which is the copy button there.
const NOT_SHOWN = /^(apps|startup|tools|hidden|locks)\.|^settings\.(admin|restartAdmin|explorer|quick)|^nav\.tools$|^common\.(scriptCopied|copyScript|commandHint|runCommand)$|^junk\.command|^overview\.quickTaskHint$/;

describe("Linux wording", () => {
  it("replaces keys that exist, with the same variables", () => {
    for (const [key, value] of overlay) {
      expect({ key, known: enMap.has(key) }).toEqual({ key, known: true });
      expect({ key, vars: vars(value) }).toEqual({ key, vars: vars(enMap.get(key) ?? "") });
    }
  });

  it("does not touch plural keys, which other languages extend", () => {
    expect([...overlay.keys()].filter((k) => /_(zero|one|two|few|many|other)$/.test(k))).toEqual([]);
  });

  it("names nothing only Windows has", () => {
    for (const [key, value] of overlay) expect({ key, ok: !WINDOWS_WORDS.test(value) }).toEqual({ key, ok: true });
    expect(WINDOWS_WORDS.test([...flatten(tr.linux as unknown as Tree).values()].join(" "))).toBe(false);
  });

  it("leaves no Windows word in what Linux shows", () => {
    const left = [...enMap].filter(([key, value]) => !NOT_SHOWN.test(key) && !overlay.has(key) && WINDOWS_WORDS.test(value)).map(([key]) => key);
    expect(left).toEqual([]);
  });

  it("uses a language's own wording, then English", () => {
    const turkish = flatten(linuxWording("tr"));
    const german = flatten(linuxWording("de"));
    expect(turkish.get("method.recycle")).toBe(tr.linux.method.recycle);
    expect(german.get("method.recycle")).toBe(en.linux.method.recycle);
    expect(german.size).toBe(overlay.size);
  });
});

describe("applyPlatformWording", () => {
  const originals = new Map(Object.keys(TRANSLATIONS).map((code) => [code, i18n.getFixedT(code)("method.recycle")]));

  it("changes nothing on Windows", () => {
    applyPlatformWording("windows");
    for (const [code, text] of originals) expect(i18n.getFixedT(code)("method.recycle")).toBe(text);
    expect(i18n.getFixedT("de")("method.recycle")).toBe(de.method?.recycle);
  });

  it("replaces the keys in every language off Windows, and only those", () => {
    applyPlatformWording("linux");
    expect(i18n.getFixedT("en")("method.recycle")).toBe("Move to Trash");
    expect(i18n.getFixedT("tr")("method.recycle")).toBe(tr.linux.method.recycle);
    // A language without Linux wording shows English rather than its Windows term.
    expect(i18n.getFixedT("de")("method.recycle")).toBe("Move to Trash");
    expect(i18n.getFixedT("en")("method.permanent")).toBe("Delete permanently");
    expect(i18n.getFixedT("de")("method.permanent")).toBe(de.method?.permanent);
  });
});
