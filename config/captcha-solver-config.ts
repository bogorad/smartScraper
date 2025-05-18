// config/captcha-solver-config.ts
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export interface CaptchaSolverConfig {
  service: string;
  apiKey?: string;
  defaultTimeout: number;
  pollingInterval: number;
  maxRetries: number;
  postCaptchaSubmitDelay: number;
  twoCaptchaInUrl: string;
  twoCaptchaResUrl: string;
  dataDomeDomains: string[];
  debug?: boolean;
}

const captchaSolverConfig: CaptchaSolverConfig = {
  service: process.env.CAPTCHA_SERVICE_NAME || '2captcha',
  apiKey: process.env.TWOCAPTCHA_API_KEY,
  defaultTimeout: process.env.CAPTCHA_DEFAULT_TIMEOUT ? parseInt(process.env.CAPTCHA_DEFAULT_TIMEOUT, 10) : 120,
  pollingInterval: process.env.CAPTCHA_POLLING_INTERVAL ? parseInt(process.env.CAPTCHA_POLLING_INTERVAL, 10) : 5000,
  maxRetries: process.env.CAPTCHA_MAX_RETRIES ? parseInt(process.env.CAPTCHA_MAX_RETRIES, 10) : 3,
  postCaptchaSubmitDelay: process.env.POST_CAPTCHA_SUBMIT_DELAY ? parseInt(process.env.POST_CAPTCHA_SUBMIT_DELAY, 10) : 5000,
  twoCaptchaInUrl: 'https://2captcha.com/in.php',
  twoCaptchaResUrl: 'https://2captcha.com/res.php',
  dataDomeDomains: process.env.DATADOME_DOMAINS ? process.env.DATADOME_DOMAINS.split(',').map(d => d.trim()) : [],
  debug: (process.env.LOG_LEVEL || 'INFO').toUpperCase() === 'DEBUG',
};

export default captchaSolverConfig;
