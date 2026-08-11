const puppeteer = require('puppeteer-core');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  const url = 'file:///' + path.resolve('deploy/index.html').replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem('mood.data.v2', JSON.stringify({
      records: [
        { id: 't1', date: '2026-08-08', time: '14:30', mood: 4, scene: '看电影嚼豆花', note: '今天很放松，搞笑电影和好吃的豆花让人管特', tags: ['电影','豆花'], author: '' },
        { id: 't2', date: '2026-08-07', mood: 3, scene: '工作', note: '普通的一天', tags: ['工作'] },
        { id: 't3', date: '2026-08-08', time: '09:00', mood: 5, scene: '晨跑', note: '早起感觉很好', tags: ['运动'] }
      ]
    }));
  });

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(1500);

  await page.evaluate(() => { if (typeof switchView === 'function') switchView('viewTl'); });
  await sleep(1000);

  const info = await page.evaluate(() => {
    const items = document.querySelectorAll('.tl-item');
    if (!items.length) return { error: 'no items' };
    const first = items[0];
    const cs = window.getComputedStyle(first);
    const body = first.querySelector('.tl-body');
    const bcs = body ? window.getComputedStyle(body) : null;
    return {
      gridCols: cs.gridTemplateColumns,
      itemCount: items.length,
      bodyWidth: bcs ? bcs.width : null,
      children: first.children.length
    };
  });
  console.log('TL Item Info:', JSON.stringify(info, null, 2));

  await page.screenshot({ path: path.join(__dirname, 'tl-fix-check.png') });
  console.log('Screenshot saved.');

  // button check
  const btns = await page.evaluate(() => {
    const all = document.querySelectorAll('#viewTl button, .page-top button, .botnav button');
    return Array.from(all).map(b => ({ id: b.id, text: b.textContent.trim().slice(0, 30), disabled: b.disabled }));
  });
  console.log('Buttons:', JSON.stringify(btns, null, 2));

  await browser.close();
  console.log('ALL DONE');
})().catch(e => { console.error(e.message); process.exit(1); });
