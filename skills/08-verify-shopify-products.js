import fs from 'fs';
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

function parseProductLinks(rawLinks) {
  if (!rawLinks) {
    return [];
  }

  return rawLinks
    .split(/\r?\n|,|\|/)
    .map((link) => link.trim())
    .filter(Boolean);
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

  // Optional backward compatibility if you still use the old permanent-token method.
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

  console.log(
    `Shopify access token received. Expires in ${expiresInSeconds} seconds.`
  );

  return accessToken;
}

function extractProductHandle(productUrl, expectedDomain) {
  let parsedUrl;

  try {
    parsedUrl = new URL(productUrl);
  } catch {
    return {
      ok: false,
      error: 'Invalid product URL.',
      handle: null,
      actualDomain: null,
    };
  }

  const actualDomain = normalizeDomain(parsedUrl.hostname);
  const normalizedExpectedDomain = normalizeDomain(expectedDomain);

  if (actualDomain !== normalizedExpectedDomain) {
    return {
      ok: false,
      error: `Product link domain "${actualDomain}" does not match selected Shopify store "${normalizedExpectedDomain}".`,
      handle: null,
      actualDomain,
    };
  }

  const pathParts = parsedUrl.pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  const productsIndex = pathParts.indexOf('products');

  if (productsIndex === -1 || !pathParts[productsIndex + 1]) {
    return {
      ok: false,
      error: 'URL does not contain a valid /products/{handle} path.',
      handle: null,
      actualDomain,
    };
  }

  return {
    ok: true,
    error: null,
    handle: pathParts[productsIndex + 1],
    actualDomain,
  };
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
    return {
      ok: false,
      status: response.status,
      errors: response.data,
      data: null,
    };
  }

  if (response.data.errors) {
    return {
      ok: false,
      status: response.status,
      errors: response.data.errors,
      data: null,
    };
  }

  return {
    ok: true,
    status: response.status,
    errors: null,
    data: response.data.data,
  };
}

async function fetchProductByHandle(store, handle) {
  const query = `
    query VerifyProductByHandle($identifier: ProductIdentifierInput!) {
      product: productByIdentifier(identifier: $identifier) {
        id
        title
        handle
        status
        onlineStoreUrl
        totalInventory
        variants(first: 50) {
          nodes {
            id
            title
            displayName
            sku
            price
            availableForSale
            inventoryPolicy
            inventoryQuantity
            sellableOnlineQuantity
            inventoryItem {
              tracked
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphql({
    store,
    query,
    variables: {
      identifier: {
        handle,
      },
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      error: `Shopify API request failed with status ${result.status}.`,
      apiErrors: result.errors,
      product: null,
    };
  }

  return {
    ok: true,
    error: null,
    apiErrors: null,
    product: result.data.product,
  };
}

function evaluateProduct(product) {
  const checks = [];
  const warnings = [];

  function addCheck(name, passed, detail) {
    checks.push({
      name,
      passed,
      detail,
    });
  }

  function addWarning(name, detail) {
    warnings.push({
      name,
      detail,
    });
  }

  if (!product) {
    addCheck('Product exists', false, 'Product handle was not found in Shopify.');

    return {
      passed: false,
      reason: 'Product handle was not found in Shopify.',
      checks,
      warnings,
      inventorySummary: null,
    };
  }

  addCheck('Product exists', true, `Found product: ${product.title}`);

  const isActive = product.status === 'ACTIVE';

  addCheck(
    'Product status',
    isActive,
    `Status is ${product.status}. Required: ACTIVE.`
  );

  if (product.onlineStoreUrl) {
    addWarning(
      'Online Store URL',
      `Product has an Online Store URL: ${product.onlineStoreUrl}`
    );
  } else {
    addWarning(
      'Online Store URL',
      'Product has no onlineStoreUrl. For demo/pre-launch stores, this is allowed because verification uses Shopify Admin API instead of the public storefront.'
    );
  }

  const variants = product.variants?.nodes || [];
  const hasVariants = variants.length > 0;

  addCheck(
    'Variant exists',
    hasVariants,
    hasVariants
      ? `${variants.length} variant(s) found.`
      : 'No variants were found for this product.'
  );

  const availableVariants = variants.filter(
    (variant) => variant.availableForSale === true
  );

  const hasAvailableVariant = availableVariants.length > 0;

  addCheck(
    'Variant availability',
    hasAvailableVariant,
    hasAvailableVariant
      ? `${availableVariants.length} variant(s) are available for sale.`
      : 'No variants are available for sale.'
  );

  const sellableOnlineQuantityTotal = variants.reduce((sum, variant) => {
    const value = Number(variant.sellableOnlineQuantity || 0);
    return sum + value;
  }, 0);

  const inventoryQuantityTotal = variants.reduce((sum, variant) => {
    const value = Number(variant.inventoryQuantity || 0);
    return sum + value;
  }, 0);

  const hasUntrackedAvailableVariant = availableVariants.some(
    (variant) => variant.inventoryItem?.tracked === false
  );

  const hasContinueSellingVariant = availableVariants.some(
    (variant) => variant.inventoryPolicy === 'CONTINUE'
  );

  const hasPositiveSellableQuantity = sellableOnlineQuantityTotal > 0;
  const hasPositiveInventoryQuantity = inventoryQuantityTotal > 0;

  const inventoryPass =
    hasPositiveSellableQuantity ||
    hasPositiveInventoryQuantity ||
    hasUntrackedAvailableVariant ||
    hasContinueSellingVariant;

  let inventoryDetail = `Total inventory quantity: ${inventoryQuantityTotal}. Total sellable online quantity: ${sellableOnlineQuantityTotal}.`;

  if (hasUntrackedAvailableVariant) {
    inventoryDetail += ' At least one available variant does not track inventory.';
  }

  if (hasContinueSellingVariant) {
    inventoryDetail += ' At least one available variant allows continuing to sell when out of stock.';
  }

  addCheck('Inventory / sellable quantity', inventoryPass, inventoryDetail);

  const hasValidPrice = variants.some((variant) => Number(variant.price) > 0);

  addCheck(
    'Variant price',
    hasValidPrice,
    hasValidPrice
      ? 'At least one variant has a valid price.'
      : 'No variant has a valid price.'
  );

  const skuCount = variants.filter((variant) => Boolean(variant.sku)).length;

  if (skuCount < variants.length) {
    addWarning(
      'SKU audit',
      `${skuCount}/${variants.length} variant(s) have SKU values. SKU is useful for operations but not required to pass this demo verifier.`
    );
  } else {
    addWarning(
      'SKU audit',
      `${skuCount}/${variants.length} variant(s) have SKU values.`
    );
  }

  const passed =
    isActive &&
    hasVariants &&
    hasAvailableVariant &&
    inventoryPass &&
    hasValidPrice;

  let reason =
    'Product exists, is active, available, has sellable inventory/availability, and has valid pricing.';

  if (!passed) {
    const failedChecks = checks
      .filter((check) => !check.passed)
      .map((check) => check.name);

    reason = `Failed required checks: ${failedChecks.join(', ')}`;
  }

  return {
    passed,
    reason,
    checks,
    warnings,
    inventorySummary: {
      totalInventory: product.totalInventory,
      inventoryQuantityTotal,
      sellableOnlineQuantityTotal,
      availableVariantCount: availableVariants.length,
      totalVariantCount: variants.length,
      hasUntrackedAvailableVariant,
      hasContinueSellingVariant,
    },
  };
}

async function verifyProductLink({ store, productUrl }) {
  const handleResult = extractProductHandle(productUrl, store.domain);

  if (!handleResult.ok) {
    return {
      url: productUrl,
      passed: false,
      reason: handleResult.error,
      storeKey: store.storeKey,
      expectedDomain: store.domain,
      actualDomain: handleResult.actualDomain,
      handle: null,
      checks: [
        {
          name: 'Store domain match',
          passed: false,
          detail: handleResult.error,
        },
      ],
      warnings: [],
      product: null,
    };
  }

  const productResult = await fetchProductByHandle(store, handleResult.handle);

  if (!productResult.ok) {
    return {
      url: productUrl,
      passed: false,
      reason: productResult.error,
      storeKey: store.storeKey,
      expectedDomain: store.domain,
      actualDomain: handleResult.actualDomain,
      handle: handleResult.handle,
      checks: [
        {
          name: 'Shopify API request',
          passed: false,
          detail: `${productResult.error} ${getSafeErrorMessage(productResult.apiErrors)}`,
        },
      ],
      warnings: [],
      apiErrors: productResult.apiErrors,
      product: null,
    };
  }

  const evaluation = evaluateProduct(productResult.product);

  return {
    url: productUrl,
    passed: evaluation.passed,
    reason: evaluation.reason,
    storeKey: store.storeKey,
    expectedDomain: store.domain,
    actualDomain: handleResult.actualDomain,
    handle: handleResult.handle,
    checks: evaluation.checks,
    warnings: evaluation.warnings,
    inventorySummary: evaluation.inventorySummary || null,
    product: productResult.product
      ? {
          id: productResult.product.id,
          title: productResult.product.title,
          handle: productResult.product.handle,
          status: productResult.product.status,
          onlineStoreUrl: productResult.product.onlineStoreUrl,
          totalInventory: productResult.product.totalInventory,
          variants: productResult.product.variants?.nodes || [],
        }
      : null,
  };
}

async function run() {
  const storeKey = process.argv[2];
  const rawLinks = process.argv[3];

  if (!storeKey) {
    throw new Error(
      'Missing Store Key. Run: node skills/08-verify-shopify-products.js "Demo" "https://store.myshopify.com/products/product-handle"'
    );
  }

  const productLinks = parseProductLinks(rawLinks);

  if (productLinks.length === 0) {
    throw new Error('Missing product links to verify.');
  }

  const store = getStoreConfig(storeKey);

  console.log('Verifying Shopify product links...');
  console.log(`Store Key: ${store.storeKey}`);
  console.log(`Shop: ${store.shop}`);
  console.log(`Store Domain: ${store.domain}`);
  console.log(`API Version: ${config.shopify.apiVersion}`);
  console.log(`Auth Mode: ${store.adminToken ? 'static admin token' : 'client credentials grant'}`);
  console.log(`Product links: ${productLinks.length}`);

  const results = [];

  for (const productUrl of productLinks) {
    console.log('\n------------------------------');
    console.log(`Checking: ${productUrl}`);

    const result = await verifyProductLink({
      store,
      productUrl,
    });

    results.push(result);

    if (result.passed) {
      console.log(`PASS: ${result.reason}`);
    } else {
      console.log(`FAIL: ${result.reason}`);
    }

    for (const check of result.checks || []) {
      console.log(`${check.passed ? '  ✓' : '  ✗'} ${check.name}: ${check.detail}`);
    }

    for (const warning of result.warnings || []) {
      console.log(`  ! ${warning.name}: ${warning.detail}`);
    }

    if (result.inventorySummary) {
      console.log(
        `Inventory: total=${result.inventorySummary.inventoryQuantityTotal}, sellableOnline=${result.inventorySummary.sellableOnlineQuantityTotal}, availableVariants=${result.inventorySummary.availableVariantCount}/${result.inventorySummary.totalVariantCount}`
      );
    }
  }

  const report = {
    storeKey: store.storeKey,
    shop: store.shop,
    storeDomain: store.domain,
    apiVersion: config.shopify.apiVersion,
    authMode: store.adminToken ? 'static_admin_token' : 'client_credentials_grant',
    checkedAt: new Date().toISOString(),
    totalLinks: results.length,
    passedLinks: results.filter((result) => result.passed).length,
    failedLinks: results.filter((result) => !result.passed).length,
    warningCount: results.reduce(
      (sum, result) => sum + (result.warnings?.length || 0),
      0
    ),
    allPassed: results.every((result) => result.passed),
    results,
  };

  fs.mkdirSync('output', { recursive: true });

  fs.writeFileSync(
    'output/shopify-product-report.json',
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log('\n========================================');
  console.log('Shopify verification summary');
  console.log('========================================');
  console.log(`Passed: ${report.passedLinks}/${report.totalLinks}`);
  console.log(`Failed: ${report.failedLinks}/${report.totalLinks}`);
  console.log(`Warnings: ${report.warningCount}`);
  console.log('Report saved to: output/shopify-product-report.json');

  if (!report.allPassed) {
    throw new Error('One or more Shopify product links failed required verification.');
  }

  console.log('All Shopify product links passed required verification.');
}

run().catch((error) => {
  console.error('Shopify product verification failed.');
  console.error(error.message);
  process.exit(1);
});