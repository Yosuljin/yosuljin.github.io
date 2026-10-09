'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

(async () => {
  let browser = null;
  let brave = null;
  const errors = [];
  const failedRequests = [];
  const failures = [];
  try {
    const executable = process.env.BRAVE_PATH || 'brave';
    const profileDir = process.env.BROWSER_PROFILE || path.join(os.tmpdir(), 'yosuljin-qa-profile-' + process.pid);
    const outputDir = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'yosuljin-site-qa-' + stamp);
    const port = Number(process.env.DEBUG_PORT || 9333);
    const targetUrl = process.env.SITE_URL || ('https://yosuljin.github.io/?qa=' + Date.now());
    fs.mkdirSync(profileDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    brave = spawn(executable, [
      '--new-window', '--user-data-dir=' + profileDir,
      '--remote-debugging-port=' + port, '--no-first-run',
      '--no-default-browser-check', '--disable-extensions',
      '--start-maximized', targetUrl
    ], { detached: true, stdio: 'ignore' });
    brave.unref();

    for (let attempt = 0; attempt < 30 && !browser; attempt++) {
      try {
        browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port, defaultViewport: null });
      } catch { await pause(400); }
    }
    if (!browser) throw new Error('Could not connect to Brave debugging port ' + port);

    const pages = await browser.pages();
    const page = pages.find(candidate => /^https?:/.test(candidate.url())) || pages[0];
    if (!page) throw new Error('Brave opened without an accessible page');
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(String(error)));
    page.on('requestfailed', request => failedRequests.push({
      url: request.url(),
      error: request.failure() ? request.failure().errorText : null
    }));

    await page.waitForSelector('.menu-toggle', { timeout: 15000 });
    await pause(1600);
    const home = await page.evaluate(() => {
      const rect = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          rect: [box.x, box.y, box.width, box.height],
          opacity: style.opacity, visibility: style.visibility,
          transform: style.transform, text: (element.textContent || '').trim()
        };
      };
      return {
        url: location.href, viewport: [innerWidth, innerHeight],
        rootClasses: document.documentElement.className,
        stylesheet: [...document.styleSheets].map(sheet => sheet.href || '').find(href => href.includes('styles.css')) || null,
        homePanel: rect('.panel-home'), heroTitle: rect('.hero-title'), worldCanvas: rect('.world-canvas')
      };
    });
    await page.screenshot({ path: path.join(outputDir, 'home.png') });

    // First visit opens a standby dialog that blocks the menu until an explicit gesture.
    // Choose the quiet path so the test does not begin an audio session.
    const quietGate = await page.$('.signal-gate-quiet');
    if (quietGate) {
      await quietGate.click();
      await page.waitForFunction(() => !document.querySelector('.signal-gate'), { timeout: 5000 });
      await pause(450);
    }
    const entered = await page.evaluate(() => ({
      url: location.href,
      rootClasses: document.documentElement.className,
      gateStillPresent: !!document.querySelector('.signal-gate'),
      menuButtonVisible: !!document.querySelector('.menu-toggle')
    }));
    await page.screenshot({ path: path.join(outputDir, 'home-entered.png') });

    const menuButton = await page.$('.menu-toggle');
    const menuBox = menuButton && await menuButton.boundingBox();
    if (!menuBox) throw new Error('Menu button has no visible bounding box');
    await page.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await pause(550);
    const menu = await page.evaluate(() => ({
      expanded: document.querySelector('.menu-toggle')?.getAttribute('aria-expanded') || null,
      rootClasses: document.documentElement.className,
      visibility: getComputedStyle(document.querySelector('#site-menu')).visibility
    }));
    await page.screenshot({ path: path.join(outputDir, 'menu.png') });
    if (menu.expanded !== 'true') failures.push('Menu did not report aria-expanded=true');

    const link = await page.$('.site-menu a[href$="developpement.html"]');
    const linkBox = link && await link.boundingBox();
    if (!linkBox) throw new Error('Development link was not visible in the open menu');
    await page.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
    await pause(100);
    await page.screenshot({ path: path.join(outputDir, 'transition-100ms.png') });
    await pause(230);
    await page.screenshot({ path: path.join(outputDir, 'transition-330ms.png') });
    await page.waitForFunction(
      () => location.pathname.endsWith('/developpement.html'),
      { timeout: 9000 }
    ).catch(() => {});
    await pause(900);

    const detail = await page.evaluate(() => ({
      url: location.href, pathname: location.pathname,
      rootClasses: document.documentElement.className,
      title: document.querySelector('.detail-title')?.textContent ||
        document.querySelector('h1')?.textContent || null,
      worldReady: document.documentElement.classList.contains('world-ready')
    }));
    await page.screenshot({ path: path.join(outputDir, 'detail.png') });
    if (!detail.pathname.endsWith('/developpement.html')) failures.push('Development link did not reach developpement.html');
    if (!detail.title) failures.push('Detail page has no visible h1/title');

    const report = {
      testedAt: new Date().toISOString(), targetUrl, browserExecutable: executable,
      viewport: home.viewport, home, entered, menu, detail,
      pageErrors: errors, failedRequests, failures, screenshots: outputDir
    };
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (failures.length || errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
    if (brave && brave.pid) { try { brave.kill(); } catch {} }
  }
})();
