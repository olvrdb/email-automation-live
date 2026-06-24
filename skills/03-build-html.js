import fs from 'fs';
import path from 'path';
import mjml2html from 'mjml';
import { config } from '../config.js';

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function toEmailSafePath(inputPath) {
  const fileName = path.basename(inputPath);
  return `slices/${fileName}`;
}

function getSliceManifestPath(inputImagePath) {
  const parsed = path.parse(inputImagePath);
  const sourceName = parsed.name.replace(/-processed$/, '');

  return path.join(parsed.dir, `${sourceName}-slices`, 'manifest.json');
}

function getLocalSliceSrc(manifest, slice) {
  const sliceFolderName = path.basename(manifest.sliceDir);
  return `slices/${sliceFolderName}/${slice.fileName}`;
}

function getPublicSliceSrc(publicImageSrc, manifest, slice) {
  if (!publicImageSrc) {
    return null;
  }

  const baseUrl = publicImageSrc.slice(0, publicImageSrc.lastIndexOf('/') + 1);
  const sliceFolderName = path.basename(manifest.sliceDir);

  return `${baseUrl}${sliceFolderName}/${slice.fileName}`;
}

function buildSliceImages({ manifest, productUrl, publicImageSrc, emailWidth }) {
  return manifest.slices
    .map((slice) => {
      const publicSliceSrc = getPublicSliceSrc(publicImageSrc, manifest, slice);
      const localSliceSrc = getLocalSliceSrc(manifest, slice);
      const imageSrc = publicSliceSrc || localSliceSrc;

      return `
        <mj-image
          src="${imageSrc}"
          href="${productUrl}"
          alt="Email slice ${slice.index}"
          width="${emailWidth}px"
          padding="0px"
          fluid-on-mobile="false"
        />
      `;
    })
    .join('\n');
}

async function run() {
  const inputImagePath = process.argv[2];
  const productUrl = process.argv[3] || config.shopify.url;
  const publicImageSrc = process.argv[4];
  const emailWidth = Number(process.env.EMAIL_WIDTH || 600);

  if (!inputImagePath) {
    throw new Error(
      'Missing input image path. Run: node skills/03-build-html.js "output/slices/email-hero-processed.png"'
    );
  }

  if (!fs.existsSync(inputImagePath)) {
    throw new Error(`Input image does not exist: ${inputImagePath}`);
  }

  const manifestPath = getSliceManifestPath(inputImagePath);
  const hasSliceManifest = fs.existsSync(manifestPath);

  let emailBodyContent = '';
  let buildMode = 'single-image';

  if (hasSliceManifest) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    buildMode = 'sliced-images';

    emailBodyContent = buildSliceImages({
      manifest,
      productUrl,
      publicImageSrc,
      emailWidth,
    });

    console.log(`Using slice manifest: ${normalizePath(manifestPath)}`);
    console.log(`Total slices in email: ${manifest.totalSlices}`);
  } else {
    const imageSrc = publicImageSrc || toEmailSafePath(inputImagePath);

    emailBodyContent = `
        <mj-image
          src="${imageSrc}"
          href="${productUrl}"
          alt="Email design exported from Figma"
          width="${emailWidth}px"
          padding="0px"
          fluid-on-mobile="false"
        />
    `;

    console.log('No slice manifest found. Falling back to single-image email.');
    console.log(`Image source: ${imageSrc}`);
  }

  const mjmlTemplate = `
<mjml>
  <mj-head>
    <mj-title>Mock Email Demo</mj-title>
    <mj-preview>Automated Figma to email preview</mj-preview>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-section padding="0px" />
      <mj-column padding="0px" />
      <mj-image padding="0px" />
    </mj-attributes>
  </mj-head>

  <mj-body background-color="#f4f4f4" width="${emailWidth}px">
    <mj-section background-color="#ffffff" padding="0px">
      <mj-column width="100%">
        ${emailBodyContent}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

  const result = await mjml2html(mjmlTemplate, {
    validationLevel: 'soft',
  });

  const html = typeof result === 'string' ? result : result?.html;
  const errors = result?.errors || [];

  if (!html) {
    console.log('MJML returned this result:');
    console.log(result);
    throw new Error('MJML did not return HTML output.');
  }

  if (errors.length > 0) {
    console.warn('MJML warnings:');
    console.warn(errors);
  }

  fs.mkdirSync('output', { recursive: true });

  fs.writeFileSync(config.output.emailHtml, html, 'utf8');
  fs.writeFileSync(config.output.previewHtml, html, 'utf8');

  console.log('HTML build complete.');
  console.log(`Build mode: ${buildMode}`);
  console.log(`Email width: ${emailWidth}px`);
  console.log(`Email HTML saved to: ${config.output.emailHtml}`);
  console.log(`Preview HTML saved to: ${config.output.previewHtml}`);
  console.log(`Linked image slices to: ${productUrl}`);
}

run().catch((error) => {
  console.error('HTML build failed.');
  console.error(error.message);
  process.exit(1);
});