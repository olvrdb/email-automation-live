import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from '../config.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function figmaGet(url, options = {}, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (error) {
      const status = error.response?.status;
      const isRateLimited = status === 429;
      const isTemporaryError = status >= 500;

      if ((!isRateLimited && !isTemporaryError) || attempt === maxRetries) {
        throw error;
      }

      const retryAfter = Number(error.response?.headers?.['retry-after']);
      const delayMs = retryAfter
        ? retryAfter * 1000
        : attempt * 3000;

      console.log(
        `Figma API returned ${status}. Retrying attempt ${attempt + 1}/${maxRetries}...`
      );

      await sleep(delayMs);
    }
  }
}

function extractFigmaFileId(figmaInput) {
  if (!figmaInput) {
    throw new Error(
      'Missing Figma URL. Run: node skills/01-figma-export.js "YOUR_FIGMA_URL"'
    );
  }

  const match = figmaInput.match(/figma\.com\/(?:design|file)\/([^/?]+)/);

  if (match && match[1]) {
    return match[1];
  }

  if (!figmaInput.includes('figma.com')) {
    return figmaInput;
  }

  throw new Error('Could not extract Figma file ID from the provided input.');
}

function extractNodeId(figmaInput) {
  try {
    const url = new URL(figmaInput);
    const rawNodeId = url.searchParams.get('node-id');

    if (!rawNodeId) {
      return null;
    }

    return decodeURIComponent(rawNodeId).replace(/-/g, ':');
  } catch {
    return null;
  }
}

function findNodeById(node, targetId) {
  if (node.id === targetId) {
    return node;
  }

  if (!node.children) {
    return null;
  }

  for (const child of node.children) {
    const found = findNodeById(child, targetId);

    if (found) {
      return found;
    }
  }

  return null;
}

function findEmailLikeFrames(node, results = []) {
  if (node.type === 'FRAME' && node.absoluteBoundingBox && node.visible !== false) {
    const { width, height } = node.absoluteBoundingBox;
    const childCount = node.children?.length || 0;

    const isEmailWidth = width >= 560 && width <= 760;
    const isTallEnough = height >= 400;
    const isPortraitOrEmailShape = height > width;
    const hasContent = childCount > 0;

    if (isEmailWidth && isTallEnough && isPortraitOrEmailShape && hasContent) {
      results.push({
        id: node.id,
        name: node.name,
        width,
        height,
        childCount,
        node,
      });
    }
  }

  if (node.children) {
    for (const child of node.children) {
      findEmailLikeFrames(child, results);
    }
  }

  return results;
}

function makeSafeFileName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function downloadImage(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  });

  fs.writeFileSync(outputPath, response.data);
}

function resolveTargetNode(document, selectedNodeId) {
  if (selectedNodeId) {
    const selectedNode = findNodeById(document, selectedNodeId);

    if (!selectedNode) {
      throw new Error(
        `The selected node-id "${selectedNodeId}" was not found in the Figma file.`
      );
    }

    console.log(`Selected node from URL: "${selectedNode.name}" (${selectedNode.type})`);

    if (selectedNode.type === 'FRAME') {
      console.log('Using selected Figma frame.');
      return selectedNode;
    }

    console.log(
      `Selected node is "${selectedNode.type}", not a frame. Falling back to smart email-frame detection...`
    );
  } else {
    console.log('No selected node-id found. Using smart email-frame detection...');
  }

  const emailFrames = findEmailLikeFrames(document);

  if (emailFrames.length === 0) {
    throw new Error(
      'No email-like Figma frame found. Expected one visible frame around 560–760px wide and taller than it is wide.'
    );
  }

  if (emailFrames.length > 1) {
    console.log('Multiple email-like frames found:');

    for (const frame of emailFrames) {
      console.log(
        `- "${frame.name}" | Node ID: ${frame.id} | Size: ${Math.round(
          frame.width
        )}x${Math.round(frame.height)}`
      );
    }

    throw new Error(
      'Multiple possible email frames found. Please paste the URL of the exact selected Figma frame into Airtable.'
    );
  }

  const onlyFrame = emailFrames[0];

  console.log(
    `Auto-detected email frame: "${onlyFrame.name}" | Size: ${Math.round(
      onlyFrame.width
    )}x${Math.round(onlyFrame.height)}`
  );

  return onlyFrame.node;
}

async function run() {
  const figmaInput = process.argv[2];

  const figmaFileId = extractFigmaFileId(figmaInput);
  const selectedNodeId = extractNodeId(figmaInput);

  if (!config.figma.token) {
    throw new Error('Missing FIGMA_TOKEN in .env');
  }

  console.log('Reading Figma file...');
  console.log(`Figma file ID: ${figmaFileId}`);

  const fileResponse = await figmaGet(
    `https://api.figma.com/v1/files/${figmaFileId}`,
    {
      headers: {
        'X-Figma-Token': config.figma.token,
      },
    }
  );

  const document = fileResponse.data.document;

  const targetNode = resolveTargetNode(document, selectedNodeId);

  console.log(`Final export target: "${targetNode.name}"`);
  console.log(`Node ID: ${targetNode.id}`);

  const exportResponse = await figmaGet(
    `https://api.figma.com/v1/images/${figmaFileId}`,
    {
      headers: {
        'X-Figma-Token': config.figma.token,
      },
      params: {
        ids: targetNode.id,
        format: 'png',
        scale: 1,
      },
    }
  );

  const imageUrl = exportResponse.data.images[targetNode.id];

  if (!imageUrl) {
    throw new Error(`Figma did not return an export URL for "${targetNode.name}".`);
  }

  fs.mkdirSync(config.output.slicesDir, { recursive: true });
  fs.mkdirSync('output', { recursive: true });

  const safeFileName = makeSafeFileName(targetNode.name);
  const outputPath = path.join(config.output.slicesDir, `${safeFileName}.png`);

  await downloadImage(imageUrl, outputPath);

  const exportMetadata = {
    figmaFileId,
    selectedNodeId,
    exportedNodeId: targetNode.id,
    exportedNodeName: targetNode.name,
    exportedImagePath: outputPath,
    exportedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    'output/figma-export.json',
    JSON.stringify(exportMetadata, null, 2),
    'utf8'
  );

  console.log('Export complete.');
  console.log(`Saved image to: ${outputPath}`);
  console.log('Saved metadata to: output/figma-export.json');
}

run().catch((error) => {
  console.error('Figma export failed.');

  if (error.response?.status) {
    console.error(`Status: ${error.response.status}`);
  }

  console.error(error.response?.data || error.message);
  process.exit(1);
});