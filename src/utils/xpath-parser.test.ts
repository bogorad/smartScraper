import { describe, it, expect } from 'vitest';
import { parseXPathResponse } from './xpath-parser.js';

describe('parseXPathResponse', () => {
  it('should parse valid JSON array of XPaths', () => {
    const content = '["//article", "//div[@id=\'content\']", "//main"]';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', "//div[@id='content']", '//main']);
  });

  it('should handle JSON array with whitespace', () => {
    const content = '  \n["//article", "//div"]  \n  ';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', '//div']);
  });

  it('should remove duplicate XPaths', () => {
    const content = '["//article", "//div", "//article", "//main", "//div"]';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', '//div', '//main']);
  });

  it('should parse JSON from code blocks', () => {
    const content = 'Here are the XPaths:\n```json\n["//article", "//div[@class=\'content\']"]\n```';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', "//div[@class='content']"]);
  });

  it('should parse JSON from code blocks without language tag', () => {
    const content = '```\n["//article", "//main"]\n```';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', '//main']);
  });

  it('should extract XPaths using regex when JSON parsing fails', () => {
    const content = 'The main content is at //article and you can also try //div[@id="main"]';
    const result = parseXPathResponse(content);
    
    expect(result).toContain('//article');
    expect(result).toContain('//div[@id="main"]');
  });

  it('should handle complex XPath expressions', () => {
    const content = '["//article[@class=\'post\']//div[@id=\'content\']", "//main//section[@class=\'entry\']"]';
    const result = parseXPathResponse(content);
    
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("//article[@class='post']//div[@id='content']");
  });

  it('should return empty array for empty input', () => {
    const result = parseXPathResponse('');
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid JSON', () => {
    const content = '{invalid json}';
    const result = parseXPathResponse(content);
    expect(result).toEqual([]);
  });

  it('should filter out non-string values from JSON array', () => {
    const content = '["//article", 123, "//div", null, true]';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', '//div']);
  });

  it('should handle JSON array inside markdown with extra text', () => {
    const content = 'Sure! Here are the XPaths you need:\n```json\n["//article", "//main"]\n```\nThese should work well.';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual(['//article', '//main']);
  });

  it('should extract multiple XPaths from natural language response', () => {
    const content = 'Try //article first, then //div[@class="content"], and finally //main';
    const result = parseXPathResponse(content);
    
    expect(result).toContain('//article');
    expect(result).toContain('//div[@class="content"]');
    expect(result).toContain('//main');
  });

  it('should handle XPaths with various attribute types', () => {
    const content = '["//div[@id=\'test\']", "//article[@class=\"main\"]", "//span[@data-id=\'123\']"]';
    const result = parseXPathResponse(content);
    
    expect(result.length).toBeGreaterThan(0);
  });

  it('should not extract invalid XPath-like strings', () => {
    const content = '// this is a comment, not an xpath';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual([]);
  });

  it('should handle response with only whitespace', () => {
    const content = '   \n\t\n   ';
    const result = parseXPathResponse(content);
    
    expect(result).toEqual([]);
  });

  it('should handle mixed format with both code block and plain text XPaths', () => {
    const content = '```\n["//article"]\n```\nOr try //div[@id="content"]';
    const result = parseXPathResponse(content);
    
    expect(result).toContain('//article');
  });
});
