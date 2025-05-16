// tests/utils/url-helpers.test.js
import { normalizeDomain, getBaseDomain, isValidUrl } from '../../src/utils/url-helpers';

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
        });
        it('should handle subdomains', () => {
            expect(normalizeDomain('blog.example.com')).toBe('blog.example.com');
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
        });
        it('should return null for invalid input', () => {
            expect(getBaseDomain(null)).toBeNull();
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
        });
    });
});
