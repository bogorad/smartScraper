import { describe, expect, it, vi } from "vitest";

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
  getDefaultEngine: () => ({
    scrapeUrl: vi.fn().mockResolvedValue({
      success: true,
      method: "chrome",
      xpath: "//article",
      data: "Extracted content",
    }),
  }),
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
  it("builds health and version routes without starting a server", async () => {
    const { createApp } = await import("./app.js");
    const app = createApp({ enableRequestLogger: false });

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
    const { createApp } = await import("./app.js");
    const app = createApp({ enableRequestLogger: false });

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
  });
});
