import fs from 'fs';
import { config } from '../config.js';

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function makeSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getMode() {
  return config.klaviyo.key && config.klaviyo.key !== 'MOCK'
    ? 'LIVE_READY'
    : 'MOCK';
}

function summarizeLinkReport(linkReport) {
  if (!Array.isArray(linkReport)) {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      allPassed: false,
    };
  }

  const passed = linkReport.filter((item) => item.ok).length;
  const failed = linkReport.filter((item) => !item.ok).length;

  return {
    total: linkReport.length,
    passed,
    failed,
    allPassed: failed === 0 && linkReport.length > 0,
  };
}

async function run() {
  const campaignName = process.argv[2] || 'Mock Email Demo';
  const subjectLine = process.argv[3] || 'Automated Email Preview';

  const safeCampaignName = makeSafeName(campaignName);

  const emailHtml = readTextFile(config.output.emailHtml);
  const linkReport = readJsonIfExists('output/link-report.json') || [];
  const hostingReport = readJsonIfExists('output/hosting-report.json');
  const figmaExport = readJsonIfExists('output/figma-export.json');

  const linkSummary = summarizeLinkReport(linkReport);

  if (!linkSummary.allPassed) {
    throw new Error(
      `Cannot generate Klaviyo payload. Link verification failed or no links were checked. Failed links: ${linkSummary.failed}`
    );
  }

  const mode = getMode();

  const payload = {
    mode,
    generatedAt: new Date().toISOString(),

    campaign: {
      name: campaignName,
      safeName: safeCampaignName,
      subjectLine,
      previewText: 'Automated Figma to email preview',
      status: 'draft-ready',
    },

    source: {
      figmaFileId: figmaExport?.figmaFileId || null,
      selectedNodeId: figmaExport?.selectedNodeId || null,
      exportedNodeId: figmaExport?.exportedNodeId || null,
      exportedNodeName: figmaExport?.exportedNodeName || null,
      exportedImagePath: figmaExport?.exportedImagePath || null,
    },

    hosting: {
      previewUrl: hostingReport?.previewUrl || null,
      emailHtmlUrl: hostingReport?.emailHtmlUrl || null,
      cdnImageFolderUrl: hostingReport?.cdnImageFolderUrl || null,
      githubRepo: hostingReport?.githubRepo || config.cdn.githubRepo || null,
      branch: hostingReport?.branch || process.env.GITHUB_BRANCH || 'main',
    },

    linkVerification: {
      summary: linkSummary,
      results: linkReport,
    },

    email: {
      html: emailHtml,
    },

    klaviyoDraftRequest: {
      note:
        mode === 'MOCK'
          ? 'Mock payload only. Add a real KLAVIYO_KEY to enable live API draft creation later.'
          : 'Live-ready payload. This can be mapped to Klaviyo template/campaign API calls.',
      intendedAction: 'create_or_update_draft_campaign',
      campaignName,
      subjectLine,
      html: emailHtml,
    },
  };

  fs.mkdirSync('output', { recursive: true });

  fs.writeFileSync(
    config.output.klaviyoPayload,
    JSON.stringify(payload, null, 2),
    'utf8'
  );

  console.log('Klaviyo-ready payload generated.');
  console.log(`Saved to: ${config.output.klaviyoPayload}`);
  console.log(`Campaign: ${campaignName}`);
  console.log(`Subject: ${subjectLine}`);
  console.log(`Mode: ${mode}`);
  console.log(`Links checked: ${linkSummary.total}`);
  console.log(`Links passed: ${linkSummary.passed}`);
  console.log(`Links failed: ${linkSummary.failed}`);

  if (payload.hosting.previewUrl) {
    console.log(`Preview URL: ${payload.hosting.previewUrl}`);
  }

  if (payload.hosting.cdnImageFolderUrl) {
    console.log(`CDN Image Folder URL: ${payload.hosting.cdnImageFolderUrl}`);
  }
}

run().catch((error) => {
  console.error('Klaviyo payload generation failed.');
  console.error(error.message);
  process.exit(1);
});