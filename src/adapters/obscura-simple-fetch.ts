import { execFile } from "child_process";
import { promisify } from "util";

import { DEFAULTS } from "../constants.js";
import type {
  SimpleFetchOptions,
  SimpleFetchPort,
} from "../ports/simple-fetch.js";

const execFileAsync = promisify(execFile);
const MAX_HTML_BUFFER_BYTES = 20 * 1024 * 1024;

export class ObscuraSimpleFetchAdapter implements SimpleFetchPort {
  async fetchHtml(
    url: string,
    options?: SimpleFetchOptions,
  ): Promise<string> {
    const args = [
      "fetch",
      url,
      "--dump",
      "html",
      "--wait-until",
      "load",
      "--quiet",
    ];

    if (options?.userAgentString) {
      args.push("--user-agent", options.userAgentString);
    }

    try {
      const { stdout } = await execFileAsync(
        "obscura",
        args,
        {
          timeout:
            options?.timeoutMs ?? DEFAULTS.TIMEOUT_MS,
          maxBuffer: MAX_HTML_BUFFER_BYTES,
        },
      );

      return stdout;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      throw new Error(`Obscura fetch failed: ${message}`);
    }
  }
}
