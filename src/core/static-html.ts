import { parseHTML } from "linkedom";
import { SCORING } from "../constants.js";

export interface StaticHtmlExtraction {
  xpath: string;
  html: string;
  textLength: number;
}

interface StaticHtmlCandidate {
  xpath: string;
  selector: string;
}

const FALLBACK_CANDIDATES: StaticHtmlCandidate[] = [
  { xpath: "//article", selector: "article" },
  { xpath: "//main", selector: "main" },
  { xpath: "//*[@role='main']", selector: '[role="main"]' },
  {
    xpath: "//div[contains(@class, 'article')]",
    selector: "div[class*='article']",
  },
  {
    xpath: "//div[contains(@class, 'content')]",
    selector: "div[class*='content']",
  },
];

export function extractStaticArticleFromHtml(
  html: string,
  preferredXPath?: string,
): StaticHtmlExtraction | null {
  const { document } = parseHTML(html);
  const preferredCandidate = preferredXPath
    ? xpathToCandidate(preferredXPath)
    : null;
  const candidates: StaticHtmlCandidate[] = [
    ...(preferredCandidate ? [preferredCandidate] : []),
    ...FALLBACK_CANDIDATES,
  ];

  let best: StaticHtmlExtraction | null = null;
  for (const candidate of candidates) {
    const extraction = extractFirstUsableNode(
      document,
      candidate,
    );
    if (
      extraction &&
      (!best || extraction.textLength > best.textLength)
    ) {
      best = extraction;
    }
  }

  return best;
}

function extractFirstUsableNode(
  document: Document,
  candidate: StaticHtmlCandidate,
): StaticHtmlExtraction | null {
  let elements: Element[];
  try {
    elements = Array.from(
      document.querySelectorAll(candidate.selector),
    );
  } catch {
    return null;
  }

  for (const element of elements) {
    const textLength = normalizedTextLength(element);
    if (textLength < SCORING.MIN_CONTENT_CHARS) {
      continue;
    }

    return {
      xpath: candidate.xpath,
      html: element.outerHTML,
      textLength,
    };
  }

  return null;
}

function xpathToCandidate(
  candidateXPath: string,
): StaticHtmlCandidate | null {
  const trimmed = candidateXPath.trim();
  const tagOnly = trimmed.match(/^\/\/([a-zA-Z][\w-]*)$/);
  if (tagOnly) {
    return {
      xpath: trimmed,
      selector: tagOnly[1],
    };
  }

  const idMatch = trimmed.match(
    /^\/\/([a-zA-Z][\w-]*)\[@id=['"]([^'"]+)['"]\]$/,
  );
  if (idMatch) {
    return {
      xpath: trimmed,
      selector: `${idMatch[1]}#${cssEscape(idMatch[2])}`,
    };
  }

  const classMatch = trimmed.match(
    /^\/\/([a-zA-Z][\w-]*)\[@class=['"]([^'"]+)['"]\]$/,
  );
  if (classMatch) {
    return {
      xpath: trimmed,
      selector: `${classMatch[1]}.${classMatch[2]
        .split(/\s+/)
        .filter(Boolean)
        .map(cssEscape)
        .join(".")}`,
    };
  }

  return null;
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function normalizedTextLength(element: Element): number {
  return (element.textContent || "").replace(/\s+/g, " ").trim()
    .length;
}
