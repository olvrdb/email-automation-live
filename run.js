import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { config } from './config.js';

function runStep(label, command, args) {
  console.log('\n========================================');
  console.log(label);
  console.log('========================================');

  execFileSync(command, args, {
    stdio: 'inherit',
    shell: false,
  });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getProcessedImagePath(exportedImagePath) {
  const parsed = path.parse(exportedImagePath);

  return path.join(parsed.dir, `${parsed.name}-processed${parsed.ext}`);
}

function makeSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPagesBaseUrl(repo) {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    return null;
  }

  if (repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io`;
  }

  return `https://${owner}.github.io/${repoName}`;
}

function getPublicImageUrl({ campaignName, processedImagePath }) {
  if (!config.cdn.githubRepo) {
    return null;
  }

  const pagesBaseUrl = getPagesBaseUrl(config.cdn.githubRepo);

  if (!pagesBaseUrl) {
    return null;
  }

  const safeCampaignName = makeSafeName(campaignName);
  const imageFileName = path.basename(processedImagePath);

  return `${pagesBaseUrl}/campaigns/${safeCampaignName}/slices/${imageFileName}`;
}

function parseProductLinks(rawProductLinks) {
  if (!rawProductLinks) {
    return [config.shopify.url];
  }

  return rawProductLinks
    .split(/\r?\n|,|\|/)
    .map((link) => link.trim())
    .filter(Boolean);
}

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const useCache = rawArgs.includes('--use-cache');
  const forceFigma = rawArgs.includes('--force-figma');

  const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'));

  const productLinks = parseProductLinks(positionalArgs[1]);
  const primaryProductUrl = productLinks[0] || config.shopify.url;

  return {
    figmaUrl: positionalArgs[0],
    productLinks,
    primaryProductUrl,
    campaignName: positionalArgs[2] || 'Mock Email Demo',
    subjectLine: positionalArgs[3] || 'Automated Email Preview',
    useCache,
    forceFigma,
  };
}

function validateCachedExport(figmaExport) {
  if (!figmaExport.exportedImagePath) {
    throw new Error('Cached Figma export is missing exportedImagePath.');
  }

  if (!fs.existsSync(figmaExport.exportedImagePath)) {
    throw new Error(
      `Cached exported image does not exist: ${figmaExport.exportedImagePath}`
    );
  }
}

function main() {
  const {
    figmaUrl,
    productLinks,
    primaryProductUrl,
    campaignName,
    subjectLine,
    useCache,
    forceFigma,
  } = parseArgs();

  if (!figmaUrl) {
    throw new Error('Missing Figma URL. Run: node run.js "YOUR_FIGMA_URL"');
  }

  console.log('Starting Figma to Klaviyo automation...');
  console.log(`Figma URL: ${figmaUrl}`);
  console.log(`Primary product URL: ${primaryProductUrl}`);
  console.log(`Product links to verify: ${productLinks.length}`);
  console.log(`Campaign name: ${campaignName}`);
  console.log(`Subject line: ${subjectLine}`);
  console.log(`Use cached Figma export: ${useCache ? 'YES' : 'NO'}`);

  const cachePath = 'output/figma-export.json';

  if (useCache && !forceFigma) {
    console.log('\n========================================');
    console.log('Step 1: Use cached Figma export');
    console.log('========================================');

    if (!fs.existsSync(cachePath)) {
      throw new Error(
        'No cached Figma export found. Run the automation once without --use-cache first.'
      );
    }

    const cachedExport = readJson(cachePath);
    validateCachedExport(cachedExport);

    console.log(`Using cached export: ${cachedExport.exportedNodeName}`);
    console.log(`Cached image: ${cachedExport.exportedImagePath}`);
  } else {
    runStep('Step 1: Export Figma email frame', 'node', [
      'skills/01-figma-export.js',
      figmaUrl,
    ]);
  }

  const figmaExport = readJson(cachePath);
  validateCachedExport(figmaExport);

  const exportedImagePath = figmaExport.exportedImagePath;
  const processedImagePath = getProcessedImagePath(exportedImagePath);

  const publicImageUrl = getPublicImageUrl({
    campaignName,
    processedImagePath,
  });

  console.log('\nResolved Figma export:');
  console.log(`Exported node: ${figmaExport.exportedNodeName}`);
  console.log(`Exported image: ${exportedImagePath}`);
  console.log(`Processed image target: ${processedImagePath}`);
  console.log(`Public image URL target: ${publicImageUrl || 'Not configured'}`);

  runStep('Step 2: Process email-safe image', 'node', [
    'skills/02-process-images.js',
    exportedImagePath,
  ]);

  const buildHtmlArgs = [
    'skills/03-build-html.js',
    processedImagePath,
    primaryProductUrl,
  ];

  if (publicImageUrl) {
    buildHtmlArgs.push(publicImageUrl);
  }

  runStep('Step 3: Build email HTML and preview', 'node', buildHtmlArgs);

  runStep('Step 4: Verify all product links', 'node', [
    'skills/04-verify-links.js',
    ...productLinks,
  ]);

  runStep('Step 5: Upload preview and assets to GitHub Pages', 'node', [
    'skills/06-upload-to-github-pages.js',
    campaignName,
  ]);

  runStep('Step 6: Generate Klaviyo-ready payload', 'node', [
    'skills/05-generate-klaviyo-payload.js',
    campaignName,
    subjectLine,
  ]);

  const hostingReport = readJson('output/hosting-report.json');

  console.log('\nAutomation complete.');
  console.log('Generated files:');
  console.log('- output/email.html');
  console.log('- output/preview.html');
  console.log('- output/link-report.json');
  console.log('- output/klaviyo-campaign-payload.json');
  console.log('- output/figma-export.json');
  console.log('- output/hosting-report.json');

  console.log('\nHosted URLs:');
  console.log(`Preview URL: ${hostingReport.previewUrl}`);
  console.log(`Email HTML URL: ${hostingReport.emailHtmlUrl}`);
  console.log(`CDN Image Folder URL: ${hostingReport.cdnImageFolderUrl}`);
}

try {
  main();
} catch (error) {
  console.error('\nAutomation failed.');
  console.error(error.message);
  process.exit(1);
}