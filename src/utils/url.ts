export function normalizeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function extractDomain(url: string): string | null {
  const parsed = normalizeUrl(url);
  if (!parsed) return null;
  return parsed.hostname.replace(/^www\./, '');
}

export function isValidUrl(url: string): boolean {
  const parsed = normalizeUrl(url);
  return parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}
