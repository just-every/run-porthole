// A launch and a rendered page prove the installed libraries are usable.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.argv[2], headless: true, timeout: 15000, args: ['--no-sandbox'] });
try {
 const page = await browser.newPage();
 await page.setContent('<main>Chromium ready</main>');
 if (await page.locator('main').textContent() !== 'Chromium ready') throw Error('Chromium launch probe failed');
 console.log('Chromium launch probe passed; no apt work needed.');
} finally { await browser.close(); }
