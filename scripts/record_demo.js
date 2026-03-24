const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function record() {
  const url = process.env.SRO_URL || 'http://104.238.128.128/';
  const outDir = path.resolve(__dirname, '..', 'recordings');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();

  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Try to open demo link if present
  try {
    const demoLink = await page.$('a[href="/demo"]');
    if (demoLink) {
      await demoLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.warn('Could not navigate to /demo:', e.message);
  }

  // Interact a bit to show UI
  try {
    await page.mouse.move(400, 240);
    await page.mouse.click(400, 240);
    await page.waitForTimeout(1000);
  } catch (e) {}

  // Wait while video records
  console.log('Recording for 6s...');
  await page.waitForTimeout(6000);

  await browser.close();

  // find the newest video file
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.webm') || f.endsWith('.webm')).map(f => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs })).sort((a,b)=>b.t-a.t);
  if (!files.length) {
    console.error('No video file found in', outDir);
    process.exit(2);
  }
  const latest = path.join(outDir, files[0].f);
  const outMp4 = path.resolve('/tmp', 'sro_demo.mp4');
  console.log('Converting', latest, '->', outMp4);

  const { execSync } = require('child_process');
  try {
    execSync(`ffmpeg -y -i "${latest}" -c:v libx264 -preset veryfast -crf 18 "${outMp4}"`, { stdio: 'inherit' });
    console.log('Saved demo to', outMp4);
  } catch (e) {
    console.error('ffmpeg failed:', e.message);
    process.exit(3);
  }
}

record().catch(err => {
  console.error(err);
  process.exit(1);
});
