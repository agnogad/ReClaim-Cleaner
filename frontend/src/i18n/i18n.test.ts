import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { id } from "./id";
import { it as italian } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { LANGUAGES, resolveLang } from "./languages";
import { pl } from "./pl";
import { pt } from "./pt";
import { ru } from "./ru";
import { tr } from "./tr";
import { uk } from "./uk";
import { zh } from "./zh";

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

const vars = (s: string) => [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
const PLURAL = /_(zero|one|two|few|many|other)$/;
/** The English key a translated key corresponds to (plural forms map to the English `_other`). */
function englishKey(key: string, enMap: Map<string, string>): string | undefined {
  if (enMap.has(key)) return key;
  if (PLURAL.test(key)) {
    const other = key.replace(PLURAL, "_other");
    if (enMap.has(other)) return other;
  }
  return undefined;
}

const enMap = flatten(en as unknown as Tree);
const PARTIAL = { de, es, fr, it: italian, pt, pl, ru, uk, id, ja, ko, zh } as Record<string, unknown>;

describe("Turkish", () => {
  const trMap = flatten(tr as unknown as Tree);

  it("has exactly the English keys", () => {
    expect([...trMap.keys()].sort()).toEqual([...enMap.keys()].sort());
  });

  it("uses the same interpolation variables", () => {
    for (const [key, value] of enMap) {
      expect({ key, vars: vars(trMap.get(key) ?? "") }).toEqual({ key, vars: vars(value) });
    }
  });
});

describe.each(Object.entries(PARTIAL))("%s", (code, translation) => {
  const map = flatten(translation as Tree);

  it("only uses keys English has", () => {
    const unknown = [...map.keys()].filter((k) => !englishKey(k, enMap));
    expect(unknown).toEqual([]);
  });

  it("keeps interpolation variables", () => {
    for (const [key, value] of map) {
      const source = enMap.get(englishKey(key, enMap)!) ?? "";
      // A plural form may drop {{count}} (Japanese "one" style), but never invent variables.
      for (const v of vars(value)) expect({ code, key, v, ok: vars(source).includes(v) }).toEqual({ code, key, v, ok: true });
    }
  });

  it("covers almost all of the UI", () => {
    const covered = [...enMap.keys()].filter((k) => map.has(k) || (PLURAL.test(k) && map.has(k.replace(PLURAL, "_other")))).length;
    expect(covered / enMap.size).toBeGreaterThan(0.9);
  });

  it("has no empty strings and no emoji", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [key, value] of map) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(emoji.test(value), key).toBe(false);
    }
  });
});

describe("languages", () => {
  it("lists every translation once", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(["de", "en", "es", "fr", "id", "it", "ja", "ko", "pl", "pt", "ru", "tr", "uk", "zh"]);
  });

  it("resolves settings and system languages", () => {
    expect(resolveLang("de", "en-US")).toBe("de");
    expect(resolveLang("system", "pt-BR")).toBe("pt");
    expect(resolveLang(undefined, "zh-CN")).toBe("zh");
    expect(resolveLang("system", "ar-SA")).toBe("en");
  });
});

describe("English", () => {
  it("has no empty strings and no emoji", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [key, value] of enMap) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(emoji.test(value), key).toBe(false);
    }
  });
});
