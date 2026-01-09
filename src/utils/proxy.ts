import crypto from 'crypto';
import { logger } from './logger.js';

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
      logger.warn('Invalid proxy protocol', { protocol, url: url.replace(/:([^:@]+)@/, ':***@') }, 'PROXY');
      return null;
    }
    
    const result: ParsedProxy = {
      protocol,
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 8080,
      username: parsed.username || undefined,
      password: parsed.password || undefined
    };
    
    logger.debug('Parsed proxy URL', {
      protocol: result.protocol,
      host: result.host,
      port: result.port,
      hasAuth: !!(result.username && result.password)
    }, 'PROXY');
    
    return result;
  } catch (error) {
    logger.error('Failed to parse proxy URL', { error: error instanceof Error ? error.message : String(error) }, 'PROXY');
    return null;
  }
}

/**
 * Build a session-specific proxy URL for 2Captcha residential proxy
 * Constructs URL from separate host, login, and password components
 * Format: http://user-session-{UUID}-sessTime-{minutes}:password@host
 * 
 * @param host - Proxy host with port (e.g., "170.106.118.114:2333")
 * @param login - Base username/login (e.g., "u76614f10561905ca-zone-custom-region-us")
 * @param password - Proxy password
 * @param sessionMinutes - How long to keep the same IP (default: 2 minutes)
 * @returns Session-specific proxy URL with unique session ID
 */
export function buildSessionProxyUrl(
  host: string,
  login: string,
  password: string,
  sessionMinutes: number = 2
): string {
  const sessionId = crypto.randomUUID().slice(0, 8);  // e.g., "a1b2c3d4"
  
  // Strip any existing session params from login (in case user provided them)
  // e.g., "user-zone-custom-session-xyz-sessTime-2" -> "user-zone-custom"
  const baseLogin = login.split('-session-')[0];
  
  // Build username with session params
  const sessionLogin = `${baseLogin}-session-${sessionId}-sessTime-${sessionMinutes}`;
  
  // Construct full URL (always use http:// for Chromium compatibility)
  const proxyUrl = `http://${sessionLogin}:${password}@${host}`;
  
  logger.debug('Built session proxy URL', {
    sessionId,
    stickyMinutes: sessionMinutes,
    baseLogin,
    host,
    // Redact password
    proxyUrlRedacted: proxyUrl.replace(/:([^:@]+)@/, ':***@')
  }, 'PROXY');
  
  return proxyUrl;
}
