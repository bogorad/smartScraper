import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const testState = vi.hoisted(() => ({
  dataDir: "",
}));

vi.mock("../config.js", () => ({
  getDataDir: () => testState.dataDir,
  getLogLevel: () => "NONE",
  isDebugMode: () => false,
}));

describe("FsKnownSitesAdapter", () => {
  beforeEach(async () => {
    vi.resetModules();
    testState.dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "smart-scraper-sites-"),
    );
  });

  afterEach(async () => {
    await fs.rm(testState.dataDir, {
      recursive: true,
      force: true,
    });
  });

  it("quarantines corrupt sites files and recovers with an empty config list", async () => {
    const sitesFile = path.join(
      testState.dataDir,
      "sites.jsonc",
    );
    await fs.mkdir(testState.dataDir, { recursive: true });
    await fs.writeFile(sitesFile, "{ not jsonc");

    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await expect(adapter.getAllConfigs()).resolves.toEqual(
      [],
    );
    await expect(
      fs.readFile(sitesFile, "utf-8"),
    ).resolves.toBe("[]");

    const files = await fs.readdir(testState.dataDir);
    const corruptFiles = files.filter((file) =>
      file.startsWith("sites.jsonc.corrupt-"),
    );
    expect(corruptFiles).toHaveLength(1);
    await expect(
      fs.readFile(
        path.join(testState.dataDir, corruptFiles[0]),
        "utf-8",
      ),
    ).resolves.toBe("{ not jsonc");
  });
});
