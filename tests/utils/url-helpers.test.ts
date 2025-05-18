// tests/utils/url-helpers.test.ts
import { normalizeDomain, getBaseDomain, isValidUrl } from '../../src/utils/url-helpers';

// Mock logger to prevent console output during tests and scraperSettings
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugging: jest.fn().mockReturnValue(false),
  }
}));
jest.mock('../../config/index.js', () => ({
  scraperSettings: {
    debug: false, // Ensure debug specific logs in url-helpers are off by default for tests
  }
}));


describe('URL Helpers', () => {
  describe('normalizeDomain', () => {
    it('should normalize a simple URL', () => {
      expect(normalizeDomain('http://example.com/path?query=1')).toBe('example.com');
    });

    it('should remove www.', () => {
      expect(normalizeDomain('https://www.example.com')).toBe('example.com');
    });

    it('should handle URLs without scheme', () => {
      expect(normalizeDomain('example.com/')).toBe('example.com');
    });

    it('should convert to lowercase', () => {
      expect(normalizeDomain('HTTP://EXAMPLE.COM')).toBe('example.com');
    });

    it('should return null for invalid URLs', () => {
      expect(normalizeDomain('not a url')).toBeNull();
      expect(normalizeDomain('')).toBeNull();
      expect(normalizeDomain(null)).toBeNull();
      expect(normalizeDomain(undefined)).toBeNull();
    });
    
    it('should handle subdomains', () => {
      expect(normalizeDomain('blog.example.com')).toBe('blog.example.com');
      expect(normalizeDomain('www.blog.example.com')).toBe('blog.example.com');
    });
  });

  describe('getBaseDomain', () => {
    it('should get base domain from subdomain', () => {
      expect(getBaseDomain('blog.example.com')).toBe('example.com');
    });

    it('should return hostname if already base domain', () => {
      expect(getBaseDomain('example.com')).toBe('example.com');
    });

    it('should handle www prefix correctly', () => {
      expect(getBaseDomain('www.example.com')).toBe('example.com');
    });

    it('should handle .co.uk style domains', () => {
      expect(getBaseDomain('www.example.co.uk')).toBe('example.co.uk');
      expect(getBaseDomain('sub.example.co.uk')).toBe('example.co.uk');
    });
    
    it('should return null for invalid input', () => {
      expect(getBaseDomain(null)).toBeNull();
      expect(getBaseDomain(undefined)).toBeNull();
      expect(getBaseDomain('')).toBeNull();
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://www.example.co.uk/path?q=1#hash')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('example.com')).toBe(false); // Requires scheme for Node's URL
      expect(isValidUrl('htp://example.com')).toBe(false);
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
    });
  });
});
