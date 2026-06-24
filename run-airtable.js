import dotenv from 'dotenv';
import fs from 'fs';
import axios from 'axios';
import { spawnSync } from 'child_process';
dotenv.config();

const NOTES_FIELD = 'Notes';
const RESOLVE_FIELD = 'Resolve';

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing ${name}. Check your .env file.`);
  }
}

function parsePositiveInteger(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer value: ${value}`);
  }

  return parsed;
}

function parseArgs() {
  const rawArgs = process.argv.slice(2);

  const useCache = rawArgs.includes('--use-cache');
  const force = rawArgs.includes('--force');

  const campaignIndex = rawArgs.indexOf('--campaign');
  const campaignName =
    campaignIndex !== -1 ? rawArgs[campaignIndex + 1] : null;

  const maxIndex = rawArgs.indexOf('--max');
  const maxFromCli = maxIndex !== -1 ? rawArgs[maxIndex + 1] : null;

  if (campaignIndex !== -1 && !campaignName) {
    throw new Error('Missing campaign name after --campaign.');
  }

  if (maxIndex !== -1 && !maxFromCli) {
    throw new Error('Missing number after --max.');
  }

  const maxCampaigns = parsePositiveInteger(
    maxFromCli || process.env.MAX_CAMPAIGNS,
    null
  );

  return {
    useCache,
    force,
    campaignName,
    maxCampaigns,
  };
}

function getConfig() {
  return {
    airtable: {
      token: process.env.AIRTABLE_TOKEN || '',
      baseId: process.env.AIRTABLE_BASE_ID || '',
      tableName: process.env.AIRTABLE_TABLE_NAME || 'Email Campaigns',
    },
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
function makeSuccessNote() {
  return 'Success: Automation completed successfully.';
}

function makeErrorNote(errorMessage) {
  const cleanMessage = String(errorMessage || 'Unknown automation error.')
    .replace(/\s+/g, ' ')
    .trim();

  return `Error: ${cleanMessage}`.slice(0, 1500);
}

function extractFailureMessage(outputText) {
  const lines = String(outputText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line.startsWith('Reason:')) {
      const previousFail = lines
        .slice(Math.max(0, index - 5), index)
        .reverse()
        .find((candidate) => candidate.startsWith('FAIL:'));

      return previousFail ? `${previousFail} ${line}` : line;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (
      line.startsWith('FAIL:') ||
      line.startsWith('Error:') ||
      line.includes('Invalid ') ||
      line.includes('Missing ')
    ) {
      return line;
    }
  }

  return 'Automation command failed.';
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isFigmaRateLimitOutput(outputText) {
  const text = outputText.toLowerCase();

  return (
    text.includes('figma') &&
    (
      text.includes('status: 429') ||
      text.includes('http 429') ||
      text.includes('rate limit') ||
      text.includes('rate-limited') ||
      text.includes('too many requests')
    )
  );
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  return result;
}

async function getCampaigns({ campaignName, force, maxCampaigns }) {
  const config = getConfig();

  requireValue('AIRTABLE_TOKEN', config.airtable.token);
  requireValue('AIRTABLE_BASE_ID', config.airtable.baseId);
  requireValue('AIRTABLE_TABLE_NAME', config.airtable.tableName);

  const airtableUrl = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(
    config.airtable.tableName
  )}`;

  const eligibleStatusFormula = `OR(
    {Automation Status} = 'Scheduled',
    {Automation Status} = 'Error'
  )`;

let filterByFormula = `AND(
    {Design Status} = 'Approved',
    ${eligibleStatusFormula}
  )`;

  if (campaignName && force) {
    filterByFormula = `{Campaign Name} = '${escapeAirtableString(campaignName)}'`;
  }

 if (campaignName && !force) {
  filterByFormula = `AND(
      {Campaign Name} = '${escapeAirtableString(campaignName)}',
      {Design Status} = 'Approved',
      ${eligibleStatusFormula}
    )`;
}

  const records = [];
  let offset = null;

  do {
    const params = {
      filterByFormula,
      pageSize: 100,
    };

    if (offset) {
      params.offset = offset;
    }

    if (maxCampaigns) {
      params.maxRecords = maxCampaigns;
    }

    const response = await axios.get(airtableUrl, {
      headers: {
        Authorization: `Bearer ${config.airtable.token}`,
      },
      params,
    });

    records.push(...(response.data.records || []));
    offset = response.data.offset || null;

    if (maxCampaigns && records.length >= maxCampaigns) {
      return records.slice(0, maxCampaigns);
    }
  } while (offset);

  return records;
}

async function updateAirtableRecord(recordId, fields) {
  const config = getConfig();

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

function tryRestoreAutomationCache(campaignName) {
  console.log('\nAttempting to restore cached Figma export...');
  console.log(`Campaign: ${campaignName}`);

  const result = runCommand('node', [
    'skills/07-restore-cache.js',
    campaignName,
  ]);

  if (result.status === 0) {
    console.log('Cache restore succeeded. Figma API will be skipped.');
    return true;
  }

  if (result.status === 2) {
    console.log('No cache available. Automation will pull fresh from Figma.');
    return false;
  }

  throw new Error(`Cache restore failed for campaign: ${campaignName}`);
}

function runLocalAutomation({
  figmaUrl,
  productLinks,
  campaignName,
  useCache,
  storeKey,
}) {
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

  if (storeKey) {
    args.push('--store-key', storeKey);
  }

  const result = runCommand('node', args);

  if (result.status !== 0) {
    const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;

    if (isFigmaRateLimitOutput(combinedOutput)) {
      const error = new Error(
        'Figma API rate limit detected. Campaign deferred for a later run.'
      );

      error.code = 'FIGMA_RATE_LIMITED';
      throw error;
    }

  const failureMessage = extractFailureMessage(combinedOutput);
throw new Error(failureMessage);
  }
}

async function processCampaign(record, { useCache }) {
  const fields = record.fields;

  const selectedCampaignName = fields['Campaign Name'];
  const figmaUrl = fields['Figma URL'];
  const productLinks = parseProductLinks(fields['Product Links']);
  const firstProductUrl = productLinks[0];

  const storeKey = fields['Store Key'] || '';
  const forceRefresh = Boolean(fields['Force Refresh']);

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
  console.log(`Store Key: ${storeKey || 'none'}`);
  console.log(`Force Refresh: ${forceRefresh ? 'YES' : 'NO'}`);

  let shouldUseCache = useCache;

  if (forceRefresh) {
    console.log('Force Refresh is checked. Cache will be ignored.');
    shouldUseCache = false;
  }

  if (!forceRefresh && !useCache) {
    shouldUseCache = tryRestoreAutomationCache(selectedCampaignName);
  }

  console.log(`Use cached Figma export: ${shouldUseCache ? 'YES' : 'NO'}`);

  runLocalAutomation({
    figmaUrl,
    productLinks,
    campaignName: selectedCampaignName,
    useCache: shouldUseCache,
    storeKey,
  });

  const hostingReport = readJson('output/hosting-report.json');

  const safeCampaignName = makeSafeName(selectedCampaignName);
  const mockKlaviyoId = `MOCK-${safeCampaignName}-${Date.now()}`;

  const updateFields = {
  'Link Verification Status': 'Verified',
  'Automation Last Run Date': new Date().toISOString(),
  'HTML Live Preview URL': hostingReport.previewUrl,
  'CDN Image Folder URL': hostingReport.cdnImageFolderUrl,
  'Klaviyo Campaign ID': mockKlaviyoId,
  'Force Refresh': false,
  [RESOLVE_FIELD]: false,
  [NOTES_FIELD]: makeSuccessNote(),
};

  await updateAirtableRecord(record.id, updateFields);

  console.log('Airtable updated successfully.');
  console.log('Link Verification Status: Verified');
  console.log(`HTML Live Preview URL: ${hostingReport.previewUrl}`);
  console.log(`CDN Image Folder URL: ${hostingReport.cdnImageFolderUrl}`);
  console.log(`Klaviyo Campaign ID: ${mockKlaviyoId}`);
  console.log('Force Refresh reset to unchecked.');
  console.log('Resolve reset to unchecked.');
console.log(`Notes: ${makeSuccessNote()}`);
}

async function run() {
  const { campaignName, useCache, force, maxCampaigns } = parseArgs();

  console.log('Scanning Airtable for campaigns...');
  console.log(`Campaign filter: ${campaignName || 'none'}`);
  console.log(`Force mode: ${force ? 'YES' : 'NO'}`);
  console.log(`Use cache override: ${useCache ? 'YES' : 'NO'}`);
  console.log(`Max campaigns: ${maxCampaigns || 'no limit'}`);

  const records = await getCampaigns({
    campaignName,
    force,
    maxCampaigns,
  });

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
      if (error.code === 'FIGMA_RATE_LIMITED') {
        console.warn(`Campaign deferred: ${campaignLabel}`);
        console.warn(error.message);

        await updateAirtableRecord(record.id, {
  'Automation Last Run Date': new Date().toISOString(),
  [NOTES_FIELD]: `Deferred: ${error.message}`,
  [RESOLVE_FIELD]: false,
});

        results.push({
          campaign: campaignLabel,
          status: 'deferred',
          error: error.message,
        });

        continue;
      }

      console.error(`Campaign failed: ${campaignLabel}`);
      console.error(error.message);

      await updateAirtableRecord(record.id, {
  'Link Verification Status': 'Error',
  'Automation Last Run Date': new Date().toISOString(),
  [NOTES_FIELD]: makeErrorNote(error.message),
  [RESOLVE_FIELD]: false,
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
    let label = 'FAIL';

    if (result.status === 'success') {
      label = 'PASS';
    }

    if (result.status === 'deferred') {
      label = 'DEFERRED';
    }

    console.log(
      `${label} - ${result.campaign}${
        result.error ? ` | ${result.error}` : ''
      }`
    );
  }

  const failedCount = results.filter((result) => result.status === 'failed').length;

  if (failedCount > 0) {
    throw new Error(`${failedCount} campaign(s) failed.`);
  }

  const deferredCount = results.filter(
    (result) => result.status === 'deferred'
  ).length;

  if (deferredCount > 0) {
    console.log(`${deferredCount} campaign(s) deferred for a later run.`);
  }

  console.log('Airtable automation finished.');
}

run().catch((error) => {
  console.error('Airtable automation failed.');
  console.error(error.message);
  process.exit(1);
});