import { describe, expect, it } from "vitest";
import { buildScript, psQuote } from "./script";

const opts = { recycle: true, generatedAt: new Date("2026-10-16T10:00:00Z"), version: "0.1.0" };

describe("psQuote", () => {
  it("doubles single quotes so paths cannot break out of the literal", () => {
    expect(psQuote("C:\\It's\\here")).toBe("'C:\\It''s\\here'");
    expect(psQuote("C:\\a'; Remove-Item C:\\ -Recurse; '")).toBe("'C:\\a''; Remove-Item C:\\ -Recurse; '''");
  });
});

describe("buildScript", () => {
  it("starts in dry-run mode and uses literal paths", () => {
    const s = buildScript([{ title: "npm cache", paths: ["C:\\Users\\a\\AppData\\Local\\npm-cache\\_cacache"], mode: "contents" }], opts);
    expect(s).toContain("$DryRun = $true");
    expect(s).toContain("$UseRecycleBin = $true");
    expect(s).toContain("Remove-Contents -Path 'C:\\Users\\a\\AppData\\Local\\npm-cache\\_cacache'");
    expect(s).toContain("-LiteralPath");
    expect(s).not.toContain("Needs administrator rights");
  });

  it("keeps admin steps in a guarded section", () => {
    const s = buildScript(
      [
        { title: "Temp", paths: ["C:\\Users\\a\\AppData\\Local\\Temp"], mode: "contents", minAgeHours: 24 },
        { title: "Windows temp", paths: ["C:\\Windows\\Temp"], mode: "contents", admin: true },
      ],
      { ...opts, recycle: false },
    );
    expect(s).toContain("-MinAgeHours 24");
    expect(s).toContain("Get-FilesSafe");
    const ex = buildScript([{ title: "Temp", paths: ["C:\\T"], mode: "contents", exclude: ["*.blend", "it's"] }], opts);
    expect(ex).toContain("-Exclude @('*.blend', 'it''s')");
    expect(s).toContain("$UseRecycleBin = $false");
    const adminAt = s.indexOf("Needs administrator rights");
    expect(adminAt).toBeGreaterThan(0);
    expect(s.indexOf("C:\\Windows\\Temp")).toBeGreaterThan(adminAt);
  });

  it("uses official commands for report-only rules", () => {
    const s = buildScript([{ title: "Recycle Bin", paths: [], mode: "report", command: "api:SHEmptyRecycleBinW(NULL)" }], opts);
    expect(s).toContain("Clear-RecycleBin");
    const d = buildScript([{ title: "Components", paths: [], mode: "report", command: "Dism.exe /Online /Cleanup-Image /StartComponentCleanup", admin: true }], opts);
    expect(d).toContain("Would run: Dism.exe");
  });

  it("filters files mode by include patterns", () => {
    const s = buildScript([{ title: "Dumps", paths: ["C:\\Windows"], mode: "files", include: ["*.dmp"], admin: true }], opts);
    expect(s).toContain("-Include @('*.dmp')");
  });
});
