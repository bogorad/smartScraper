// src/constants.ts

export const METHODS = Object.freeze({
  CURL: 'curl',
  PUPPETEER_STEALTH: 'puppeteer_stealth',
  PUPPETEER_CAPTCHA: 'puppeteer_captcha',
});

export type MethodValue = typeof METHODS[keyof typeof METHODS];

export const OUTPUT_TYPES = Object.freeze({
  CONTENT_ONLY: 'content_only',
  FULL_HTML: 'full_html',
  METADATA_ONLY: 'metadata_only', // Example, not fully implemented
});

export type OutputTypeValue = typeof OUTPUT_TYPES[keyof typeof OUTPUT_TYPES];
