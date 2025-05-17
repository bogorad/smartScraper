// Save this as test-url.mjs (or test-url.js, it should work with "type": "module")
import https from 'node:https';

// Let's use a different URL from your list, e.g., ft.com
const urlToTest = "https://www.ft.com/content/2ed8372b-8a82-4198-b6c1-dd1b9ef8feaa";
// const urlToTest = "https://www.nytimes.com/2025/05/17/weather/storms-tornadoes-missouri-kentucky.html"; // Another example

console.log(`Testing URL: ${urlToTest} from a system date of May 17, 2025`);

const options = {
  method: 'GET',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Node.js Test Script; SmartScraper)'
  }
};

const req = https.request(urlToTest, options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));

  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log('Response ended.');
  });
});

req.on('error', (e) => {
  console.error(`\nREQUEST ERROR for ${urlToTest}:`);
  console.error(`Message: ${e.message}`);
  console.error(`Code: ${e.code}`); // This is very important! e.g., CERT_HAS_EXPIRED, UNABLE_TO_VERIFY_LEAF_SIGNATURE
  // console.error(e); // Uncomment for the full error object if needed
});

req.end();
