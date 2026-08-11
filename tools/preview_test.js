const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/manifest|favicon|ERR_|Failed to load resource/i.test(t)) errs.push('CONSOLE: ' + t); } });
  const url = 'file:///<项目目录>/情绪地图完整预览.html';
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 600));

  // 进入地图
  await page.click('#navMap');
  await new Promise(r => setTimeout(r, 400));
  const total = await page.$$eval('#viewMap .map-pt', els => els.length);
  const labels = await page.$$eval('#viewMap .map-pin text', els => els.map(e => e.textContent));

  // 切到“自己”
  await page.click('#viewMap [data-self-toggle] button[data-v="self"]');
  await new Promise(r => setTimeout(r, 300));
  const selfCount = await page.$$eval('#viewMap .map-pt', els => els.length);

  // 切回“我们”
  await page.click('#viewMap [data-self-toggle] button[data-v="all"]');
  await new Promise(r => setTimeout(r, 300));
  const allCount = await page.$$eval('#viewMap .map-pt', els => els.length);

  // 主题切换
  const themeBefore = await page.evaluate(() => document.body.className);
  // 打开主题选择器
  const themeBtn = await page.$('#themeBtn');
  if (themeBtn) { await themeBtn.click(); await new Promise(r => setTimeout(r, 200)); }
  const lightBtn = await page.$('#themeLight');
  if (lightBtn) { await lightBtn.click(); await new Promise(r => setTimeout(r, 200)); }
  const themeAfter = await page.evaluate(() => document.body.className);

  // 记录详情点击
  await page.click('#navMap'); await new Promise(r => setTimeout(r, 300));
  await page.click('#viewMap .map-pt'); await new Promise(r => setTimeout(r, 300));
  const modalOpen = await page.$eval('#recDetail', el => !el.hidden).catch(() => false);

  console.log(JSON.stringify({
    total, selfCount, allCount,
    filterWorks: selfCount < total && allCount === total,
    labelCount: labels.length, labelsSample: labels.slice(0, 6),
    themeChanged: themeBefore !== themeAfter,
    modalOpen,
    realErrors: errs
  }, null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
