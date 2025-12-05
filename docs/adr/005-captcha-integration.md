# ADR-005: CAPTCHA and DataDome Integration

- Status: Accepted
- Date: 2025-12-05

## Context

Many target sites use CAPTCHAs and anti-bot services (especially DataDome). The system must detect, classify, and solve these challenges to access protected content.

## Decision

### CAPTCHA Detection

Detection via HTML markers:
- DataDome iframes from `captcha-delivery.com` or `geo.captcha-delivery.com`
- Generic CAPTCHA elements (reCAPTCHA, hCaptcha, Turnstile)

Classification result: `'none' | 'generic' | 'datadome'`

### 2Captcha: Generic CAPTCHAs

**Environment Variables:**
- `CAPTCHA_SERVICE_NAME` (expected: `2captcha`)
- `TWOCAPTCHA_API_KEY` (required)
- `CAPTCHA_DEFAULT_TIMEOUT` (seconds, default: 120)
- `CAPTCHA_POLLING_INTERVAL` (ms, default: 5000)

**Submit Request:**
```
POST https://2captcha.com/in.php
Query:
  key: TWOCAPTCHA_API_KEY
  method: userrecaptcha | hcaptcha | turnstile
  pageurl: target page URL
  sitekey/googlekey: CAPTCHA site key
  json: 1
```

**Poll Request:**
```
GET https://2captcha.com/res.php
Query:
  key: TWOCAPTCHA_API_KEY
  action: get
  id: captchaId
  json: 1
```

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
    "userAgent": "UA used for page load"
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
