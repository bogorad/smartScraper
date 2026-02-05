import fs from 'fs/promises';
import path from 'path';
import PQueue from 'p-queue';
import type { Stats } from '../domain/models.js';
import { utcToday } from '../utils/date.js';
import { getDataDir } from '../config.js';

const writeQueue = new PQueue({ concurrency: 1 });
let cache: Stats | null = null;

const DEFAULT_STATS: Stats = {
  scrapeTotal: 0,
  failTotal: 0,
  todayDate: utcToday(),
  scrapeToday: 0,
  failToday: 0,
  domainCounts: {}
};

function getStatsFile(): string {
  return path.join(getDataDir(), 'stats.json');
}

async function ensureFile(): Promise<void> {
  const statsFile = getStatsFile();
  try {
    await fs.access(statsFile);
  } catch {
    await fs.mkdir(getDataDir(), { recursive: true });
    await fs.writeFile(statsFile, JSON.stringify(DEFAULT_STATS, null, 2));
  }
}

async function loadFromDisk(): Promise<Stats> {
  await ensureFile();
  const content = await fs.readFile(getStatsFile(), 'utf-8');
  const parsed = JSON.parse(content) as Partial<Stats>;
  // Ensure domainCounts is always initialized (defensive against malformed JSON)
  cache = {
    ...DEFAULT_STATS,
    ...parsed,
    domainCounts: parsed.domainCounts || {}
  };
  return cache;
}

async function flush(): Promise<void> {
  if (!cache) return;
  await ensureFile();
  const tempFile = getStatsFile() + '.tmp';
  await fs.writeFile(tempFile, JSON.stringify(cache, null, 2));
  await fs.rename(tempFile, getStatsFile());
}

// Reads use cache directly - no queue needed
export async function loadStats(): Promise<Stats> {
  if (cache) return cache;
  return await loadFromDisk();
}

// Writes go through queue for serialization
export async function saveStats(stats: Stats): Promise<void> {
  return writeQueue.add(async () => {
    cache = stats;
    await flush();
  });
}

export async function recordScrape(domain: string, success: boolean): Promise<void> {
  return writeQueue.add(async () => {
    if (!cache) await loadFromDisk();
    const stats = cache!;
    const today = utcToday();

    if (stats.todayDate !== today) {
      stats.todayDate = today;
      stats.scrapeToday = 0;
      stats.failToday = 0;
    }

    stats.scrapeTotal++;
    stats.scrapeToday++;
    stats.domainCounts[domain] = (stats.domainCounts[domain] || 0) + 1;

    if (!success) {
      stats.failTotal++;
      stats.failToday++;
    }

    await flush();
  });
}

// Reads use cache directly
export async function getTopDomains(limit = 5): Promise<{ domain: string; count: number }[]> {
  if (!cache) await loadFromDisk();
  const stats = cache!;
  return Object.entries(stats.domainCounts || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}

export async function resetStats(): Promise<void> {
  return writeQueue.add(async () => {
    cache = {
      scrapeTotal: 0,
      failTotal: 0,
      todayDate: utcToday(),
      scrapeToday: 0,
      failToday: 0,
      domainCounts: {}
    };
    await flush();
  });
}
