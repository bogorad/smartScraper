import { execFile } from "node:child_process";
import type {
  CurlFetchOptions,
  CurlFetchPort,
  CurlFetchResult,
} from "../ports/curl-fetch.js";
import { getProxyServer } from "../config.js";
import { parseProxyUrl } from "../utils/proxy.js";

const DEFAULT_TIMEOUT_MS = 30000;
const STATUS_MARKER = "SMARTSCRAPER_CURL_STATUS:";

interface ExecFileError extends Error {
  code?: number | string;
  signal?: NodeJS.Signals;
  killed?: boolean;
}

export class CurlFetchAdapter implements CurlFetchPort {
  async fetchHtml(
    url: string,
    options: CurlFetchOptions = {},
  ): Promise<CurlFetchResult> {
    const timeoutMs =
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const proxy =
      options.proxy === undefined
        ? getProxyServer()
        : options.proxy;

    if (proxy && !parseProxyUrl(proxy)) {
      return {
        ok: false,
        reason: "invalid_proxy",
        message: "Invalid proxy configuration",
      };
    }

    const args = buildCurlArgs(
      url,
      options,
      timeoutMs,
      proxy || undefined,
    );

    return new Promise((resolve) => {
      execFile(
        "curl",
        args,
        {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          timeout: timeoutMs + 1000,
        },
        (error, stdout, stderr) => {
          resolve(
            toCurlFetchResult(
              error as ExecFileError | null,
              stdout,
              stderr,
            ),
          );
        },
      );
    });
  }
}

function buildCurlArgs(
  url: string,
  options: CurlFetchOptions,
  timeoutMs: number,
  proxy?: string,
): string[] {
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    secondsForCurl(timeoutMs),
    "--write-out",
    `\n${STATUS_MARKER}%{http_code}`,
    url,
  ];

  if (options.userAgentString) {
    args.splice(
      args.length - 1,
      0,
      "--user-agent",
      options.userAgentString,
    );
  }

  for (const [name, value] of Object.entries(
    options.headers ?? {},
  )) {
    args.splice(
      args.length - 1,
      0,
      "--header",
      `${name}: ${value}`,
    );
  }

  if (proxy) {
    args.splice(args.length - 1, 0, "--proxy", proxy);
  }

  return args;
}

function secondsForCurl(timeoutMs: number): string {
  return Math.max(timeoutMs / 1000, 0.001).toString();
}

function toCurlFetchResult(
  error: ExecFileError | null,
  stdout: string,
  stderr: string,
): CurlFetchResult {
  const parsed = parseCurlStdout(stdout);

  if (error) {
    if (
      error.killed ||
      error.signal === "SIGTERM" ||
      error.code === 28
    ) {
      return {
        ok: false,
        reason: "timeout",
        message: "Curl request timed out",
        stderr,
        exitCode:
          typeof error.code === "number"
            ? error.code
            : undefined,
      };
    }

    return {
      ok: false,
      reason: classifyCurlError(error, stderr),
      message: stderr.trim() || error.message,
      statusCode: parsed.statusCode,
      stderr,
      exitCode:
        typeof error.code === "number"
          ? error.code
          : undefined,
    };
  }

  if (!parsed.statusCode) {
    return {
      ok: false,
      reason: "empty_response",
      message:
        "Curl response did not include an HTTP status code",
      stderr,
    };
  }

  if (parsed.statusCode >= 400) {
    return {
      ok: false,
      reason: "http_status",
      message: `HTTP request failed with status ${parsed.statusCode}`,
      statusCode: parsed.statusCode,
      stderr,
    };
  }

  if (!parsed.body) {
    return {
      ok: false,
      reason: "empty_response",
      message: "Curl response body was empty",
      statusCode: parsed.statusCode,
      stderr,
    };
  }

  return {
    ok: true,
    html: parsed.body,
    statusCode: parsed.statusCode,
  };
}

function parseCurlStdout(stdout: string): {
  body: string;
  statusCode?: number;
} {
  const markerIndex = stdout.lastIndexOf(
    `\n${STATUS_MARKER}`,
  );
  if (markerIndex === -1) {
    return { body: stdout };
  }

  const statusText = stdout
    .slice(markerIndex + STATUS_MARKER.length + 1)
    .trim();
  const statusCode = Number.parseInt(statusText, 10);

  return {
    body: stdout.slice(0, markerIndex),
    statusCode: Number.isFinite(statusCode)
      ? statusCode
      : undefined,
  };
}

function classifyCurlError(
  error: ExecFileError,
  stderr: string,
): "network_error" | "curl_error" {
  if (
    typeof error.code === "number" &&
    [5, 6, 7, 35, 52, 56].includes(error.code)
  ) {
    return "network_error";
  }

  if (
    /could not resolve|failed to connect|connection refused|network/i.test(
      stderr,
    )
  ) {
    return "network_error";
  }

  return "curl_error";
}
