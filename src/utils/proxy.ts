import crypto from 'crypto';

export interface ParsedProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
}

/**
 * Parse a proxy URL into its components
 * @param url - Proxy URL in format: protocol://[user:pass@]host:port
 * @returns Parsed proxy components or null if invalid
 */
export function parseProxyUrl(url: string): ParsedProxy | null {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '') as ParsedProxy['protocol'];
    
    if (!['http', 'https', 'socks4', 'socks5'].includes(protocol)) {
      return null;
    }
    
    return {
      protocol,
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 8080,
      username: parsed.username || undefined,
      password: parsed.password || undefined
    };
  } catch {
    return null;
  }
}

/**
 * Build a session-specific proxy URL for 2Captcha residential proxy
 * Transforms base URL by appending session parameters to username
 * Format: user-session-{UUID}-sessTime-{minutes}
 * 
 * @param baseUrl - Base proxy URL (e.g., http://user:pass@proxy.2captcha.com:8080)
 * @param sessionMinutes - How long to keep the same IP (default: 2 minutes)
 * @returns Session-specific proxy URL with unique session ID
 */
export function buildSessionProxyUrl(baseUrl: string, sessionMinutes: number = 2): string {
  const parsed = new URL(baseUrl);
  const sessionId = crypto.randomUUID().slice(0, 8);  // e.g., "a1b2c3d4"
  
  // Transform username: "myuser" → "myuser-session-a1b2c3d4-sessTime-2"
  const baseUser = parsed.username;
  parsed.username = `${baseUser}-session-${sessionId}-sessTime-${sessionMinutes}`;
  
  return parsed.toString();
}
