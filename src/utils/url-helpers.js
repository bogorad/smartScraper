// src/utils/url-helpers.js
import { URL } from 'url'; 

function normalizeDomain(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return null;
  }
  try {
    let prefixedUrl = urlString;
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      prefixedUrl = 'http://' + urlString;
    }
    const parsedUrl = new URL(prefixedUrl);
    let hostname = parsedUrl.hostname;
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname.toLowerCase();
  } catch (error) {
    return null; 
  }
}

function getBaseDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return null;
  }
  const parts = hostname.split('.');
  if (parts.length < 2) {
    return hostname; 
  }
  if (parts.length >= 3 && (parts[parts.length-2] === 'co' || parts[parts.length-2] === 'com' || parts[parts.length-2] === 'org' || parts[parts.length-2] === 'net' || parts[parts.length-2] === 'gov')) {
      if (parts.length >= 3) return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.'); 
}

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
