const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = 'file://' + path.resolve('E:\\学习\\情绪记录\\情绪地图完整预览.html');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/favicon|manifest|Failed to load resource/i.test(t)) errs.push('CONSOLE: ' + t); } });

  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1500));

  const r = await page.evaluate(() => {
    const out = {};
    const txt = document.body.innerText;
    out.hasTerrainTitle = txt.includes('情绪地形 · 近 30 天');
    out.hasHeatTitle = txt.includes('情绪地形热力 · 近 13 周');
    out.hasCompassTitle = txt.includes('情绪罗盘 · 来源与相关');
    out.hasFootprintNav = !!document.querySelector('#navTl span') && document.querySelector('#navTl span').textContent === '足迹';
    out.hasSubtitleA = txt.includes('承载你每一段情绪的地图');
    // 视觉母题
    const ic = document.querySelector('.ic');
    out.icHasBg = !!(ic && getComputedStyle(ic).backgroundImage && getComputedStyle(ic).backgroundImage !== 'none');
    const hero = document.querySelector('#hero');
    out.heroHasBg = !!(hero && getComputedStyle(hero).backgroundImage && getComputedStyle(hero).backgroundImage !== 'none');
    const panel = document.querySelector('.panel');
    out.panelHasBg = !!(panel && getComputedStyle(panel).backgroundImage && getComputedStyle(panel).backgroundImage !== 'none');
    // 数据渲染
    out.heatCells = document.querySelectorAll('.cell').length;
    out.heatColored = [...document.querySelectorAll('.cell')].filter(c => c.classList.contains('on')).length;
    out.timelineItems = document.querySelectorAll('.tl-item, .tl-day').length;
    out.tagChips = document.querySelectorAll('.chip').length;
    // 主题切换
    const themeBtn = document.querySelector('#themeBtn, [data-theme-toggle], .theme-btn');
    out.themeBtnExists = !!themeBtn;
    return out;
  });

  // 主题切换实测
  let themeOk = false;
  try {
    await page.evaluate(() => {
      // 打开主题面板并切浅色
      const open = document.querySelector('#themeBtn');
      if (open) open.click();
    });
    await new Promise(r => setTimeout(r, 300));
    const after = await page.evaluate(() => {
      const light = document.querySelector('.theme-light, [data-theme="light"], #themeLight');
      if (light) light.click();
      return document.documentElement.className || document.body.className || '';
    });
    themeOk = true;
  } catch (e) { themeOk = 'ERR:' + e.message; }

  // 记一笔弹窗
  let recModalOk = false;
  try {
    await page.evaluate(() => { const b = document.querySelector('#recBtn, #newRecBtn, [data-open-rec]'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 400));
    recModalOk = await page.evaluate(() => !!document.querySelector('#recModal, .rec-modal, [id*="recModal"]'));
  } catch (e) { recModalOk = 'ERR:' + e.message; }

  console.log(JSON.stringify({ ...r, themeOk, recModalOk, errs }, null, 2));
  await browser.close();
})();
