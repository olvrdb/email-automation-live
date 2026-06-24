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

function getAllFiles(folderPath) {
  if (!fs.existsSync(folderPath)) {
    return [];
  }

  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function getExistingFileSha({ repo, repoPath, branch, token }) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeRepoPath(
    repoPath
  )}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
      params: {
        ref: branch,
      },
    });

    return response.data.sha;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }

    throw error;
  }
}

async function uploadFileToGitHub({ localPath, repoPath, repo, branch, token }) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file does not exist: ${localPath}`);
  }

  const sha = await getExistingFileSha({
    repo,
    repoPath,
    branch,
    token,
  });

  const fileContent = fs.readFileSync(localPath);
  const encodedContent = fileContent.toString('base64');

  const url = `https://api.github.com/repos/${repo}/contents/${encodeRepoPath(
    repoPath
  )}`;

  const body = {
    message: sha ? `Update ${repoPath}` : `Create ${repoPath}`,
    content: encodedContent,
    branch,
  };

  if (sha) {
    body.sha = sha;
  }

  await axios.put(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
  });

  console.log(`Uploaded: ${repoPath}`);
}

function getCurrentCampaignFiles() {
  const figmaExportPath = 'output/figma-export.json';

  if (!fs.existsSync(figmaExportPath)) {
    throw new Error('Missing output/figma-export.json.');
  }

  const figmaExport = JSON.parse(fs.readFileSync(figmaExportPath, 'utf8'));
  const exportedImagePath = figmaExport.exportedImagePath;

  if (!exportedImagePath || !fs.existsSync(exportedImagePath)) {
    throw new Error(`Exported image does not exist: ${exportedImagePath}`);
  }

  const parsedImage = path.parse(exportedImagePath);

  const processedImagePath = path.join(
    parsedImage.dir,
    `${parsedImage.name}-processed${parsedImage.ext}`
  );

  const sliceDir = path.join(parsedImage.dir, `${parsedImage.name}-slices`);

  const files = [exportedImagePath];

  if (fs.existsSync(processedImagePath)) {
    files.push(processedImagePath);
  }

  const sliceFiles = getAllFiles(sliceDir);
  files.push(...sliceFiles);

  return {
    exportedImagePath,
    processedImagePath,
    sliceDir,
    files,
  };
}

function getRepoPathForAsset({ localPath, campaignFiles, campaignRepoDir }) {
  const normalizedLocalPath = normalizePath(localPath);
  const fileName = path.basename(localPath);
  const normalizedSliceDir = normalizePath(campaignFiles.sliceDir);

  if (normalizedLocalPath.startsWith(normalizedSliceDir)) {
    const relativeSlicePath = normalizePath(path.relative(campaignFiles.sliceDir, localPath));

    return `${campaignRepoDir}/slices/${path.basename(
      campaignFiles.sliceDir
    )}/${relativeSlicePath}`;
  }

  return `${campaignRepoDir}/slices/${fileName}`;
}

async function run() {
  requireValue('GITHUB_TOKEN', config.cdn.githubToken);
  requireValue('GITHUB_REPO', config.cdn.githubRepo);

  const campaignName = process.argv[2] || 'Mock Email Demo';
  const safeCampaignName = makeSafeName(campaignName);

  const repo = config.cdn.githubRepo;
  const token = config.cdn.githubToken;
  const branch = process.env.GITHUB_BRANCH || 'main';

  const pagesBaseUrl = getPagesBaseUrl(repo);
  const campaignRepoDir = `docs/campaigns/${safeCampaignName}`;
  const campaignPublicDir = `${pagesBaseUrl}/campaigns/${safeCampaignName}`;

  const requiredFiles = ['output/preview.html', 'output/email.html'];

  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing required generated file: ${file}`);
    }
  }

  console.log('Uploading generated email assets to GitHub Pages...');
  console.log(`Repo: ${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Campaign: ${campaignName}`);

  await uploadFileToGitHub({
    localPath: 'output/preview.html',
    repoPath: `${campaignRepoDir}/preview.html`,
    repo,
    branch,
    token,
  });

  await uploadFileToGitHub({
    localPath: 'output/email.html',
    repoPath: `${campaignRepoDir}/email.html`,
    repo,
    branch,
    token,
  });

  const campaignFiles = getCurrentCampaignFiles();

  console.log(`Asset files found: ${campaignFiles.files.length}`);

  for (const localPath of campaignFiles.files) {
    const repoPath = getRepoPathForAsset({
      localPath,
      campaignFiles,
      campaignRepoDir,
    });

    await uploadFileToGitHub({
      localPath,
      repoPath,
      repo,
      branch,
      token,
    });
  }

  const hostingReport = {
    campaignName,
    githubRepo: repo,
    branch,
    previewUrl: `${campaignPublicDir}/preview.html`,
    emailHtmlUrl: `${campaignPublicDir}/email.html`,
    cdnImageFolderUrl: `${campaignPublicDir}/slices/`,
    uploadedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    'output/hosting-report.json',
    JSON.stringify(hostingReport, null, 2),
    'utf8'
  );

  console.log('GitHub Pages upload complete.');
  console.log(`Preview URL: ${hostingReport.previewUrl}`);
  console.log(`Email HTML URL: ${hostingReport.emailHtmlUrl}`);
  console.log(`CDN image folder URL: ${hostingReport.cdnImageFolderUrl}`);
  console.log('Saved report to: output/hosting-report.json');
}

run().catch((error) => {
  console.error('GitHub Pages upload failed.');

  if (error.response?.status) {
    console.error(`Status: ${error.response.status}`);
  }

  console.error(error.response?.data || error.message);
  process.exit(1);
});