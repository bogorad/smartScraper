# ADR-008: Domain Models and Port Interfaces

- Status: Accepted
- Date: 2025-12-05

## Context

The engine must be testable and maintainable. Concrete implementations (Puppeteer, Axios, 2Captcha, filesystem) should be swappable without changing core logic.

## Decision

### Primary Port Interfaces

#### BrowserPort

```typescript
interface BrowserPort {
  close(): Promise<void>;
  closePage(pageId: string): Promise<void>;
  loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }>;
  evaluateXPath(pageId: string, xpath: string): Promise<string[] | null>;
  getPageHtml(pageId: string): Promise<string>;
  detectCaptcha(pageId: string): Promise<CaptchaDetectionResult>;
  getElementDetails(pageId: string, xpath: string): Promise<ElementDetails | null>;
  getCookies(pageId: string): Promise<string>;
  setCookies(pageId: string, cookies: string): Promise<void>;
  reload(pageId: string, timeoutMs?: number): Promise<void>;
  injectTurnstileToken(pageId: string, token: string): Promise<void>;
}
```

#### LlmPort

```typescript
interface LlmPort {
  suggestXPaths(input: {
    simplifiedDom: string;
    snippets: string[];
    previousFailureReason?: string;
  }): Promise<LlmXPathSuggestion[]>;
}
```

#### CaptchaPort

```typescript
interface CaptchaPort {
  solveIfPresent(input: {
    pageId: string;
    captchaTypeHint?: 'generic' | 'datadome';
    proxyDetails?: { server: string };
    userAgentString?: string;
  }): Promise<{
    solved: boolean;
    updatedCookie?: string;
    reason?: string;
  }>;
}
```

#### KnownSitesPort

```typescript
interface KnownSitesPort {
  getConfig(domain: string): Promise<SiteConfig | undefined>;
  saveConfig(config: SiteConfig): Promise<void>;
  incrementFailure(domain: string): Promise<void>;
  markSuccess(domain: string): Promise<void>;
  deleteConfig(domain: string): Promise<void>;
}
```

### Core Domain Models

#### ScrapeContext

```typescript
interface ScrapeContext {
  targetUrl: string;
  normalizedDomain: string;
  siteConfig?: SiteConfig;
  methodAttempted?: MethodValue;
  proxyDetails?: { server: string };
  userAgentString?: string;
  debugContextId?: string;
}
```

#### ElementDetails

```typescript
interface ElementDetails {
  xpath: string;
  textLength: number;
  linkDensity: number;
  paragraphCount: number;
  headingCount: number;
  hasMedia: boolean;
  domDepth: number;
  semanticScore: number;
  unwantedTagScore: number;
}
```

## Consequences

- Engine depends only on port interfaces
- Concrete adapters implement ports (Puppeteer, OpenRouter, 2Captcha, FS)
- Full testability via mock/fake implementations
- Contracts must remain stable to avoid breaking changes
