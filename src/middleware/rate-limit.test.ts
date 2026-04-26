import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from "vitest";
import { Hono } from "hono";
import {
  rateLimitMiddleware,
  rateLimitTestUtils,
} from "./rate-limit.js";
import { logger } from "../utils/logger.js";

vi.mock("../utils/logger.js", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

function createTestApp(maxRequests = 1) {
  const app = new Hono();
  app.use(
    "/*",
    rateLimitMiddleware({ maxRequests, windowMs: 60000 }),
  );
  app.get("/test", (c) => c.text("OK"));
  return app;
}

describe("rateLimitMiddleware", () => {
  beforeEach(() => {
    rateLimitTestUtils.clearStore();
    vi.mocked(logger.warn).mockClear();
  });

  it("rate limits per bearer token without storing or logging the raw token", async () => {
    const app = createTestApp();
    const token = "secret-token-value";

    const firstResponse = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const secondResponse = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);

    const storeKeys = rateLimitTestUtils.getStoreKeys();
    expect(storeKeys).toHaveLength(1);
    expect(storeKeys[0]).not.toContain(token);
    expect(storeKeys[0]).not.toContain("secret-token");

    expect(logger.warn).toHaveBeenCalledOnce();
    const logData = vi.mocked(logger.warn).mock
      .calls[0]?.[1] as { identifier: string };
    expect(logData.identifier).toMatch(
      /^auth:[a-f0-9]{64}$/,
    );
    expect(logData.identifier).not.toContain(token);
    expect(logData.identifier).not.toContain(
      "secret-token",
    );
  });

  it("keeps separate rate limits for different bearer tokens", async () => {
    const app = createTestApp();

    const firstTokenResponse = await app.request("/test", {
      headers: { Authorization: "Bearer token-a" },
    });
    const secondTokenResponse = await app.request("/test", {
      headers: { Authorization: "Bearer token-b" },
    });
    const repeatedFirstTokenResponse = await app.request(
      "/test",
      {
        headers: { Authorization: "Bearer token-a" },
      },
    );

    expect(firstTokenResponse.status).toBe(200);
    expect(secondTokenResponse.status).toBe(200);
    expect(repeatedFirstTokenResponse.status).toBe(429);
  });

  it("uses the first x-forwarded-for address without storing or logging it raw", async () => {
    const app = createTestApp();
    const clientIp = "203.0.113.10";

    const firstResponse = await app.request("/test", {
      headers: {
        "x-forwarded-for": `${clientIp}, 10.0.0.2`,
      },
    });
    const secondResponse = await app.request("/test", {
      headers: {
        "x-forwarded-for": `${clientIp}, 10.0.0.3`,
      },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);

    const storeKeys = rateLimitTestUtils.getStoreKeys();
    expect(storeKeys).toHaveLength(1);
    expect(storeKeys[0]).not.toContain(clientIp);

    const logData = vi.mocked(logger.warn).mock
      .calls[0]?.[1] as { identifier: string };
    expect(logData.identifier).toMatch(/^ip:[a-f0-9]{64}$/);
    expect(logData.identifier).not.toContain(clientIp);
  });
});
