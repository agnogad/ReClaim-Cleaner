import { describe, expect, it } from "vitest";
import { baseName, claudeProjectLabel, driveLabel, hasDriveLetter, isDriveRoot, isFilePath, parentPath, pathKey, samePath, shortPath } from "./paths";

describe("Windows paths", () => {
  it("extracts names and parents", () => {
    expect(baseName("C:\\Users\\a\\Desktop\\")).toBe("Desktop");
    expect(parentPath("C:\\Users\\a\\file.txt")).toBe("C:\\Users\\a");
    expect(parentPath("C:\\Users")).toBe("C:");
  });

  it("shortens the profile prefix case-insensitively", () => {
    expect(shortPath("C:\\Users\\Alex\\.npm", "c:\\users\\alex")).toBe("~\\.npm");
    expect(shortPath("D:\\data", "C:\\Users\\Alex")).toBe("D:\\data");
    expect(shortPath("C:\\Users\\Alex", "C:\\Users\\Alex")).toBe("C:\\Users\\Alex");
    expect(shortPath("C:\\Users\\Alex2\\x", "C:\\Users\\Alex")).toBe("C:\\Users\\Alex2\\x");
  });

  it("compares without case", () => {
    expect(samePath("C:\\Users", "c:\\users")).toBe(true);
    expect(pathKey("C:\\Users")).toBe("c:\\users");
    expect(samePath("C:\\", "D:\\")).toBe(false);
  });

  it("labels drives without the backslash", () => {
    expect(driveLabel("C:\\")).toBe("C:");
    expect(driveLabel("D:\\")).toBe("D:");
  });

  it("recognises drive roots", () => {
    expect(isDriveRoot("C:\\")).toBe(true);
    expect(isDriveRoot("c:")).toBe(true);
    expect(isDriveRoot("C:\\Users")).toBe(false);
  });

  it("tells paths from names", () => {
    expect(isFilePath("C:\\Temp")).toBe(true);
    expect(isFilePath("Recycle Bin")).toBe(false);
    expect(hasDriveLetter("C:\\Temp")).toBe(true);
    expect(hasDriveLetter("\\\\server\\share")).toBe(false);
    expect(hasDriveLetter("/home/alex")).toBe(false);
  });
});

describe("Linux paths", () => {
  it("extracts names and parents", () => {
    expect(baseName("/home/alex/Desktop/")).toBe("Desktop");
    expect(baseName("/")).toBe("/");
    expect(parentPath("/home/alex/file.txt")).toBe("/home/alex");
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });

  it("treats a backslash as part of a name", () => {
    expect(baseName("/home/alex/a\\b.txt")).toBe("a\\b.txt");
    expect(parentPath("/home/alex/a\\b.txt")).toBe("/home/alex");
  });

  it("shortens only an exact profile prefix", () => {
    expect(shortPath("/home/alex/.cache/npm", "/home/alex")).toBe("~/.cache/npm");
    expect(shortPath("/home/alex/.cache", "/home/alex/")).toBe("~/.cache");
    expect(shortPath("/home/Alex/.cache", "/home/alex")).toBe("/home/Alex/.cache");
    expect(shortPath("/home/alex", "/home/alex")).toBe("/home/alex");
    expect(shortPath("/home/alex2/x", "/home/alex")).toBe("/home/alex2/x");
    expect(shortPath("/mnt/data", "")).toBe("/mnt/data");
    expect(shortPath("/mnt/data", "/")).toBe("/mnt/data");
  });

  it("compares exactly, apart from trailing slashes", () => {
    expect(samePath("/mnt/Data", "/mnt/data")).toBe(false);
    expect(samePath("/mnt/data/", "/mnt/data")).toBe(true);
    expect(samePath("/", "/")).toBe(true);
    expect(pathKey("/Home/")).toBe("/Home");
  });

  it("keeps drive roots readable", () => {
    expect(driveLabel("/")).toBe("/");
    expect(driveLabel("/mnt/data")).toBe("/mnt/data");
    expect(driveLabel("/mnt/data/")).toBe("/mnt/data");
  });

  it("recognises the root and known mount points", () => {
    expect(isDriveRoot("/")).toBe(true);
    expect(isDriveRoot("/mnt/data")).toBe(false);
    expect(isDriveRoot("/mnt/data", ["/", "/mnt/data"])).toBe(true);
    expect(isDriveRoot("/mnt/data/photos", ["/", "/mnt/data"])).toBe(false);
  });

  it("tells paths from names", () => {
    expect(isFilePath("/var/cache/apt")).toBe(true);
    expect(isFilePath("Docker images")).toBe(false);
  });
});

describe("Claude project labels", () => {
  it("rebuilds the Windows drive", () => {
    expect(claudeProjectLabel("C--code-shop", "C:\\Users\\a")).toBe("C:\\code-shop");
  });

  it("shortens the home folder on Linux and leaves the rest alone", () => {
    expect(claudeProjectLabel("-home-alex-my-shop", "/home/alex")).toBe("~/my-shop");
    expect(claudeProjectLabel("-home-al-ex-shop", "/home/al.ex")).toBe("~/shop");
    expect(claudeProjectLabel("-home-alex2-shop", "/home/alex")).toBe("-home-alex2-shop");
    expect(claudeProjectLabel("-srv-shop", "/home/alex")).toBe("-srv-shop");
  });

  it("does not guess when the profile is unknown", () => {
    expect(claudeProjectLabel("-home-alex-shop", "")).toBe("-home-alex-shop");
    expect(claudeProjectLabel("plain", "C:\\Users\\a")).toBe("plain");
  });
});
