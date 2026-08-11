const puppeteer = require('puppeteer-core');
const path = '<项目目录>/情绪记录.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + path, { waitUntil: 'networkidle0' });
  const txt = await page.$eval('#reviewBtn', el => el.textContent.trim());
  await page.click('#reviewBtn');
  await new Promise(r => setTimeout(r, 200));
  const modalShown = await page.$eval('#reportModal', el => el.classList.contains('show'));
  console.log(JSON.stringify({ reviewBtnText: txt, hasEmoji: /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(txt), modalShown }, null, 2));
  await browser.close();
})();
