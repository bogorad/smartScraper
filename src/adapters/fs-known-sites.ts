import fs from "fs/promises";
import path from "path";
import PQueue from "p-queue";
import { parse, stringify } from "comment-json";
import { randomUUID } from "crypto";
import type { KnownSitesPort } from "../ports/known-sites.js";
import type {
  SiteConfig,
  SiteConfigCaptcha,
  SiteConfigMethod,
  SiteConfigProxy,
} from "../domain/models.js";
import { utcNow } from "../utils/date.js";
import { getDataDir } from "../config.js";
import { logger } from "../utils/logger.js";

const SITE_CONFIG_METHODS = new Set<SiteConfigMethod>([
  "curl",
  "chrome",
]);
const SITE_CONFIG_CAPTCHAS = new Set<SiteConfigCaptcha>([
  "none",
  "datadome",
  "recaptcha",
  "turnstile",
  "hcaptcha",
  "unsupported",
]);
const SITE_CONFIG_PROXIES = new Set<SiteConfigProxy>([
  "none",
  "default",
  "datadome",
]);

function getSitesFile(): string {
  return path.join(getDataDir(), "sites.jsonc");
}

function getTempFile(targetFile: string): string {
  return `${targetFile}.${process.pid}-${Date.now()}-${randomUUID()}.tmp`;
}

function normalizeKnownSiteDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function domainMatchesConfig(domain: string, configDomain: string): boolean {
  return domain === configDomain || domain.endsWith(`.${configDomain}`);
}

function normalizeSiteConfigMethod(
  method: unknown,
): SiteConfigMethod | undefined {
  if (method === undefined) return undefined;
  if (
    typeof method === "string" &&
    SITE_CONFIG_METHODS.has(method as SiteConfigMethod)
  ) {
    return method as SiteConfigMethod;
  }
  throw new Error(`invalid site method: ${String(method)}`);
}

function normalizeSiteConfigCaptcha(
  captcha: unknown,
): SiteConfigCaptcha | undefined {
  if (captcha === undefined) return undefined;
  if (captcha === "generic" || captcha === "cloudflare") {
    return "unsupported";
  }
  if (
    typeof captcha === "string" &&
    SITE_CONFIG_CAPTCHAS.has(captcha as SiteConfigCaptcha)
  ) {
    return captcha as SiteConfigCaptcha;
  }
  throw new Error(`invalid site captcha: ${String(captcha)}`);
}

function normalizeSiteConfigProxy(
  proxy: unknown,
  needsProxy: unknown,
): SiteConfigProxy | undefined {
  const proxyValue =
    proxy === undefined && needsProxy === "off"
      ? "none"
      : proxy === undefined && needsProxy === "datadome"
        ? "datadome"
        : proxy;
  if (proxyValue === undefined) return undefined;
  if (
    typeof proxyValue === "string" &&
    SITE_CONFIG_PROXIES.has(proxyValue as SiteConfigProxy)
  ) {
    return proxyValue as SiteConfigProxy;
  }
  throw new Error(`invalid site proxy: ${String(proxyValue)}`);
}

function normalizeSiteConfig(config: SiteConfig): SiteConfig {
  const raw = config as SiteConfig & {
    method?: unknown;
    captcha?: unknown;
    proxy?: unknown;
    needsProxy?: unknown;
  };
  const normalized: SiteConfig = {
    ...config,
  };
  const method = normalizeSiteConfigMethod(raw.method);
  const captcha = normalizeSiteConfigCaptcha(raw.captcha);
  const proxy = normalizeSiteConfigProxy(raw.proxy, raw.needsProxy);

  if (method) normalized.method = method;
  if (captcha) normalized.captcha = captcha;
  if (proxy) {
    normalized.proxy = proxy;
    normalized.needsProxy = proxy === "datadome" ? "datadome" : "off";
  }

  return normalized;
}

function findMatchingConfig(
  configs: SiteConfig[],
  domain: string,
): SiteConfig | undefined {
  const normalizedDomain = normalizeKnownSiteDomain(domain);
  return configs
    .filter((config) =>
      domainMatchesConfig(
        normalizedDomain,
        normalizeKnownSiteDomain(config.domainPattern),
      ),
    )
    .sort(
      (a, b) =>
        normalizeKnownSiteDomain(b.domainPattern).length -
        normalizeKnownSiteDomain(a.domainPattern).length,
    )[0];
}

async function quarantineCorruptSitesFile(
  sitesFile: string,
  error: unknown,
): Promise<void> {
  const corruptFile = `${sitesFile}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.rename(sitesFile, corruptFile);
  await fs.writeFile(sitesFile, "[]");
  logger.warn("[SITES] Recovered from corrupt sites file", {
    file: sitesFile,
    corruptFile,
    error:
      error instanceof Error
        ? error.message
        : String(error),
  });
}

export class FsKnownSitesAdapter implements KnownSitesPort {
  private cache: SiteConfig[] | null = null;
  private cacheSignature: string | null = null;
  private writeQueue = new PQueue({ concurrency: 1 });

  private async ensureFile(): Promise<void> {
    const sitesFile = getSitesFile();
    try {
      await fs.access(sitesFile);
    } catch {
      await fs.mkdir(getDataDir(), { recursive: true });
      await fs.writeFile(sitesFile, "[]");
    }
  }

  private async load(): Promise<SiteConfig[]> {
    await this.ensureFile();
    const sitesFile = getSitesFile();
    const stat = await fs.stat(sitesFile);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (this.cache && this.cacheSignature === signature) {
      return [...this.cache]; // Return copy to prevent external mutation
    }
    const content = await fs.readFile(sitesFile, "utf-8");
    try {
      const parsed = parse(content) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("sites file must contain an array");
      }
      this.cache = (parsed as SiteConfig[]).map(normalizeSiteConfig);
      this.cacheSignature = signature;
    } catch (error) {
      await quarantineCorruptSitesFile(
        sitesFile,
        error,
      );
      this.cache = [];
      const recoveredStat = await fs.stat(sitesFile);
      this.cacheSignature = `${recoveredStat.mtimeMs}:${recoveredStat.size}`;
    }
    logger.debug(
      `[SITES] Loaded ${this.cache.length} site configs`,
    );
    return [...this.cache];
  }

  private async flush(
    configs: SiteConfig[],
  ): Promise<void> {
    await this.ensureFile();
    const sitesFile = getSitesFile();
    const tempFile = getTempFile(sitesFile);
    const content = stringify(configs, null, 2);
    await fs.writeFile(tempFile, content);
    await fs.rename(tempFile, sitesFile);
    this.cache = configs; // Update cache only after successful write
    const stat = await fs.stat(sitesFile);
    this.cacheSignature = `${stat.mtimeMs}:${stat.size}`;
  }

  // Reads use cache directly - no queue needed
  async getConfig(
    domain: string,
  ): Promise<SiteConfig | undefined> {
    const configs = await this.load();
    return findMatchingConfig(configs, domain);
  }

  // Writes go through queue for serialization
  async saveConfig(config: SiteConfig): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const normalizedConfig = {
        ...normalizeSiteConfig(config),
        domainPattern: normalizeKnownSiteDomain(
          config.domainPattern,
        ),
      };
      const index = configs.findIndex(
        (c) =>
          normalizeKnownSiteDomain(c.domainPattern) ===
          normalizedConfig.domainPattern,
      );

      if (index >= 0) {
        configs[index] = normalizedConfig;
      } else {
        configs.push(normalizedConfig);
      }

      await this.flush(configs);
    });
  }

  async incrementFailure(domain: string): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const config = findMatchingConfig(configs, domain);

      if (config) {
        config.failureCountSinceLastSuccess++;
        await this.flush(configs);
      }
    });
  }

  async markSuccess(domain: string): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const config = findMatchingConfig(configs, domain);

      if (config) {
        config.failureCountSinceLastSuccess = 0;
        config.lastSuccessfulScrapeTimestamp = utcNow();
        await this.flush(configs);
      }
    });
  }

  async deleteConfig(domain: string): Promise<void> {
    return this.writeQueue.add(async () => {
      const configs = await this.load();
      const normalizedDomain = normalizeKnownSiteDomain(domain);
      const filtered = configs.filter(
        (c) =>
          normalizeKnownSiteDomain(c.domainPattern) !==
          normalizedDomain,
      );
      await this.flush(filtered);
    });
  }

  // Reads use cache directly
  async getAllConfigs(): Promise<SiteConfig[]> {
    return await this.load();
  }
}

export const knownSitesAdapter = new FsKnownSitesAdapter();
