import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { config } from './config.js';

function makeSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
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

function parseArgs() {
  const rawArgs = process.argv.slice(2);

  const useCache = rawArgs.includes('--use-cache');

  const storeKeyIndex = rawArgs.indexOf('--store-key');
  const storeKey = storeKeyIndex !== -1 ? rawArgs[storeKeyIndex + 1] : '';

  if (storeKeyIndex !== -1 && !storeKey) {
    throw new Error('Missing value after --store-key.');
  }

  const positionalArgs = rawArgs.filter((arg, index) => {
    if (arg === '--use-cache') {
      return false;
    }

    if (arg === '--store-key') {
      return false;
    }

    if (index > 0 && rawArgs[index - 1] === '--store-key') {
      return false;
    }

    return true;
  });

  const figmaUrl = positionalArgs[0];
  const productLinksText = positionalArgs[1] || config.shopify.url;
  const campaignName = positionalArgs[2] || 'Mock Email Demo';
  const subjectLine = positionalArgs[3] || 'Automated Email Preview';

  return {
    figmaUrl,
    productLinksText,
    productLinks: parseProductLinks(productLinksText),
    campaignName,
    subjectLine,
    useCache,
    storeKey,
  };
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

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }

  return result;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getExportedImagePath() {
  const figmaExport = readJson('output/figma-export.json');

  if (!figmaExport.exportedImagePath) {
    throw new Error('output/figma-export.json is missing exportedImagePath.');
  }

  return figmaExport.exportedImagePath;
}

function getProcessedImagePath(exportedImagePath) {
  const parsedImage = path.parse(exportedImagePath);

  return path.join(
    parsedImage.dir,
    `${parsedImage.name}-processed${parsedImage.ext}`
  );
}

function getPagesBaseUrl(repo) {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error('GITHUB_REPO must look like: username/repo-name');
  }

  if (repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io`;
  }

  return `https://${owner}.github.io/${repoName}`;
}

function getExpectedPublicImageUrl({ campaignName, processedImagePath }) {
  if (!config.cdn.githubRepo) {
    return null;
  }

  const pagesBaseUrl = getPagesBaseUrl(config.cdn.githubRepo);
  const safeCampaignName = makeSafeName(campaignName);
  const fileName = path.basename(processedImagePath);

  return `${pagesBaseUrl}/campaigns/${safeCampaignName}/slices/${fileName}`;
}

function verifyShopifyProducts({ storeKey, productLinksText }) {
  if (!storeKey) {
    console.log('No Store Key supplied. Skipping Shopify Admin API product verification.');
    return;
  }

  console.log('\nStep: Shopify Admin API product verification');
  console.log(`Store Key: ${storeKey}`);

  runCommand('node', [
    'skills/08-verify-shopify-products.js',
    storeKey,
    productLinksText,
  ]);
}

async function run() {
  const {
    figmaUrl,
    productLinksText,
    productLinks,
    campaignName,
    subjectLine,
    useCache,
    storeKey,
  } = parseArgs();

  if (!figmaUrl) {
    throw new Error(
      'Missing Figma URL. Run: node run.js "FIGMA_URL" "PRODUCT_LINKS" "Campaign Name" "Subject Line"'
    );
  }

  if (productLinks.length === 0) {
    throw new Error('At least one product link is required.');
  }

  const primaryProductUrl = productLinks[0];

  console.log('Starting Figma to Klaviyo automation...');
  console.log(`Campaign: ${campaignName}`);
  console.log(`Subject: ${subjectLine}`);
  console.log(`Figma URL: ${figmaUrl}`);
  console.log(`Primary product URL: ${primaryProductUrl}`);
  console.log(`Product links to verify: ${productLinks.length}`);
  console.log(`Use cached Figma export: ${useCache ? 'YES' : 'NO'}`);
  console.log(`Store Key: ${storeKey || 'none'}`);

  fs.mkdirSync('output', { recursive: true });

  if (useCache) {
    console.log('\nStep: Using cached Figma export');
    console.log('Skipping Figma API export because --use-cache was provided.');

    const cachedFigmaExportPath = 'output/figma-export.json';

    if (!fs.existsSync(cachedFigmaExportPath)) {
      throw new Error(
        'Cannot use --use-cache because output/figma-export.json does not exist.'
      );
    }
  } else {
    console.log('\nStep: Export design from Figma');

    runCommand('node', [
      'skills/01-figma-export.js',
      figmaUrl,
    ]);
  }

  const exportedImagePath = getExportedImagePath();

  console.log('\nStep: Process image and create email-safe slices');

  runCommand('node', [
    'skills/02-process-images.js',
    exportedImagePath,
  ]);

  const processedImagePath = getProcessedImagePath(exportedImagePath);

  if (!fs.existsSync(processedImagePath)) {
    throw new Error(`Processed image was not created: ${processedImagePath}`);
  }

  const publicImageUrl = getExpectedPublicImageUrl({
    campaignName,
    processedImagePath,
  });

  if (publicImageUrl) {
    console.log(`Public image URL target: ${publicImageUrl}`);
  } else {
    console.log('No GitHub repo configured. HTML will use local image paths.');
  }

  console.log('\nStep: Build email HTML');

  const htmlArgs = [
    'skills/03-build-html.js',
    processedImagePath,
    primaryProductUrl,
  ];

  if (publicImageUrl) {
    htmlArgs.push(publicImageUrl);
  }

  runCommand('node', htmlArgs);

  console.log('\nStep: Verify public product links');

  runCommand('node', [
    'skills/04-verify-links.js',
    ...productLinks,
  ]);

  verifyShopifyProducts({
    storeKey,
    productLinksText,
  });

  console.log('\nStep: Upload preview and assets to GitHub Pages');

  runCommand('node', [
    'skills/06-upload-to-github-pages.js',
    campaignName,
  ]);

  console.log('\nStep: Generate Klaviyo-ready payload');

  runCommand('node', [
    'skills/05-generate-klaviyo-payload.js',
    campaignName,
    subjectLine,
  ]);

  const hostingReport = readJson('output/hosting-report.json');

  console.log('\nAutomation complete.');
  console.log(`Preview URL: ${hostingReport.previewUrl}`);
  console.log(`Email HTML URL: ${hostingReport.emailHtmlUrl}`);
  console.log(`CDN Image Folder URL: ${hostingReport.cdnImageFolderUrl}`);
  console.log(`Klaviyo payload: ${normalizePath(config.output.klaviyoPayload)}`);

  if (storeKey) {
    console.log('Shopify verification report: output/shopify-product-report.json');
  }
}

run().catch((error) => {
  console.error('Automation failed.');
  console.error(error.message);
  process.exit(1);
});