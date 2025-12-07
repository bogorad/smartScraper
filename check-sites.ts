import fs from 'fs';
import { parse } from 'comment-json';

try {
  const content = fs.readFileSync('data/sites.jsonc', 'utf-8');
  const data = parse(content);
  console.log(`Successfully parsed. Items: ${data.length}`);
  console.log('First item:', data[0].domainPattern);
  console.log('Last item:', data[data.length - 1].domainPattern);
} catch (e) {
  console.error('Parse error:', e);
}
