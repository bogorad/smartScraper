const REMOVE_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe'];
const REMOVE_CLASSES = ['ad', 'advertisement', 'social-share', 'related-posts', 'sidebar', 'menu', 'nav', 'comment'];
const MAX_TEXT_LENGTH = 50;
const MAX_SIBLINGS = 2;
const MAX_DEPTH = 10;
const MAX_DOM_LENGTH = 8000;
const MAX_HTML_SIZE = 1024 * 1024; // 1MB limit to prevent ReDoS

export function simplifyDom(html: string): string {
  // Limit input size to prevent ReDoS attacks
  if (html.length > MAX_HTML_SIZE) {
    html = html.slice(0, MAX_HTML_SIZE);
  }

  let simplified = html;

  for (const tag of REMOVE_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
    simplified = simplified.replace(regex, '');
    const selfClosing = new RegExp(`<${tag}[^>]*/?>`, 'gi');
    simplified = simplified.replace(selfClosing, '');
  }

  simplified = simplified.replace(/<!--[\s\S]*?-->/g, '');

  for (const cls of REMOVE_CLASSES) {
    const regex = new RegExp(`<[^>]+class="[^"]*\\b${cls}\\b[^"]*"[^>]*>.*?</[^>]+>`, 'gis');
    simplified = simplified.replace(regex, '<!-- removed -->');
  }

  simplified = simplified.replace(/>([^<]{50,})</g, (_, text) => {
    const truncated = text.trim().slice(0, MAX_TEXT_LENGTH).trim();
    return `>${truncated}...<`;
  });

  simplified = simplified.replace(/\s+/g, ' ');
  simplified = simplified.replace(/>\s+</g, '><');

  if (simplified.length > MAX_DOM_LENGTH) {
    simplified = simplified.slice(0, MAX_DOM_LENGTH) + '\n<!-- truncated -->';
  }

  return simplified.trim();
}

export function extractSnippets(html: string, maxSnippets = 3, maxCharsPerSnippet = 150): string[] {
  const snippets: string[] = [];
  const paragraphRegex = /<p[^>]*>([^<]{100,})<\/p>/gi;
  let match;

  while ((match = paragraphRegex.exec(html)) !== null && snippets.length < maxSnippets) {
    let text = match[1].trim();
    
    const parentMatch = html.slice(Math.max(0, match.index - 200), match.index);
    const hasUnwantedParent = REMOVE_CLASSES.some(cls => 
      parentMatch.includes(`class="${cls}`) || parentMatch.includes(`class='${cls}`)
    );
    
    if (hasUnwantedParent) continue;

    if (text.length > maxCharsPerSnippet) {
      const cutoff = text.lastIndexOf(' ', maxCharsPerSnippet);
      text = text.slice(0, cutoff > 0 ? cutoff : maxCharsPerSnippet) + '...';
    }

    if (!snippets.includes(text)) {
      snippets.push(text);
    }
  }

  return snippets;
}
