import { parseHTML } from "linkedom";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface RichTextNode {
  attributes?: {
    value?: unknown;
  };
  children?: RichTextNode[];
}

const MIN_EMBEDDED_ARTICLE_CHARS = 200;

export function extractEmbeddedArticleFromHtml(
  html: string,
): string | null {
  const { document } = parseHTML(html);

  return (
    extractFromApolloState(document) ??
    extractFromJsonLd(document) ??
    extractFromNextData(document)
  );
}

function extractFromApolloState(
  document: Document,
): string | null {
  for (const script of Array.from(
    document.querySelectorAll("script"),
  )) {
    const state = parseAssignedJson(
      script.textContent || "",
      "__APOLLO_STATE__",
    );
    if (!isRecord(state)) {
      continue;
    }

    for (const [key, value] of Object.entries(state)) {
      if (!key.startsWith("Article:") || !isRecord(value)) {
        continue;
      }

      const paywalled = extractRichTextList(
        value.paywalledContent,
      );
      if (paywalled) {
        return paywalled;
      }

      const body = extractRichTextList(value.body);
      if (body) {
        return body;
      }
    }
  }

  return null;
}

function extractRichTextList(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.json)) {
    return null;
  }

  const paragraphs = value.json
    .map((node) => extractFromRichTextNode(node))
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.length > 0
    ? paragraphs.join("\n\n")
    : null;
}

function extractFromRichTextNode(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }

  const richNode = node as RichTextNode;
  const parts: string[] = [];
  const value = richNode.attributes?.value;
  if (typeof value === "string") {
    parts.push(value);
  }

  if (Array.isArray(richNode.children)) {
    for (const child of richNode.children) {
      parts.push(extractFromRichTextNode(child));
    }
  }

  return parts.filter(Boolean).join("");
}

function extractFromJsonLd(
  document: Document,
): string | null {
  for (const script of Array.from(
    document.querySelectorAll(
      'script[type="application/ld+json"]',
    ),
  )) {
    const data = parseJson(script.textContent || "");
    const articleBody = findArticleBody(data);
    if (articleBody) {
      return articleBody;
    }
  }

  return null;
}

function findArticleBody(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const articleBody = findArticleBody(item);
      if (articleBody) {
        return articleBody;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.articleBody === "string" &&
    value.articleBody.length > MIN_EMBEDDED_ARTICLE_CHARS
  ) {
    return value.articleBody;
  }

  return findArticleBody(value["@graph"]);
}

function extractFromNextData(
  document: Document,
): string | null {
  const nextDataScript = document.querySelector(
    "script#__NEXT_DATA__",
  );
  const nextData =
    parseJson(nextDataScript?.textContent || "") ??
    parseNextDataAssignment(document);

  if (!isRecord(nextData)) {
    return null;
  }

  const props = nextData.props;
  if (!isRecord(props)) {
    return null;
  }

  const pageProps = props.pageProps;
  if (!isRecord(pageProps)) {
    return null;
  }

  const article = pageProps.article;
  if (!isRecord(article)) {
    return null;
  }

  return typeof article.body === "string" &&
    article.body.length > MIN_EMBEDDED_ARTICLE_CHARS
    ? article.body
    : null;
}

function parseNextDataAssignment(
  document: Document,
): JsonValue | null {
  for (const script of Array.from(
    document.querySelectorAll("script"),
  )) {
    const data = parseAssignedJson(
      script.textContent || "",
      "__NEXT_DATA__",
    );
    if (data) {
      return data;
    }
  }

  return null;
}

function parseAssignedJson(
  scriptText: string,
  variableName: string,
): JsonValue | null {
  const markerIndex = scriptText.indexOf(variableName);
  if (markerIndex === -1) {
    return null;
  }

  const jsonStart = findJsonStart(scriptText, markerIndex);
  if (jsonStart === -1) {
    return null;
  }

  const jsonEnd = findJsonEnd(scriptText, jsonStart);
  if (jsonEnd === -1) {
    return null;
  }

  return parseJson(scriptText.slice(jsonStart, jsonEnd + 1));
}

function findJsonStart(
  text: string,
  fromIndex: number,
): number {
  const objectStart = text.indexOf("{", fromIndex);
  const arrayStart = text.indexOf("[", fromIndex);

  if (objectStart === -1) {
    return arrayStart;
  }
  if (arrayStart === -1) {
    return objectStart;
  }

  return Math.min(objectStart, arrayStart);
}

function findJsonEnd(
  text: string,
  startIndex: number,
): number {
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const open = stack.pop();
      if (
        (char === "}" && open !== "{") ||
        (char === "]" && open !== "[")
      ) {
        return -1;
      }
      if (stack.length === 0) {
        return index;
      }
    }
  }

  return -1;
}

function parseJson(text: string): JsonValue | null {
  try {
    return JSON.parse(text.trim()) as JsonValue;
  } catch {
    return null;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
