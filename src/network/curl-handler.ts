// src/network/curl-handler.ts
import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import https from 'https';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { NetworkError } from '../utils/error-handler.js';
import { scraperSettings } from '../../config/index.js';

interface ProxyDetails {
  server: string;
  username?: string;
  password?: string;
}

interface CurlResponse {
  success: boolean;
  html?: string;
  error?: string;
  statusCode?: number;
  finalUrl?: string;
}

async function fetchWithCurl(
  url: string,
  proxyDetails: ProxyDetails | null = null,
  headers: Record<string, string> | null = null,
  userAgent: string | null = null
): Promise<CurlResponse> {
  if (scraperSettings.debug) {
    logger.debug(`[fetchWithCurl] Attempting cURL-like request to: ${url}`);
  }

  // FAIL HARD if proxy not configured
  if (!proxyDetails || !proxyDetails.server) {
    logger.error(`[fetchWithCurl] Proxy is required but not configured for URL: ${url}`);
    throw new NetworkError('Proxy configuration is mandatory for all requests', { url });
  }

  const axiosConfig: AxiosRequestConfig = {
    timeout: 15000, // Reduced to 15 seconds to prevent hanging
    headers: {
      'User-Agent': userAgent || scraperSettings.defaultUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br', // Axios handles decompression
      'Connection': 'keep-alive',
      ...(headers || {}), // Spread any custom headers
    },
    maxRedirects: 10, // Increased to handle paywall redirects
    validateStatus: () => true, // Accept all status codes to get HTML at all costs
  };

  // ALWAYS configure proxy (mandatory)
  try {
    const proxyUrl = new URL(proxyDetails.server);
    axiosConfig.proxy = {
      protocol: proxyUrl.protocol.replace(':', ''),
      host: proxyUrl.hostname,
      port: parseInt(proxyUrl.port, 10) || (proxyUrl.protocol === 'https:' ? 443 : 80),
      auth: (proxyDetails.username && proxyDetails.password) ? {
        username: decodeURIComponent(proxyDetails.username),
        password: decodeURIComponent(proxyDetails.password),
      } : undefined,
    };
    if (scraperSettings.debug) {
      logger.info(`[fetchWithCurl] Using proxy for cURL request: ${axiosConfig.proxy.host}:${axiosConfig.proxy.port}`);
    }
  } catch (e: any) {
    logger.error(`[fetchWithCurl] Invalid proxy server string for cURL: ${proxyDetails.server}. Error: ${e.message}`);
    throw new NetworkError(`Invalid proxy server string format for cURL`, { proxyServer: proxyDetails.server, originalErrorName: e.name, originalErrorMessage: e.message });
  }

  // For HTTPS requests, especially with proxies or specific TLS requirements
  if (url.startsWith('https://')) {
    axiosConfig.httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Consider if this is appropriate for your use case
      // ciphers: 'DEFAULT@SECLEVEL=1' // Example: If needed for older sites, but usually not recommended
    });
  }

  if (scraperSettings.debug) {
    logger.debug(`[DEBUG_MODE] cURL Request Details for ${url}:`, {
        method: 'GET',
        headers: axiosConfig.headers,
        proxy: axiosConfig.proxy ? `${axiosConfig.proxy.host}:${axiosConfig.proxy.port}` : 'None',
        timeout: axiosConfig.timeout
    });
  }

  // Retry logic with IP rotation (up to 5 attempts)
  const maxRetries = 5;
  let lastError: any = null;

  logger.info(`[DEBUG] Starting cURL request with proxy: ${axiosConfig.proxy ? `${axiosConfig.proxy.host}:${axiosConfig.proxy.port}` : 'None'}`);
  logger.info(`[DEBUG] Request timeout: ${axiosConfig.timeout}ms`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[DEBUG] Making cURL-like request to: ${url} (attempt ${attempt}/${maxRetries})`);
      logger.info(`[DEBUG] About to call axios.get...`);

      const startTime = Date.now();
      const response: AxiosResponse = await axios.get(url, axiosConfig);
      const endTime = Date.now();

      logger.info(`[DEBUG] axios.get completed in ${endTime - startTime}ms`);
      logger.info(`cURL request to ${url} successful with status: ${response.status} on attempt ${attempt}`);

      // Get HTML at all costs - extract from response regardless of status
      const htmlContent: string = typeof response.data === 'string' ? response.data : response.data.toString();

      if (scraperSettings.debug) {
          logger.debug(`[DEBUG_MODE] cURL response for ${url}: Status ${response.status}, Content-Type: ${response.headers['content-type']}, Length: ${htmlContent?.length}`);
      }

      return {
        success: true,
        html: htmlContent,
        statusCode: response.status,
        finalUrl: response.request?.res?.responseUrl || url,
      };
    } catch (error: any) {
      const axiosError = error as AxiosError;
      lastError = axiosError;

      logger.warn(`[DEBUG] axios.get threw error: ${axiosError.code || 'NO_CODE'} - ${axiosError.message}`);
      logger.warn(`cURL request to ${url} failed on attempt ${attempt}/${maxRetries}. Error: ${axiosError.message}`);

      // Try to extract HTML from error response (for redirect errors, etc.)
      let errorHtml = '';
      if (axiosError.response && axiosError.response.data) {
        try {
          errorHtml = typeof axiosError.response.data === 'string' ? axiosError.response.data : '';
          if (errorHtml.length > 0) {
            logger.info(`[DEBUG] Extracted ${errorHtml.length} chars of HTML from error response`);
          }
        } catch (e) {
          logger.debug(`[DEBUG] Could not extract HTML from error response: ${e}`);
        }
      }

      // Get HTML from error response if available (at all costs)
      if (axiosError.response) {
        const htmlContent = typeof axiosError.response.data === 'string' ? axiosError.response.data : undefined;

        if (scraperSettings.debug) {
          logger.debug(`[DEBUG_MODE] Axios error response details for ${url} (attempt ${attempt}):`, {
            status: axiosError.response.status,
            statusText: axiosError.response.statusText,
            headers: axiosError.response.headers,
            dataType: typeof axiosError.response.data,
            dataLength: htmlContent?.length || 'N/A'
          });
        }

        // If we have HTML content, return it regardless of status code
        if (htmlContent && htmlContent.length > 0) {
          logger.info(`Got HTML content from error response (status ${axiosError.response.status}) on attempt ${attempt}`);
          return {
            success: false, // Mark as false due to error status, but provide HTML
            error: `cURL request to ${url} failed with status ${axiosError.response.status}`,
            html: htmlContent,
            statusCode: axiosError.response.status,
            finalUrl: url,
          };
        }
      }

      // If this is not the last attempt, wait and retry with new IP
      if (attempt < maxRetries) {
        logger.info(`Retrying request to ${url} with new proxy IP (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        // Proxy will automatically rotate IP on next request
        continue;
      }
    }
  }

  // All retries exhausted
  const axiosError = lastError as AxiosError;
  logger.error(`All ${maxRetries} attempts failed for cURL request to ${url}. Final error: ${axiosError.message}`);

  const errorDetails: any = {
    url,
    method: 'cURL',
    originalErrorName: axiosError.name,
    originalErrorMessage: axiosError.message,
    attemptsExhausted: maxRetries
  };

  if (axiosError.request) {
    errorDetails.reason = 'no_response';
    throw new NetworkError(`No response received for cURL request to ${url} after ${maxRetries} attempts`, errorDetails);
  } else {
    errorDetails.reason = 'request_setup_error';
    throw new NetworkError(`Error setting up cURL request for ${url} after ${maxRetries} attempts: ${axiosError.message}`, errorDetails);
  }
}

export { fetchWithCurl, ProxyDetails, CurlResponse };
