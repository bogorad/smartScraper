// src/utils/url-helpers.js
// No console.log or console.error should be used here directly. Use logger if needed.
import { URL } from 'url'; // Node.js built-in URL module

/**
 * Normalizes a URL to get a consistent domain key.
 * Removes 'www.', scheme, path, query, and fragment.
 * Converts to lowercase.
 * @param {string} urlString - The URL string to normalize.
 * @returns {string|null} The normalized domain (e.g., "example.com") or null if URL is invalid.
 */
function normalizeDomain(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return null;
  }
  try {
    // Ensure a scheme is present for proper parsing, default to http if missing
    let prefixedUrl = urlString;
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      prefixedUrl = 'http://' + urlString;
    }
    const parsedUrl = new URL(prefixedUrl);
    let hostname = parsedUrl.hostname;
    // Remove 'www.' prefix if it exists
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname.toLowerCase();
  } catch (error) {
    // logger.warn(`[URL HELPER] Error normalizing URL "${urlString}": ${error.message}`); // Use logger if this needs to be logged
    return null; // Invalid URL
  }
}

/**
 * Extracts the base domain from a hostname (e.g., "blog.example.com" -> "example.com").
 * This is a simple implementation and might not cover all edge cases for complex TLDs (e.g., .co.uk).
 * @param {string} hostname - The hostname (e.g., "www.blog.example.com").
 * @returns {string|null} The base domain or null if input is invalid.
 */
function getBaseDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return null;
  }
  const parts = hostname.split('.');
  if (parts.length < 2) {
    return hostname; // Or null if it's just 'com' or something invalid
  }
  // Simple heuristic: if more than 2 parts, take the last two.
  // This doesn't handle multi-part TLDs like 'co.uk' perfectly without a TLD list.
  // A more robust solution would involve a list of public suffixes (e.g., from publicsuffix.org)
  // For now, a common case:
  if (parts.length >= 3 && (parts[parts.length-2] === 'co' || parts[parts.length-2] === 'com' || parts[parts.length-2] === 'org' || parts[parts.length-2] === 'net' || parts[parts.length-2] === 'gov')) {
      // Handles cases like example.co.uk, example.com.au
      if (parts.length >= 3) return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.'); // e.g. example.com from blog.example.com
}

/**
 * Checks if a URL is valid.
 * @param {string} urlString
 * @returns {boolean}
 */
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }
  try {
    new URL(urlString);
    return true;
  } catch (e) {
    return false;
  }
}

export { normalizeDomain, getBaseDomain, isValidUrl };
