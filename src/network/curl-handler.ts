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

  const axiosConfig: AxiosRequestConfig = {
    timeout: scraperSettings.curlTimeout || 30000, // 30 seconds timeout
    headers: {
      'User-Agent': userAgent || scraperSettings.defaultUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br', // Axios handles decompression
      'Connection': 'keep-alive',
      ...(headers || {}), // Spread any custom headers
    },
    // responseType: 'arraybuffer', // To handle different encodings better, then convert
    maxRedirects: 5,
  };

  if (proxyDetails && proxyDetails.server) {
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

  try {
    logger.info(`Making cURL-like request to: ${url}`);
    const response: AxiosResponse = await axios.get(url, axiosConfig);
    logger.info(`cURL request to ${url} successful with status: ${response.status}`);

    // TODO: Handle character encoding more robustly if issues arise.
    // For now, assume Axios handles common cases or response.data is string.
    const htmlContent: string = typeof response.data === 'string' ? response.data : response.data.toString();

    if (scraperSettings.debug) {
        logger.debug(`[DEBUG_MODE] cURL response for ${url}: Status ${response.status}, Content-Type: ${response.headers['content-type']}, Length: ${htmlContent?.length}`);
    }

    return {
      success: true,
      html: htmlContent,
      statusCode: response.status,
      finalUrl: response.request?.res?.responseUrl || url, // Get final URL after redirects
    };
  } catch (error: any) {
    const axiosError = error as AxiosError;
    logger.error(`cURL request to ${url} failed. Error: ${axiosError.message}`);

    const errorDetails: any = {
      url,
      method: 'cURL',
      originalErrorName: axiosError.name,
      originalErrorMessage: axiosError.message,
      // htmlContent is removed
    };

    if (axiosError.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorDetails.statusCode = axiosError.response.status;
      const errorDataString = typeof axiosError.response.data === 'string' ? axiosError.response.data : (Buffer.isBuffer(axiosError.response.data) ? axiosError.response.data.toString('utf-8', 0, 500) : JSON.stringify(axiosError.response.data));

      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full Axios error response for ${url}:`, {
            status: axiosError.response.status,
            headers: axiosError.response.headers,
            dataPreview: errorDataString.substring(0, 200) + (errorDataString.length > 200 ? '...' : '')
        });
      }
      // Return a CurlResponse object for operational errors
      return {
        success: false,
        error: `cURL request to ${url} failed with status ${axiosError.response.status}`,
        html: typeof axiosError.response.data === 'string' ? axiosError.response.data : undefined, // Provide HTML if it's string
        statusCode: axiosError.response.status,
        finalUrl: url,
      };
      // throw new NetworkError(`cURL request to ${url} failed with status ${axiosError.response.status}`, errorDetails);
    } else if (axiosError.request) {
      // The request was made but no response was received
      logger.error('No response received for cURL request.');
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Axios error request details for ${url}:`, axiosError.request);
      }
      errorDetails.reason = 'no_response';
      throw new NetworkError(`No response received for cURL request to ${url}`, errorDetails);
    } else {
      // Something happened in setting up the request that triggered an Error
      logger.error(`Error setting up cURL request: ${axiosError.message}`);
      if (scraperSettings.debug) {
        logger.error(`[DEBUG_MODE] Full cURL error object for ${url}:`, axiosError);
      }
      errorDetails.reason = 'request_setup_error';
      throw new NetworkError(`Error setting up cURL request for ${url}: ${axiosError.message}`, errorDetails);
    }
  }
}

export { fetchWithCurl, ProxyDetails, CurlResponse };
