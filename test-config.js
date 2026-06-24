import { config } from './config.js';

console.log('Config loaded successfully.');

console.log({
  figmaTokenExists: Boolean(config.figma.token),
  figmaFileIdExists: Boolean(config.figma.fileId),
  shopifyUrl: config.shopify.url,
  klaviyoMode: config.klaviyo.key === 'MOCK' ? 'MOCK' : 'LIVE',
  cdnMode: config.cdn.githubToken ? 'LIVE' : 'MOCK',
  output: config.output,
});