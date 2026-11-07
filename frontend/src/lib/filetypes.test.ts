import { describe, expect, it } from "vitest";
import { fileKind, fullySelectedGroups, selectDuplicates } from "./filetypes";
import type { DupGroup } from "./types";

describe("fileKind", () => {
  it("groups by extension", () => {
    expect(fileKind("Holiday.MP4")).toBe("video");
    expect(fileKind("Win11_24H2.iso")).toBe("disk");
    expect(fileKind("setup.msi")).toBe("installer");
    expect(fileKind("llama3.gguf")).toBe("model");
    expect(fileKind("notes")).toBe("other");
  });
});

describe("duplicate selection", () => {
  const groups: DupGroup[] = [
    {
      hash: "a",
      bytes: 10,
      wasted: 20,
      files: [
        { path: "C:\\x\\long\\path\\a.bin", mtime: 300 },
        { path: "C:\\a.bin", mtime: 100 },
        { path: "C:\\y\\a.bin", mtime: 200 },
      ],
    },
  ];

  it("keeps exactly one copy per group", () => {
    for (const rule of ["newest", "oldest", "shortest"] as const) {
      const sel = selectDuplicates(groups, rule);
      expect(sel.size).toBe(2);
      expect(fullySelectedGroups(groups, sel)).toHaveLength(0);
    }
    expect(selectDuplicates(groups, "newest").has("C:\\x\\long\\path\\a.bin")).toBe(false);
    expect(selectDuplicates(groups, "oldest").has("C:\\a.bin")).toBe(false);
    expect(selectDuplicates(groups, "shortest").has("C:\\a.bin")).toBe(false);
  });

  it("flags groups where every copy is selected", () => {
    const all = new Set(groups[0]!.files.map((f) => f.path));
    expect(fullySelectedGroups(groups, all)).toHaveLength(1);
  });
});
