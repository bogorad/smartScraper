// config/captcha-solver-config.js
import dotenv from 'dotenv';
dotenv.config();

export const captchaSolverConfig = {
  apiKey: process.env.TWOCAPTCHA_API_KEY,
  service: process.env.CAPTCHA_SERVICE_NAME || '2captcha',
  defaultTimeout: 120, 
  pollingInterval: 5, 
  navigationTimeout: 60000,
  postCaptchaSubmitDelay: 5000,
  proxy: {
    server: process.env.HTTP_PROXY || null,
  },
  inUrl: 'https://2captcha.com/in.php',
  resUrl: 'https://2captcha.com/res.php',
  createTaskUrl: 'https://api.2captcha.com/createTask',
  getTaskResultUrl: 'https://api.2captcha.com/getTaskResult'
};
