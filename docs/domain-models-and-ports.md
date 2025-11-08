# Domain Models and Ports Specification

Canonical contracts for a full rebuild.

## Core Domain Models

### SiteConfig

Represents learned configuration for a domain.

Fields (minimum set to support current behavior):

- `domainPattern: string`
- `method: MethodValue`
- `xpathMainContent: string`
- `lastSuccessfulScrapeTimestamp?: string` (ISO)
- `failureCountSinceLastSuccess: number`
- `needsCaptchaSolver?: boolean`
- `discoveredByLlm?: boolean`
- `userAgentToUse?: string`
- `siteSpecificHeaders?: Record<string, string>`
- `puppeteerWaitConditions?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
    timeoutMs?: number
  }`
- `captchaCookie?: string`

### ScrapeContext

Internal object passed through the pipeline.

- `targetUrl: string`
- `normalizedDomain: string`
- `siteConfig?: SiteConfig`
- `methodAttempted?: MethodValue`
- `proxyDetails?: { server: string }`
- `userAgentString?: string`
- `debugContextId?: string`

### ElementDetails

Minimal fields needed for scoring and selection.

- `xpath: string`
- `textLength: number`
- `linkDensity: number`
- `paragraphCount: number`
- `headingCount: number`
- `hasMedia: boolean`
- `domDepth: number`
- `semanticScore: number`
- `unwantedTagScore: number`

### LlmXPathSuggestion

- `xpath: string`
- `explanation?: string`

## Primary Ports (Interfaces)

These ports allow the engine to be rebuilt cleanly with dependency inversion.

### NetworkPort

Responsible for HTTP fetches (curl-like).

- `fetch(url, options) -> Promise<{
    ok: boolean,
    status: number,
    finalUrl: string,
    headers: Record<string, string>,
    body: string,
    errorMessage?: string
  }>`

Options include proxy, UA, timeouts, TLS relax.

### BrowserPort

Responsible for dynamic rendering and DOM queries.

- `open(): Promise<void>` (idempotent)
- `close(): Promise<void>`
- `loadPage(url, options) -> Promise<{ pageId: string }>`
- `evaluateXPath(pageId, xpath) -> Promise<ElementDetails | null>`
- `getPageHtml(pageId) -> Promise<string>`
- `detectCaptcha(pageId) -> Promise<'none' | 'generic' | 'datadome'>`

### LlmPort

Responsible for generating XPath candidates.

- `suggestXPaths(input: {
    simplifiedDom: string,
    snippets: string[],
    previousFailureReason?: string
  }): Promise<LlmXPathSuggestion[]>`

### CaptchaPort

Responsible for solving CAPTCHAs.

- `solveIfPresent(input: {
    pageId: string,
    captchaTypeHint?: 'generic' | 'datadome',
    proxyDetails?: { server: string },
    userAgentString?: string
  }): Promise<{
    solved: boolean,
    updatedCookie?: string,
    reason?: string
  }>`

### KnownSitesPort

Responsible for persisting and retrieving SiteConfig.

- `getConfig(domain: string): Promise<SiteConfig | undefined>`
- `saveConfig(config: SiteConfig): Promise<void>`
- `incrementFailure(domain: string): Promise<void>`
- `markSuccess(domain: string): Promise<void>`
- `deleteConfig(domain: string): Promise<void>`

## Engine Collaboration

A rebuilt engine should:

- Depend only on these ports (or close equivalents).
- Treat concrete Axios/Puppeteer/FS/2Captcha integrations as adapters implementing the ports.
- Keep data contracts here stable to avoid breaking downstream users.
