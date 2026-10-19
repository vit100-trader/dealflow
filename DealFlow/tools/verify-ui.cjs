const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

// Uses the persistent Edge/CDP profile specified in the repository instructions.
// Set NODE_PATH to the bundled node_modules directory before running.
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = process.argv[2] || path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(output, { recursive: true });
  let checks = 0;
  const check = (condition, description) => {
    if (!condition) throw new Error(description);
    checks++;
  };
  try {
    await page.goto('http://localhost:5110/?deal=12196870&days=30', { waitUntil: 'networkidle' });
    await page.locator('#explorer').waitFor({ state: 'visible', timeout: 60000 });
    check(await page.locator('#dealTitle').textContent() === '#12196870', 'Deal lookup renders');
    check(await page.locator('#map .node-current').count() === 1, 'One current position');
    check(await page.locator('#map .edge-hit').count() > 0, 'Observed routes rendered');
    check(await page.locator('#timeline .activity').count() >= 5, 'Resubmission timeline rendered');
    const focusedEdges = await page.locator('#map .edge-hit').count();
    await page.locator('#allRoutes').check();
    check(await page.locator('#map .edge-hit').count() > focusedEdges, 'All routes expands the observed graph');
    await page.locator('#allRoutes').uncheck();
    check(await page.locator('#map .edge-hit').count() === focusedEdges, 'Focused map restores');
    await page.screenshot({ path: path.join(output, 'dealflow-desktop.png'), fullPage: true });
    await page.locator('#map [data-code="SU"]').click();
    check((await page.locator('#detail').textContent()).includes('THIS DEAL’S VISITS'), 'State click opens visit details');
    await page.locator('#map .edge-hit').first().press('Enter');
    check((await page.locator('#detail').textContent()).includes('TRANSITION DETAILS'), 'Keyboard route selection');
    const before = await page.locator('#map').getAttribute('style');
    await page.locator('#zoomIn').click();
    check(await page.locator('#map').getAttribute('style') !== before, 'Map zoom changes scale');
    await page.locator('#fit').click();
    await page.locator('#traffic').uncheck();
    await page.locator('#happy').uncheck();
    check(await page.locator('#map .node-current').count() === 1, 'Layers retain current position');
    await page.locator('#traffic').check(); await page.locator('#happy').check();
    await page.locator('#catalogNav').click();
    await page.locator('#catalogRows tr').nth(19).waitFor({ timeout: 60000 });
    check(await page.locator('#catalogRows tr').count() === 20, 'All 20 QA status definitions');
    check((await page.locator('#catalogRows').textContent()).includes('Documents Incomplete'), 'Database names in catalog');
    await page.locator('#closeCatalog').click();
    await page.locator('#days').selectOption('7');
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: 60000 });
    check((await page.locator('#metrics').textContent()).includes('7 days'), 'Historical period refresh');
    await page.locator('#dealId').fill('0');
    await page.locator('#searchButton').click();
    await page.locator('#error').waitFor({ state: 'visible', timeout: 60000 });
    check((await page.locator('#error').textContent()).includes('No auto application'), 'Unknown deal error');
    await page.locator('#dealId').fill('12192982');
    await page.locator('#searchButton').click();
    await page.locator('#explorer').waitFor({ state: 'visible', timeout: 60000 });
    check(await page.locator('#dealTitle').textContent() === '#12192982', 'Recover after missing deal');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'dealflow-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, 'Mobile layout does not overflow page');
    check(errors.length === 0, 'No browser JavaScript errors: ' + errors.join('; '));
    console.log(JSON.stringify({ passed: checks, browserErrors: errors, screenshots: output }));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
