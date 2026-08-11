/**
 * 情绪记录 · 自动化交互自检
 * 用本机 Edge（headless）真实打开页面，逐个按钮点一遍，检查：
 *   1) 有没有 JS 报错 / 未捕获异常
 *   2) 每个按钮能不能点到（热区、遮挡、pointer-events）
 *   3) 悬停 + 点击前后位置会不会漂移（用户反馈的「按钮乱飘」）
 *   4) 关键交互结果对不对（筛选、切视图、主题、折叠…）
 *   5) 手机视口下有没有横向溢出
 *
 * 用法： node uitest.js [http://127.0.0.1:8899/情绪记录.html]
 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8899/' + encodeURIComponent('情绪记录.html');

// 造一批带标签、跨作者的假数据，才能测到标签关系图和「谁是谁」图例
function seedData() {
  const tagPool = [
    ['学习', '焦虑'], ['学习', '疲惫', '熬夜'], ['考试', '焦虑', '挫败'],
    ['运动', '放松'], ['社交', '开心'], ['学习', '成就感'],
    ['熬夜', '疲惫'], ['焦虑', '想逃'], ['平静', '整理'], ['社交', '委屈'],
  ];
  const authors = ['小苏', '朋友A'];
  const recs = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(2026, 6, 1 + i % 31);
    recs.push({
      id: 'test-' + i,
      date: d.toISOString().slice(0, 10),
      time: (8 + i % 12) + ':00',
      author: authors[i % 2],
      mood: 1 + (i % 5),
      energy: 1 + (i % 5), tension: 1 + ((i + 2) % 5), sleep: 5 + (i % 5),
      scene: '场景' + i,
      tags: tagPool[i % tagPool.length],
      note: '测试备注 ' + i,
      important: i % 7 === 0,
    });
  }
  return { version: 1, records: recs, nextQuestions: [] };
}

const results = { errors: [], drift: [], dead: [], flow: [], overflow: [] };

async function measure(page, handle) {
  return await page.evaluate(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), tf: cs.transform };
  }, handle);
}

function label(info) {
  return (info.id ? '#' + info.id : '') + (info.cls ? '.' + String(info.cls).split(' ')[0] : '') + ' 「' + (info.text || '').slice(0, 14) + '」';
}

async function checkClickable(page, sel) {
  const items = await page.$$(sel);
  for (const h of items) {
    const info = await page.evaluate(el => ({
      id: el.id, cls: el.getAttribute('class') || '', text: (el.textContent || '').trim(),
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      pe: getComputedStyle(el).pointerEvents,
      disabled: !!el.disabled,
    }), h);
    if (!info.visible || info.disabled) continue;

    const before = await measure(page, h);
    if (before.w < 24 || before.h < 24) results.dead.push(label(info) + ' 热区过小 ' + before.w + '×' + before.h);
    if (info.pe === 'none') results.dead.push(label(info) + ' pointer-events:none，点不到');

    // 中心点是否被别的元素挡住
    const blocked = await page.evaluate(el => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null;
      const top = document.elementFromPoint(cx, cy);
      if (!top) return 'nothing';
      if (el.contains(top) || top.contains(el)) return null;
      return (top.id ? '#' + top.id : top.tagName.toLowerCase() + '.' + String(top.className).split(' ')[0]);
    }, h);
    if (blocked) results.dead.push(label(info) + ' 中心被 ' + blocked + ' 挡住');

    // 悬停 → 是否漂移
    try {
      await h.hover();
      await new Promise(r => setTimeout(r, 260));
      const after = await measure(page, h);
      const dx = Math.abs(after.x - before.x), dy = Math.abs(after.y - before.y);
      if (dx > 1.5 || dy > 1.5) {
        results.drift.push(label(info) + ' 悬停位移 Δx=' + dx.toFixed(1) + ' Δy=' + dy.toFixed(1) + ' transform=' + after.tf);
      }
    } catch (e) { /* 元素可能在视口外，忽略 */ }
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  page.on('pageerror', e => results.errors.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') results.errors.push('[console.error] ' + m.text()); });

  const data = seedData();
  await page.evaluateOnNewDocument(d => {
    localStorage.setItem('mood.data.v2', JSON.stringify(d));
    localStorage.setItem('mood.ghNick', '小苏');
  }, data);

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1600));

  // ---- 桌面端：全量按钮扫描 ----
  await checkClickable(page, '.btn, .tb-btn, .bnav-btn, .mood-chip, .seg-btn, .tagcloud .chip, .cal-arrow, .tag-chip, .collapse-btn, .lg-item, .swatch');

  // ---- 页面自带的运行时自检 ----
  const selfCheck = await page.evaluate(() => window.__moodSelfCheck || null);

  // ---- 关键流程 ----
  const flow = async (name, fn) => {
    try { const r = await fn(); results.flow.push((r === true ? '✓ ' : '✗ ') + name + (typeof r === 'string' ? ' → ' + r : '')); }
    catch (e) { results.flow.push('✗ ' + name + ' → 抛错：' + e.message); }
  };

  await flow('高频标签可点 → 跳到历史并筛选', async () => {
    const chip = await page.$('.tagcloud .chip');
    if (!chip) return '找不到标签 chip';
    const tag = await page.evaluate(el => el.dataset.tag, chip);
    await chip.click();
    await new Promise(r => setTimeout(r, 500));
    const st = await page.evaluate(() => ({
      hidden: document.querySelector('#viewHist').hidden,
      n: document.querySelectorAll('#viewHistList .hist-item').length,
      cnt: document.querySelector('#viewHistCount').textContent,
    }));
    return (!st.hidden && st.n > 0) ? true : ('viewHist.hidden=' + st.hidden + ' 条数=' + st.n + ' 标签=' + tag);
  });

  await flow('标签关系图渲染出节点', async () => {
    const n = await page.$$eval('#tagGraph .tg-node', els => els.length);
    return n > 0 ? true : '节点数 0';
  });

  await flow('点关系图节点 → 切换筛选', async () => {
    await page.evaluate(() => { document.querySelector('#tgReset').click(); });
    await new Promise(r => setTimeout(r, 350));
    const node = await page.$('#tagGraph .tg-node');
    const box = await node.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise(r => setTimeout(r, 450));
    const t = await page.evaluate(() => document.querySelector('#tgActive').textContent);
    return t.includes('当前筛选') ? true : ('tgActive="' + t + '"');
  });

  await flow('共享空间图例出现且可筛选作者', async () => {
    const items = await page.$$('#authorLegend .lg-item');
    if (!items.length) return '没有图例项';
    await items[1].click();
    await new Promise(r => setTimeout(r, 450));
    const ok = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#viewHistList .hist-item'));
      const names = new Set(rows.map(r => (r.textContent.match(/记录人 · (\S+)/) || [])[1]).filter(Boolean));
      return { n: rows.length, names: Array.from(names) };
    });
    return (ok.n > 0 && ok.names.length === 1) ? true : JSON.stringify(ok);
  });

  await flow('清除筛选按钮生效', async () => {
    await page.evaluate(() => document.querySelector('#tgReset').click());
    await new Promise(r => setTimeout(r, 400));
    const t = await page.evaluate(() => document.querySelector('#tgActive').textContent);
    return t === '' ? true : ('残留="' + t + '"');
  });

  await flow('折叠「标签关系图」', async () => {
    await page.evaluate(() => document.querySelector('#tgToggle').click());
    await new Promise(r => setTimeout(r, 450));
    const c = await page.evaluate(() => document.querySelector('#tgBody').classList.contains('collapsed'));
    await page.evaluate(() => document.querySelector('#tgToggle').click());
    return c === true ? true : '没折起来';
  });

  await flow('底部导航切换视图', async () => {
    await page.evaluate(() => document.querySelector('#navTl').click());
    await new Promise(r => setTimeout(r, 400));
    const a = await page.evaluate(() => !document.querySelector('#viewTl').hidden);
    await page.evaluate(() => document.querySelector('#navDash').click());
    await new Promise(r => setTimeout(r, 400));
    const b = await page.evaluate(() => !document.querySelector('#bento').hidden);
    return (a && b) ? true : ('tl=' + a + ' dash=' + b);
  });

  await flow('主题面板 → 浅色可点', async () => {
    await page.evaluate(() => document.querySelector('#themeBtn').click());
    await new Promise(r => setTimeout(r, 450));
    await page.evaluate(() => document.querySelector('#modeLight').click());
    await new Promise(r => setTimeout(r, 350));
    const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.evaluate(() => document.querySelector('#modeDark').click());
    await new Promise(r => setTimeout(r, 200));
    const t2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.evaluate(() => { const p = document.querySelector('#themePanel'); if (p) p.classList.remove('show'); const s = document.querySelector('#scrim'); if (s) s.classList.remove('show'); });
    return (t === 'light' && t2 === 'dark') ? true : ('light→' + t + ' dark→' + t2);
  });

  await flow('AI 发送按钮有响应（无 Key 时应给提示而不是没反应）', async () => {
    await page.evaluate(() => { const i = document.querySelector('#aiInput'); i.value = '今天有点累'; });
    const b1 = await page.evaluate(() => { const r = document.querySelector('#aiSend').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.evaluate(() => document.querySelector('#aiSend').click());
    await new Promise(r => setTimeout(r, 700));
    const b2 = await page.evaluate(() => { const r = document.querySelector('#aiSend').getBoundingClientRect(); return { x: r.x, y: r.y }; });
    const moved = Math.abs(b1.x - b2.x) > 1.5 || Math.abs(b1.y - b2.y) > 1.5;
    const said = await page.evaluate(() => (document.querySelector('#aiChat').textContent || '').trim().length > 0);
    if (moved) return '点击后按钮位移了 Δx=' + (b2.x - b1.x).toFixed(1);
    return said ? true : '点了没有任何反馈';
  });

  await flow('记一笔弹窗 · 心情按钮不漂移', async () => {
    await page.evaluate(() => document.querySelector('#recBtn').click());
    await new Promise(r => setTimeout(r, 600));
    const btns = await page.$$('#recMood button');
    if (!btns.length) return '找不到心情按钮';
    const before = [];
    for (const b of btns) before.push(await measure(page, b));
    for (const b of btns) { await b.hover(); await new Promise(r => setTimeout(r, 120)); }
    await btns[3].click();
    await new Promise(r => setTimeout(r, 350));
    const after = [];
    for (const b of btns) after.push(await measure(page, b));
    const bad = before.map((v, i) => Math.abs(v.x - after[i].x) + Math.abs(v.y - after[i].y)).filter(d => d > 1.5);
    const active = await page.evaluate(() => !!document.querySelector('#recMood button.active'));
    await page.evaluate(() => { const m = document.querySelector('#recModal'); if (m) m.classList.remove('show'); const s = document.querySelector('#scrim'); if (s) s.classList.remove('show'); });
    if (bad.length) return bad.length + ' 个心情按钮发生位移';
    return active ? true : '点了没有选中态';
  });

  await flow('设置弹窗 · 测试连接按钮不漂移', async () => {
    await page.evaluate(() => document.querySelector('#setBtn').click());
    await new Promise(r => setTimeout(r, 600));
    const t = await page.$('#ghTest');
    if (!t) return '找不到 #ghTest';
    const b1 = await measure(page, t);
    await t.hover(); await new Promise(r => setTimeout(r, 300));
    const b2 = await measure(page, t);
    await t.click(); await new Promise(r => setTimeout(r, 500));
    const b3 = await measure(page, t);
    const d = Math.abs(b1.x - b3.x) + Math.abs(b1.y - b3.y) + Math.abs(b1.x - b2.x) + Math.abs(b1.y - b2.y);
    await page.evaluate(() => { const m = document.querySelector('#setModal'); if (m) m.classList.remove('show'); const s = document.querySelector('#scrim'); if (s) s.classList.remove('show'); });
    return d <= 2 ? true : ('累计位移 ' + d.toFixed(1) + 'px');
  });

  await flow('顶栏同步状态可点（未配置时打开设置）', async () => {
    await page.evaluate(() => document.querySelector('#connDot').click());
    await new Promise(r => setTimeout(r, 500));
    const open = await page.evaluate(() => document.querySelector('#setModal').classList.contains('show'));
    await page.evaluate(() => { const m = document.querySelector('#setModal'); if (m) m.classList.remove('show'); const s = document.querySelector('#scrim'); if (s) s.classList.remove('show'); });
    return open ? true : '点了没打开设置';
  });

  // ---- 手机视口 ----
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1600));

  const mob = await page.evaluate(() => {
    const doc = document.documentElement;
    const over = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > innerWidth + 2 || r.left < -2)) {
        over.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' right=' + r.right.toFixed(0));
      }
    });
    const pills = Array.from(document.querySelectorAll('#stats .pill'));
    const ys = new Set(pills.map(p => Math.round(p.getBoundingClientRect().top)));
    return {
      scrollW: doc.scrollWidth, innerW: innerWidth,
      overflow: over.slice(0, 12),
      pillRows: ys.size,
      pillNumberVisible: pills.some(p => { const v = p.querySelector('.v'); return v && getComputedStyle(v).display !== 'none'; }),
      pillVizVisible: pills.every(p => { const v = p.querySelector('.pill-viz'); return v && getComputedStyle(v).display !== 'none'; }),
      segCount: document.querySelectorAll('#stats .pv-seg').length,
      toolsRows: new Set(Array.from(document.querySelectorAll('.tools > *')).map(e => Math.round(e.getBoundingClientRect().top))).size,
    };
  });
  results.overflow = mob;

  await checkClickable(page, '.btn, .tb-btn, .bnav-btn, .collapse-btn, .tagcloud .chip');

  await browser.close();

  // ---- 输出 ----
  const out = [];
  out.push('════ 情绪记录 · 交互自检报告 ════');
  out.push('\n【1】JS 错误：' + (results.errors.length ? '\n  · ' + [...new Set(results.errors)].join('\n  · ') : ' 无 ✓'));
  out.push('\n【2】点不动 / 被挡 / 热区过小：' + (results.dead.length ? '\n  · ' + [...new Set(results.dead)].join('\n  · ') : ' 无 ✓'));
  out.push('\n【3】按钮漂移：' + (results.drift.length ? '\n  · ' + [...new Set(results.drift)].join('\n  · ') : ' 无 ✓'));
  out.push('\n【4】页面内建自检 window.__moodSelfCheck：' + (selfCheck && selfCheck.length ? '\n  · ' + selfCheck.join('\n  · ') : ' 无问题 ✓'));
  out.push('\n【5】关键流程：\n  ' + results.flow.join('\n  '));
  out.push('\n【6】手机视口 390×844：');
  out.push('  横向溢出：' + (mob.scrollW > mob.innerW ? ('有！scrollWidth=' + mob.scrollW + ' > ' + mob.innerW) : '无 ✓'));
  if (mob.overflow.length) out.push('  溢出元素：\n    · ' + mob.overflow.join('\n    · '));
  out.push('  概览胶囊排成 ' + mob.pillRows + ' 行（期望 1）' + (mob.pillRows === 1 ? ' ✓' : ' ✗'));
  out.push('  概览是否还在显示数字：' + (mob.pillNumberVisible ? '是 ✗' : '否 ✓'));
  out.push('  概览刻度条是否显示：' + (mob.pillVizVisible ? '是 ✓（共 ' + mob.segCount + ' 段）' : '否 ✗'));
  out.push('  顶栏 tools 占 ' + mob.toolsRows + ' 行（状态一行 + 按钮一行 = 2 为佳）');
  console.log(out.join('\n'));
})().catch(e => { console.error('测试脚本自身出错：', e); process.exit(1); });
