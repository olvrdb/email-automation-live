import axios from 'axios';
import { URLSearchParams } from 'node:url';
import { config } from '../config.js';

const tokenCache = new Map();

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function normalizeShop(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/g, '')
    .replace(/\.myshopify\.com$/i, '')
    .toLowerCase();
}

function getStoreConfig(storeKey) {
  const stores = config.shopify.stores || {};
  const rawStore = stores[storeKey];

  if (!rawStore) {
    throw new Error(
      `Store Key "${storeKey}" was not found in SHOPIFY_STORES_JSON.`
    );
  }

  const shop = normalizeShop(rawStore.shop || rawStore.domain);
  const domain = normalizeDomain(rawStore.domain || `${shop}.myshopify.com`);

  const clientId = rawStore.clientId || rawStore.client_id || '';
  const clientSecret = rawStore.clientSecret || rawStore.client_secret || '';
  const adminToken = rawStore.adminToken || rawStore.admin_token || '';

  requireValue(`shop for Store Key "${storeKey}"`, shop);
  requireValue(`domain for Store Key "${storeKey}"`, domain);

  if (!adminToken) {
    requireValue(`clientId for Store Key "${storeKey}"`, clientId);
    requireValue(`clientSecret for Store Key "${storeKey}"`, clientSecret);
  }

  return {
    storeKey,
    shop,
    domain,
    clientId,
    clientSecret,
    adminToken,
  };
}

function getSafeErrorMessage(data) {
  if (!data) {
    return 'No response body.';
  }

  if (typeof data === 'string') {
    return data.slice(0, 500);
  }

  try {
    return JSON.stringify(data).slice(0, 1000);
  } catch {
    return 'Could not stringify response body.';
  }
}

async function getShopifyAccessToken(store) {
  if (store.adminToken) {
    return store.adminToken;
  }

  const cachedToken = tokenCache.get(store.storeKey);

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  console.log(`Requesting fresh Shopify access token for Store Key: ${store.storeKey}`);

  const tokenUrl = `https://${store.domain}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: store.clientId,
    client_secret: store.clientSecret,
  });

  const response = await axios.post(tokenUrl, body.toString(), {
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Shopify token request failed with status ${response.status}. Response: ${getSafeErrorMessage(
        response.data
      )}`
    );
  }

  const accessToken = response.data?.access_token;
  const expiresInSeconds = Number(response.data?.expires_in || 86399);

  if (!accessToken) {
    throw new Error(
      `Shopify token response did not include access_token. Response: ${getSafeErrorMessage(
        response.data
      )}`
    );
  }

  tokenCache.set(store.storeKey, {
    accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });

  console.log(`Shopify access token received. Expires in ${expiresInSeconds} seconds.`);

  return accessToken;
}

async function shopifyGraphql({ store, query, variables }) {
  const accessToken = await getShopifyAccessToken(store);

  const url = `https://${store.domain}/admin/api/${config.shopify.apiVersion}/graphql.json`;

  const response = await axios.post(
    url,
    {
      query,
      variables,
    },
    {
      timeout: 30000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Shopify GraphQL request failed with status ${response.status}. Response: ${getSafeErrorMessage(
        response.data
      )}`
    );
  }

  if (response.data.errors) {
    throw new Error(
      `Shopify GraphQL errors: ${getSafeErrorMessage(response.data.errors)}`
    );
  }

  return response.data.data;
}

async function run() {
  const storeKey = process.argv[2] || 'Demo';
  const store = getStoreConfig(storeKey);

  console.log('Listing Shopify products...');
  console.log(`Store Key: ${store.storeKey}`);
  console.log(`Shop: ${store.shop}`);
  console.log(`Store Domain: ${store.domain}`);
  console.log(`API Version: ${config.shopify.apiVersion}`);

  const query = `
    query ListProducts {
      products(first: 20) {
        nodes {
          id
          title
          handle
          status
          onlineStoreUrl
          totalInventory
          variants(first: 10) {
            nodes {
              title
              sku
              price
              availableForSale
              inventoryQuantity
              sellableOnlineQuantity
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql({
    store,
    query,
    variables: {},
  });

  const products = data.products.nodes || [];

  console.log(`\nProducts found: ${products.length}`);

  if (products.length === 0) {
    console.log('No products found in this Shopify store.');
    return;
  }

  for (const product of products) {
    console.log('\n------------------------------');
    console.log(`Title: ${product.title}`);
    console.log(`Handle: ${product.handle}`);
    console.log(`Status: ${product.status}`);
    console.log(`Online Store URL: ${product.onlineStoreUrl || 'Not published / not available'}`);
    console.log(`Total Inventory: ${product.totalInventory}`);

    const variants = product.variants?.nodes || [];

    for (const variant of variants) {
      console.log(
        `Variant: ${variant.title} | Price: ${variant.price} | SKU: ${variant.sku || 'none'} | Available: ${variant.availableForSale} | Inventory: ${variant.inventoryQuantity} | Sellable Online: ${variant.sellableOnlineQuantity}`
      );
    }

    console.log(
      `Test URL: https://${store.domain}/products/${product.handle}`
    );
  }
}

run().catch((error) => {
  console.error('Shopify product listing failed.');
  console.error(error.message);
  process.exit(1);
});