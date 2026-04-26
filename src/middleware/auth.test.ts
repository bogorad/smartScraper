import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from "vitest";
import { Hono } from "hono";
import {
  apiAuthMiddleware,
  dashboardAuthMiddleware,
  createSession,
  validateToken,
} from "./auth.js";

const configMock = vi.hoisted(() => ({
  apiToken: "test-token" as string | null,
  nodeEnv: "test",
  trustProxyHeaders: false,
}));

vi.mock("../config.js", () => ({
  getApiToken: () => configMock.apiToken,
  getNodeEnv: () => configMock.nodeEnv,
  getTrustProxyHeaders: () => configMock.trustProxyHeaders,
  getLogLevel: () => "NONE",
}));

function readCookie(
  setCookie: string | null,
  name: string,
): string {
  if (!setCookie) {
    throw new Error(
      `Missing Set-Cookie header for ${name}`,
    );
  }

  const match = setCookie.match(
    new RegExp(`${name}=([^;]+)`),
  );
  if (!match) {
    throw new Error(`Missing ${name} cookie`);
  }

  return `${name}=${match[1]}`;
}

describe("auth middleware", () => {
  beforeEach(() => {
    configMock.apiToken = "test-token";
    configMock.nodeEnv = "test";
    configMock.trustProxyHeaders = false;
  });

  describe("apiAuthMiddleware", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use("/*", apiAuthMiddleware);
      app.get("/test", (c) =>
        c.json({ message: "success" }),
      );
    });

    it("should allow requests with valid bearer token", async () => {
      const req = new Request("http://localhost/test", {
        headers: {
          Authorization: "Bearer test-token",
        },
      });

      const res = await app.request(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe("success");
    });

    it("should reject requests without authorization header", async () => {
      const req = new Request("http://localhost/test");

      const res = await app.request(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("should reject requests with invalid token", async () => {
      const req = new Request("http://localhost/test", {
        headers: {
          Authorization: "Bearer wrong-token",
        },
      });

      const res = await app.request(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("should reject requests with invalid token lengths", async () => {
      const req = new Request("http://localhost/test", {
        headers: {
          Authorization: "Bearer test-token-extra",
        },
      });

      const res = await app.request(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("should handle authorization header without Bearer prefix", async () => {
      const req = new Request("http://localhost/test", {
        headers: {
          Authorization: "test-token",
        },
      });

      const res = await app.request(req);

      expect(res.status).toBeGreaterThanOrEqual(200);
    });

    it("should handle empty authorization header", async () => {
      const req = new Request("http://localhost/test", {
        headers: {
          Authorization: "",
        },
      });

      const res = await app.request(req);

      expect(res.status).toBe(401);
    });

    it("should fail closed when API token is not configured", async () => {
      configMock.apiToken = null;
      const req = new Request("http://localhost/test", {
        headers: {
          Authorization: "Bearer test-token",
        },
      });

      const res = await app.request(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("API token not configured");
    });
  });

  describe("dashboardAuthMiddleware", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use("/dashboard/*", dashboardAuthMiddleware);
      app.get("/dashboard/test", (c) =>
        c.text("Dashboard content"),
      );
    });

    it("should redirect to login when session cookie is missing", async () => {
      const req = new Request(
        "http://localhost/dashboard/test",
      );

      const res = await app.request(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain(
        "/login",
      );
    });

    it("should redirect to login when session cookie is invalid", async () => {
      const req = new Request(
        "http://localhost/dashboard/test",
        {
          headers: {
            Cookie: "ss_session=invalid-hash",
          },
        },
      );

      const res = await app.request(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain(
        "/login",
      );
    });

    it("should allow requests with valid session cookie", async () => {
      const sessionApp = new Hono();
      sessionApp.post("/login", (c) => {
        createSession(c, "test-token");
        return c.text("OK");
      });

      const sessionRes = await sessionApp.request(
        "http://localhost/login",
        { method: "POST" },
      );
      const sessionCookie = readCookie(
        sessionRes.headers.get("Set-Cookie"),
        "ss_session",
      );
      const req = new Request(
        "http://localhost/dashboard/test",
        {
          headers: {
            Cookie: sessionCookie,
          },
        },
      );

      const res = await app.request(req);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Dashboard content");
    });

    it("should redirect to login when session cookie length is invalid", async () => {
      const req = new Request(
        "http://localhost/dashboard/test",
        {
          headers: {
            Cookie: `ss_session=${"a".repeat(65)}`,
          },
        },
      );

      const res = await app.request(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain(
        "/login",
      );
    });

    it("should preserve redirect path in query parameter", async () => {
      const req = new Request(
        "http://localhost/dashboard/test",
      );

      const res = await app.request(req);

      expect(res.status).toBe(302);
      const location = res.headers.get("Location");
      expect(location).toContain("redirect=");
      expect(location).toContain(
        encodeURIComponent("/dashboard/test"),
      );
    });

    it("should redirect to config error when API token is not configured", async () => {
      configMock.apiToken = null;
      const req = new Request(
        "http://localhost/dashboard/test",
        {
          headers: {
            Cookie: "ss_session=some-session",
          },
        },
      );

      const res = await app.request(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?error=config",
      );
    });
  });

  describe("validateToken", () => {
    it("should return true for valid token", () => {
      expect(validateToken("test-token")).toBe(true);
    });

    it("should return false for invalid token", () => {
      expect(validateToken("wrong-token")).toBe(false);
    });

    it("should return false for empty token", () => {
      expect(validateToken("")).toBe(false);
    });

    it("should return false when API token is not configured", () => {
      configMock.apiToken = null;

      expect(validateToken("test-token")).toBe(false);
    });
  });

  describe("createSession", () => {
    it("should set session cookie", async () => {
      const testApp = new Hono();
      testApp.post("/login", (c) => {
        createSession(c, "test-token");
        return c.text("OK");
      });

      const req = new Request("http://localhost/login", {
        method: "POST",
      });
      const res = await testApp.request(req);

      expect(res.headers.get("Set-Cookie")).toContain(
        "ss_session=",
      );
    });

    it("should not set session cookie when API token is not configured", async () => {
      configMock.apiToken = null;
      const testApp = new Hono();
      testApp.post("/login", (c) => {
        const created = createSession(c, "test-token");
        return c.text(created ? "OK" : "NO");
      });

      const req = new Request("http://localhost/login", {
        method: "POST",
      });
      const res = await testApp.request(req);

      expect(await res.text()).toBe("NO");
      expect(
        res.headers.get("Set-Cookie") || "",
      ).not.toContain("ss_session=");
    });

    it("does not mark production localhost sessions as Secure", async () => {
      configMock.nodeEnv = "production";
      const testApp = new Hono();
      testApp.post("/login", (c) => {
        createSession(c, "test-token");
        return c.text("OK");
      });

      const req = new Request("http://localhost/login", {
        method: "POST",
      });
      const res = await testApp.request(req);

      expect(res.headers.get("Set-Cookie")).toContain(
        "ss_session=",
      );
      expect(res.headers.get("Set-Cookie")).not.toContain(
        "Secure",
      );
    });

    it("marks trusted HTTPS reverse-proxy sessions as Secure", async () => {
      configMock.nodeEnv = "production";
      configMock.trustProxyHeaders = true;
      const testApp = new Hono();
      testApp.post("/login", (c) => {
        createSession(c, "test-token");
        return c.text("OK");
      });

      const req = new Request("http://localhost/login", {
        method: "POST",
        headers: {
          "X-Forwarded-Proto": "https",
        },
      });
      const res = await testApp.request(req);

      expect(res.headers.get("Set-Cookie")).toContain(
        "ss_session=",
      );
      expect(res.headers.get("Set-Cookie")).toContain(
        "Secure",
      );
    });

    it("does not mark local development sessions as Secure", async () => {
      configMock.nodeEnv = "development";
      configMock.trustProxyHeaders = true;
      const testApp = new Hono();
      testApp.post("/login", (c) => {
        createSession(c, "test-token");
        return c.text("OK");
      });

      const req = new Request("http://localhost/login", {
        method: "POST",
        headers: {
          "X-Forwarded-Proto": "https",
        },
      });
      const res = await testApp.request(req);

      expect(res.headers.get("Set-Cookie")).toContain(
        "ss_session=",
      );
      expect(res.headers.get("Set-Cookie")).not.toContain(
        "Secure",
      );
    });
  });
});
