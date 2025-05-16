import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY;
console.log(`Using 2Captcha API key: ${CAPTCHA_API_KEY ? 'Provided' : 'Not provided'}`);

async function testApiBalance() {
  try {
    const response = await axios.get(`https://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=getbalance&json=1`);
    console.log('API Balance Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('API Balance Error:', error.message);
    return null;
  }
}

// Run the test
testApiBalance().catch(console.error);
