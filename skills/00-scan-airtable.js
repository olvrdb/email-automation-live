import fs from 'fs';
import axios from 'axios';
import { config } from '../config.js';

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing ${name}. Check your .env file.`);
  }
}

async function run() {
  requireValue('AIRTABLE_TOKEN', config.airtable.token);
  requireValue('AIRTABLE_BASE_ID', config.airtable.baseId);
  requireValue('AIRTABLE_TABLE_NAME', config.airtable.tableName);

  console.log('Scanning Airtable for approved campaigns...');

  const airtableUrl = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(
    config.airtable.tableName
  )}`;

  const filterByFormula = `AND({Design Status} = 'Approved', {Automation Status} = 'Scheduled')`;

  const response = await axios.get(airtableUrl, {
    headers: {
      Authorization: `Bearer ${config.airtable.token}`,
    },
    params: {
      filterByFormula,
      maxRecords: 10,
    },
  });

  const records = response.data.records || [];

  if (records.length === 0) {
    console.log('No approved campaigns ready for automation.');
    return;
  }

  const campaigns = records.map((record) => ({
    recordId: record.id,
    campaignName: record.fields['Campaign Name'],
    figmaUrl: record.fields['Figma URL'],
    designStatus: record.fields['Design Status'],
    automationStatus: record.fields['Automation Status'],
    productLinks: record.fields['Product Links'],
  }));

  fs.mkdirSync('output', { recursive: true });

  fs.writeFileSync(
    'output/approved-campaigns.json',
    JSON.stringify(campaigns, null, 2),
    'utf8'
  );

  console.log(`Found ${campaigns.length} approved campaign(s).`);

  for (const campaign of campaigns) {
    console.log('------------------------------');
    console.log(`Campaign: ${campaign.campaignName}`);
    console.log(`Record ID: ${campaign.recordId}`);
    console.log(`Design Status: ${campaign.designStatus}`);
    console.log(`Automation Status: ${campaign.automationStatus}`);
    console.log(`Figma URL: ${campaign.figmaUrl}`);
    console.log(`Product Links: ${campaign.productLinks}`);
  }

  console.log('Saved result to: output/approved-campaigns.json');
}

run().catch((error) => {
  console.error('Airtable scan failed.');
  console.error(error.response?.data || error.message);
  process.exit(1);
});