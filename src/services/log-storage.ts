import fs from 'fs/promises';
import path from 'path';
import type { LogEntry } from '../domain/models.js';
import { utcToday, isOlderThanDays } from '../utils/date.js';
import { DEFAULTS } from '../constants.js';
import { getDataDir } from '../config.js';

const DATA_DIR = getDataDir();
const LOGS_DIR = path.join(DATA_DIR, 'logs');

async function ensureDir(): Promise<void> {
  await fs.mkdir(LOGS_DIR, { recursive: true });
}

export async function logScrape(entry: LogEntry): Promise<void> {
  await ensureDir();
  const today = utcToday();
  const logFile = path.join(LOGS_DIR, `${today}.jsonl`);
  const line = JSON.stringify(entry) + '\n';
  await fs.appendFile(logFile, line);
}

export async function cleanupOldLogs(): Promise<void> {
  await ensureDir();
  
  try {
    const files = await fs.readdir(LOGS_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      
      const dateStr = file.replace('.jsonl', '');
      if (isOlderThanDays(dateStr, DEFAULTS.LOG_RETENTION_DAYS)) {
        await fs.unlink(path.join(LOGS_DIR, file));
        console.log(`[LOGS] Cleaned up old log: ${file}`);
      }
    }
  } catch (error) {
    console.error('[LOGS] Cleanup error:', error);
  }
}

export async function readTodayLogs(): Promise<LogEntry[]> {
  await ensureDir();
  const today = utcToday();
  const logFile = path.join(LOGS_DIR, `${today}.jsonl`);
  
  try {
    const content = await fs.readFile(logFile, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}
