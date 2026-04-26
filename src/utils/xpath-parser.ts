export const MAX_XPATH_LENGTH = 500;
export const DISALLOWED_XPATH_CHARS =
  /[\u0000-\u001f\u007f`;<>{}]/;
const XPATH_START_PATTERN = /(?:\.?\/\/|\.?\/|\(\/\/)/g;

export function parseXPathResponse(
  content: string,
): string[] {
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed)) {
      return uniqueValidXPaths(
        parsed.filter((x) => typeof x === "string"),
      );
    }
  } catch {}

  const codeBlockMatch = content.match(
    /```(?:json)?\s*([\s\S]*?)```/,
  );
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        return uniqueValidXPaths(
          parsed.filter((x) => typeof x === "string"),
        );
      }
    } catch {}
  }

  return uniqueValidXPaths(extractXPathCandidates(content));
}

export function isValidXPath(xpath: string): boolean {
  const trimmed = xpath.trim();

  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_XPATH_LENGTH &&
    !DISALLOWED_XPATH_CHARS.test(trimmed) &&
    startsLikeXPath(trimmed) &&
    hasBalancedXPathSyntax(trimmed) &&
    hasXPathStep(trimmed)
  );
}

function uniqueValidXPaths(xpaths: string[]): string[] {
  return [
    ...new Set(
      xpaths
        .map((xpath) => cleanXPathCandidate(xpath))
        .filter(isValidXPath),
    ),
  ];
}

function startsLikeXPath(xpath: string): boolean {
  return (
    xpath.startsWith("/") ||
    xpath.startsWith("./") ||
    xpath.startsWith("(/") ||
    xpath.startsWith("(//")
  );
}

function hasXPathStep(xpath: string): boolean {
  return /(?:^|[/(])(?:[a-zA-Z_][\w.-]*|\*|[a-zA-Z_][\w.-]*::[a-zA-Z_*][\w.-]*)/.test(
    xpath,
  );
}

function hasBalancedXPathSyntax(xpath: string): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | undefined;

  for (const char of xpath) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
    }

    if (bracketDepth < 0 || parenDepth < 0) {
      return false;
    }
  }

  return !quote && bracketDepth === 0 && parenDepth === 0;
}

function extractXPathCandidates(content: string): string[] {
  const candidates: string[] = [];

  for (const match of content.matchAll(
    XPATH_START_PATTERN,
  )) {
    const startIndex = match.index ?? 0;
    if (isXPathCandidateBoundary(content, startIndex)) {
      candidates.push(
        readXPathCandidate(content, startIndex),
      );
    }
  }

  return candidates;
}

function isXPathCandidateBoundary(
  content: string,
  startIndex: number,
): boolean {
  if (startIndex === 0) {
    return true;
  }

  return /[\s"',:]/.test(content[startIndex - 1]);
}

function readXPathCandidate(
  content: string,
  startIndex: number,
): string {
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | undefined;
  let endIndex = startIndex;

  for (
    let index = startIndex;
    index < content.length;
    index += 1
  ) {
    const char = content[index];

    if (char === "\n" || char === "\r" || char === "\t") {
      break;
    }

    if (quote) {
      endIndex = index + 1;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (
      (char === '"' || char === "'") &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      break;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
    }

    if (
      bracketDepth < 0 ||
      parenDepth < 0 ||
      DISALLOWED_XPATH_CHARS.test(char) ||
      shouldStopAtTopLevelSeparator(
        content,
        index,
        bracketDepth,
        parenDepth,
      )
    ) {
      break;
    }

    endIndex = index + 1;
  }

  return content.slice(startIndex, endIndex);
}

function shouldStopAtTopLevelSeparator(
  content: string,
  index: number,
  bracketDepth: number,
  parenDepth: number,
): boolean {
  if (bracketDepth > 0 || parenDepth > 0) {
    return false;
  }

  const char = content[index];
  if (char === ",") {
    return true;
  }

  if (char !== " ") {
    return false;
  }

  const next = content.slice(index + 1).trimStart()[0];
  return next !== "|";
}

function cleanXPathCandidate(xpath: string): string {
  return xpath.trim().replace(/[,.!?]+$/g, "");
}
