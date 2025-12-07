import { describe, it, expect } from 'vitest';
import { simplifyDom, extractSnippets } from './dom.js';

describe('dom utilities', () => {
  describe('simplifyDom', () => {
    it('should remove script tags', () => {
      const html = '<div>Hello<script>alert("bad")</script>World</div>';
      const result = simplifyDom(html);
      expect(result).not.toContain('script');
      expect(result).not.toContain('alert');
    });

    it('should remove style tags', () => {
      const html = '<div>Hello<style>.class { color: red; }</style>World</div>';
      const result = simplifyDom(html);
      expect(result).not.toContain('style');
      expect(result).not.toContain('color: red');
    });

    it('should remove comments', () => {
      const html = '<div>Hello<!-- This is a comment -->World</div>';
      const result = simplifyDom(html);
      expect(result).not.toContain('<!--');
      expect(result).not.toContain('comment');
    });

    it('should remove elements with unwanted classes', () => {
      const html = '<div>Content<div class="ad">Advertisement</div>More content</div>';
      const result = simplifyDom(html);
      expect(result).toContain('<!-- removed -->');
    });

    it('should truncate long text nodes', () => {
      const longText = 'a'.repeat(100);
      const html = `<div>${longText}</div>`;
      const result = simplifyDom(html);
      expect(result.length).toBeLessThan(html.length);
      expect(result).toContain('...');
    });

    it('should collapse whitespace', () => {
      const html = '<div>  Hello    World  </div>';
      const result = simplifyDom(html);
      expect(result).toContain('Hello World');
    });

    it('should truncate if result exceeds max length', () => {
      const html = '<div>' + 'x'.repeat(10000) + '</div>';
      const result = simplifyDom(html);
      expect(result.length).toBeLessThan(9000);
    });

    it('should handle empty input', () => {
      expect(simplifyDom('')).toBe('');
      expect(simplifyDom('   ')).toBe('');
    });

    it('should preserve basic HTML structure', () => {
      const html = '<div><p>Paragraph</p><a href="#">Link</a></div>';
      const result = simplifyDom(html);
      expect(result).toContain('<div>');
      expect(result).toContain('<p>');
      expect(result).toContain('Paragraph');
    });

    it('should remove multiple unwanted tag types', () => {
      const html = '<div>Content<script>bad</script><style>ugly</style><iframe></iframe></div>';
      const result = simplifyDom(html);
      expect(result).not.toContain('script');
      expect(result).not.toContain('style');
      expect(result).not.toContain('iframe');
    });
  });

  describe('extractSnippets', () => {
    it('should extract paragraph text', () => {
      const html = '<p>' + 'a'.repeat(150) + '</p>';
      const snippets = extractSnippets(html, 3, 150);
      expect(snippets.length).toBe(1);
      expect(snippets[0]).toContain('a'.repeat(100));
    });

    it('should respect maxSnippets limit', () => {
      const html = '<p>' + 'a'.repeat(150) + '</p><p>' + 'b'.repeat(150) + '</p><p>' + 'c'.repeat(150) + '</p><p>' + 'd'.repeat(150) + '</p>';
      const snippets = extractSnippets(html, 2, 200);
      expect(snippets.length).toBe(2);
    });

    it('should truncate snippets exceeding maxCharsPerSnippet', () => {
      const longText = 'word '.repeat(100);
      const html = `<p>${longText}</p>`;
      const snippets = extractSnippets(html, 3, 100);
      expect(snippets[0].length).toBeLessThanOrEqual(104);
      expect(snippets[0]).toContain('...');
    });

    it('should skip paragraphs with unwanted parent classes', () => {
      const html = '<div class="ad"><p>' + 'a'.repeat(150) + '</p></div><div><p>' + 'b'.repeat(150) + '</p></div>';
      const snippets = extractSnippets(html, 3, 200);
      expect(snippets.length).toBeGreaterThanOrEqual(0);
    });

    it('should not include duplicate snippets', () => {
      const text = 'a'.repeat(150);
      const html = `<p>${text}</p><p>${text}</p>`;
      const snippets = extractSnippets(html, 5, 200);
      expect(snippets.length).toBe(1);
    });

    it('should return empty array for HTML without suitable paragraphs', () => {
      const html = '<p>Too short</p><div>Not a paragraph</div>';
      const snippets = extractSnippets(html, 3, 150);
      expect(snippets.length).toBe(0);
    });

    it('should handle paragraphs with minimum length requirement', () => {
      const html = '<p>Short</p><p>' + 'a'.repeat(100) + '</p>';
      const snippets = extractSnippets(html, 3, 150);
      expect(snippets.length).toBe(1);
      expect(snippets[0]).toContain('a');
    });

    it('should truncate at word boundary when possible', () => {
      const html = '<p>' + 'word '.repeat(50) + '</p>';
      const snippets = extractSnippets(html, 3, 50);
      expect(snippets.length).toBe(1);
      expect(snippets[0].length).toBeLessThanOrEqual(54);
    });
  });
});
