export type CurlFetchFailureReason =
  | "timeout"
  | "http_status"
  | "invalid_proxy"
  | "network_error"
  | "curl_error"
  | "empty_response";

export interface CurlFetchFailure {
  ok: false;
  reason: CurlFetchFailureReason;
  message: string;
  statusCode?: number;
  stderr?: string;
  exitCode?: number;
}

export interface CurlFetchSuccess {
  ok: true;
  html: string;
  statusCode: number;
}

export type CurlFetchResult =
  | CurlFetchSuccess
  | CurlFetchFailure;

export interface CurlFetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  userAgentString?: string;
  proxy?: string | false;
}

export interface CurlFetchPort {
  fetchHtml(
    url: string,
    options?: CurlFetchOptions,
  ): Promise<CurlFetchResult>;
}
