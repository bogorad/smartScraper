# ADR-005: CAPTCHA and DataDome Integration

- Status: Accepted
- Date: 2025-12-05

## Context

Many target sites use CAPTCHAs and anti-bot services (especially DataDome). The system must detect, classify, and solve these challenges to access protected content.

## Decision

### CAPTCHA Detection

Detection via HTML markers:
- DataDome iframes from `captcha-delivery.com` or `geo.captcha-delivery.com`
- Unsupported challenge elements (reCAPTCHA, hCaptcha, Turnstile)

Classification result: `'none' | 'datadome' | 'recaptcha' | 'turnstile' | 'hcaptcha' | 'unsupported'`

### Unsupported CAPTCHA Families

reCAPTCHA, hCaptcha, and Turnstile are detected but not solved in the current
runtime strategy. The scraper returns explicit unsupported CAPTCHA results for
those families instead of falling through to a generic extraction failure.

### 2Captcha: DataDome (DataDomeSliderTask)

**Endpoints:**
- Create: `https://api.2captcha.com/createTask`
- Result: `https://api.2captcha.com/getTaskResult`

**CreateTask:**
```json
{
  "clientKey": "TWOCAPTCHA_API_KEY",
  "task": {
    "type": "DataDomeSliderTask",
    "websiteURL": "main page URL",
    "captchaUrl": "DataDome iframe URL",
    "userAgent": "UA used for page load",
    "proxyType": "http",
    "proxyAddress": "proxy host",
    "proxyPort": 2334,
    "proxyLogin": "proxy user",
    "proxyPassword": "proxy password"
  }
}
```

**GetTaskResult:**
```json
{
  "clientKey": "TWOCAPTCHA_API_KEY",
  "taskId": "from createTask"
}
```

**Success Response:**
- `status: "ready"`
- `solution.cookie` contains DataDome cookie string

### Banned IP Detection

DataDome URL parameter `t=bv` indicates IP is banned. On detection:
- Skip CAPTCHA solve attempt
- Recommend proxy rotation

### DataDome Proxy Requirements

DataDome solving requires a DataDome-compatible proxy from
`DATADOME_PROXY_HOST`, `DATADOME_PROXY_LOGIN`, and
`DATADOME_PROXY_PASSWORD`. The normal default proxy
(`DEFAULT_SOCKS5_PROXY` or `default_socks5_proxy`) is for regular page loads
and is not passed to 2Captcha DataDome tasks.

If 2Captcha reports a proxy error such as `ERROR_BAD_PROXY`, the adapter returns
a DataDome solver proxy configuration failure instead of a generic failure.

### Optimal Flow

1. Check HTTP response for CAPTCHA indicators
2. If DataDome detected early: skip stealth, go directly to CAPTCHA solving
3. If no CAPTCHA: proceed with normal flow
4. On solve success: set cookie, reload page, verify bypass

## Consequences

- Encapsulated CAPTCHA complexity
- Tight coupling to 2Captcha service
- Requires robust timeout/retry handling
- Must handle banned IP scenarios gracefully
