import sanitizeHtml from 'sanitize-html';
import he from 'he';
import { parseHTML } from 'linkedom';
import xpath from 'xpath';
import TurndownService from 'turndown';

const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'p', 'div', 'span', 'a', 'img', 'br', 'hr', 
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'article', 'section'];

const ALLOWED_ATTRIBUTES = {
  a: ['href'],
  img: ['src', 'alt']
};

const DEFAULT_CLASSES_TO_REMOVE = [
  'ad', 'ads', 'advert', 'advertisement', 'advertising',
  'social', 'social-share', 'share', 'sharebox', 'sharing',
  'related', 'related-posts', 'related-articles', 'related-news', 'related-links',
  'sidebar', 'menu', 'nav', 'navigation',
  'comment', 'comments',
  'newsletter', 'subscribe', 'signup', 'subscription',
  'promo', 'promotion', 'sponsored',
  'popup', 'modal', 'overlay',
  'cookie', 'consent',
  'footer', 'header'
];

const SELECTORS_TO_REMOVE = [
  '//button',
  '//form',
  '//input',
  '//select',
  '//textarea',
  '//nav',
  '//aside',
  '//footer',
  '//*[@role="navigation"]',
  '//*[@role="banner"]',
  '//*[@role="contentinfo"]',
  '//*[@role="complementary"]',
  '//*[@aria-hidden="true"]'
];

export interface CleanerOptions {
  siteCleanupClasses?: string[];
  additionalSelectors?: string[];
  keepTags?: string[];
}

export function cleanHtml(html: string, options: CleanerOptions = {}): string {
  if (typeof html !== 'string' || !html.trim()) {
    return '';
  }

  const decoded = he.decode(html);

  const allowedTags = options.keepTags 
    ? [...ALLOWED_TAGS, ...options.keepTags]
    : ALLOWED_TAGS;

  const sanitized = sanitizeHtml(decoded, {
    allowedTags,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https'],
    disallowedTagsMode: 'discard'
  });

  const classesToRemove = [
    ...DEFAULT_CLASSES_TO_REMOVE,
    ...(options.siteCleanupClasses || [])
  ];

  const selectorsToRemove = [
    ...SELECTORS_TO_REMOVE,
    ...(options.additionalSelectors || [])
  ];

  const classSelectors = classesToRemove.map(cls => `//*[contains(@class, "${cls}")]`);
  const allSelectors = [...classSelectors, ...selectorsToRemove];

  const { document } = parseHTML(`<!DOCTYPE html><html><body>${sanitized}</body></html>`);

  for (const selector of allSelectors) {
    try {
      const nodes = xpath.select(selector, document) as Node[];
      for (const node of nodes) {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    } catch {
      // Invalid selector, skip
    }
  }

  const body = document.querySelector('body');
  const result = body ? body.innerHTML : '';

  return collapseWhitespace(result);
}

function collapseWhitespace(html: string): string {
  return html
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/^\s+|\s+$/g, '');
}

export function extractText(html: string, options: CleanerOptions = {}): string {
  const cleaned = cleanHtml(html, options);
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${cleaned}</body></html>`);
  const text = document.body?.textContent || '';
  return text.replace(/\s+/g, ' ').trim();
}

export function toMarkdown(html: string, options: CleanerOptions = {}): string {
  const cleaned = cleanHtml(html, options);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  turndown.remove(['script', 'style', 'nav', 'aside', 'footer', 'header', 'form']);

  turndown.addRule('removeEmptyElements', {
    filter: function (node) {
      return (
        (node.nodeName === 'DIV' || node.nodeName === 'SPAN') &&
        !node.textContent?.trim() &&
        !node.querySelector('img, video, audio, iframe')
      );
    },
    replacement: function () {
      return '';
    },
  });

  const markdown = turndown.turndown(cleaned);

  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}
