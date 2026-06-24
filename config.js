import dotenv from 'dotenv';

dotenv.config();

export const config = {
  figma: {
    token: process.env.FIGMA_TOKEN,
  },

  cdn: {
    githubToken: process.env.GITHUB_TOKEN || '',
    githubRepo: process.env.GITHUB_REPO || '',
  },

  klaviyo: {
    key: process.env.KLAVIYO_KEY || 'MOCK',
  },

  shopify: {
    url: process.env.SHOPIFY_URL || 'https://example.com',
  },

  airtable: {
    token: process.env.AIRTABLE_TOKEN || '',
    baseId: process.env.AIRTABLE_BASE_ID || '',
    tableName: process.env.AIRTABLE_TABLE_NAME || 'Email Campaigns',
  },

  output: {
    slicesDir: 'output/slices',
    emailHtml: 'output/email.html',
    previewHtml: 'output/preview.html',
    klaviyoPayload: 'output/klaviyo-campaign-payload.json',
  },
};