export function parseXPathResponse(content: string): string[] {
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
      return [...new Set(parsed)];
    }
  } catch {}

  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.filter(x => typeof x === 'string'))];
      }
    } catch {}
  }

  const xpathPattern = /\/\/[a-zA-Z][a-zA-Z0-9]*(?:\[[^\]]+\])?(?:\/[a-zA-Z][a-zA-Z0-9]*(?:\[[^\]]+\])?)*/g;
  const matches = content.match(xpathPattern);
  return matches ? [...new Set(matches)] : [];
}
