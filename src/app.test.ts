import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { VERSION } from "./constants.js";

vi.mock("./config.js", () => ({
  getApiToken: () => "test-api-token",
  getLogLevel: () => "NONE",
}));

vi.mock("./middleware/rate-limit.js", () => ({
  rateLimitMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
}));

vi.mock("./core/engine.js", () => ({
  getDefaultEngine: () => {
    throw new Error("default engine should not be used");
  },
  getQueueStats: () => ({
    active: 0,
    activeUrls: [],
    max: 1,
    pending: 0,
  }),
  workerEvents: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe("createApp", () => {
  function createEngine(data: string) {
    return {
      scrapeUrl: vi.fn().mockResolvedValue({
        success: true,
        method: "chrome",
        xpath: "//article",
        data,
      }),
    };
  }

  it("builds health and version routes without starting a server", async () => {
    const app = createApp({
      enableRequestLogger: false,
      engine: createEngine("unused"),
    });

    const health = await app.request("/health");
    const version = await app.request("/api/version");

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "alive",
      version: VERSION,
    });
    expect(version.status).toBe(200);
    await expect(version.json()).resolves.toEqual({
      version: VERSION,
    });
  });

  it("registers dashboard root redirect and API scrape route", async () => {
    const engine = createEngine("Extracted content");
    const app = createApp({
      enableRequestLogger: false,
      engine,
    });

    const root = await app.request("/");
    const scrape = await app.request("/api/scrape", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-api-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/dashboard");
    expect(scrape.status).toBe(200);
    await expect(scrape.json()).resolves.toMatchObject({
      success: true,
      data: "Extracted content",
    });
    expect(engine.scrapeUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps app scrape engine state isolated between app creations", async () => {
    const firstEngine = createEngine("first app");
    const secondEngine = createEngine("second app");

    const firstApp = createApp({
      enableRequestLogger: false,
      engine: firstEngine,
    });
    const secondApp = createApp({
      enableRequestLogger: false,
      engine: secondEngine,
    });

    const firstScrape = await firstApp.request("/api/scrape", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-api-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const secondScrape = await secondApp.request(
      "/api/scrape",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://example.com",
        }),
      },
    );

    await expect(firstScrape.json()).resolves.toMatchObject({
      data: "first app",
    });
    await expect(secondScrape.json()).resolves.toMatchObject({
      data: "second app",
    });
    expect(firstEngine.scrapeUrl).toHaveBeenCalledTimes(1);
    expect(secondEngine.scrapeUrl).toHaveBeenCalledTimes(1);
  });
});
