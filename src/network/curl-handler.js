// src/network/curl-handler.js
import axios from 'axios';
import https from 'https'; 
import { logger } from '../utils/logger.js';
import { NetworkError } from '../utils/error-handler.js';
import { DEFAULT_USER_AGENT } from '../constants.js';

const DEFAULT_TIMEOUT = 15000; 

async function fetchWithCurl(
  url,
  proxyDetails = null,
  customHeaders = null,
  userAgentString = null,
  timeout = DEFAULT_TIMEOUT,
  ignoreHttpsErrors = true
) {
  const effectiveUserAgent = userAgentString || DEFAULT_USER_AGENT;
  const headers = {
    'User-Agent': effectiveUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br', 
    ...(customHeaders || {}),
  };

  const axiosConfig = {
    headers,
    timeout,
    responseType: 'text',
    maxRedirects: 5,
  };

  if (proxyDetails && proxyDetails.server) {
    try {
      const proxyUrl = new URL(proxyDetails.server);
      axiosConfig.proxy = {
        protocol: proxyUrl.protocol.replace(':', ''),
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port, 10) || (proxyUrl.protocol === 'https:' ? 443 : 80),
        auth: (proxyUrl.username || proxyUrl.password) ? {
          username: decodeURIComponent(proxyUrl.username),
          password: decodeURIComponent(proxyUrl.password),
        } : undefined,
      };
      logger.info(`Using proxy for cURL request: ${axiosConfig.proxy.host}:${axiosConfig.proxy.port}`);
    } catch (e) {
      logger.error(`Invalid proxy server string for cURL: ${proxyDetails.server}. Error: ${e.message}`);
      throw new NetworkError(`Invalid proxy server string format for cURL`, { proxyServer: proxyDetails.server, originalError: e.message });
    }
  }

  if (ignoreHttpsErrors) {
    axiosConfig.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
  }

  logger.info(`Making cURL-like request to: ${url}`);
  try {
    const response = await axios.get(url, axiosConfig);
    logger.info(`cURL request to ${url} successful with status: ${response.status}`);
    return {
      success: true,
      html: response.data,
      status: response.status,
      headers: response.headers,
      error: null,
    };
  } catch (error) {
    if (error instanceof NetworkError) throw error; 

    logger.error(`cURL request to ${url} failed. Error: ${error.message}`);
    if (error.response) {
      logger.error(`Status: ${error.response.status}, Data: ${typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : 'Non-string data'}`);
      return {
        success: false,
        html: typeof error.response.data === 'string' ? error.response.data : null,
        status: error.response.status,
        headers: error.response.headers,
        error: `HTTP Error ${error.response.status}: ${error.message}`,
      };
    } else if (error.request) {
      logger.error('No response received for cURL request.');
      return {
        success: false,
        html: null,
        status: null,
        headers: null,
        error: `No response received: ${error.message}`,
      };
    } else {
      logger.error(`Error setting up cURL request: ${error.message}`);
      return {
        success: false,
        html: null,
        status: null,
        headers: null,
        error: `Request setup error: ${error.message}`,
      };
    }
  }
}

export { fetchWithCurl };
