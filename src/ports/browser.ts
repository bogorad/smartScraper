import type { ElementDetails, LoadPageOptions } from '../domain/models.js';
import type { CaptchaTypeValue } from '../constants.js';

export interface BrowserPort {
  open(): Promise<void>;
  close(): Promise<void>;
  closePage(pageId: string): Promise<void>;
  loadPage(url: string, options?: LoadPageOptions): Promise<{ pageId: string }>;
  evaluateXPath(pageId: string, xpath: string): Promise<string[] | null>;
  getPageHtml(pageId: string): Promise<string>;
  detectCaptcha(pageId: string): Promise<CaptchaTypeValue>;
  getElementDetails(pageId: string, xpath: string): Promise<ElementDetails | null>;
  getCookies(pageId: string): Promise<string>;
  setCookies(pageId: string, cookies: string): Promise<void>;
  reload(pageId: string): Promise<void>;
}
