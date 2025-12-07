import { describe, it, expect } from 'vitest';
import { normalizeUrl, extractDomain, isValidUrl } from './url.js';

describe('url utilities', () => {
  describe('normalizeUrl', () => {
    it('should parse valid URLs', () => {
      const url = normalizeUrl('https://example.com/path');
      expect(url).toBeInstanceOf(URL);
      expect(url?.href).toBe('https://example.com/path');
    });

    it('should return null for invalid URLs', () => {
      expect(normalizeUrl('not-a-url')).toBeNull();
      expect(normalizeUrl('')).toBeNull();
    });

    it('should handle URLs with query parameters', () => {
      const url = normalizeUrl('https://example.com/path?foo=bar');
      expect(url?.href).toBe('https://example.com/path?foo=bar');
    });

    it('should handle URLs with fragments', () => {
      const url = normalizeUrl('https://example.com/path#section');
      expect(url?.href).toBe('https://example.com/path#section');
    });
  });

  describe('extractDomain', () => {
    it('should extract domain from valid URLs', () => {
      expect(extractDomain('https://example.com/path')).toBe('example.com');
      expect(extractDomain('https://subdomain.example.com/path')).toBe('subdomain.example.com');
    });

    it('should remove www prefix', () => {
      expect(extractDomain('https://www.example.com/path')).toBe('example.com');
      expect(extractDomain('http://www.subdomain.example.com')).toBe('subdomain.example.com');
    });

    it('should return null for invalid URLs', () => {
      expect(extractDomain('not-a-url')).toBeNull();
      expect(extractDomain('')).toBeNull();
    });

    it('should handle different protocols', () => {
      expect(extractDomain('http://example.com')).toBe('example.com');
      expect(extractDomain('https://example.com')).toBe('example.com');
    });

    it('should handle localhost', () => {
      expect(extractDomain('http://localhost:3000')).toBe('localhost');
    });

    it('should handle IP addresses', () => {
      expect(extractDomain('http://192.168.1.1')).toBe('192.168.1.1');
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
      expect(isValidUrl('http://www.example.com/path?query=1')).toBe(true);
    });

    it('should return true for valid HTTPS URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://subdomain.example.com/path')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
    });

    it('should return false for non-HTTP(S) protocols', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('file:///path/to/file')).toBe(false);
      expect(isValidUrl('mailto:user@example.com')).toBe(false);
    });
  });
});
