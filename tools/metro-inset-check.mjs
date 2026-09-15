// The metronome page with the INSTALLED app's safe areas: 393x852 minus a
// 59px notch and a 34px home bar. Chrome's CDP can override the env() insets.
import puppeteer from 'puppeteer-core';
// See CLAUDE.md. npm run dev (on 5199) first.
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
for (const [w, h, top, bottom] of [[393, 852, 59, 34], [390, 844, 47, 34], [430, 932, 59, 34], [375, 667, 20, 0]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const cdp = await page.createCDPSession();
  let insets = 'set';
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, left: 0, bottom, right: 0 } });
  } catch (e) { insets = `NOT SUPPORTED: ${e.message}`; }
  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const seen = await page.evaluate(async () => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector('#tab-metronome')?.classList.contains('active')) break;
      document.querySelector('.tab-btn[data-tab="metronome"]')?.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 700));
    const start = document.querySelector('#metro-toggle');
    const box = start.getBoundingClientRect();
    const bar = document.querySelector('.tabbar, #tabbar, nav');
    const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);';
    document.body.append(probe);
    const envTop = probe.getBoundingClientRect().height; probe.remove();
    return {
      envTop,
      slack: document.documentElement.scrollHeight - window.innerHeight,
      startBottom: Math.round(box.bottom), barTop: Math.round(barTop),
      reachable: hit === start || start.contains(hit),
      classes: document.documentElement.className,
    };
  });
  console.log(`${w}x${h} insets ${top}/${bottom} (${insets}) env-top=${seen.envTop}`, seen);
  await page.close();
}
await browser.close();
