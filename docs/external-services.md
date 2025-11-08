# External Services API Reference

This document specifies how SmartScraper interacts with external services.
It is designed so you can rebuild the internals while preserving correct
integration behavior.

Services covered:
- LLM provider (OpenRouter-style / OpenAI-compatible chat completions)
- 2Captcha (generic CAPTCHAs)
- 2Captcha for DataDome (DataDomeSliderTask)
- HTTP proxies and User-Agent configuration

---

## 1. LLM Provider (OpenRouter-style Chat Completions)

Environment/config:
- `OPENROUTER_API_KEY` (required)
- `LLM_MODEL` (optional, default: `meta-llama/llama-4-maverick:free`)
- `LLM_TEMPERATURE` (optional, default: `0`)
- Implicit endpoint in current config:
  - `https://openrouter.ai/api/v1/chat/completions`

Request (conceptual):
- Method: `POST`
- URL: `https://openrouter.ai/api/v1/chat/completions`
- Headers:
  - `Authorization: Bearer ${OPENROUTER_API_KEY}`
  - `Content-Type: application/json`
  - `HTTP-Referer: ${LLM_HTTP_REFERER || 'https://github.com/bogorad/smartScraper'}`
  - `X-Title: ${LLM_X_TITLE || 'SmartScraper'}`
- Body shape:
  - `model: string` (from `LLM_MODEL`)
  - `messages: { role: 'system' | 'user' | 'assistant'; content: string }[]`
  - `temperature: number`

Response assumptions:
- JSON object with:
  - `choices[0].message.content: string` containing either:
    - a JSON array of XPath strings, or
    - a markdown code block containing that JSON array.
- The implementation:
  - extracts JSON array from content (optionally from ```json``` block),
  - or falls back to regex-based XPath extraction.

Rebuild requirements:
- Keep using an OpenAI-compatible chat completions API.
- Maintain the above auth/headers contract (for OpenRouter specifically).
- Continue to expect `choices[0].message.content` as the primary payload.

---

## 2. 2Captcha: Generic CAPTCHA Solving

Environment/config:
- `CAPTCHA_SERVICE_NAME` (expected: `2captcha`)
- `TWOCAPTCHA_API_KEY` (required when using 2Captcha)
- Optional tuning:
  - `CAPTCHA_DEFAULT_TIMEOUT` (seconds, default: 120)
  - `CAPTCHA_POLLING_INTERVAL` (ms, default: 5000)
  - `CAPTCHA_MAX_RETRIES`
  - `POST_CAPTCHA_SUBMIT_DELAY` (ms)

Base endpoints (current usage):
- Submit: `https://2captcha.com/in.php`
- Poll: `https://2captcha.com/res.php`

Submit request (generic pattern):
- Method: `POST` (with query parameters)
- URL: `https://2captcha.com/in.php`
- Query parameters (subset, depends on CAPTCHA type):
  - `key`: `TWOCAPTCHA_API_KEY`
  - `method`: one of:
    - `userrecaptcha` (reCAPTCHA v2)
    - `hcaptcha`
    - `turnstile`
  - `pageurl`: page URL where CAPTCHA is located
  - `sitekey`: for hCaptcha/Turnstile (and reCAPTCHA via `googlekey`)
  - `googlekey`: for reCAPTCHA v2
  - `json`: `1`
  - `soft_id`: optional, currently fixed placeholder
  - `userAgent`: UA string (included by current code)

Submit response expectations:
- JSON with `status` and `request` fields.
- On success: `status === 1`, `request` is `captchaId`.

Polling request:
- Method: `GET`
- URL: `https://2captcha.com/res.php`
- Query parameters:
  - `key`: `TWOCAPTCHA_API_KEY`
  - `action`: `get`
  - `id`: `captchaId`
  - `json`: `1`

Polling response expectations:
- While pending: `status !== 1` and `request === 'CAPCHA_NOT_READY'`.
- On success: `status === 1`, `request` is the solution token.
- On error: `status !== 1`, `request` contains error code.

Rebuild requirements:
- Preserve the above call pattern to 2Captcha.
- Respect timeout and polling intervals from configuration.
- Map 2Captcha errors to structured `CaptchaError`/equivalent.

---

## 3. 2Captcha for DataDome (DataDomeSliderTask)

Environment/config:
- `TWOCAPTCHA_API_KEY` (required)
- `HTTP_PROXY` (optional, used for 2Captcha task if present)
- `DATADOME_DOMAINS` (optional, comma-separated, influences enabling of DataDome logic)

Endpoints used:
- Create task: `https://api.2captcha.com/createTask`
- Get result: `https://api.2captcha.com/getTaskResult`

CreateTask request:
- Method: `POST`
- URL: `https://api.2captcha.com/createTask`
- Body (JSON):
  - `clientKey`: `TWOCAPTCHA_API_KEY`
  - `task`: {
      `type`: `"DataDomeSliderTask"`,
      `websiteURL`: main page URL,
      `captchaUrl`: DataDome iframe URL,
      `userAgent`: UA used for page load,
      (optional proxy fields derived from `HTTP_PROXY`)
    }
  - `softId`: optional identifier

CreateTask response expectations:
- On success: `{ errorId: 0, taskId: string }`.
- On error: `errorId != 0`, with `errorCode` / `errorDescription`.

GetTaskResult request:
- Method: `POST`
- URL: `https://api.2captcha.com/getTaskResult`
- Body (JSON):
  - `clientKey`: `TWOCAPTCHA_API_KEY`
  - `taskId`: from createTask

GetTaskResult response expectations:
- While processing:
  - `status: "processing"`.
- On success:
  - `status: "ready"`, `solution.cookie` contains DataDome cookie string.
- On error:
  - `errorId != 0` and `errorCode` / `errorDescription` indicate failure.

Rebuild requirements:
- When solving DataDome:
  - Use the above createTask/getTaskResult contract.
  - Respect banned-IP indicators in `captchaUrl` (e.g. `t=bv`, `cid` with `block`).
  - On success, parse `solution.cookie` into a browser cookie and optionally persist it.

---

## 4. Proxies and User-Agent

Environment:
- `HTTP_PROXY` (optional)
  - Used for:
    - outbound HTTP requests to target sites,
    - 2Captcha DataDome tasks (if parseable into protocol/host/port/login/password).
- `USER_AGENT` (optional)
  - If set, used as default User-Agent for scraping & external calls.

Behavior expectations:
- All network-bound calls (targets, LLM, 2Captcha) MAY use configured proxy when appropriate.
- All calls should send a realistic User-Agent; for CAPTCHA/LLM tasks the same UA is often forwarded.

---

## 5. Summary

For a full rebuild, treat all external integrations as stable contracts:

- LLM: OpenAI-compatible chat completions using `OPENROUTER_API_KEY` and `LLM_MODEL`.
- 2Captcha (generic): `in.php` + `res.php` with documented params, polling until solution or error.
- 2Captcha (DataDomeSliderTask): `createTask` + `getTaskResult` with cookie-based solution.
- Configuration via environment variables MUST continue to drive keys, models, timeouts, and proxy/UA behavior.

Internal implementation details are free to change as long as these
integration behaviors remain compatible.