import { execFile } from "node:child_process";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  proxyServer: "",
  parseProxyUrl: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../config.js", () => ({
  getProxyServer: () => mocks.proxyServer,
}));

vi.mock("../utils/proxy.js", () => ({
  parseProxyUrl: mocks.parseProxyUrl,
}));

describe("CurlFetchAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyServer = "";
    mocks.parseProxyUrl.mockReturnValue({
      protocol: "http",
      host: "proxy.example",
      port: 8080,
    });
  });

  it("returns html and status code for successful responses", async () => {
    mockCurlResult(
      null,
      "<html>ok</html>\nSMARTSCRAPER_CURL_STATUS:200",
      "",
    );
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    const result = await new CurlFetchAdapter().fetchHtml(
      "https://example.com/article",
    );

    expect(result).toEqual({
      ok: true,
      html: "<html>ok</html>",
      statusCode: 200,
    });
  });

  it("passes timeout, headers, user-agent, and configured proxy to curl", async () => {
    mocks.proxyServer = "socks5://proxy.example:1080";
    mockCurlResult(
      null,
      "<html>ok</html>\nSMARTSCRAPER_CURL_STATUS:200",
      "",
    );
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    await new CurlFetchAdapter().fetchHtml(
      "https://example.com/article",
      {
        timeoutMs: 1500,
        headers: {
          Accept: "text/html",
          "X-Test": "yes",
        },
        userAgentString: "SmartScraper Test",
      },
    );

    expect(mockedExecFile).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "--max-time",
        "1.5",
        "--user-agent",
        "SmartScraper Test",
        "--header",
        "Accept: text/html",
        "--header",
        "X-Test: yes",
        "--proxy",
        "socks5://proxy.example:1080",
        "https://example.com/article",
      ]),
      expect.objectContaining({ timeout: 2500 }),
      expect.any(Function),
    );
  });

  it("allows disabling configured proxy per request", async () => {
    mocks.proxyServer = "http://proxy.example:8080";
    mockCurlResult(
      null,
      "<html>ok</html>\nSMARTSCRAPER_CURL_STATUS:200",
      "",
    );
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    await new CurlFetchAdapter().fetchHtml(
      "https://example.com/article",
      {
        proxy: false,
      },
    );

    const args = mockedExecFile.mock
      .calls[0][1] as string[];
    expect(args).not.toContain("--proxy");
  });

  it("returns invalid_proxy before invoking curl for malformed proxy config", async () => {
    mocks.proxyServer = "socks5://missing-port";
    mocks.parseProxyUrl.mockReturnValue(null);
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    const result = await new CurlFetchAdapter().fetchHtml(
      "https://example.com/article",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_proxy",
      message: "Invalid proxy configuration",
    });
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("returns structured http_status failures", async () => {
    mockCurlResult(
      null,
      "blocked\nSMARTSCRAPER_CURL_STATUS:403",
      "",
    );
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    const result = await new CurlFetchAdapter().fetchHtml(
      "https://example.com/article",
    );

    expect(result).toEqual({
      ok: false,
      reason: "http_status",
      message: "HTTP request failed with status 403",
      statusCode: 403,
      stderr: "",
    });
  });

  it("returns structured timeout failures", async () => {
    const timeoutError = Object.assign(
      new Error("Command timed out"),
      {
        code: 28,
      },
    );
    mockCurlResult(timeoutError, "", "Operation timed out");
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    const result = await new CurlFetchAdapter().fetchHtml(
      "https://example.com/article",
    );

    expect(result).toEqual({
      ok: false,
      reason: "timeout",
      message: "Curl request timed out",
      stderr: "Operation timed out",
      exitCode: 28,
    });
  });

  it("returns structured network failures", async () => {
    const networkError = Object.assign(
      new Error("curl failed"),
      {
        code: 6,
      },
    );
    mockCurlResult(
      networkError,
      "\nSMARTSCRAPER_CURL_STATUS:000",
      "Could not resolve host",
    );
    const { CurlFetchAdapter } =
      await import("./curl-fetch.js");

    const result = await new CurlFetchAdapter().fetchHtml(
      "https://bad.example",
    );

    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      message: "Could not resolve host",
      statusCode: 0,
      stderr: "Could not resolve host",
      exitCode: 6,
    });
  });
});

const mockedExecFile = vi.mocked(execFile);

function mockCurlResult(
  error: Error | null,
  stdout: string,
  stderr: string,
): void {
  mockedExecFile.mockImplementation(((
    _command: string,
    _args: readonly string[],
    _options: object,
    callback: (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => {
    callback(error, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  }) as typeof execFile);
}
