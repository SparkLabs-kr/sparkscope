import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const outputPath = path.join(process.cwd(), 'dashboard.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

try {
  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'load' });
  
  // 데이터 로딩 대기
  console.log('Waiting for content to load...');
  await page.waitForTimeout(5000);
  
  // 스크롤 해서 동적 로딩 유도
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(2000);

  console.log('Taking screenshot...');
  const buffer = await page.screenshot({ fullPage: true });
  fs.writeFileSync(outputPath, buffer);
  console.log(`✓ Screenshot saved (${buffer.length} bytes)`);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
} finally {
  await browser.close();
}
