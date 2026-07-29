import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });

try {
  console.log('Opening dashboard...');
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('Taking screenshot...');
  await page.screenshot({ path: '/tmp/dashboard.png', fullPage: true });
  console.log('✓ Screenshot saved to /tmp/dashboard.png');
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await browser.close();
}
