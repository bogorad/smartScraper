export interface SimpleFetchOptions {
  timeoutMs?: number;
  userAgentString?: string;
}

export interface SimpleFetchPort {
  fetchHtml(
    url: string,
    options?: SimpleFetchOptions,
  ): Promise<string>;
}
