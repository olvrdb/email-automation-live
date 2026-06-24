import fs from 'fs';
import axios from 'axios';
import { execFileSync } from 'child_process';
import { config } from './config.js';

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing ${name}. Check your .env file.`);
  }
}

function parseArgs() {
  const rawArgs = process.argv.slice(2);

  const useCache = rawArgs.includes('--use-cache');
  const force = rawArgs.includes('--force');

  const campaignIndex = rawArgs.indexOf('--campaign');
  const campaignName =
    campaignIndex !== -1 ? rawArgs[campaignIndex + 1] : null;

  if (campaignIndex !== -1 && !campaignName) {
    throw new Error('Missing campaign name after --campaign.');
  }

  return {
    useCache,
    force,
    campaignName,
  };
}

function escapeAirtableString(value) {
  return String(value).replace(/'/g, "\\'");
}

function parseProductLinks(rawLinks) {
  if (!rawLinks) {
    return [];
  }

  return rawLinks
    .split(/\r?\n|,|\|/)
    .map((link) => link.trim())
    .filter(Boolean);
}

function makeSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function getCampaigns({ campaignName, force }) {
  requireValue('AIRTABLE_TOKEN', config.airtable.token);
  requireValue('AIRTABLE_BASE_ID', config.airtable.baseId);
  requireValue('AIRTABLE_TABLE_NAME', config.airtable.tableName);

  const airtableUrl = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(
    config.airtable.tableName
  )}`;

  let filterByFormula = `AND(
    {Design Status} = 'Approved',
    {Automation Status} = 'Scheduled'
  )`;

  if (campaignName && force) {
    filterByFormula = `{Campaign Name} = '${escapeAirtableString(campaignName)}'`;
  }

  if (campaignName && !force) {
    filterByFormula = `AND(
      {Campaign Name} = '${escapeAirtableString(campaignName)}',
      {Design Status} = 'Approved',
      {Automation Status} = 'Scheduled'
    )`;
  }

  const response = await axios.get(airtableUrl, {
    headers: {
      Authorization: `Bearer ${config.airtable.token}`,
    },
    params: {
      filterByFormula,
      maxRecords: 50,
    },
  });

  return response.data.records || [];
}

async function updateAirtableRecord(recordId, fields) {
  const airtableUrl = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(
    config.airtable.tableName
  )}/${recordId}`;

  await axios.patch(
    airtableUrl,
    {
      fields,
    },
    {
      headers: {
        Authorization: `Bearer ${config.airtable.token}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

function runLocalAutomation({ figmaUrl, productLinks, campaignName, useCache }) {
  const productLinksText = productLinks.join('|');

  const args = [
    'run.js',
    figmaUrl,
    productLinksText,
    campaignName,
    'Automated Email Preview',
  ];

  if (useCache) {
    args.push('--use-cache');
  }

  execFileSync('node', args, {
    stdio: 'inherit',
    shell: false,
  });
}

async function processCampaign(record, { useCache }) {
  const fields = record.fields;

  const selectedCampaignName = fields['Campaign Name'];
  const figmaUrl = fields['Figma URL'];
  const productLinks = parseProductLinks(fields['Product Links']);
  const firstProductUrl = productLinks[0];

  console.log('\n========================================');
  console.log(`Processing Airtable campaign: ${selectedCampaignName || record.id}`);
  console.log('========================================');

  if (!selectedCampaignName) {
    throw new Error('Campaign Name is missing.');
  }

  if (!figmaUrl) {
    throw new Error('Figma URL is missing.');
  }

  if (!firstProductUrl) {
    throw new Error('Product Links is missing.');
  }

  console.log(`Record ID: ${record.id}`);
  console.log(`Figma URL: ${figmaUrl}`);
  console.log(`Primary product URL: ${firstProductUrl}`);
  console.log(`Product links to verify: ${productLinks.length}`);
  console.log(`Use cached Figma export: ${useCache ? 'YES' : 'NO'}`);

  runLocalAutomation({
    figmaUrl,
    productLinks,
    campaignName: selectedCampaignName,
    useCache,
  });

  const hostingReport = readJson('output/hosting-report.json');

  const safeCampaignName = makeSafeName(selectedCampaignName);
  const mockKlaviyoId = `MOCK-${safeCampaignName}-${Date.now()}`;

  await updateAirtableRecord(record.id, {
    'Link Verification Status': 'Verified',
    'Automation Last Run Date': new Date().toISOString(),
    'HTML Live Preview URL': hostingReport.previewUrl,
    'CDN Image Folder URL': hostingReport.cdnImageFolderUrl,

    // Still mock until we connect the real Klaviyo API.
    'Klaviyo Campaign ID': mockKlaviyoId,
  });

  console.log('Airtable updated successfully.');
  console.log('Link Verification Status: Verified');
  console.log(`HTML Live Preview URL: ${hostingReport.previewUrl}`);
  console.log(`CDN Image Folder URL: ${hostingReport.cdnImageFolderUrl}`);
  console.log(`Klaviyo Campaign ID: ${mockKlaviyoId}`);
}

async function run() {
  const { campaignName, useCache, force } = parseArgs();

  console.log('Scanning Airtable for campaigns...');
  console.log(`Campaign filter: ${campaignName || 'none'}`);
  console.log(`Force mode: ${force ? 'YES' : 'NO'}`);
  console.log(`Use cache: ${useCache ? 'YES' : 'NO'}`);

  const records = await getCampaigns({ campaignName, force });

  if (records.length === 0) {
    console.log('No campaigns found for processing.');
    return;
  }

  if (useCache && records.length > 1) {
    throw new Error(
      'Do not use --use-cache when processing multiple campaigns. Cache is only safe for single-campaign testing.'
    );
  }

  console.log(`Found ${records.length} campaign(s) to process.`);

  const results = [];

  for (const record of records) {
    const campaignLabel = record.fields['Campaign Name'] || record.id;

    try {
      await processCampaign(record, { useCache });

      results.push({
        campaign: campaignLabel,
        status: 'success',
      });
    } catch (error) {
      console.error(`Campaign failed: ${campaignLabel}`);
      console.error(error.message);

      await updateAirtableRecord(record.id, {
        'Link Verification Status': 'Error',
        'Automation Last Run Date': new Date().toISOString(),
      });

      results.push({
        campaign: campaignLabel,
        status: 'failed',
        error: error.message,
      });
    }
  }

  console.log('\n========================================');
  console.log('Airtable automation summary');
  console.log('========================================');

  for (const result of results) {
    console.log(
      `${result.status === 'success' ? 'PASS' : 'FAIL'} - ${result.campaign}${
        result.error ? ` | ${result.error}` : ''
      }`
    );
  }

  const failedCount = results.filter((result) => result.status === 'failed').length;

  if (failedCount > 0) {
    throw new Error(`${failedCount} campaign(s) failed.`);
  }

  console.log('All campaigns processed successfully.');
}

run().catch((error) => {
  console.error('Airtable automation failed.');
  console.error(error.message);
  process.exit(1);
});