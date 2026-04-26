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

describe("stats storage", () => {
  beforeEach(async () => {
    vi.resetModules();
    testState.dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "smart-scraper-stats-"),
    );
  });

  afterEach(async () => {
    await fs.rm(testState.dataDir, {
      recursive: true,
      force: true,
    });
  });

  it("quarantines corrupt stats files and recovers with default stats", async () => {
    const statsFile = path.join(
      testState.dataDir,
      "stats.json",
    );
    await fs.mkdir(testState.dataDir, { recursive: true });
    await fs.writeFile(statsFile, "{ not json");

    const { loadStats } =
      await import("./stats-storage.js");

    await expect(loadStats()).resolves.toMatchObject({
      scrapeTotal: 0,
      failTotal: 0,
      scrapeToday: 0,
      failToday: 0,
      domainCounts: {},
    });

    const recovered = JSON.parse(
      await fs.readFile(statsFile, "utf-8"),
    ) as unknown;
    expect(recovered).toMatchObject({
      scrapeTotal: 0,
      failTotal: 0,
      scrapeToday: 0,
      failToday: 0,
      domainCounts: {},
    });

    const files = await fs.readdir(testState.dataDir);
    const corruptFiles = files.filter((file) =>
      file.startsWith("stats.json.corrupt-"),
    );
    expect(corruptFiles).toHaveLength(1);
    await expect(
      fs.readFile(
        path.join(testState.dataDir, corruptFiles[0]),
        "utf-8",
      ),
    ).resolves.toBe("{ not json");
  });
});
