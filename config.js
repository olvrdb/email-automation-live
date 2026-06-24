import dotenv from 'dotenv';

dotenv.config();

function parseShopifyStoresJson() {
  const rawValue = process.env.SHOPIFY_STORES_JSON || '';

  if (!rawValue) {
    return {};
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(
      'Invalid SHOPIFY_STORES_JSON. It must be valid JSON, for example: {"Demo":{"domain":"demo.myshopify.com","adminToken":"shpat_xxx"}}'
    );
  }
}

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

    // Old single-store fields kept for backward compatibility.
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN || '',
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN || '',

    // New multi-store setup.
    stores: parseShopifyStoresJson(),

    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-04',
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