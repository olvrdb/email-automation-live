PS C:\Users\SINE NOMINE\Desktop\Automations\Oli-Automations\email-automation> node run.js "https://www.figma.com/design/iVvyGPfRYiNXuUVWSuxWBM/Untitled?node-id=0-1&p=f&t=IBHR5JkI6sTKkYRU-0"
◇ injected env (5) from .env // tip: ⌁ auth for agents [www.vestauth.com]
Starting Figma to Klaviyo automation...
Figma URL: https://www.figma.com/design/iVvyGPfRYiNXuUVWSuxWBM/Untitled?node-id=0-1&p=f&t=IBHR5JkI6sTKkYRU-0
Target frame/layer: Email / Hero
Product URL: https://example.com
Campaign name: Mock Email Demo
Subject line: Automated Email Preview

========================================
Step 1: Export Figma frame/layer
========================================
◇ injected env (0) from .env // tip: ◈ encrypted .env [www.dotenvx.com]
Reading Figma file...
Target layer/frame: Email / Hero
Found "Email / Hero".
Node ID: 1:2
Export complete.
Saved to: output\slices\email-hero.png

========================================
Step 2: Process email-safe image
========================================
◇ injected env (0) from .env // tip: ⌘ override existing { override: true }
Processing image: output\slices\email-hero.png
Image processing complete.
Saved to: output\slices\email-hero-processed.png

========================================
Step 3: Build email HTML and preview
========================================
◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]
HTML build complete.
Email HTML saved to: output/email.html
Preview HTML saved to: output/preview.html
Linked image to: https://example.com

========================================
Step 4: Verify product links
========================================
◇ injected env (0) from .env // tip: ⌁ auth for agents [www.vestauth.com]
Verifying product links...
Checking: https://example.com
PASS: https://example.com returned 200
Link verification complete.
Report saved to: output/link-report.json
All links passed.

========================================
Step 5: Generate Klaviyo-ready payload
========================================
◇ injected env (0) from .env // tip: ◈ encrypted .env [www.dotenvx.com]
Klaviyo-ready payload generated.
Saved to: output/klaviyo-campaign-payload.json
Campaign: Mock Email Demo
Subject: Automated Email Preview
Mode: MOCK

Automation complete.
Generated files:
- output/email.html
- output/preview.html
- output/link-report.json
- output/klaviyo-campaign-payload.json