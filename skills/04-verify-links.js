import fs from 'fs';
import axios from 'axios';
import { config } from '../config.js';

async function checkUrl(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 Email Automation Link Checker',
      },
    });

    return {
      url,
      finalUrl: response.request?.res?.responseUrl || url,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      result: response.status >= 200 && response.status < 400 ? 'PASS' : 'FAIL',
    };
  } catch (error) {
    return {
      url,
      finalUrl: null,
      status: null,
      ok: false,
      result: 'FAIL',
      error: error.message,
    };
  }
}

async function run() {
  const links = process.argv.slice(2);
  const urlsToCheck = links.length > 0 ? links : [config.shopify.url];

  console.log('Verifying product links...');

  const results = [];

  for (const url of urlsToCheck) {
    console.log(`Checking: ${url}`);

    const result = await checkUrl(url);
    results.push(result);

    if (result.ok) {
      console.log(`PASS: ${url} returned ${result.status}`);
    } else {
      console.log(`FAIL: ${url}`);
      console.log(`Reason: ${result.error || `Status ${result.status}`}`);
    }
  }

  fs.mkdirSync('output', { recursive: true });

  const reportPath = 'output/link-report.json';

  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');

  const failedLinks = results.filter((item) => !item.ok);

  console.log('Link verification complete.');
  console.log(`Report saved to: ${reportPath}`);

  if (failedLinks.length > 0) {
    console.error(`${failedLinks.length} link(s) failed verification.`);
    process.exit(1);
  }

  console.log('All links passed.');
}

run().catch((error) => {
  console.error('Link verification failed.');
  console.error(error.message);
  process.exit(1);
});