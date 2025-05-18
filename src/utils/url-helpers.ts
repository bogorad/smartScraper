// src/utils/url-helpers.ts
import { logger } from './logger.js';
import { scraperSettings } from '../../config/index.js'; // For debug flag

function normalizeDomain(urlString: string | null | undefined): string | null {
  if (scraperSettings.debug) {
    logger.debug(`[DEBUG_MODE][normalizeDomain] Input urlString: "${urlString}" (Type: ${typeof urlString}, Length: ${urlString?.length})`);
    if (urlString && typeof urlString === 'string') {
        const charCodes = Array.from(urlString).map(char => char.charCodeAt(0));
        logger.debug(`[DEBUG_MODE][normalizeDomain] Char codes for urlString: [${charCodes.join(', ')}]`);
    }
  }

  if (!urlString || typeof urlString !== 'string') {
    logger.warn(`[normalizeDomain] urlString is invalid (falsy or not a string). Input: "${urlString}". Returning null.`);
    return null;
  }

  let prefixedUrl = urlString.trim(); // Trim upfront
  // Clean common problematic invisible characters
  prefixedUrl = prefixedUrl.replace(/[\u200B-\u200D\uFEFF\0]/g, '');

  if (scraperSettings.debug && prefixedUrl !== urlString.trim()) {
    logger.debug(`[DEBUG_MODE][normalizeDomain] urlString was cleaned. Original trimmed: "${urlString.trim()}", Cleaned: "${prefixedUrl}"`);
  }


  if (!prefixedUrl.startsWith('http://') && !prefixedUrl.startsWith('https://')) {
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][normalizeDomain] urlString "${prefixedUrl}" missing scheme, prefixing with 'http://'.`);
    }
    prefixedUrl = 'http://' + prefixedUrl;
  }

  try {
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][normalizeDomain] Attempting to parse with new URL(): "${prefixedUrl}"`);
    }
    const parsedUrl = new URL(prefixedUrl);
    let hostname = parsedUrl.hostname;

    // --- DETAILED HOSTNAME DEBUGGING ---
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][normalizeDomain] Successfully created parsedUrl object for "${prefixedUrl}".`);
        logger.debug(`[DEBUG_MODE][normalizeDomain] parsedUrl.hostname value: "${parsedUrl.hostname}" (Type: ${typeof parsedUrl.hostname}, Length: ${parsedUrl.hostname?.length})`);
        // Log all properties of parsedUrl to see its structure
        // Be cautious as this can be verbose.
        // logger.debug(`[DEBUG_MODE][normalizeDomain] Full parsedUrl object:`, JSON.stringify(parsedUrl, null, 2));
    }
    // --- END DETAILED HOSTNAME DEBUGGING ---

    if (!hostname) { // Check if hostname is falsy (empty string, null, undefined)
      logger.warn(`[normalizeDomain] Parsed URL "${prefixedUrl}" but got a falsy hostname (e.g., empty string). Original input: "${urlString}". Returning null.`);
      if (scraperSettings.debug) {
          logger.debug(`[DEBUG_MODE][normalizeDomain] Details of parsedUrl that resulted in falsy hostname: protocol="${parsedUrl.protocol}", host="${parsedUrl.host}", pathname="${parsedUrl.pathname}"`);
      }
      return null;
    }

    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    const resultHostname = hostname.toLowerCase();
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][normalizeDomain] Output hostname: "${resultHostname}" for input "${urlString}"`);
    }
    return resultHostname;
  } catch (error: any) {
    logger.warn(`[normalizeDomain] Error during new URL("${prefixedUrl}") parsing or subsequent processing. Original input: "${urlString}". Error: ${error.message}. Returning null.`);
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][normalizeDomain] Full error object for "${prefixedUrl}":`, error);
        const charCodesPrefixed = Array.from(prefixedUrl).map(char => char.charCodeAt(0));
        logger.debug(`[DEBUG_MODE][normalizeDomain] Char codes for prefixedUrl that failed: [${charCodesPrefixed.join(', ')}]`);
    }
    return null;
  }
}

function getBaseDomain(hostname: string | null | undefined): string | null {
  if (!hostname || typeof hostname !== 'string') {
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][getBaseDomain] Invalid input hostname: "${hostname}". Returning null.`);
    }
    return null;
  }
  try {
    const parts = hostname.split('.');
    if (parts.length <= 2) {
      return hostname; // example.com or example
    }
    // Handle common TLDs like .co.uk, .com.au
    if (parts.length > 2 && (parts[parts.length - 2] === 'co' || parts[parts.length - 2] === 'com')) {
      return parts.slice(-3).join('.'); // example.co.uk
    }
    return parts.slice(-2).join('.'); // blog.example.com -> example.com
  } catch (error: any) {
    logger.warn(`[getBaseDomain] Error processing hostname "${hostname}": ${error.message}. Returning original hostname.`);
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][getBaseDomain] Full error object:`, error);
    }
    return hostname; // Fallback or could return null
  }
}

function isValidUrl(urlString: string | null | undefined): boolean {
  if (scraperSettings.debug) {
    logger.debug(`[DEBUG_MODE][isValidUrl] Input urlString: "${urlString}" (Type: ${typeof urlString}, Length: ${urlString?.length})`);
  }
  if (!urlString || typeof urlString !== 'string') {
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][isValidUrl] urlString is falsy or not a string. Returning false.`);
    }
    return false;
  }

  let cleanedUrlString = urlString.trim().replace(/[\u200B-\u200D\uFEFF\0]/g, '');
  if (scraperSettings.debug && cleanedUrlString !== urlString.trim()) {
    logger.debug(`[DEBUG_MODE][isValidUrl] URL was cleaned. Original trimmed: "${urlString.trim()}", Cleaned: "${cleanedUrlString}"`);
  }


  try {
    new URL(cleanedUrlString); // Throws TypeError if invalid
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][isValidUrl] Successfully parsed "${cleanedUrlString}" with new URL(). Returning true.`);
    }
    return true;
  } catch (error: any) {
    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE][isValidUrl] Failed to parse "${cleanedUrlString}" with new URL(). Error: ${error.message}`);
        const charCodes = Array.from(cleanedUrlString).map(char => char.charCodeAt(0));
        logger.debug(`[DEBUG_MODE][isValidUrl] Char codes for cleanedUrlString that failed: [${charCodes.join(', ')}]`);
        logger.debug('[DEBUG_MODE][isValidUrl] Full error object during new URL() parsing:', error);
    }
    return false;
  }
}

export { normalizeDomain, getBaseDomain, isValidUrl };
