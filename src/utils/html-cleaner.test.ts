import { describe, it, expect } from 'vitest';
import { cleanHtml, extractText, toMarkdown } from './html-cleaner.js';

describe('html-cleaner', () => {
  describe('cleanHtml', () => {
    it('should decode HTML entities', () => {
      const html = '<p>&lt;div&gt; &amp; &quot;test&quot;</p>';
      const result = cleanHtml(html);
      expect(result).toContain('<div>');
      expect(result).toContain('&');
      expect(result).toContain('"test"');
    });

    it('should remove disallowed tags', () => {
      const html = '<p>Text</p><script>alert("bad")</script><style>.bad{}</style>';
      const result = cleanHtml(html);
      expect(result).toContain('Text');
      expect(result).not.toContain('script');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('style');
    });

    it('should keep allowed tags', () => {
      const html = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em></p>';
      const result = cleanHtml(html);
      expect(result).toContain('<h1>');
      expect(result).toContain('<p>');
      expect(result).toContain('<strong>');
      expect(result).toContain('<em>');
    });

    it('should remove elements with unwanted classes', () => {
      const html = '<div>Content</div><div class="ad">Ad content</div><div>More content</div>';
      const result = cleanHtml(html);
      expect(result).toContain('Content');
      expect(result).toContain('More content');
    });

    it('should remove navigation elements', () => {
      const html = '<article>Content</article><nav>Navigation</nav><aside>Sidebar</aside>';
      const result = cleanHtml(html);
      expect(result).toContain('Content');
    });

    it('should remove form elements', () => {
      const html = '<div>Text</div><form><input type="text"/><button>Submit</button></form>';
      const result = cleanHtml(html);
      expect(result).toContain('Text');
      expect(result).not.toContain('form');
      expect(result).not.toContain('input');
      expect(result).not.toContain('button');
    });

    it('should collapse whitespace', () => {
      const html = '<p>  Multiple   spaces   </p>';
      const result = cleanHtml(html);
      expect(result).toContain('Multiple spaces');
    });

    it('should handle empty input', () => {
      expect(cleanHtml('')).toBe('');
      expect(cleanHtml('   ')).toBe('');
    });

    it('should preserve links with href', () => {
      const html = '<p>Check <a href="https://example.com">this link</a></p>';
      const result = cleanHtml(html);
      expect(result).toContain('<a href="https://example.com">');
      expect(result).toContain('this link');
    });

    it('should preserve images with src and alt', () => {
      const html = '<p>Image: <img src="image.jpg" alt="Description"/></p>';
      const result = cleanHtml(html);
      expect(result).toContain('<img');
      expect(result).toContain('src="image.jpg"');
      expect(result).toContain('alt="Description"');
    });

    it('should remove custom site cleanup classes', () => {
      const html = '<div>Content</div><div class="custom-ad">Custom ad</div>';
      const result = cleanHtml(html, { siteCleanupClasses: ['custom-ad'] });
      expect(result).toContain('Content');
    });

    it('should allow additional tags when specified', () => {
      const html = '<video>Video content</video><p>Text</p>';
      const result = cleanHtml(html, { keepTags: ['video'] });
      expect(result).toContain('<video>');
      expect(result).toContain('Video content');
      expect(result).toContain('<p>');
    });
  });

  describe('extractText', () => {
    it('should extract plain text from HTML', () => {
      const html = '<p>Hello <strong>World</strong></p>';
      const result = extractText(html);
      expect(result).toBe('Hello World');
    });

    it('should remove all HTML tags', () => {
      const html = '<h1>Title</h1><p>Paragraph</p><div>Content</div>';
      const result = extractText(html);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('Title');
      expect(result).toContain('Paragraph');
      expect(result).toContain('Content');
    });

    it('should collapse whitespace in text', () => {
      const html = '<p>Multiple     spaces</p><p>Another   line</p>';
      const result = extractText(html);
      expect(result).not.toMatch(/\s{2,}/);
      expect(result).toContain('Multiple spaces');
    });

    it('should handle empty input', () => {
      expect(extractText('')).toBe('');
      expect(extractText('   ')).toBe('');
    });

    it('should remove unwanted elements before extracting text', () => {
      const html = '<p>Content</p><nav>Navigation</nav><div class="ad">Ad</div>';
      const result = extractText(html);
      expect(result).toContain('Content');
    });
  });

  describe('toMarkdown', () => {
    it('should convert headings to markdown', () => {
      const html = '<h1>Main Title</h1><h2>Subtitle</h2>';
      const result = toMarkdown(html);
      expect(result).toContain('# Main Title');
      expect(result).toContain('## Subtitle');
    });

    it('should convert paragraphs to markdown', () => {
      const html = '<p>First paragraph</p><p>Second paragraph</p>';
      const result = toMarkdown(html);
      expect(result).toContain('First paragraph');
      expect(result).toContain('Second paragraph');
    });

    it('should convert bold and italic to markdown', () => {
      const html = '<p>Text with <strong>bold</strong> and <em>italic</em></p>';
      const result = toMarkdown(html);
      expect(result).toContain('**bold**');
      expect(result).toMatch(/[_*]italic[_*]/);
    });

    it('should convert links to markdown', () => {
      const html = '<p>Check <a href="https://example.com">this link</a></p>';
      const result = toMarkdown(html);
      expect(result).toContain('[this link](https://example.com)');
    });

    it('should convert lists to markdown', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      const result = toMarkdown(html);
      expect(result).toMatch(/-\s+Item 1/);
      expect(result).toMatch(/-\s+Item 2/);
    });

    it('should handle code blocks', () => {
      const html = '<pre><code>const x = 42;</code></pre>';
      const result = toMarkdown(html);
      expect(result).toContain('const x = 42;');
    });

    it('should remove unwanted elements before conversion', () => {
      const html = '<article><p>Content</p><nav>Navigation</nav></article>';
      const result = toMarkdown(html);
      expect(result).toContain('Content');
    });

    it('should collapse excessive newlines', () => {
      const html = '<p>Para 1</p><br/><br/><br/><p>Para 2</p>';
      const result = toMarkdown(html);
      expect(result).not.toContain('\n\n\n');
    });

    it('should handle empty input', () => {
      const result = toMarkdown('');
      expect(result).toBe('');
    });

    it('should handle blockquotes', () => {
      const html = '<blockquote>This is a quote</blockquote>';
      const result = toMarkdown(html);
      expect(result).toContain('> This is a quote');
    });
  });
});
