import fs from 'fs/promises';
import path from 'path';
import type { Stats } from '../domain/models.js';
import { utcToday } from '../utils/date.js';
import { Mutex } from '../utils/mutex.js';
import { getDataDir } from '../config.js';

const DATA_DIR = getDataDir();
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const statsMutex = new Mutex();

const DEFAULT_STATS: Stats = {
  scrapeTotal: 0,
  failTotal: 0,
  todayDate: utcToday(),
  scrapeToday: 0,
  failToday: 0,
  domainCounts: {}
};

async function ensureFile(): Promise<void> {
  try {
    await fs.access(STATS_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STATS_FILE, JSON.stringify(DEFAULT_STATS, null, 2));
  }
}

async function loadStatsInternal(): Promise<Stats> {
  await ensureFile();
  const content = await fs.readFile(STATS_FILE, 'utf-8');
  return JSON.parse(content) as Stats;
}

async function saveStatsInternal(stats: Stats): Promise<void> {
  await ensureFile();
  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

export async function loadStats(): Promise<Stats> {
  return statsMutex.runExclusive(() => loadStatsInternal());
}

export async function saveStats(stats: Stats): Promise<void> {
  return statsMutex.runExclusive(() => saveStatsInternal(stats));
}

export async function recordScrape(domain: string, success: boolean): Promise<void> {
  return statsMutex.runExclusive(async () => {
    const stats = await loadStatsInternal();
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

    await saveStatsInternal(stats);
  });
}

export async function getTopDomains(limit = 5): Promise<{ domain: string; count: number }[]> {
  return statsMutex.runExclusive(async () => {
    const stats = await loadStatsInternal();
    return Object.entries(stats.domainCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([domain, count]) => ({ domain, count }));
  });
}

export async function resetStats(): Promise<void> {
  return statsMutex.runExclusive(async () => {
    const fresh: Stats = {
      scrapeTotal: 0,
      failTotal: 0,
      todayDate: utcToday(),
      scrapeToday: 0,
      failToday: 0,
      domainCounts: {}
    };
    await saveStatsInternal(fresh);
  });
}
