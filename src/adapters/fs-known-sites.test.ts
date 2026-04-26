import fs from "fs/promises";
import os from "os";
import path from "path";
import { parse } from "comment-json";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SiteConfig } from "../domain/models.js";

const testState = vi.hoisted(() => ({
  dataDir: "",
}));

vi.mock("../config.js", () => ({
  getDataDir: () => testState.dataDir,
  getLogLevel: () => "NONE",
  isDebugMode: () => false,
}));

function siteConfig(
  domainPattern: string,
  xpathMainContent = "//main",
): SiteConfig {
  return {
    domainPattern,
    xpathMainContent,
    failureCountSinceLastSuccess: 0,
  };
}

describe("FsKnownSitesAdapter", () => {
  beforeEach(async () => {
    vi.resetModules();
    testState.dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "smart-scraper-sites-"),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("uses unique temp files for concurrent writes", async () => {
    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const firstAdapter = new FsKnownSitesAdapter();
    const secondAdapter = new FsKnownSitesAdapter();

    await Promise.all([
      firstAdapter.saveConfig({
        domainPattern: "example.com",
        xpathMainContent: "//article",
        failureCountSinceLastSuccess: 0,
      }),
      secondAdapter.saveConfig({
        domainPattern: "example.org",
        xpathMainContent: "//main",
        failureCountSinceLastSuccess: 0,
      }),
    ]);

    const tempWrites = writeFileSpy.mock.calls
      .map(([file]) => String(file))
      .filter(
        (file) =>
          file.includes("sites.jsonc.") &&
          file.endsWith(".tmp"),
      );

    expect(tempWrites).toHaveLength(2);
    expect(new Set(tempWrites).size).toBe(2);

    const files = await fs.readdir(testState.dataDir);
    expect(files).not.toContain("sites.jsonc.tmp");
    expect(files.filter((file) => file.endsWith(".tmp"))).toEqual(
      [],
    );

    const sites = parse(
      await fs.readFile(
        path.join(testState.dataDir, "sites.jsonc"),
        "utf-8",
      ),
    ) as unknown;
    expect(Array.isArray(sites)).toBe(true);
  });

  it("normalizes www domains before saving and lookup", async () => {
    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await adapter.saveConfig(
      siteConfig("WWW.Example.COM.", "//article"),
    );

    await expect(
      adapter.getConfig("example.com"),
    ).resolves.toMatchObject({
      domainPattern: "example.com",
      xpathMainContent: "//article",
    });
    await expect(
      adapter.getConfig("www.example.com"),
    ).resolves.toMatchObject({
      domainPattern: "example.com",
      xpathMainContent: "//article",
    });
  });

  it("persists strategy fields for method, captcha, and proxy", async () => {
    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await adapter.saveConfig({
      ...siteConfig("example.com", "//article"),
      method: "chrome",
      captcha: "datadome",
      proxy: "datadome",
    });

    await expect(
      adapter.getConfig("example.com"),
    ).resolves.toMatchObject({
      domainPattern: "example.com",
      method: "chrome",
      captcha: "datadome",
      proxy: "datadome",
      needsProxy: "datadome",
    });

    const sites = parse(
      await fs.readFile(
        path.join(testState.dataDir, "sites.jsonc"),
        "utf-8",
      ),
    ) as unknown as SiteConfig[];
    expect(sites[0]).toMatchObject({
      method: "chrome",
      captcha: "datadome",
      proxy: "datadome",
      needsProxy: "datadome",
    });
  });

  it("loads legacy strategy fields without requiring new fields", async () => {
    const sitesFile = path.join(
      testState.dataDir,
      "sites.jsonc",
    );
    await fs.mkdir(testState.dataDir, { recursive: true });
    await fs.writeFile(
      sitesFile,
      JSON.stringify([
        {
          domainPattern: "legacy.example.com",
          xpathMainContent: "//article",
          failureCountSinceLastSuccess: 0,
          method: "puppeteer_stealth",
          captcha: "generic",
          needsProxy: "datadome",
        },
      ]),
    );

    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await expect(
      adapter.getConfig("legacy.example.com"),
    ).resolves.toMatchObject({
      method: "chrome",
      captcha: "unsupported",
      proxy: "datadome",
      needsProxy: "datadome",
    });
  });

  it("uses root domain configs for subdomains", async () => {
    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await adapter.saveConfig(siteConfig("example.com"));

    await expect(
      adapter.getConfig("news.example.com"),
    ).resolves.toMatchObject({
      domainPattern: "example.com",
    });
  });

  it("prefers an exact subdomain config over a root domain config", async () => {
    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await adapter.saveConfig(siteConfig("example.com", "//main"));
    await adapter.saveConfig(
      siteConfig("news.example.com", "//article"),
    );

    await expect(
      adapter.getConfig("news.example.com"),
    ).resolves.toMatchObject({
      domainPattern: "news.example.com",
      xpathMainContent: "//article",
    });
  });

  it("does not match unrelated domains", async () => {
    const { FsKnownSitesAdapter } =
      await import("./fs-known-sites.js");
    const adapter = new FsKnownSitesAdapter();

    await adapter.saveConfig(siteConfig("example.com"));

    await expect(
      adapter.getConfig("notexample.com"),
    ).resolves.toBeUndefined();
    await expect(
      adapter.getConfig("example.com.evil.test"),
    ).resolves.toBeUndefined();
  });
});
