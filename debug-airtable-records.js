import axios from 'axios';
import { config } from './config.js';

async function run() {
  const airtableUrl = `https://api.airtable.com/v0/${config.airtable.baseId}/${encodeURIComponent(
    config.airtable.tableName
  )}`;

  const response = await axios.get(airtableUrl, {
    headers: {
      Authorization: `Bearer ${config.airtable.token}`,
    },
    params: {
      maxRecords: 10,
    },
  });

  const records = response.data.records || [];

  console.log(`Found ${records.length} total record(s).`);

  for (const record of records) {
    console.log('\n------------------------------');
    console.log(`Record ID: ${record.id}`);
    console.log(record.fields);
  }
}

run().catch((error) => {
  console.error('Debug failed.');
  console.error(error.response?.data || error.message);
  process.exit(1);
});