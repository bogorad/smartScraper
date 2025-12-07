import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { utcToday, utcNow, isOlderThanDays, formatDuration, formatNumber } from './date.js';

describe('date utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('utcToday', () => {
    it('should return current date in YYYY-MM-DD format', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));
      expect(utcToday()).toBe('2024-03-15');
    });

    it('should handle year boundaries', () => {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      expect(utcToday()).toBe('2024-01-01');
    });
  });

  describe('utcNow', () => {
    it('should return current timestamp in ISO format', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));
      expect(utcNow()).toBe('2024-03-15T14:30:00.000Z');
    });
  });

  describe('isOlderThanDays', () => {
    it('should return true for dates older than specified days', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));
      const oldDate = '2024-03-01T00:00:00Z';
      expect(isOlderThanDays(oldDate, 10)).toBe(true);
    });

    it('should return false for recent dates', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));
      const recentDate = '2024-03-14T00:00:00Z';
      expect(isOlderThanDays(recentDate, 10)).toBe(false);
    });

    it('should return false for current date', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));
      const today = '2024-03-15T14:30:00Z';
      expect(isOlderThanDays(today, 1)).toBe(false);
    });

    it('should handle boundary case correctly', () => {
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));
      const boundaryDate = '2024-03-05T14:30:01Z';
      expect(isOlderThanDays(boundaryDate, 10)).toBe(false);
      
      const olderBoundaryDate = '2024-03-05T14:29:59Z';
      expect(isOlderThanDays(olderBoundaryDate, 10)).toBe(true);
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds when less than 1 second', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(0)).toBe('0ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format as seconds when >= 1000ms', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(1500)).toBe('1.5s');
      expect(formatDuration(2345)).toBe('2.3s');
      expect(formatDuration(60000)).toBe('60.0s');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with US locale separators', () => {
      expect(formatNumber(1000)).toBe('1,000');
      expect(formatNumber(1234567)).toBe('1,234,567');
      expect(formatNumber(100)).toBe('100');
      expect(formatNumber(0)).toBe('0');
    });
  });
});
