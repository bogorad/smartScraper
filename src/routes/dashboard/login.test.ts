import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Hono } from "hono";
import { loginRouter } from "./login.js";
import * as auth from "../../middleware/auth.js";

const configMock = vi.hoisted(() => ({
  apiToken: "test-token" as string | null,
  trustProxyHeaders: false,
}));

vi.mock("../../config.js", () => ({
  getApiToken: () => configMock.apiToken,
  getDataDir: () => "/tmp/smart-scraper-test",
  getLogLevel: () => "NONE",
  getNodeEnv: () => "test",
  getTrustProxyHeaders: () => configMock.trustProxyHeaders,
  isDebugMode: () => false,
}));

vi.mock("../../middleware/auth.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../middleware/auth.js")>();
  return {
    ...actual,
    validateToken: vi.fn(actual.validateToken),
  };
});

function createLoginApp(): Hono {
  const app = new Hono();
  app.route("/login", loginRouter);
  return app;
}

function readCookie(
  setCookie: string | null,
  name: string,
): string {
  if (!setCookie) {
    throw new Error(
      `Missing Set-Cookie header for ${name}`,
    );
  }

  const matches = Array.from(
    setCookie.matchAll(new RegExp(`${name}=([^;]+)`, "g")),
  );
  if (matches.length === 0) {
    throw new Error(`Missing ${name} cookie`);
  }

  return `${name}=${matches[matches.length - 1][1]}`;
}

async function getLoginCsrf(app: Hono): Promise<{
  csrfCookie: string;
  csrfToken: string;
  html: string;
}> {
  const res = await app.request(
    "/login?redirect=%2Fdashboard%2Fsites",
  );
  const html = await res.text();
  const csrfCookie = readCookie(
    res.headers.get("Set-Cookie"),
    "csrf_token",
  );
  const csrfToken = csrfCookie.split("=")[1];

  return { csrfCookie, csrfToken, html };
}

function loginRequest(
  redirect: string,
  csrfCookie: string,
  csrfToken: string,
  token = "test-token",
): Request {
  const body = new URLSearchParams({
    token,
    _csrf: csrfToken,
  });
  return new Request(
    `http://localhost/login?redirect=${encodeURIComponent(redirect)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: csrfCookie,
      },
      body,
    },
  );
}

function rawLoginRequest(
  redirect: string,
  csrfCookie: string,
  csrfToken: string,
  body: BodyInit,
  contentType?: string,
): Request {
  const headers = new Headers({
    Cookie: csrfCookie,
    "X-CSRF-Token": csrfToken,
  });
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return new Request(
    `http://localhost/login?redirect=${encodeURIComponent(redirect)}`,
    {
      method: "POST",
      headers,
      body,
    },
  );
}

function expectInvalidLoginRedirect(res: Response): void {
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe(
    "/login?error=invalid&redirect=%2Fdashboard%2Fsites",
  );
  expect(res.headers.get("Set-Cookie") || "").not.toContain(
    "ss_session=",
  );
}

describe("loginRouter", () => {
  beforeEach(() => {
    configMock.apiToken = "test-token";
    configMock.trustProxyHeaders = false;
    vi.mocked(auth.validateToken).mockClear();
  });

  it("emits a CSRF token on GET", async () => {
    const app = createLoginApp();

    const { csrfToken, html } = await getLoginCsrf(app);

    expect(html).toContain('name="_csrf"');
    expect(html).toContain(`value="${csrfToken}"`);
  });

  it("rejects login POSTs without a CSRF token", async () => {
    const app = createLoginApp();
    const body = new URLSearchParams({
      token: "test-token",
    });

    const res = await app.request(
      "/login?redirect=%2Fdashboard%2Fsites",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    expect(res.status).toBe(403);
  });

  it("rejects login POSTs with a stale CSRF token", async () => {
    const app = createLoginApp();
    const { csrfCookie } = await getLoginCsrf(app);
    const body = new URLSearchParams({
      token: "test-token",
      _csrf: "stale-token",
    });

    const res = await app.request(
      "/login?redirect=%2Fdashboard%2Fsites",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
          Cookie: csrfCookie,
        },
        body,
      },
    );

    expect(res.status).toBe(403);
  });

  it("redirects valid logins to local dashboard paths", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);

    const res = await app.request(
      loginRequest(
        "/dashboard/sites?filter=active",
        csrfCookie,
        csrfToken,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/dashboard/sites?filter=active",
    );
  });

  it("normalizes external absolute redirects after valid login", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);

    const res = await app.request(
      loginRequest(
        "https://evil.example/phish",
        csrfCookie,
        csrfToken,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("normalizes protocol-relative redirects after valid login", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);

    const res = await app.request(
      loginRequest(
        "//evil.example/phish",
        csrfCookie,
        csrfToken,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  it("does not preserve external redirects after invalid login", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);

    const res = await app.request(
      loginRequest(
        "https://evil.example/phish",
        csrfCookie,
        csrfToken,
        "wrong-token",
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/login?error=invalid&redirect=%2Fdashboard",
    );
  });

  it("treats missing token values as invalid login attempts", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);
    const body = new URLSearchParams({
      _csrf: csrfToken,
    });

    const res = await app.request(
      rawLoginRequest(
        "/dashboard/sites",
        csrfCookie,
        csrfToken,
        body,
        "application/x-www-form-urlencoded",
      ),
    );

    expectInvalidLoginRedirect(res);
    expect(auth.validateToken).not.toHaveBeenCalled();
  });

  it("treats array-style token values as invalid login attempts", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);
    const body = new URLSearchParams({
      "token[]": "test-token",
      _csrf: csrfToken,
    });

    const res = await app.request(
      rawLoginRequest(
        "/dashboard/sites",
        csrfCookie,
        csrfToken,
        body,
        "application/x-www-form-urlencoded",
      ),
    );

    expectInvalidLoginRedirect(res);
    expect(auth.validateToken).not.toHaveBeenCalled();
  });

  it("treats file token values as invalid login attempts", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);
    const body = new FormData();
    body.append(
      "token",
      new File(["test-token"], "token.txt", {
        type: "text/plain",
      }),
    );

    const res = await app.request(
      rawLoginRequest(
        "/dashboard/sites",
        csrfCookie,
        csrfToken,
        body,
      ),
    );

    expectInvalidLoginRedirect(res);
    expect(auth.validateToken).not.toHaveBeenCalled();
  });

  it("treats malformed form bodies as invalid login attempts", async () => {
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);

    const res = await app.request(
      rawLoginRequest(
        "/dashboard/sites",
        csrfCookie,
        csrfToken,
        "--not-the-configured-boundary",
        "multipart/form-data; boundary=configured-boundary",
      ),
    );

    expectInvalidLoginRedirect(res);
    expect(auth.validateToken).not.toHaveBeenCalled();
  });

  it("fails closed without creating a session when API_TOKEN is missing", async () => {
    configMock.apiToken = null;
    const app = createLoginApp();
    const { csrfCookie, csrfToken } =
      await getLoginCsrf(app);

    const res = await app.request(
      loginRequest(
        "/dashboard/sites",
        csrfCookie,
        csrfToken,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/login?error=config&redirect=%2Fdashboard%2Fsites",
    );
    expect(
      res.headers.get("Set-Cookie") || "",
    ).not.toContain("ss_session=");
  });
});
