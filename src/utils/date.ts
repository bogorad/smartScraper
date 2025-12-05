export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function utcNow(): string {
  return new Date().toISOString();
}

export function isOlderThanDays(dateStr: string, days: number): boolean {
  const date = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return date < cutoff;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
