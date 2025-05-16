// config/captcha-solver-config.js

// import dotenv from 'dotenv';
// dotenv.config();

const captchaSolverConfig = {
  // Example for 2Captcha, adapt for your chosen service
  service: process.env.CAPTCHA_SERVICE_NAME || '2captcha', // or 'anticaptcha', etc.
  apiKey: process.env.CAPTCHA_API_KEY || 'YOUR_FALLBACK_CAPTCHA_API_KEY',
  // Add other service-specific parameters if needed
  // For 2Captcha:
  // twoCaptchaSiteKeyUrl: 'https://2captcha.com/in.php',
  // twoCaptchaResultUrl: 'https://2captcha.com/res.php',
  defaultTimeout: 120, // Default timeout for solving a CAPTCHA in seconds
  pollingInterval: 5, // Interval to poll for CAPTCHA solution in seconds
};

export default captchaSolverConfig;
