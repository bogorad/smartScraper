// config/captcha-solver-config.js

// import dotenv from 'dotenv';
// dotenv.config();

const captchaSolverConfig = {
  // CAPTCHA service configuration
  service: process.env.CAPTCHA_SERVICE_NAME || '2captcha', // or 'anticaptcha', etc.
  apiKey: process.env.CAPTCHA_API_KEY || 'YOUR_FALLBACK_CAPTCHA_API_KEY',

  // Timeouts and intervals
  defaultTimeout: 120, // Default timeout for solving a CAPTCHA in seconds
  pollingInterval: 5, // Interval to poll for CAPTCHA solution in seconds
  navigationTimeout: 60000, // Timeout for page navigation after CAPTCHA solving in milliseconds
  postCaptchaSubmitDelay: 5000, // Delay after submitting CAPTCHA solution in milliseconds

  // User agent to use for CAPTCHA solving
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',

  // Proxy configuration for CAPTCHA solving
  proxy: {
    server: process.env.HTTP_PROXY || null, // Format: 'http://user:pass@host:port'
  },

  // 2Captcha specific configuration
  twoCaptcha: {
    // Standard API endpoints (for reCAPTCHA, hCaptcha, etc.)
    inUrl: 'https://2captcha.com/in.php',
    resUrl: 'https://2captcha.com/res.php',

    // New API endpoints (for DataDome and other modern CAPTCHA types)
    createTaskUrl: 'https://api.2captcha.com/createTask',
    getResultUrl: 'https://api.2captcha.com/getTaskResult'
  }
};

export { captchaSolverConfig };
