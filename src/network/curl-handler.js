// src/network/curl-handler.js

import axios from 'axios';
import https from 'https'; // To configure a custom agent for ignoring SSL errors if needed
import { logger } from '../utils/logger.js';
import { NetworkError } from '../utils/error-handler.js';
// import { scraperSettings } from '../../config/index.js'; // If specific timeouts are needed from global config

// Default User-Agent if none is provided.
// It's good to use a common browser User-Agent.
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36';
const DEFAULT_TIMEOUT = 15000; // 15 seconds default timeout for cURL requests

/**
 * Fetches a webpage using an HTTP client (axios), simulating a cURL request.
 *
 * @param {string} url - The URL to fetch.
 * @param {object|null} proxyDetails - Proxy configuration.
 *        Example: { protocol: 'http', host: 'proxy.example.com', port: 8080, auth: { username: 'user', password: 'pass'} }
 *        Or for a simple proxy string: { server: 'http://user:pass@proxy.example.com:8080' }
 * @param {object|null} customHeaders - Custom HTTP headers to include in the request.
 * @param {string|null} userAgentString - The User-Agent string to use. Defaults to a common browser UA.
 * @param {number} timeout - Request timeout in milliseconds.
 * @param {boolean} ignoreHttpsErrors - Whether to ignore SSL/TLS certificate errors.
 * @returns {Promise<{success: boolean, html: string|null, status: number|null, error: string|null, headers: object|null}>}
 *          An object indicating success, the fetched HTML, status code, error message, and response headers.
 */
async function fetchWithCurl(
    url,
    proxyDetails = null,
    customHeaders = null,
    userAgentString = null,
    timeout = DEFAULT_TIMEOUT,
    ignoreHttpsErrors = true // Often useful for scraping, but be aware of security implications
) {
    const headers = {
        'User-Agent': userAgentString || DEFAULT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br', // Axios handles decompression automatically
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        ...(customHeaders || {}),
    };

    const axiosConfig = {
        headers: headers,
        timeout: timeout,
        responseType: 'text', // Get response as a string
        // Axios will follow redirects by default (max 5)
        // maxRedirects: 5,
    };

    if (proxyDetails) {
        if (proxyDetails.server) { // Simple proxy string format
            try {
                const proxyUrl = new URL(proxyDetails.server);
                axiosConfig.proxy = {
                    protocol: proxyUrl.protocol.replace(':', ''),
                    host: proxyUrl.hostname,
                    port: parseInt(proxyUrl.port, 10),
                };
                if (proxyUrl.username || proxyUrl.password) {
                    axiosConfig.proxy.auth = {
                        username: decodeURIComponent(proxyUrl.username),
                        password: decodeURIComponent(proxyUrl.password),
                    };
                }
            } catch (e) {
                logger.error(`Invalid proxy server string format: ${proxyDetails.server}`);
                throw new NetworkError(`Invalid proxy server string format`, { proxyServer: proxyDetails.server }, e);
            }
        } else { // Structured proxy format
            axiosConfig.proxy = {
                protocol: proxyDetails.protocol || 'http',
                host: proxyDetails.host,
                port: parseInt(proxyDetails.port, 10),
            };
            if (proxyDetails.auth) {
                axiosConfig.proxy.auth = {
                    username: proxyDetails.auth.username,
                    password: proxyDetails.auth.password,
                };
            }
        }
        logger.info(`Using proxy for cURL request: ${axiosConfig.proxy.host}:${axiosConfig.proxy.port}`);
    }

    if (ignoreHttpsErrors) {
        axiosConfig.httpsAgent = new https.Agent({
            rejectUnauthorized: false
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
            error: null,
            headers: response.headers,
        };
    } catch (error) {
        // If it's already a NetworkError, just re-throw it
        if (error instanceof NetworkError) {
            throw error;
        }

        logger.error(`cURL request to ${url} failed. Error: ${error.message}`);

        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            logger.error(`Status: ${error.response.status}, Data: ${typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : 'Non-string data'}`);

            // Create a NetworkError but also return data that might be useful
            const responseData = {
                success: false,
                html: typeof error.response.data === 'string' ? error.response.data : null, // Return HTML even on error if available
                status: error.response.status,
                error: `HTTP Error ${error.response.status}: ${error.message}`,
                headers: error.response.headers,
            };

            // Throw a NetworkError with the response data
            throw new NetworkError(
                `HTTP Error ${error.response.status} for ${url}`,
                {
                    url,
                    status: error.response.status,
                    responseData: responseData
                },
                error
            );
        } else if (error.request) {
            // The request was made but no response was received
            logger.error('No response received for cURL request.');
            throw new NetworkError(
                `No response received for cURL request to ${url}`,
                { url },
                error
            );
        } else {
            // Something happened in setting up the request that triggered an Error
            logger.error(`Error setting up cURL request: ${error.message}`);
            throw new NetworkError(
                `Error setting up cURL request to ${url}`,
                { url },
                error
            );
        }
    }
}

export { fetchWithCurl };
