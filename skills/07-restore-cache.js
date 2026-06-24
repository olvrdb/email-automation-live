import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from '../config.js';

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing ${name}. Check your .env file.`);
  }
}

function makeSafeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function encodeRepoPath(filePath) {
  return filePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

async function downloadRepoFileAsBuffer({ repo, branch, token, repoPath }) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeRepoPath(
    repoPath
  )}`;

  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
    params: {
      ref: branch,
    },
    validateStatus: () => true,
  });

  if (response.status === 404) {
    return null;
  }

  if (response.status < 200 || response.status >= 300) {
    console.log('GitHub API response:');
    console.log(response.data);
    throw new Error(`Failed to download ${repoPath}. Status: ${response.status}`);
  }

  if (!response.data.content) {
    throw new Error(`GitHub file response has no content: ${repoPath}`);
  }

  return Buffer.from(response.data.content, 'base64');
}

async function downloadRepoJson({ repo, branch, token, repoPath }) {
  const buffer = await downloadRepoFileAsBuffer({
    repo,
    branch,
    token,
    repoPath,
  });

  if (!buffer) {
    return null;
  }

  return JSON.parse(buffer.toString('utf8'));
}

function buildRestoredFigmaExport(cache) {
  return {
    figmaFileId: cache.figma?.figmaFileId || null,
    selectedNodeId: cache.figma?.selectedNodeId || null,
    exportedNodeId: cache.figma?.exportedNodeId || null,
    exportedNodeName: cache.figma?.exportedNodeName || null,
    exportedImagePath:
      cache.output?.exportedImagePath || cache.figma?.exportedImagePath,
    restoredFromCache: true,
    restoredAt: new Date().toISOString(),
    automationCacheUrl: cache.hosting?.automationCacheUrl || null,
  };
}

async function restoreAsset({ repo, branch, token, asset }) {
  if (!asset.repoPath || !asset.localPath) {
    return;
  }

  const localPath = normalizePath(asset.localPath);

  console.log(`Restoring: ${localPath}`);

  const buffer = await downloadRepoFileAsBuffer({
    repo,
    branch,
    token,
    repoPath: asset.repoPath,
  });

  if (!buffer) {
    throw new Error(`Cached asset missing in GitHub repo: ${asset.repoPath}`);
  }

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
}

async function run() {
  const campaignName = process.argv[2];

  if (!campaignName) {
    throw new Error(
      'Missing campaign name. Run: node skills/07-restore-cache.js "Campaign Name"'
    );
  }

  requireValue('GITHUB_REPO', config.cdn.githubRepo);
  requireValue('GITHUB_TOKEN', config.cdn.githubToken);

  const repo = config.cdn.githubRepo;
  const token = config.cdn.githubToken;
  const branch = process.env.GITHUB_BRANCH || 'main';

  const safeCampaignName = makeSafeName(campaignName);
  const campaignRepoDir = `docs/campaigns/${safeCampaignName}`;
  const automationCacheRepoPath = `${campaignRepoDir}/automation-cache.json`;

  console.log('Checking for automation cache from GitHub repo...');
  console.log(`Campaign: ${campaignName}`);
  console.log(`Repo: ${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Cache path: ${automationCacheRepoPath}`);

  const cache = await downloadRepoJson({
    repo,
    branch,
    token,
    repoPath: automationCacheRepoPath,
  });

  if (!cache) {
    console.log('No automation cache found in GitHub repo.');
    process.exit(2);
  }

  if (!cache.assets || !Array.isArray(cache.assets) || cache.assets.length === 0) {
    throw new Error('Automation cache exists but contains no assets.');
  }

  fs.mkdirSync('output', { recursive: true });
  fs.mkdirSync(config.output.slicesDir, { recursive: true });

  console.log(`Cache found. Assets to restore: ${cache.assets.length}`);

  for (const asset of cache.assets) {
    await restoreAsset({
      repo,
      branch,
      token,
      asset,
    });
  }

  const restoredFigmaExport = buildRestoredFigmaExport(cache);

  if (!restoredFigmaExport.exportedImagePath) {
    throw new Error('Restored cache is missing exportedImagePath.');
  }

  fs.writeFileSync(
    'output/figma-export.json',
    JSON.stringify(restoredFigmaExport, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    'output/restored-automation-cache.json',
    JSON.stringify(cache, null, 2),
    'utf8'
  );

  console.log('Automation cache restored successfully.');
  console.log(`Restored Figma export: ${restoredFigmaExport.exportedImagePath}`);
}

run().catch((error) => {
  console.error('Cache restore failed.');

  if (error.response?.status) {
    console.error(`Status: ${error.response.status}`);
  }

  console.error(error.response?.data || error.message);
  process.exit(1);
});