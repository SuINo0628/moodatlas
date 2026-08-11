/* ============================================================
   情绪记录 · 渲染与动效 v3
   纯原生 JS + SVG + Canvas，无外部依赖
   特性：主题随切变色 · 年/月/日筛选 · 上下文联动提问 · 语音/自由输入 · 柔光粒子
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 本地数据：localStorage 持久化 + 导入导出（本地保存） ---------- */
  const LS_KEY = 'mood.data.v2';
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function loadData() {
    try { const s = localStorage.getItem(LS_KEY); if (s) { const d = JSON.parse(s); if (d && Array.isArray(d.records)) return d; } } catch (e) {}
    return null;
  }
  const _seeded = loadData();
  const DATA = _seeded || window.__DATA__ || { records: [] };
  // 给旧记录 / 导入数据补稳定 id：用内容指纹做 id，保证同一笔旧记录在不同设备上算出的是同一个 id，
  // 否则各自随机 id 会让「跨设备合并 / 删除」对老数据失效（同一条被当成两条、墓碑对不上）。
  (DATA.records || []).forEach(r => { if (!r.id) r.id = 'fp_' + recFingerprint(r); });
  if (!DATA.nextQuestions) DATA.nextQuestions = [];
  if (!Array.isArray(DATA.deleted)) DATA.deleted = []; // 墓碑：记录被删的 id/指纹，用于跨设备传播删除
  if (!Array.isArray(DATA.revived)) DATA.revived = []; // 复活标记：从回收站恢复过的 id，压过更早的墓碑
  if (!Array.isArray(DATA.trash)) DATA.trash = []; // 回收站：被软删除的记录，可恢复或彻底删除
  if (!Array.isArray(DATA.trashPurged)) DATA.trashPurged = []; // 已离开回收站的 id（彻底删除 / 已恢复）
  // 回收站里的老记录也要补稳定 id（和主记录同一套 fp_ 指纹），否则彻底删除/恢复时
  // 按 id 找不到会静默 return，表现成"点了没用、记录还在"。
  (DATA.trash || []).forEach(r => { if (!r.id) r.id = 'fp_' + recFingerprint(r); });
  const TODAY_Q = DATA.todayQuestion || window.__TODAY_Q__ || '今天过得怎么样？挑感受最明显的一件事，写两句。';
  const Q_PROMPTS = window.__Q_PROMPTS__ || [];
  const NEXT_Q = DATA.nextQuestions;
  const GEN_DATE = window.__GEN_DATE__ || '';
  function saveData() { try { localStorage.setItem(LS_KEY, JSON.stringify(DATA)); } catch (e) {} }
  const recs = (DATA.records || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);

  /* ---------- 本地服务连接探测（决定能否「网页内直接写回文件」） ---------- */
  let API_OK = false, API_BASE = '', PORT = 8137;
  function probeApi() {
    const setLive = (ok, base) => {
      API_OK = ok; API_BASE = base;
      updateConn();
    };
    const abs = 'http://127.0.0.1:' + PORT + '/api/ping';
    fetch('/api/ping', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j && j.ok) setLive(true, ''); else throw 0; })
      .catch(() => fetch(abs, { cache: 'no-store' }).then(r => r.json()).then(j => { if (j && j.ok) setLive(true, abs); else throw 0; }).catch(() => setLive(false, '')));
  }

  /* ---------- GitHub 云同步（前端直连 api.github.com，手机/电脑共用一份数据） ---------- */
  const GH_FILE = '情绪记录.json';
  const GH_TRASH = '情绪记录_回收站.json';
  function ghProfile() { return localStorage.getItem('mood.ghProfile') || 'personal'; }
  function ghSuffix() { return ghProfile() === 'shared' ? '2' : ''; }
  function ghConf() {
    const p = ghSuffix(), shared = ghProfile() === 'shared';
    return {
      profile: ghProfile(),
      enabled: localStorage.getItem('mood.ghEnabled' + p) === '1',
      user: (localStorage.getItem('mood.ghUser' + p) || '').trim(),
      repo: (localStorage.getItem('mood.ghRepo' + p) || (shared ? 'mood-atlas-shared' : 'mood-atlas-sync')).trim(),
      token: (localStorage.getItem('mood.ghToken' + p) || '').trim(),
      auto: localStorage.getItem('mood.ghAuto' + p) === '1'
    };
  }
  function ghNick() { return (localStorage.getItem('mood.ghNick' + ghSuffix()) || '').trim(); }
  function loadGh() {
    const p = ghSuffix();
    $('#ghUser').value = localStorage.getItem('mood.ghUser' + p) || '';
    $('#ghRepo').value = localStorage.getItem('mood.ghRepo' + p) || (ghProfile() === 'shared' ? 'mood-atlas-shared' : 'mood-atlas-sync');
    $('#ghToken').value = localStorage.getItem('mood.ghToken' + p) || '';
    if (typeof updateGhTokenHint === 'function') updateGhTokenHint();
    $('#ghEnable').checked = localStorage.getItem('mood.ghEnabled' + p) === '1';
    $('#ghAuto').checked = localStorage.getItem('mood.ghAuto' + p) === '1';
    $('#ghNick').value = ghNick();
    $('#ghNickWrap').style.display = ghProfile() === 'shared' ? 'block' : 'none';
    document.querySelectorAll('#ghSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.profile === ghProfile()));
    $('#ghHint').textContent = ghProfile() === 'shared'
      ? '共享空间：和朋友共用同一份记录。请给朋友一把「只限共享仓库」的受限令牌，不要分享你的主 PAT。'
      : '个人空间：数据只在你的私有仓库，朋友默认看不到。';
  }
  function ghHeaders() {
    const c = ghConf();
    return { 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json' };
  }
  function ghApiUrl(c, file) {
    return 'https://api.github.com/repos/' + encodeURIComponent(c.user) + '/' + encodeURIComponent(c.repo) + '/contents/' + encodeURIComponent(file || GH_FILE);
  }
  function b64enc(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64dec(s) { return decodeURIComponent(escape(atob(s.replace(/\s/g, '')))); }
  // 把 GitHub 返回的非 2xx 统一包成带「是否限流」标记的错误，方便上层决定重试还是放弃
  async function ghHttpErr(res, what) {
    let body = '';
    try { const b = await res.json(); if (b && b.message) body = b.message; } catch (_) {}
    const status = res.status;
    const statusText = res.statusText || '';
    const remaining = res.headers && res.headers.get ? res.headers.get('X-RateLimit-Remaining') : null;
    const retryAfter = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
    // GitHub 限流也用 403 返回（和"令牌没权限"是同一个状态码），必须靠响应体/剩余配额区分，
    // 否则会把"只是被限流"误判成"令牌坏了"，既不重试又吓用户。
    const rateLimited = status === 429 ||
      (status === 403 && (remaining === '0' || /rate limit|secondary rate|abuse/i.test(body + ' ' + statusText)));
    const e = new Error((what || '操作') + '失败 HTTP ' + status + (body ? ' — ' + body : (statusText ? ' — ' + statusText : '')));
    e.status = status; e.rateLimited = !!rateLimited;
    e.retryAfter = retryAfter ? parseInt(retryAfter, 10) : null;
    return e;
  }
  async function ghPull(file) {
    const c = ghConf();
    let res;
    try { res = await fetch(ghApiUrl(c, file), { headers: ghHeaders() }); }
    catch (netErr) {
      const e = new Error('网络连不上 GitHub（' + ((netErr && netErr.message) || netErr) + '），稍后会自动重试');
      e.status = 0; e.net = true; throw e;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw await ghHttpErr(res, '拉取');
    const j = await res.json();
    let bad = false;
    let data; try { data = JSON.parse(b64dec(j.content)); } catch (e) { bad = true; data = { records: [], nextQuestions: [] }; }
    if (!data || typeof data !== 'object') { bad = true; data = { records: [] }; }
    // 云端文件损坏时，不能当成「云端是空的」继续往下走：那会把本地数据当成全量覆盖上去，
    // 反过来也可能把本地清空。直接报错，让用户看到，数据原样留在两边。
    if (bad) { const e = new Error('云端文件内容坏了，解析不出来，已停下不动它'); e.status = 599; throw e; }
    if (!Array.isArray(data.records)) data.records = [];
    if (!Array.isArray(data.nextQuestions)) data.nextQuestions = [];
    if (!Array.isArray(data.deleted)) data.deleted = [];
    if (!Array.isArray(data.revived)) data.revived = [];
    if (!Array.isArray(data.purged)) data.purged = [];
    return { data: data, sha: j.sha };
  }
  /* 合并策略修复：原来以 date 作唯一键，两个人在同一天各记一条时会互相覆盖（真实丢数据）。
     现在改为：先按稳定 id 合并，再按「日期+时间+记录人+心情+场景+备注」内容指纹去重，
     同一条的两个版本保留字段更完整的那份。同日多条、双人同日都能完整保留。 */
  function fieldScore(o) {
    return Object.keys(o).filter(function (k) {
      const v = o[k];
      return v !== '' && v != null && !(Array.isArray(v) && !v.length);
    }).length;
  }
  function recFingerprint(r) {
    return [r.date || '', r.time || '', r.author || '', r.mood == null ? '' : r.mood,
      String(r.scene || '').trim(), String(r.note || '').trim()].join('|');
  }
  function mergeRecords(local, remote) {
    const byId = {};
    const put = function (r) {
      if (!r || !r.date) return;
      const k = r.id ? 'id:' + r.id : 'fp:' + recFingerprint(r);
      const cur = byId[k];
      if (!cur || fieldScore(r) > fieldScore(cur)) byId[k] = r;
    };
    (local || []).forEach(put);
    (remote || []).forEach(put);
    // 两台设备各自给同一条老记录补了不同 id 的情况，再按内容指纹收敛一次
    const byPrint = {};
    Object.keys(byId).forEach(function (k) {
      const r = byId[k], p = recFingerprint(r), cur = byPrint[p];
      if (!cur || fieldScore(r) > fieldScore(cur)) byPrint[p] = r;
    });
    return Object.keys(byPrint).map(function (p) { return byPrint[p]; }).sort(function (x, y) {
      if (x.date !== y.date) return x.date < y.date ? -1 : 1;
      return (x.time || '') < (y.time || '') ? -1 : 1;
    });
  }
  function mergeNext(local, remote) {
    const seen = new Set(), out = [];
    (local || []).concat(remote || []).forEach(function (n) {
      const k = (n && (n.id || (n.date + '|' + (n.text || '')))) || JSON.stringify(n);
      if (!seen.has(k)) { seen.add(k); out.push(n); }
    });
    return out;
  }
  async function ghPush(payload, sha, file) {
    const c = ghConf();
    const body = { message: 'mood sync ' + new Date().toISOString().slice(0, 19).replace('T', ' '), content: b64enc(JSON.stringify(payload)) };
    if (sha) body.sha = sha;
    const res = await fetch(ghApiUrl(c, file), { method: 'PUT', headers: Object.assign(ghHeaders(), { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    if (!res.ok) throw await ghHttpErr(res, '推送');
    const j = await res.json();
    return j.content.sha;
  }
  /* ---------- 回收站云同步：独立文件 情绪记录_回收站.json ----------
     与主文件互不干扰（各自的 sha，不会互相 409）。
     结构：{ records: [...], purged: [{id, at}] }
     purged 是「已离开回收站」的标记（彻底删除或恢复），用来让这个动作跨设备生效，
     否则本机删掉一条、云端还有，下次一合并又被拉回来，看起来像「删不掉」。 */
  function mergeTrashList(a, b) {
    const seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (x) {
      if (!x) return;
      const k = x.id ? 'id:' + x.id : 'fp:' + recFingerprint(x);
      if (seen[k]) return;
      seen[k] = 1; out.push(x);
    });
    return out;
  }
  function mergeMarks(a, b) {
    const m = {}, out = [];
    (a || []).concat(b || []).forEach(function (t) {
      if (!t || !t.id) return;
      if (t.at && Date.now() - t.at > 180 * 86400000) return; // 半年前的标记不再保留
      if (!m[t.id] || (t.at || 0) > m[t.id].at) m[t.id] = { id: t.id, at: t.at || 0 };
    });
    Object.keys(m).forEach(function (k) { out.push(m[k]); });
    return out;
  }
  function applyPurged(list, purged) {
    const gone = {};
    (purged || []).forEach(function (t) { if (t && t.id) gone[t.id] = 1; });
    return (list || []).filter(function (r) { return !(r && r.id && gone[r.id]); });
  }
  // 只读云端回收站并与本地合并（不写回），进回收站页面时对齐用
  async function pullTrash() {
    const c = ghConf();
    if (!c.enabled || !c.token || !c.user || !c.repo) return null;
    const r = await ghPull(GH_TRASH);
    if (r && r.data) {
      DATA.trashPurged = mergeMarks(DATA.trashPurged, r.data.purged);
      DATA.trash = applyPurged(mergeTrashList(r.data.records, DATA.trash), DATA.trashPurged);
      saveData();
      return r.sha;
    }
    return null;
  }
  let _trashBusy = false, _trashPending = false;
  async function syncTrash(_retried) {
    const c = ghConf();
    if (!c.enabled || !c.token || !c.user || !c.repo) return;
    if (_trashBusy) { _trashPending = true; return; }
    _trashBusy = true;
    let handoff = false;
    try {
      // 拉取必须成功（或确认文件确实不存在 → 404 → null）才能推。
      // 拉取出错就中断，绝不拿本地数据去盲推，否则会把别的设备的回收站整个覆盖掉。
      const r = await ghPull(GH_TRASH);
      let sha = null;
      if (r && r.data) {
        DATA.trashPurged = mergeMarks(DATA.trashPurged, r.data.purged);
        DATA.trash = applyPurged(mergeTrashList(r.data.records, DATA.trash), DATA.trashPurged);
        saveData();
        sha = r.sha;
      }
      await ghPush({ records: DATA.trash || [], purged: DATA.trashPurged || [], updatedAt: new Date().toISOString() }, sha, GH_TRASH);
    } catch (e) {
      // 409/422 都是「sha 和云端对不上」：重新拉一次拿到新 sha 再推
      if (e && (e.status === 409 || e.status === 422) && !_retried) {
        _trashBusy = false; handoff = true;
        return syncTrash(true);
      }
      throw e;
    } finally {
      if (!handoff) {
        _trashBusy = false;
        if (_trashPending) { _trashPending = false; Promise.resolve().then(function () { syncTrash().catch(function () {}); }); }
      }
    }
  }
  // 判断两次同步负载是否内容一致（忽略数组顺序），用于识别「没有新数据要同步」
  function arrSig(arr) {
    return (arr || []).map(function (x) { return JSON.stringify(x); }).sort().join('\u0001');
  }
  function payloadEquals(a, b) {
    return ['records', 'nextQuestions', 'deleted', 'revived', 'purged'].every(function (k) {
      return arrSig(a[k]) === arrSig(b[k]);
    });
  }
  let _ghBusy = false;
  let _ghPending = false;
  // 设备指纹：基于浏览器特征生成一个稳定标识（同设备不同标签页/重启后一致），
  // 用于多设备场景下追踪「这条记录是哪台设备写的」，合并时更智能。
  function deviceFingerprint() {
    var d = localStorage['mood.deviceFp'];
    if (d) return d;
    // 用屏幕分辨率 + 时区 + 平台 + 随机盐 生成一个足够稳定的短 hash
    var raw = [screen.width, 'x', screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.platform, Math.random().toString(36).slice(2, 6)].join('|');
    var h = 2166136261 >>> 0;
    for (var i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = (h * 16777619) >>> 0; }
    d = 'dev_' + (h.toString(16) + Date.now().toString(36)).slice(0, 12);
    localStorage['mood.deviceFp'] = d;
    return d;
  }
  const DEVICE = deviceFingerprint();
  async function ghSync(msgEl, doReload, _retried) {
    // 同会话内多次触发同步（如"加一条、立刻删一条"）会让两个 ghSync 同时 fetch，
    // 第二个的 sha 在第一个 PUT 完成前就已过期，PUT 被拒为 409。
    // 加互斥锁：进入前若已在飞则只标记一次"待办"，等当前那次跑完再补跑一次。
    if (_ghBusy) { _ghPending = true; return; }
    _ghBusy = true;
    let handoff = false; // 已把锁交给 409 重试的那次调用，finally 里就别再动锁
    try {
      const c = ghConf();
      if (!c.enabled) { if (msgEl) msgEl.textContent = '请先在上方勾选「启用同步」'; updateConn(); return; }
      if (!c.user) { if (msgEl) msgEl.textContent = '请填写 GitHub 用户名'; updateConn(); return; }
      if (!c.token) { if (msgEl) msgEl.textContent = '请填写 GitHub 访问令牌 PAT'; updateConn(); return; }
      if (!c.repo) { if (msgEl) msgEl.textContent = '请填写仓库名'; updateConn(); return; }
      try {
        // 明显离线就别去打 GitHub 了：排个自动重试，等网络回来再补，不闪红色错误
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          const m = '当前离线，联网后会自动同步，本地已保存';
          if (msgEl) msgEl.textContent = '· ' + m;
          setSyncState('error', m); scheduleRetry(); return;
        }
        if (msgEl) msgEl.textContent = '同步中…';
        setSyncState('syncing');
        let remote = null;
        try { remote = await ghPull(); }
        catch (e) {
          // 401：令牌本身坏了（过期/吊销/写错），重试也没用，提示用户去换
          if (e.status === 401) {
            const m = '令牌无效或已过期（请在 GitHub 重新生成带 Contents 读写的 PAT，并更新到设置里）';
            if (msgEl) msgEl.textContent = '✗ ' + m; setSyncState('error', m); return;
          }
          // 403 / 429 可能是「限流」也可能是「真没权限」——两者要分开处理：
          // 限流（X-RateLimit-Remaining:0 或响应里带 rate limit / secondary rate）是暂时的，排个队自动重试即可；
          // 真没权限（PAT 没勾 Contents、选错仓库/账号）才需要用户去改设置，重试没用。
          if (e.status === 403 || e.status === 429) {
            if (e.rateLimited) {
              const m = 'GitHub 限流了（同步太频繁），已排到' + (e.retryAfter ? (' ' + e.retryAfter + ' 秒后') : '稍后') + '自动重试，本地数据不会丢';
              if (msgEl) msgEl.textContent = '· ' + m; setSyncState('error', m); scheduleRetry(e.retryAfter); return;
            }
            const m = '令牌没有这个仓库的权限（检查 PAT 是否勾了 Contents 读写、是否选对了仓库/账号）';
            if (msgEl) msgEl.textContent = '✗ ' + m; setSyncState('error', m); return;
          }
          if (e.status !== 404) {
            // 网络抖动 / GitHub 5xx / 离线：绝不能拿本地数据不带 sha 去覆盖云端，直接中止本次同步，
            // 本地数据已存在 localStorage，联网后会自动补推（scheduleRetry 也会兜底）。
            const m = '暂时连不上 GitHub（' + (e.message || ('HTTP ' + e.status)) + '），这次没动云端数据，稍后会自动重试';
            if (msgEl) msgEl.textContent = '✗ ' + m;
            setSyncState('error', m); scheduleRetry(); return;
          }
        }
        const merged = remote
          ? { records: mergeRecords(DATA.records, remote.data.records), nextQuestions: mergeNext(DATA.nextQuestions, remote.data.nextQuestions) }
          : { records: DATA.records, nextQuestions: DATA.nextQuestions };
        // 墓碑合并：把本地 + 云端删除标记合并，过滤掉已被删的记录，使删除跨设备 / 跨次同步生效
        const allDel = mergeMarksKeepFp(DATA.deleted, (remote && remote.data.deleted) || []);
        // 复活标记：从回收站恢复过的记录，要能压过更早的墓碑，否则一同步又被删掉
        const allRev = mergeMarks(DATA.revived, (remote && remote.data.revived) || []);
        // 主文件的 purged（彻底删除标记）也要合并保留，否则下次推送会把它从云端文件里悄悄抹掉
        DATA.purged = mergeMarks(DATA.purged || [], (remote && remote.data.purged) || []);
        const revAt = {};
        allRev.forEach(function (t) { revAt[t.id] = t.at || 0; });
        const liveDel = allDel.filter(function (t) { return !(revAt[t.id] != null && revAt[t.id] >= (t.at || 0)); });
        const delId = {}, delFp = {};
        liveDel.forEach(function (t) { if (t.id) delId[t.id] = 1; if (t.fp) delFp[t.fp] = 1; });
        const recs2 = merged.records.filter(function (r) {
          if (!r) return false;
          if (r.id && delId[r.id]) return false;      // 墓碑按 id 命中 → 删
          if (delFp[recFingerprint(r)]) return false; // 按内容指纹兜底：跨设备 id 不一致的旧记录也能被正确删除
          return true;
        });
        DATA.records = recs2;
        DATA.nextQuestions = merged.nextQuestions;
        DATA.deleted = allDel;
        DATA.revived = allRev;
        saveData();
        // 云端已有且内容完全一致 → 没有新数据要同步：跳过推送，避免无谓的 GitHub 写入与 409 冲突
        if (remote && payloadEquals(
          { records: DATA.records, nextQuestions: DATA.nextQuestions, deleted: DATA.deleted, revived: DATA.revived, purged: DATA.purged },
          { records: remote.data.records, nextQuestions: remote.data.nextQuestions, deleted: remote.data.deleted, revived: remote.data.revived, purged: remote.data.purged }
        )) {
          refreshRecs();
          setSyncState('ok');
          if (msgEl) msgEl.textContent = '✓ 数据已同步过了，暂时没有新的要同步的数据';
          if (doReload) setTimeout(function () { location.reload(); }, 700);
          return;
        }
        await ghPush({
          records: DATA.records, nextQuestions: DATA.nextQuestions,
          deleted: DATA.deleted, revived: DATA.revived, purged: DATA.purged,
          updatedAt: new Date().toISOString()
        }, remote ? remote.sha : null);
        refreshRecs(); // 云端拉回来的记录要立刻进 UI 用的数组，否则要刷新页面才看得见
        setSyncState('ok');
        bumpSyncCount();
        const others = countOtherAuthors();
        if (msgEl) msgEl.textContent = '✓ 已同步到 ' + c.user + '/' + c.repo + '，共 ' + DATA.records.length + ' 条'
          + (others ? '（其中 ' + others + '条来自一起用的人，可在「历史」里按记录人筛选查看）' : '');
        if (doReload) setTimeout(function () { location.reload(); }, 700);
      } catch (e) {
        // 409/422 = sha 过期（别的设备/标签页抢先写了）：最多重试 3 次，指数退避，每次都重新拉最新 sha
        if (e && (e.status === 409 || e.status === 422) && (!_retried || _retried < 3)) {
          var nextRetried = (_retried || 0) + 1;
          // 退避：第 1 次立刻重试，第 2 次等 2s，第 3 次等 5s
          _ghBusy = false; handoff = true;
          var delay = nextRetried === 1 ? 0 : (nextRetried === 2 ? 2000 : 5000);
          if (delay > 0) {
            if (msgEl) msgEl.textContent = '· 同步冲突，第 ' + nextRetried + ' 次重试中…';
            return new Promise(function (res) { setTimeout(res, delay); }).then(function () { return ghSync(msgEl, doReload, nextRetried); });
          }
          return ghSync(msgEl, doReload, nextRetried);
        }
        // 偶发冲突（多设备同时写入导致 sha 过期）：后台已自动重试，仍失败则温和提示，
        // 不再抛出原始 409 报错吓人，本地数据已保留不会丢
        if (e && (e.status === 409 || e.status === 422)) {
          const m = '同步出现冲突（数据在别处被更新），已保留本地数据并稍后自动重试';
          if (msgEl) msgEl.textContent = '· ' + m;
          setSyncState('error', m); scheduleRetry(); return;
        }
        const m = (e && e.message ? e.message : String(e));
        if (msgEl) msgEl.textContent = '✗ 同步失败：' + m;
        setSyncState('error', m);
        scheduleRetry();
      }
    } finally {
      // 释放锁；如果在飞的 ghSync 期间有别的同步被"记了一笔待办"，解锁后立刻补跑一次，确保所有变更都被推送
      if (!handoff) {
        _ghBusy = false;
        if (_ghPending) {
          _ghPending = false;
          Promise.resolve().then(function () { ghSync(msgEl, doReload); });
        }
      }
    }
  }
  // 墓碑合并：和 mergeMarks 一样，但保留 fp 字段（老数据没有 id，只能靠内容指纹认）
  function mergeMarksKeepFp(a, b) {
    const m = {}, out = [];
    (a || []).concat(b || []).forEach(function (t) {
      if (!t) return;
      if (t.at && Date.now() - t.at > 180 * 86400000) return;
      // 有 id 按 id 合；没 id 的老数据按内容指纹(fp)合——否则老墓碑会被丢掉，导致已删的旧记录"复活"
      const key = t.id ? ('id:' + t.id) : ('fp:' + (t.fp || recFingerprint(t)));
      const cur = m[key];
      if (!cur || (t.at || 0) > (cur.at || 0)) m[key] = t;
    });
    Object.keys(m).forEach(function (k) { out.push(m[k]); });
    return out;
  }
  // UI 用的 recs 数组要跟 DATA.records 保持同一份内容
  function refreshRecs() {
    recs.length = 0;
    (DATA.records || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (x) { recs.push(x); });
  }
  // 同步失败后自动补一次：网络抖动不该让数据一直卡在本地
  let _retryTimer = null;
  function scheduleRetry(retryAfter) {
    if (_retryTimer) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // 离线时不空转，等 'online' 事件触发真正的同步
    let ms = 45000;
    if (retryAfter && retryAfter > 0 && retryAfter < 3600) ms = retryAfter * 1000 + 500;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      const c = ghConf();
      if (c.enabled && c.token && c.user && c.repo && syncState.status === 'error' && (typeof navigator === 'undefined' || navigator.onLine !== false)) ghSync(null, false);
    }, ms);
  }
  // 共享空间里有多少条是别人写的（用于状态提示和图例）
  function countOtherAuthors() {
    const me = ghNick();
    return (DATA.records || []).filter(function (r) { return r.author && r.author !== me; }).length;
  }

  /* ---------- 数据备份：导出 / 导入 / 清空 ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '情绪记录-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.records)) throw 0;
        DATA.records = d.records;
        DATA.nextQuestions = Array.isArray(d.nextQuestions) ? d.nextQuestions : [];
        if (d.todayQuestion) DATA.todayQuestion = d.todayQuestion;
        saveData();
        recs.length = 0;
        d.records.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(x => recs.push(x));
        buildQA(); updateConn();
        const sm = $('#setMsg'); if (sm) sm.textContent = '✓ 已导入 ' + d.records.length + ' 条记录';
      } catch (e) { const sm = $('#setMsg'); if (sm) sm.textContent = '✗ 文件格式不对，导入失败'; }
    };
    r.readAsText(file);
  }
  function clearLocal() {
    localStorage.removeItem(LS_KEY);
    const sm = $('#setMsg'); if (sm) sm.textContent = '✓ 已清空浏览器数据（刷新后回到初始状态）';
  }

  /* ---------- DeepSeek（浏览器直连，key 仅存本机，不上传任何服务器） ---------- */
  const DS_URL = 'https://api.deepseek.com/chat/completions';
  function dsKey() { return (localStorage.getItem('mood.dsKey') || '').trim(); }
  // Key 格式校验：剥 Bearer 前缀 + sk- 开头 + 长度/空白检查，保存时即时红字提示
  function validateDsKey(v) {
    v = (v || '').trim();
    if (!v) return { ok: false, msg: '请填写 DeepSeek API Key' };
    if (/^bearer\s+/i.test(v)) return { ok: false, msg: '不要带 "Bearer " 前缀，只填 sk- 开头那段' };
    if (/\s/.test(v)) return { ok: false, msg: 'Key 里含有空格或换行，请重新完整复制' };
    if (!/^sk-/.test(v)) return { ok: false, msg: 'Key 应以 sk- 开头' };
    if (v.length < 20) return { ok: false, msg: 'Key 长度过短，可能复制不全' };
    return { ok: true, msg: '✓ Key 格式有效' };
  }
  function updateDsKeyHint() {
    const inp = document.getElementById('dsKey'), hint = document.getElementById('dsKeyHint');
    if (!hint) return;
    const r = validateDsKey(inp ? inp.value : dsKey());
    hint.textContent = r.msg;
    hint.className = 'key-hint ' + (r.ok ? 'ok' : 'bad');
  }
  // GitHub 令牌格式校验：剥 Bearer 前缀 + 前缀/空白/长度检查，保存时即时红字提示
  function validateGhToken(v) {
    v = (v || '').trim();
    if (!v) return { ok: false, msg: '请填写 GitHub 访问令牌 PAT' };
    if (/^bearer\s+/i.test(v)) return { ok: false, msg: '不要带 "Bearer " 前缀，直接填令牌本体' };
    if (/\s/.test(v)) return { ok: false, msg: '令牌里含有空格或换行，请重新完整复制' };
    if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(v)) return { ok: false, msg: 'GitHub 令牌应以 ghp_ / github_pat_ 等开头' };
    if (v.length < 20) return { ok: false, msg: '令牌长度过短，可能复制不全' };
    return { ok: true, msg: '✓ 令牌格式有效' };
  }
  function updateGhTokenHint() {
    const inp = document.getElementById('ghToken'), hint = document.getElementById('ghTokenHint');
    if (!hint) return;
    const r = validateGhToken(inp ? inp.value : (localStorage.getItem('mood.ghToken' + ghSuffix()) || ''));
    hint.textContent = r.msg;
    hint.className = 'key-hint ' + (r.ok ? 'ok' : 'bad');
  }
  // 模型名兼容：deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役，映射到 V4 系列
  function dsModel() {
    const m = localStorage.getItem('mood.dsModel');
    if (!m || m === 'deepseek-chat') return 'deepseek-v4-flash';
    if (m === 'deepseek-reasoner') return 'deepseek-v4-pro';
    return m;
  }
  function dsRouteMode() { return localStorage.getItem('mood.dsRoute') || 'auto'; } // 'auto' 智能路由 | 'manual' 手动
  // 智能路由：按任务类型与用户输入复杂度，自动选 flash / pro，并决定思考模式
  function resolveModel(task, text) {
    // 用户选择：所有调用都开启深度思考，以换取更准确的分析、提取与陪伴回应
    if (dsRouteMode() === 'manual') {
      const m = dsModel();
      return { model: m, thinking: 'enabled' };
    }
    if (task === 'summary') return { model: 'deepseek-v4-pro', thinking: 'enabled' };
    if (task === 'extract') return { model: 'deepseek-v4-flash', thinking: 'enabled' };
    if (task === 'chat' && text) {
      const hard = text.length > 180 || /为什么|分析|根源|怎么解决|如何解决|如何调节|深层|本质|底层|到底|帮我理/.test(text);
      if (hard) return { model: 'deepseek-v4-pro', thinking: 'enabled' }; // 复杂反思 → 深推理
    }
    return { model: 'deepseek-v4-flash', thinking: 'enabled' };
  }
  async function callDeepSeek(system, user, opts) {
    opts = opts || {};
    const key = dsKey();
    if (!key) throw new Error('no-key');
    const r2 = resolveModel(opts.task || 'chat', user);
    const body = {
      model: r2.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.7, stream: false,
      thinking: { type: r2.thinking }
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    const r = await fetch(DS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 140)); }
    const j = await r.json();
    return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', model: r2.model, thinking: r2.thinking };
  }
  function recentSummary(n) {
    return recs.slice(-(n || 14)).map(r => {
      const p = [r.date + ' 心情' + r.mood];
      if (r.scene) p.push('场景:' + r.scene);
      if (r.tags && r.tags.length) p.push('标签:' + r.tags.join('/'));
      if (r.note) p.push('备注:' + r.note);
      if (r.cause) p.push('原因:' + r.cause);
      return p.join(' · ');
    }).join('\n');
  }
  function appendBubble(box, who, text) {
    const d = document.createElement('div'); d.className = 'bubble ' + who; d.textContent = text;
    box.appendChild(d); box.scrollTop = box.scrollHeight; return d;
  }
  async function genQuestions() {
    const btn = $('#aiGen'), sv = $('#aiStatus');
    if (!dsKey()) { if (sv) sv.textContent = '请先在「⚙ 设置」里填入 DeepSeek API Key'; return; }
    btn.disabled = true; if (sv) sv.textContent = 'AI 正在生成追问…';
    const sys = '你是温和的情绪记录陪伴者。基于用户近期的情绪记录，生成 3 条个性化的、开放式的反思追问（中文，每条不超过 30 字），帮助用户更深入理解自己的情绪。只输出 JSON 数组，例如 ["问题一","问题二","问题三"]，不要任何其他文字。';
    const user = '近期记录：\n' + (recentSummary(14) || '（暂无记录）') + '\n当前日期：' + new Date().toISOString().slice(0, 10);
    try {
      const res = await callDeepSeek(sys, user, { task: 'questions' });
      const txt = res.text;
      const arr = JSON.parse(txt.replace(/```json|```/g, '').trim());
      if (Array.isArray(arr) && arr.length) {
        const newQs = arr.map((q, i) => ({ id: 'n' + (Date.now() + i), q: String(q), answer: '' }));
        NEXT_Q.length = 0; newQs.forEach(x => NEXT_Q.push(x));
        saveData(); buildQA();
        if (sv) sv.textContent = '✓ 已生成 ' + arr.length + ' 条追问';
      } else throw 0;
    } catch (e) { if (sv) sv.textContent = '✗ 生成失败：' + (e && e.message ? e.message : e); }
    finally { btn.disabled = false; }
  }
  async function aiChat() {
    const inp = $('#aiInput'), sv = $('#aiChatStatus'), box = $('#aiChat');
    const txt = inp.value.trim(); if (!txt) return;
    if (!dsKey()) {
      // 没配 Key 也要给肉眼可见的反馈，不能「点了没反应」
      appendBubble(box, 'ai', '还没配置 DeepSeek API Key，我暂时没法跟你聊～\n点右上角 ⚙ 设置，把 Key 填进去就能随时找我啦。');
      if (sv) sv.textContent = '请先在「⚙ 设置」里填入 DeepSeek API Key';
      return;
    }
    appendBubble(box, 'user', txt); inp.value = '';
    if (sv) sv.textContent = '';
    const rp0 = $('#aiRecordPrompt'); if (rp0) rp0.style.display = 'none';
    const sys = '你是一个温柔、专业、不评判的情绪陪伴助手。用中文，简短共情地回应，偶尔给一个可操作的小建议。结合用户提供的近期情绪记录来理解语境，但用自然语言表达，不要直接罗列数据格式。';
    const user = '我的近期情绪记录：\n' + (recentSummary(14) || '（暂无记录）') + '\n\n我的话：' + txt;
    const loading = appendBubble(box, 'ai', '思考中…');
    try {
      const res = await callDeepSeek(sys, user, { task: 'chat' });
      loading.textContent = res.text;
      aiOfferRecord();
    }
    catch (e) { loading.textContent = '✗ ' + (e && e.message ? e.message : e); }
  }
  // AI 聊完后询问是否记录这次聊到的情绪（受「自动询问」开关控制）
  function aiOfferRecord() {
    const rp = $('#aiRecordPrompt'); if (!rp) return;
    if (localStorage.getItem('mood.aiRecord') === 'off') { rp.style.display = 'none'; return; }
    const ub = document.querySelectorAll('#aiChat .bubble.user');
    const ab = document.querySelectorAll('#aiChat .bubble.ai');
    if (!ub.length) { rp.style.display = 'none'; return; }
    rp.dataset.user = (ub[ub.length - 1].textContent || '').slice(0, 300);
    rp.dataset.ai = (ab.length ? ab[ab.length - 1].textContent : '').slice(0, 300);
    rp.style.display = '';
  }
  // 打开「记一笔」弹窗并预填对话摘要（日期用本地日期，避免时区偏移）
  function openNewRecordWithNote(text) {
    const md = $('#recModal'); if (!md) return;
    state.editingId = null;
    const tag = md.querySelector('.mtag'); if (tag) tag.textContent = '记一笔';
    const h3 = md.querySelector('h3'); if (h3) h3.textContent = '今天的状态，随手记下';
    const sv = $('#recSave'); if (sv) sv.textContent = '落到地图';
    const del = $('#recDelete'); if (del) del.style.display = 'none';
    $('#recDate').value = isoLocal(new Date());
    $('#recTime').value = new Date().toTimeString().slice(0, 8);
    const tip = $('#recTip'); if (tip) { tip.style.display = 'none'; tip.classList.remove('show'); }
    $('#recFree').value = '';
    $('#recImportant').checked = false;
    const sg = $('#recSuggest'); if (sg) { sg.style.display = 'none'; sg.innerHTML = ''; }
    $('#recNote').value = text || '';
    md.classList.add('show'); $('#scrim').classList.add('show');
  }
  /* ---------- 同步状态（真实反映结果，不再是只看配置的摆设） ----------
     状态：idle 未配置 / ready 已配置未同步 / syncing 进行中 / ok 成功 / error 失败
     另外会比较「本地记录数 vs 上次同步成功时的记录数」，直接告诉你还有几条没上传。 */
  let syncState = { status: 'idle', at: 0, err: '' };
  function syncKey() { return 'mood.syncState' + ghSuffix(); }
  function syncedCountKey() { return 'mood.syncedCount' + ghSuffix(); }
  function loadSyncState() {
    syncState = { status: 'idle', at: 0, err: '' };
    try { const raw = localStorage.getItem(syncKey()); if (raw) { const o = JSON.parse(raw); if (o && o.status) syncState = o; } } catch (e) {}
    if (syncState.status === 'syncing') syncState.status = 'ready'; // 上次没跑完就关了页面
  }
  let _errTimer = null;
  function setSyncState(status, err) {
    syncState = { status: status, at: status === 'ok' ? Date.now() : (syncState.at || 0), err: err || '' };
    try {
      localStorage.setItem(syncKey(), JSON.stringify(syncState));
      if (status === 'ok') localStorage.setItem(syncedCountKey(), String((DATA.records || []).length));
    } catch (e) {}
    if (_errTimer) { clearTimeout(_errTimer); _errTimer = null; }
    if (status === 'error') {
      const frozen = syncState, frozenErr = err || '';
      _errTimer = setTimeout(function () {
        // 仅当仍是同一次失败时，才自动撤销“同步失败”黄标，避免旧的 409/422 永远卡着误导用户
        if (syncState === frozen && syncState.err === frozenErr && syncState.status === 'error') setSyncState('idle');
        _errTimer = null;
      }, 30000);
    }
    updateConn();
  }
  function pendingCount() {
    const done = +(localStorage.getItem(syncedCountKey()) || 0);
    return Math.max(0, (DATA.records || []).length - done);
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    const d = Math.floor(s / 86400);
    return d + ' 天前';
  }
  function updateConn() {
    const dot = $('#connDot'); if (!dot) return;
    const txt = $('#connTxt'); if (!txt) return;
    const c = ghConf();
    const who = c.profile === 'shared' ? '共享' : '个人';
    dot.classList.remove('live', 'warn', 'busy');
    if (!c.enabled || !c.token || !c.user || !c.repo) {
      txt.textContent = '未开启同步';
      dot.title = '还没配置云同步（缺少启用开关 / 用户名 / 仓库名 / 令牌中的某一项）。\n点这里打开设置去配置，配好后手机和电脑就是同一份数据。';
      return;
    }
    if (syncState.status === 'syncing') {
      dot.classList.add('busy'); txt.textContent = '同步中…';
      dot.title = '正在与 ' + c.user + '/' + c.repo + ' 交换数据。';
      return;
    }
    if (syncState.status === 'error') {
      dot.classList.add('warn');
      const errShort = syncState.err ? (syncState.err.length > 18 ? syncState.err.slice(0, 18) + '…' : syncState.err) : '未知错误';
      txt.textContent = '同步失败：' + errShort + ' · 点击重试';
      dot.title = '上次同步失败：' + (syncState.err || '未知错误') + '\n点这里立即重试。';
      return;
    }
    const pend = pendingCount();
    if (syncState.status === 'ok' && syncState.at) {
      if (pend > 0) {
        dot.classList.add('warn'); txt.textContent = '待上传 ' + pend + ' 条 · 点击同步';
        dot.title = '上次成功同步是 ' + timeAgo(syncState.at) + '，之后你又记了 ' + pend + ' 条还没上传。点这里立即同步。';
      } else {
        dot.classList.add('live'); txt.textContent = who + '空间 · 已同步 ' + timeAgo(syncState.at);
        dot.title = '已与 ' + c.user + '/' + c.repo + ' 同步完成\n时间：' + new Date(syncState.at).toLocaleString() + '\n点这里可以再手动同步一次。';
      }
      return;
    }
    dot.classList.add('warn');
    txt.textContent = pend > 0 ? ('待上传 ' + pend + ' 条 · 点击同步') : '待同步 · 点击上传';
    dot.title = '已配置 ' + c.user + '/' + c.repo + '，但还没有成功同步过。点这里立即同步。';
  }

  /* ---------- AI 帮填：对话式（随手写 → 理解/追问澄清 → 你确认） ---------- */
  let extractCtx = [];
  let lastExtractFields = null;
  function extractReset() {
    extractCtx = []; lastExtractFields = null;
    const c = $('#extractChat'); if (c) c.innerHTML = '';
    const f = $('#extractFollow'); if (f) f.style.display = 'none';
  }
  async function extractCall() {
    const key = dsKey();
    if (!key) throw new Error('no-key');
    const sys = '你是情绪记录助手，帮用户把"说不清"的状态理清并归类。这是多次对话的流程：\n'
      + '1) 用户先用口语描述今天的状态（可能碎片化、情绪化、用词不精确）。\n'
      + '2) 你判断是否已能较准确地归类。若信息不足（例如只说"有点焦虑说不清""精力透支"却没说是身体还是心理、什么场景、针对什么事、和谁在一起），就提出 1-3 个具体、好回答的澄清问题（中文，口语化，一次别太多）。\n'
      + '3) 若信息足够，就输出结构化字段。\n'
      + '无论哪种情况，都只输出一个 JSON 对象，不要任何额外文字：\n'
      + '{\n'
      + '  "ready": true 或 false,\n'
      + '  "questions": ["问1","问2"]   // 仅当 ready=false 时给出，1-3 个\n'
      + '  "fields": {                  // 尽量填；不确定的字段写 null；mood 必填(1-5，无法确定写3)\n'
      + '     "mood": 整数1-5,\n'
      + '     "energy": 整数1-5或null,\n'
      + '     "tension": 整数1-5或null,\n'
      + '     "sleep": 数字或null,\n'
      + '     "scene": 字符串,\n'
      + '     "tags": [短标签2-4字],\n'
      + '     "body": [身体信号],\n'
      + '     "behavior": [行为],\n'
      + '     "note": 整理后的当下想法1-2句,\n'
      + '     "cause": 可能原因或""\n'
      + '  },\n'
      + '  "summary": "一句话复述你对他状态的理解（让他确认是否对）"\n'
      + '}\n'
      + '注意：这些是"帮用户理清情绪"的可选项，不要强迫他回答。若用户明确不想填某项，就写 null。';
    const r2 = resolveModel('extract');
    const r = await fetch(DS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: r2.model,
        messages: [{ role: 'system', content: sys }].concat(extractCtx),
        temperature: 0.7, stream: false,
        thinking: { type: r2.thinking },
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 140)); }
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }
  function renderXBubble(who, text) {
    const box = $('#extractChat'); if (!box) return;
    const d = document.createElement('div'); d.className = 'xbubble ' + who; d.textContent = text;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
  function parseExtract(res) {
    try { return JSON.parse((res || '').replace(/```json|```/g, '').trim()); } catch (e) { return null; }
  }
  function handleExtract(obj, sv, btn) {
    let aiText = '';
    if (obj.summary) aiText += obj.summary + '\n';
    if (obj.ready === false && Array.isArray(obj.questions) && obj.questions.length) {
      aiText += '\n为了帮你更准地归类，想先确认几个：';
      obj.questions.forEach((q, i) => aiText += '\n' + (i + 1) + '. ' + q);
    } else if (obj.fields) {
      const f = obj.fields, parts = [];
      if (f.mood) parts.push('心情 ' + f.mood + '/5');
      if (f.energy) parts.push('精力 ' + f.energy);
      if (f.tension) parts.push('紧绷 ' + f.tension);
      if (f.sleep) parts.push('睡眠 ' + f.sleep + 'h');
      if (f.scene) parts.push('场景：' + f.scene);
      if (f.tags && f.tags.length) parts.push('标签：' + f.tags.join('/'));
      if (parts.length) aiText += (aiText ? '\n' : '') + '我理解到的：' + parts.join(' · ');
    }
    renderXBubble('ai', aiText.trim());
    lastExtractFields = obj.fields || null;
    if (obj.ready === false && Array.isArray(obj.questions) && obj.questions.length) {
      extractCtx.push({ role: 'assistant', content: aiText });
      $('#extractFollow').style.display = 'block';
      sv.textContent = '回答上面的问题，AI 会更准；或点「采用目前理解」直接填。';
      setTimeout(() => { const a = $('#extractAns'); if (a) a.focus(); }, 50);
    } else {
      sv.textContent = '理解好了，正在帮你填到表单…';
      applyExtractNow();
    }
    btn.disabled = false;
  }
  async function extractStart() {
    const txt = $('#extractText').value.trim(); if (!txt) { $('#extractText').focus(); return; }
    if (!dsKey()) { const sv = $('#extractStatus'); sv.textContent = '请先在「⚙ 设置」里填入 DeepSeek API Key'; sv.classList.add('show'); return; }
    const btn = $('#extractBtn'); btn.disabled = true; const sv = $('#extractStatus');
    sv.textContent = 'AI 正在理解…'; sv.classList.add('show');
    extractReset(); extractCtx.push({ role: 'user', content: txt });
    renderXBubble('user', txt);
    try {
      const res = await extractCall();
      const obj = parseExtract(res);
      if (!obj) { sv.textContent = '✗ AI 返回格式不对，请换种说法，或手动逐项填写'; btn.disabled = false; return; }
      handleExtract(obj, sv, btn);
    } catch (e) { sv.textContent = '✗ 提取失败：' + (e && e.message ? e.message : e); btn.disabled = false; }
  }
  async function extractContinue() {
    const ans = $('#extractAns').value.trim(); if (!ans) { $('#extractAns').focus(); return; }
    if (!dsKey()) return;
    const btn = $('#extractAnsBtn'); btn.disabled = true; const sv = $('#extractStatus');
    sv.textContent = 'AI 正在结合你的回答重新判断…'; sv.classList.add('show');
    extractCtx.push({ role: 'user', content: ans });
    renderXBubble('user', ans);
    try {
      const res = await extractCall();
      const obj = parseExtract(res);
      if (!obj) { sv.textContent = '✗ AI 返回格式不对，你可以再回答一次，或直接「采用目前理解」'; btn.disabled = false; return; }
      handleExtract(obj, sv, btn);
    } catch (e) { sv.textContent = '✗ 失败：' + (e && e.message ? e.message : e); btn.disabled = false; }
  }
  function applyExtractNow() {
    const f = lastExtractFields;
    if (!f) { const sv = $('#extractStatus'); sv.textContent = '还没有可采用的字段，请先让 AI 理解一下。'; sv.classList.add('show'); return; }
    fillRecordForm(f, (f.note || ''));
    $('#extractModal').classList.remove('show'); $('#scrim').classList.remove('show');
    $('#recModal').classList.add('show'); $('#scrim').classList.add('show');
    const tip = $('#recTip');
    if (tip) { tip.textContent = 'AI 已根据你的话整理好，请确认无误后点「保存并同步」（所有字段都是可选的，可直接修改）'; tip.classList.add('show'); tip.style.display = 'block'; }
  }
  function fillRecordForm(o, raw) {
    o = o || {};
    const setMood = v => {
      const m = Math.max(1, Math.min(5, +v || 3));
      const wrap = $('#recMood'); if (wrap) wrap.dataset.val = m;
      document.querySelectorAll('#recMood button').forEach(b => b.classList.toggle('active', +b.dataset.m === m));
    };
    setMood(o.mood);
    const setVal = (id, v) => { const e = $('#' + id); if (e) e.value = (v == null ? '' : v); };
    setVal('recSleep', o.sleep); setVal('recEnergy', o.energy); setVal('recTension', o.tension);
    setVal('recScene', o.scene || '');
    setVal('recTags', Array.isArray(o.tags) ? o.tags.join(', ') : '');
    setVal('recBody', Array.isArray(o.body) ? o.body.join(', ') : '');
    setVal('recBehavior', Array.isArray(o.behavior) ? o.behavior.join(', ') : '');
    setVal('recNote', o.note || raw || '');
    setVal('recCause', o.cause || '');
    const ti = $('#recTags'); if (ti) ti.dispatchEvent(new Event('input'));
  }

  /* ---------- 历史记录列表 + 底部导航（手机端） ---------- */
  function histFiltered() {
    const q = (state.histQ || '').trim().toLowerCase();
    const tag = state.histTag || '';
    const mood = state.histMood || 0;
    const who = state.histAuthor || '';
    const seen = {};
    return recs.slice().reverse().filter(r => {
      const id = r.id || (r.date + '|' + (r.time || '') + '|' + (r.note || '').slice(0, 12));
      if (seen[id]) return false; seen[id] = 1; // 按 id 去重，避免同一笔记录出现在两处
      if (mood && +r.mood !== +mood) return false;
      if (who && (((r.author || '').trim() || '未署名') !== who)) return false;
      if (tag && !(r.tags || []).includes(tag)) return false;
      if (q) {
        const hay = [r.scene, r.note, r.cause, (r.tags || []).join(' '), (r.body || []).join(' '), (r.behavior || []).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function buildHistory(target) {
    const list = target || $('#histList'); if (!list) return;
    syncTagFilterBtn();
    const sorted = histFiltered();
    const cnt = $('#histCount'); if (cnt) cnt.textContent = sorted.length;
    const vcnt = $('#viewHistCount'); if (vcnt) vcnt.textContent = sorted.length;
    list.innerHTML = '';
    if (!sorted.length) { list.innerHTML = '<div class="empty" style="padding:40px">' + ((state.histQ || state.histTag || state.histMood || state.histAuthor) ? '没有匹配的记录' : '还没有记录') + '</div>'; return; }
    sorted.forEach(r => {
      const mc = moodColor(r.mood || 3);
      const tags = (r.tags || []).map(t => `<span class="htag">${t}</span>`).join('');
      const item = el('div', 'hist-item');
      item.dataset.id = r.id;
      item.addEventListener('click', () => openRecordDetail(r.id));
      const dtxt = (r.date || '') + (r.time ? `<br><span class="htime">${r.time}</span>` : '');
      item.innerHTML = `
        <div class="hdate">${dtxt}</div>
        <div class="hmood" style="background:${mc};color:${onMood(r.mood || 3)}">${r.mood || '-'}</div>
        <div class="hbody">
          ${r.scene ? `<div class="hscene">${r.scene}</div>` : ''}
          <div class="htags">${tags || '<span class="hmuted">无标签</span>'}</div>
          ${r.important ? '<div class="hmuted" style="color:var(--accent)">重要事件</div>' : ''}
          ${r.author ? '<div class="hmuted" style="color:var(--ink-soft)">记录人 · ' + escapeHtml(r.author) + '</div>' : ''}
          ${r.note ? `<div class="hnote">${String(r.note).slice(0, 60)}</div>` : ''}
          ${(r.energy != null || r.tension != null || r.sleep != null) ? `<div class="hmeta">精力 ${r.energy != null ? r.energy : '-'} · 紧绷 ${r.tension != null ? r.tension : '-'} · 睡眠 ${r.sleep != null ? r.sleep : '-'}h</div>` : ''}
        </div>`;
      list.appendChild(item);
    });
  }
  function setBotNav(active) {
    ['navDash', 'navTl', 'navHist', 'navTrash'].forEach(id => { const b = $('#' + id); if (b) b.classList.toggle('active', id === active); });
  }
  let _viewName = 'dash';
  function switchView(name) {
    closeTrash(); // 回收站是整屏页面，切别的视图先退出来
    _viewName = name;
    const dash = name === 'dash';
    $('#bento').hidden = !dash;
    $('#timeBar').style.display = dash ? '' : 'none';
    $('#viewTl').hidden = name !== 'tl';
    $('#viewHist').hidden = name !== 'hist';
    if (name === 'tl') { buildTimeline($('#viewTlList')); renderInsights(); }
    if (name === 'hist') buildHistory($('#viewHistList'));
    setBotNav('nav' + ({ dash: 'Dash', tl: 'Tl', hist: 'Hist' }[name] || 'Dash'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openHistory() { buildHistory($('#histList')); $('#histModal').classList.add('show'); $('#scrim').classList.add('show'); }
  function closeHistory() { $('#histModal').classList.remove('show'); $('#scrim').classList.remove('show'); }

  /* ---------- 回收站：独立整屏页面（不是弹窗） ---------- */
  function trashMsg(t) { const m = $('#trashMsg'); if (m) m.textContent = t || ''; }
  function trashOpened() { const p = $('#trashPage'); return !!(p && p.classList.contains('show')); }
  function openTrash() {
    const p = $('#trashPage'); if (!p || trashOpened()) return;
    renderTrash();
    p.classList.add('show'); p.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    setBotNav('navTrash');
    trashMsg('');
    try { history.pushState({ moodTrash: 1 }, '', '#trash'); } catch (e) {}
    // 跨设备：在别的设备删掉的记录，进这个页面时也要能看到
    const c = ghConf();
    if (c.enabled && c.token && c.user && c.repo) {
      trashMsg('正在从云端读取回收站…');
      pullTrash().then(function () { renderTrash(); trashMsg('已和云端对齐，共 ' + (DATA.trash || []).length + ' 条'); })
        .catch(function (e) { trashMsg('云端读取失败（' + ((e && e.message) || e) + '），下面显示的是本机的回收站'); });
    }
  }
  function closeTrash(fromPop) {
    const p = $('#trashPage'); if (!p || !p.classList.contains('show')) return;
    p.classList.remove('show');
    document.body.style.overflow = '';
    trashMsg('');
    setBotNav('nav' + ({ dash: 'Dash', tl: 'Tl', hist: 'Hist' }[_viewName] || 'Dash'));
    if (!fromPop) { try { if (history.state && history.state.moodTrash) history.back(); } catch (e) {} }
  }
  function renderTrash() {
    const list = $('#trashList'); if (!list) return;
    const cnt = $('#trashCount'); if (cnt) cnt.textContent = (DATA.trash || []).length;
    const items = (DATA.trash || []).slice().sort(function (a, b) {
      return ((a.delAt || 0) < (b.delAt || 0)) ? 1 : ((a.delAt || 0) > (b.delAt || 0) ? -1 : ((a.date + (a.time || '')) < (b.date + (b.time || '')) ? 1 : -1));
    });
    if (!items.length) {
      list.innerHTML = '<div class="empty" style="padding:56px 20px"><div class="big">回收站是空的</div><div class="sm">删掉的记录会先落到这里。<br>想清楚了再彻底删除，也不迟。</div></div>';
      return;
    }
    list.innerHTML = items.map(function (r) {
      const mc = moodColor(r.mood || 3);
      const tags = (r.tags || []).map(function (t) { return '<span class="ttag">' + escapeHtml(t) + '</span>'; }).join('');
      const note = String(r.note || '');
      const del = r.delAt ? (' · 删于 ' + new Date(r.delAt).toLocaleDateString('zh-CN')) : '';
      return '<div class="trash-item" data-id="' + escapeHtml(String(r.id || '')) + '">'
        + '<div class="tmood" style="color:' + mc + '">' + (r.mood != null ? r.mood : '-') + '/5</div>'
        + '<div class="tbody">'
        + '<div class="tdate">' + escapeHtml(r.date || '') + (r.time ? (' ' + String(r.time).slice(0, 5)) : '') + (r.author ? (' · ' + escapeHtml(r.author)) : '') + del + '</div>'
        + (r.scene ? '<div class="tscene">' + escapeHtml(r.scene) + '</div>' : '')
        + (note ? '<div class="tnote">' + escapeHtml(note.slice(0, 240)) + (note.length > 240 ? '…' : '') + '</div>' : '')
        + (tags ? '<div class="ttags">' + tags + '</div>' : '')
        + '<div class="tacts">'
        + '<button class="btn sm" type="button" data-act="restore" data-id="' + escapeHtml(String(r.id || '')) + '">恢复</button>'
        + '<button class="btn sm danger" type="button" data-act="purge" data-id="' + escapeHtml(String(r.id || '')) + '">彻底删除</button>'
        + '</div></div></div>';
    }).join('');
  }
  function buildTrashList() { renderTrash(); } // 兼容旧调用
  const DAY_NAMES = ['周日','周一','周二','周三','周四','周五','周六'];
  function formatDow(dateStr) {
    try { return DAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()] || ''; } catch(e) { return ''; }
  }
  function buildTimeline(target) {
    const list = target || $('#tlList'); if (!list) return;
    const sorted = histFiltered();
    list.innerHTML = '';
    if (!sorted.length) { list.innerHTML = '<div class="empty" style="padding:40px">' + ((state.histQ || state.histTag || state.histMood || state.histAuthor) ? '没有匹配的记录' : '还没有记录') + '</div>'; return; }
    // 多人时上作者色
    const multi = authorList().length > 1;
    const cmap = authorColors();
    // 按日期分组
    const groups = {};
    sorted.forEach(r => {
      const d = r.date || 'unknown';
      if (!groups[d]) groups[d] = [];
      groups[d].push(r);
    });
    const dates = Object.keys(groups).sort().reverse(); // 最新的在前
    dates.forEach(d => {
      const recsOfDay = groups[d];
      const group = el('div', 'tl-date-group');
      // 日期头（可点击折叠）
      const head = el('div', 'tl-date-head');
      head.innerHTML = `<svg class="tl-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="tl-date-label">${escapeHtml(d)}</span>
        <span class="tl-date-dow">${formatDow(d)}</span>
        <span class="tl-date-count">${recsOfDay.length} 条</span>`;
      head.addEventListener('click', () => { group.classList.toggle('collapsed'); });
      group.appendChild(head);
      // 当天记录体
      const body = el('div', 'tl-date-body');
      recsOfDay.forEach(r => {
        const mc = moodColor(r.mood || 3);
        const imp = !!r.important;
        const tags = (r.tags || []).map(t => `<span class="tl-tag">${t}</span>`).join('');
        const au = authorKey(r);
        const ac = multi ? (cmap[au] || 'var(--accent)') : null;
        const item = el('div', 'tl-item' + (imp ? ' important' : ''));
        item.dataset.id = r.id;
        item.addEventListener('click', () => openRecordDetail(r.id));
        const ttxt = r.time ? `<span class="tl-time">${r.time}</span>` : '';
        const authorBadge = multi ? ` <span class="tl-author" style="--ac:${ac}"><i></i>${escapeHtml(au)}</span>` : '';
        item.innerHTML = `
          <div class="tl-axis"><span class="tl-dot"${multi ? ` style="border-color:${ac}"` : ''}></span></div>
          <div class="tl-body">
            <div class="tl-scene">${authorBadge}<span class="m" style="color:${mc}">${r.mood || '-'}/5</span> ${ttxt} ${r.scene ? '· ' + r.scene : ''}${imp ? '<span class="tl-imp-flag">重要事件</span>' : ''}</div>
            ${tags ? `<div class="tl-tags">${tags}</div>` : ''}
            ${r.note ? `<div class="tl-note">${String(r.note).slice(0, 120)}</div>` : ''}
          </div>`;
        body.appendChild(item);
      });
      group.appendChild(body);
      list.appendChild(group);
    });
  }
  /* ---------- 作者配色：共享空间里「谁是谁」一眼分清 ----------
     颜色不是随便挑的，而是从你当前主题的强调色沿色相环均匀派生出来，
     所以换主题时几个人的颜色会整体跟着变，但彼此始终区分得开。      */
  function authorKey(r) { return ((r && r.author) || '').trim() || '未署名'; }
  function authorList() {
    const seen = [];
    (recs || []).forEach(function (r) { const a = authorKey(r); if (seen.indexOf(a) < 0) seen.push(a); });
    const me = ghNick();
    // 自己永远排第一个，拿到最"正"的主题色
    seen.sort(function (a, b) {
      if (me && a === me) return -1;
      if (me && b === me) return 1;
      return a.localeCompare(b, 'zh-CN');
    });
    return seen;
  }
  let _authorColorCache = { key: '', map: {} };
  function authorColors() {
    const list = authorList();
    const accent = (getComputedStyle(root).getPropertyValue('--accent') || '#5eead4').trim() || '#5eead4';
    const key = accent + '|' + list.join(',');
    if (_authorColorCache.key === key) return _authorColorCache.map;
    let base;
    try { base = hexToHsl(accent); } catch (e) { base = { h: 168, s: 0.72, l: 0.65 }; }
    const map = {};
    const n = Math.max(list.length, 1);
    const step = n > 1 ? Math.max(46, Math.min(120, 300 / n)) : 0;
    const isGray = base.s === 0;
    list.forEach(function (a, i) {
      if (isGray) {
        // 灰度主题（纯黑/纯白/灰阶）：作者色也保持灰阶，只用亮度阶梯区分，避免强行加饱和
        const span = 0.42;
        const lo = clamp(base.l, 0.12, 0.88);
        const l = n === 1 ? base.l : clamp(lo + (i - (n - 1) / 2) * span / (n - 1), 0.12, 0.88);
        map[a] = hslToHex(base.h, 0, l);
      } else {
        const h = (base.h + i * step) % 360;
        const s = Math.min(0.86, Math.max(0.48, base.s));
        const l = Math.min(0.74, Math.max(0.5, base.l + (i % 2 ? 0.04 : 0)));
        map[a] = hslToHex(h, s, l);
      }
    });
    _authorColorCache = { key: key, map: map };
    return map;
  }
  function authorColor(a) { return authorColors()[(a || '').trim() || '未署名'] || 'var(--accent)'; }

  // 共享空间图例：谁是谁 + 各写了多少条 + 点色块只看这个人（这就是「查看对方内容」的入口）
  // target 不传 = 历史视图的标签关系图下方；传 #tlAuthorLegend = 时间轴视图顶部
  function renderAuthorLegend(target) {
    const isTl = target && target.id === 'tlAuthorLegend';
    const box = target || $('#authorLegend'); if (!box) return;
    const map = authorColors();
    const names = Object.keys(map);
    const cnt = {};
    (recs || []).forEach(function (r) { const a = authorKey(r); cnt[a] = (cnt[a] || 0) + 1; });
    if (names.length <= 1) {
      // 时间轴视图单人时不需要图例（保持清爽）；历史视图仍显示标签图提示
      box.innerHTML = isTl ? '' : '<span class="lg-note">点越大 = 这个标签出现得越多；连线 = 两个标签常常一起出现。</span>';
      return;
    }
    const me = ghNick();
    box.innerHTML = '<span class="lg-title">记录作者</span>'
      + names.map(function (a) {
        return '<button class="lg-item' + (state.histAuthor === a ? ' on' : '') + '" type="button" data-author="' + escapeHtml(a) + '"'
          + ' title="只看 ' + escapeHtml(a) + ' 的记录（再点一次取消）">'
          + '<i style="background:' + map[a] + '"></i><span>' + escapeHtml(a) + (me && a === me ? '（我）' : '') + '</span>'
          + '<b>' + (cnt[a] || 0) + '</b></button>';
      }).join('')
      + '<span class="lg-note">点某个人 = 只看 TA 的记录，再点一次看全部。</span>';
    $$('.lg-item', box).forEach(function (b) {
      b.addEventListener('click', function () {
        state.histAuthor = (state.histAuthor === b.dataset.author) ? '' : b.dataset.author;
        refreshLists();
      });
    });
  }

  /* ---------- 标签关系图（Obsidian 风格）：一个标签一个点，常同时出现的连起来 ----------
     · 点节点 = 只看这个标签下的记录；再点一次取消
     · 可以拖动节点摆位置，位置会记住，不会每次刷新乱跳
     · 个人空间按心情上色；共享空间按「主要记录人」上色，配合上面的图例   */
  let _tgLayout = { key: '', pts: null };
  let tgView = { x: 0, y: 0, k: 1 }; // 标签关系图的平移/缩放（背景拖拽 + 滚轮/双指）
  function applyTgView(svg) {
    const g = $('#tgZoom', svg); if (g) g.setAttribute('transform', 'translate(' + tgView.x.toFixed(2) + ',' + tgView.y.toFixed(2) + ') scale(' + tgView.k.toFixed(3) + ')');
  }
  function renderTagGraph() {
    const svg = $('#tagGraph'); if (!svg) return;
    const W = 720, H = 420;
    const base = (recs || []).filter(function (r) { return !state.histAuthor || authorKey(r) === state.histAuthor; });
    const cnt = {}, pair = {}, moodSum = {}, hit = {};
    base.forEach(function (r) {
      const tags = [];
      (r.tags || []).forEach(function (t) { t = String(t || '').trim(); if (t && tags.indexOf(t) < 0) tags.push(t); });
      const a = authorKey(r);
      tags.forEach(function (t) {
        cnt[t] = (cnt[t] || 0) + 1;
        moodSum[t] = (moodSum[t] || 0) + (+r.mood || 3);
        hit[t] = hit[t] || {}; hit[t][a] = (hit[t][a] || 0) + 1;
      });
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          const k = [tags[i], tags[j]].sort().join('\u0001');
          pair[k] = (pair[k] || 0) + 1;
        }
      }
    });
    const nodes = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b, 'zh-CN'); }).slice(0, 18);
    const act = $('#tgActive');
    if (!nodes.length) {
      svg.innerHTML = '<text x="360" y="200" text-anchor="middle" fill="var(--ink-dim)" font-size="13">还没有标签</text>'
        + '<text x="360" y="224" text-anchor="middle" fill="var(--ink-dim)" font-size="11.5">记一笔的时候顺手加几个标签，这里就会长出你的情绪网络</text>';
      if (act) act.textContent = '';
      return;
    }
    const idx = {}; nodes.forEach(function (t, i) { idx[t] = i; });
    const links = [];
    Object.keys(pair).forEach(function (k) {
      const p = k.split('\u0001');
      if (idx[p[0]] != null && idx[p[1]] != null) links.push({ a: idx[p[0]], b: idx[p[1]], w: pair[k] });
    });
    const maxC = cnt[nodes[0]] || 1;
    const radius = function (t) { return 8 + Math.sqrt(cnt[t] / maxC) * 12; };

    // 布局缓存：同一组标签复用上次结果（含你手动拖过的位置），避免每次刷新重新抖一遍
    const lkey = nodes.join('\u0001') + '#' + links.length + '#' + (state.histAuthor || '');
    let pts;
    if (_tgLayout.key === lkey && _tgLayout.pts && _tgLayout.pts.length === nodes.length) {
      pts = _tgLayout.pts;
      pts.forEach(function (p, i) { p.r = radius(nodes[i]); });
    } else {
      const N = nodes.length;
      pts = nodes.map(function (t, i) {
        const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
        const rad = 90 + (i % 3) * 24;
        return { x: W / 2 + Math.cos(ang) * rad, y: H / 2 + Math.sin(ang) * rad * 0.72, r: radius(t) };
      });
      for (let it = 0; it < 300; it++) {
        const k = 1 - it / 320;
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const min = pts[i].r + pts[j].r + 20;
            if (d < min) {
              const f = (min - d) / d * 0.5;
              pts[i].x -= dx * f; pts[i].y -= dy * f; pts[j].x += dx * f; pts[j].y += dy * f;
            } else {
              const g = 700 / (d * d) * k;
              pts[i].x -= dx / d * g; pts[i].y -= dy / d * g; pts[j].x += dx / d * g; pts[j].y += dy / d * g;
            }
          }
        }
        links.forEach(function (l) {
          const A = pts[l.a], B = pts[l.b];
          const dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const target = A.r + B.r + 36;
          const f = (d - target) / d * 0.05 * Math.min(3, l.w) * k;
          A.x += dx * f; A.y += dy * f; B.x -= dx * f; B.y -= dy * f;
        });
        for (let i = 0; i < N; i++) {
          pts[i].x += (W / 2 - pts[i].x) * 0.008;
          pts[i].y += (H / 2 - pts[i].y) * 0.012;
          pts[i].x = Math.max(pts[i].r + 8, Math.min(W - pts[i].r - 8, pts[i].x));
          pts[i].y = Math.max(pts[i].r + 10, Math.min(H - pts[i].r - 18, pts[i].y));
        }
      }
      _tgLayout = { key: lkey, pts: pts };
    }

    const multi = Object.keys(authorColors()).length > 1;
    const colorOf = function (t) {
      if (multi) {
        const h = hit[t] || {}; let best = '', bv = -1;
        Object.keys(h).forEach(function (a) { if (h[a] > bv) { bv = h[a]; best = a; } });
        return authorColor(best);
      }
      return moodColor(Math.round((moodSum[t] || 3) / (cnt[t] || 1)));
    };
    const maxW = links.reduce(function (m, l) { return Math.max(m, l.w); }, 1);
    const activeI = state.histTag != null ? idx[state.histTag] : undefined;
    let s = '';
    links.forEach(function (l) {
      const near = activeI != null && (l.a === activeI || l.b === activeI);
      s += '<line class="tg-link' + (near ? ' near' : '') + '"'
        + ' x1="' + pts[l.a].x.toFixed(1) + '" y1="' + pts[l.a].y.toFixed(1) + '"'
        + ' x2="' + pts[l.b].x.toFixed(1) + '" y2="' + pts[l.b].y.toFixed(1) + '"'
        + ' stroke-width="' + (0.9 + (l.w / maxW) * 2.3).toFixed(2) + '" data-a="' + l.a + '" data-b="' + l.b + '"/>';
    });
    nodes.forEach(function (t, i) {
      const on = state.histTag === t;
      const dim = activeI != null && !on && !links.some(function (l) { return (l.a === activeI && l.b === i) || (l.b === activeI && l.a === i); });
      const col = colorOf(t);
    s += '<g class="tg-node' + (on ? ' on' : '') + (dim ? ' dim' : '') + '" data-tag="' + escapeHtml(t) + '" data-i="' + i + '"'
      + ' tabindex="0" role="button" aria-label="标签 ' + escapeHtml(t) + '，' + cnt[t] + ' 条记录"'
      + ' transform="translate(' + pts[i].x.toFixed(1) + ',' + pts[i].y.toFixed(1) + ')" style="--c:' + col + '">'
      + '<circle class="tg-hitarea" r="' + (pts[i].r + 14).toFixed(1) + '" fill="transparent"/>'
      + '<circle class="tg-pulse" r="' + (pts[i].r + 4).toFixed(1) + '" fill="' + col + '" style="animation-delay:-' + ((i * 0.43) % 4).toFixed(2) + 's"/>'
      + '<circle class="tg-halo" r="' + (pts[i].r + 4).toFixed(1) + '" fill="' + col + '"/>'
      + '<circle class="tg-dot" r="' + pts[i].r.toFixed(1) + '" fill="' + col + '"/>'
      + '<text class="tg-cnt" y="' + (-pts[i].r - 7).toFixed(1) + '" text-anchor="middle">' + cnt[t] + '</text>'
      + '<text class="tg-name" y="' + (pts[i].r + 13).toFixed(1) + '" text-anchor="middle">' + escapeHtml(t) + '</text>'
      + '<title>' + escapeHtml(t) + ' · ' + cnt[t] + ' 条记录（点击只看这些）</title></g>';
    });
    svg.innerHTML = '<g class="tg-zoom" id="tgZoom">' + s + '</g>';
    applyTgView(svg);
    if (act) {
      const on = [];
      if (state.histAuthor) on.push('记录人 ' + state.histAuthor);
      if (state.histTag) on.push('#' + state.histTag);
      if (state.histMood) on.push('心情 ' + state.histMood);
      if (state.histQ) on.push('搜索「' + state.histQ + '」');
      act.textContent = on.length ? ('当前筛选：' + on.join(' · ')) : '';
    }
    bindTagGraph(svg, nodes, pts, W, H);
    bindTagGraphPan(svg);
  }

  // 节点交互：点击=筛选、拖动=摆位置（区分点击/拖动，避免"点了没反应"或"想点却拖走了"）
  function bindTagGraph(svg, nodes, pts, W, H) {
    $$('.tg-node', svg).forEach(function (g) {
      const i = +g.dataset.i;
      let sx = 0, sy = 0, moved = false, dragging = false;
      const toLocal = function (e) {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const ctm = svg.getScreenCTM(); if (!ctm) return { x: 0, y: 0 };
        const vb = pt.matrixTransform(ctm.inverse()); // 屏幕 → 视图坐标
        // 再减去平移、除以缩放，得到节点所在的「本地坐标」（拖拽数学与缩放无关）
        return { x: (vb.x - tgView.x) / tgView.k, y: (vb.y - tgView.y) / tgView.k };
      };
      g.addEventListener('pointerdown', function (e) {
        dragging = true; moved = false;
        const p = toLocal(e); sx = p.x - pts[i].x; sy = p.y - pts[i].y;
        g.setPointerCapture && g.setPointerCapture(e.pointerId);
        g.classList.add('drag');
      });
      g.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        const p = toLocal(e);
        const nx = Math.max(pts[i].r + 8, Math.min(W - pts[i].r - 8, p.x - sx));
        const ny = Math.max(pts[i].r + 10, Math.min(H - pts[i].r - 18, p.y - sy));
        if (Math.abs(nx - pts[i].x) + Math.abs(ny - pts[i].y) > 3) moved = true;
        pts[i].x = nx; pts[i].y = ny;
        g.setAttribute('transform', 'translate(' + nx.toFixed(1) + ',' + ny.toFixed(1) + ')');
        $$('.tg-link', svg).forEach(function (l) {
          if (+l.dataset.a === i) { l.setAttribute('x1', nx.toFixed(1)); l.setAttribute('y1', ny.toFixed(1)); }
          if (+l.dataset.b === i) { l.setAttribute('x2', nx.toFixed(1)); l.setAttribute('y2', ny.toFixed(1)); }
        });
      });
      const finish = function () {
        if (!dragging) return;
        dragging = false; g.classList.remove('drag');
        if (!moved) selectTag(nodes[i]);
      };
      g.addEventListener('pointerup', finish);
      g.addEventListener('pointercancel', function () { dragging = false; g.classList.remove('drag'); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTag(nodes[i]); } });
    });
  }

  // 背景平移 + 滚轮/双指缩放：让标签关系图在手机上也能自由探索，不再被挤在中间一小块
  function bindTagGraphPan(svg) {
    if (svg.dataset.pan) return; svg.dataset.pan = '1';
    const getLoc = function (e) {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svg.getScreenCTM(); if (!ctm) return null;
      return pt.matrixTransform(ctm.inverse());
    };
    const pointers = new Map(); let pinchPrev = 0, panLast = null;
    const zoomAt = function (loc, nk) {
      nk = Math.max(0.4, Math.min(4, nk));
      const plx = (loc.x - tgView.x) / tgView.k, ply = (loc.y - tgView.y) / tgView.k;
      tgView.x = loc.x - nk * plx; tgView.y = loc.y - nk * ply; tgView.k = nk; applyTgView(svg);
    };
    svg.addEventListener('pointerdown', function (e) {
      pointers.set(e.pointerId, e);
      if (pointers.size === 2) { const a = Array.prototype.slice.call(pointers.values()); const l0 = getLoc(a[0]), l1 = getLoc(a[1]); if (l0 && l1) pinchPrev = Math.hypot(l0.x - l1.x, l0.y - l1.y); panLast = null; return; }
      if (e.target.closest('.tg-node')) { panLast = null; return; } // 节点拖拽交给 bindTagGraph
      panLast = getLoc(e); svg.classList.add('grabbing');
    });
    svg.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      if (pointers.size >= 2) {
        const a = Array.prototype.slice.call(pointers.values()); const l0 = getLoc(a[0]), l1 = getLoc(a[1]);
        if (!l0 || !l1) return;
        const d = Math.hypot(l0.x - l1.x, l0.y - l1.y);
        if (pinchPrev) zoomAt({ x: (l0.x + l1.x) / 2, y: (l0.y + l1.y) / 2 }, tgView.k * (d / pinchPrev));
        pinchPrev = d; return;
      }
      if (!panLast || e.target.closest('.tg-node')) return;
      const loc = getLoc(e); if (!loc) return;
      tgView.x += (loc.x - panLast.x); tgView.y += (loc.y - panLast.y); panLast = loc; applyTgView(svg);
    });
    const end = function (e) { pointers.delete(e.pointerId); if (pointers.size < 2) pinchPrev = 0; if (pointers.size === 0) { panLast = null; svg.classList.remove('grabbing'); } };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', function (e) { if (e.target.closest('.tg-node')) return; tgView = { x: 0, y: 0, k: 1 }; applyTgView(svg); });
    svg.addEventListener('wheel', function (e) { e.preventDefault(); const loc = getLoc(e); if (loc) zoomAt(loc, tgView.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });
  }

  // 选中/取消某个标签（图上点、云上点、下拉框选，最终都走这一条路，状态永远一致）
  function selectTag(name) {
    state.histTag = (state.histTag === name) ? '' : name;
    refreshLists();
  }
  // 从「高频标签」跳到历史并筛选
  function jumpToTag(name) {
    state.histTag = name;
    switchView('hist');
    refreshLists();
  }
  // 标签筛选按钮（替代原生 select）：同步文案 + 高亮
  function syncTagFilterBtn() {
    const b = $('#histTagFilterBtn'), l = $('#histTagFilterLabel');
    if (b) b.classList.toggle('on', !!state.histTag);
    if (l) l.textContent = state.histTag || '全部标签';
  }
  // 标签筛选底部弹层
  function openTagSheet() {
    const body = $('#tagSheetBody'); const sheet = $('#tagSheet'); if (!body || !sheet) return;
    const all = {}; recs.forEach(r => (r.tags || []).forEach(t => { if (t) all[t] = (all[t] || 0) + 1; }));
    const tags = Object.keys(all).sort((a, b) => all[b] - all[a] || a.localeCompare(b, 'zh-CN'));
    let html = '<button type="button" class="sheet-item' + (state.histTag ? '' : ' on') + '" data-tag="">全部标签</button>';
    html += tags.map(t => '<button type="button" class="sheet-item' + (state.histTag === t ? ' on' : '') + '" data-tag="' + escapeHtml(t) + '">'
      + escapeHtml(t) + '<span class="sheet-cnt">' + all[t] + '</span></button>').join('');
    body.innerHTML = html;
    $$('.sheet-item', body).forEach(b => b.addEventListener('click', () => { state.histTag = b.dataset.tag || ''; closeSheet(); refreshLists(); }));
    sheet.classList.add('show'); $('#scrim').classList.add('show');
  }
  function closeSheet() { const s = $('#tagSheet'); if (s) s.classList.remove('show'); const sc = $('#scrim'); if (sc) sc.classList.remove('show'); }

  // 统一刷新所有列表容器（模态框版 + 全页视图版）。
  // 之前 buildHistory() 不传参只更新隐藏的 #histList，导致「历史」视图里搜索/筛选看着毫无反应。
  function refreshLists() {
    buildHistory($('#histList'));
    buildHistory($('#viewHistList'));
    buildTimeline($('#tlList'));
    buildTimeline($('#viewTlList'));
    renderInsights();
    renderTagGraph();
    renderAuthorLegend();
    renderAuthorLegend($('#tlAuthorLegend'));
  }
  function openTimeline() { buildTimeline($('#tlList')); $('#tlModal').classList.add('show'); $('#scrim').classList.add('show'); }
  function closeTimeline() { $('#tlModal').classList.remove('show'); $('#scrim').classList.remove('show'); }
  function bindExtractModal() {
    $('#extractClose').addEventListener('click', () => { $('#extractModal').classList.remove('show'); $('#scrim').classList.remove('show'); });
    $('#extractBtn').addEventListener('click', extractStart);
    $('#extractAnsBtn').addEventListener('click', extractContinue);
    $('#extractApply').addEventListener('click', applyExtractNow);
  }
  function bindBotNav() {
    const dash = $('#navDash'), tl = $('#navTl'), hist = $('#navHist'), trash = $('#navTrash');
    if (dash) dash.addEventListener('click', () => switchView('dash'));
    if (tl) tl.addEventListener('click', () => switchView('tl'));
    if (hist) hist.addEventListener('click', () => switchView('hist'));
    if (trash) trash.addEventListener('click', openTrash);
    const back = $('#trashBack');
    if (back) back.addEventListener('click', function () { closeTrash(); });
    // 手机上的系统返回键 / 浏览器后退，也能退出回收站
    window.addEventListener('popstate', function () { if (trashOpened()) closeTrash(true); });
    const refresh = $('#trashRefresh');
    if (refresh) refresh.addEventListener('click', function () {
      const c = ghConf();
      if (!c.enabled || !c.token || !c.user || !c.repo) { trashMsg('还没开启云同步，回收站只存在这台设备上'); return; }
      trashMsg('正在从云端读取…');
      pullTrash().then(function () { renderTrash(); trashMsg('✓ 已和云端对齐，共 ' + (DATA.trash || []).length + ' 条'); })
        .catch(function (e) { trashMsg('✗ 读取失败：' + ((e && e.message) || e)); });
    });
    const pall = $('#trashPurgeAll');
    on(pall, 'click', function () {
      const n = (DATA.trash || []).length;
      if (!n) { trashMsg('回收站本来就是空的'); return; }
      appConfirm('清空回收站？这 ' + n + ' 条记录会永远消失，无法恢复。', '清空').then(function (ok) {
        if (!ok) return;
        purgeAllTrash().then(function () { renderTrash(); trashMsg('✓ 已清空'); })
          .catch(function (e) { renderTrash(); trashMsg('✗ 云端未能同步：' + ((e && e.message) || e) + '（本机已清空，联网后会自动补上）'); });
      });
    });
    const tl2 = $('#trashList');
    on(tl2, 'click', function (e) {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
      btn.disabled = true;
      if (act === 'restore') {
        trashMsg('正在恢复…');
        restoreFromTrash(id).then(function () { renderTrash(); renderAll(); trashMsg('✓ 已恢复到主列表，回看板就能看到'); })
          .catch(function (e2) { renderTrash(); trashMsg('✗ 恢复失败：' + ((e2 && e2.message) || e2)); });
      } else if (act === 'purge') {
        appConfirm('彻底删除后无法恢复，确定吗？', '彻底删除').then(function (ok) {
          if (!ok) { btn.disabled = false; return; }
          trashMsg('正在彻底删除…');
          purgeFromTrash(id).then(function () { renderTrash(); trashMsg('✓ 已彻底删除'); })
            .catch(function (e2) { renderTrash(); trashMsg('✗ 云端未能同步：' + ((e2 && e2.message) || e2)); });
        });
      }
    });
  }

  /* ---------- 主题引擎 ---------- */
  // 每个预设只保留「主题色」一个种子，其余颜色全部由 derivePalette() 从它实时派生
  const PALETTES = {
    aurora:   { name: '极光', accent: '#5eead4' },
    rose:     { name: '玫瑰', accent: '#fb7185' },
    ocean:    { name: '海洋', accent: '#22d3ee' },
    sunset:   { name: '日落', accent: '#fb923c' },
    forest:   { name: '森林', accent: '#34d399' },
    twilight: { name: '暮光', accent: '#a78bfa' },
    neon:     { name: '霓虹', accent: '#f0abfc' },
    mono:     { name: '单色', accent: '#e2e8f0' }
  };
  const EXTRA_Q = [
    '此刻身体哪个部位有感觉？胸口、肩膀、胃……写下来。',
    '如果给今天的心情起个名字，会叫什么？它一般什么时候来？'
  ];
  // 记一笔 · 标签预设（点选即可，想不起来也能选）
  const TAG_PRESETS = ['学习', '复习', '考试', '模考', '熬夜', '疲惫', '焦虑', '挫败', '委屈', '孤单',
    '平静', '安心', '期待', '开心', '成就感', '放松', '社交', '运动', '干扰', '想逃', '暴躁', '整理', '设计', '身体']
  // 心情语义色：跟随主题（由 derivePalette 注入 --mood-low/-mid/-high），不再写死
  const moodColor = m => m <= 2 ? 'var(--mood-low)' : (m === 3 ? 'var(--mood-mid)' : 'var(--mood-high)');
  const moodBand = m => m <= 2 ? '低落' : (m === 3 ? '平稳' : '高涨');

  const root = document.documentElement;
  const hexToRgb = hex => { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join(''); return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }; };
  const hexToHsl = hex => {
    let { r, g, b } = hexToRgb(hex); r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b); let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; }
    return { h: h * 360, s, l };
  };
  const hslToHex = (h, s, l) => {
    h /= 360; let r, g, b;
    if (s === 0) { r = g = b = l; } else {
      const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
    }
    const to = x => ('0' + Math.round(x * 255).toString(16)).slice(-2);
    return '#' + to(r) + to(g) + to(b);
  };
  // 单一主题色 → 全调色板：强调色、同源和谐色、心情语义色、玻璃/背景，以及保证可读的 on-color
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let currentAccent = '#5eead4';
  // WCAG 相对亮度（0..1）
  function relLum({ r, g, b }) {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  // 在某底色上反推选「对比更清晰」的文字色（浅底→深字，深底→浅字）
  function onColorFor(hex) {
    try { return relLum(hexToRgb(hex)) > 0.55 ? '#0b1118' : '#ffffff'; }
    catch (e) { return '#04121a'; }
  }
  // 心情文字色：按 mood 取对应语义色的反相色（带缓存，accent 不变则复用）
  const moodVarName = m => (m <= 2 ? '--mood-low' : (m === 3 ? '--mood-mid' : '--mood-high'));
  const _onMoodCache = {};
  function onMood(m) {
    const k = Math.max(1, Math.min(5, Math.round(m)));
    if (_onMoodCache[k]) return _onMoodCache[k];
    const v = getComputedStyle(root).getPropertyValue(moodVarName(k)).trim();
    return _onMoodCache[k] = onColorFor(v);
  }
  function derivePalette(hex, theme) {
    currentAccent = hex;
    Object.keys(_onMoodCache).forEach(k => delete _onMoodCache[k]); // 主题色变了，心情文字色缓存失效
    const base = hexToHsl(hex);
    const h = base.h, s = base.s, l = base.l;
    const isGray = s === 0; // 纯灰度（#000/#fff/灰阶）保持真正的黑白，不强行加色调
    const sat = isGray ? 0 : clamp(s, 0.35, 0.95);
    const accent = hex;
    // 灰度主题：和谐色为同亮度的灰阶；彩色主题：按色相环偏移
    const a2 = isGray
      ? hslToHex(0, 0, clamp(l + 0.08, 0, 1))
      : hslToHex((h + 30) % 360, clamp(sat, 0.4, 0.95), clamp(l + 0.05, 0.45, 0.95));
    const a3 = isGray
      ? hslToHex(0, 0, clamp(l + 0.18, 0, 1))
      : hslToHex((h + 150) % 360, clamp(sat - 0.05, 0.35, 0.9), clamp(l, 0.45, 0.9));
    const a4 = isGray
      ? hslToHex(0, 0, clamp(l - 0.12, 0, 1))
      : hslToHex((h + 205) % 360, clamp(sat - 0.05, 0.35, 0.9), clamp(l - 0.06, 0.4, 0.82));
    const rgb = hexToRgb(hex);
    const soft = `rgba(${rgb.r},${rgb.g},${rgb.b},0.16)`;
    const glow = `rgba(${rgb.r},${rgb.g},${rgb.b},0.36)`;
    const moodLow = isGray
      ? hslToHex(0, 0, clamp(l - 0.18, 0.12, 0.55))
      : hslToHex(h, clamp(sat - 0.05, 0.2, 0.95), clamp(l - 0.22, 0.16, 0.6));
    const moodMid = hex;
    const moodHigh = isGray
      ? hslToHex(0, 0, clamp(l + 0.14, 0.55, 1))
      : hslToHex(h, clamp(sat + 0.1, 0.3, 1), clamp(l + 0.16, 0.55, 0.92));
    const onAccent = onColorFor(hex);
    const onLow = onColorFor(moodLow), onMid = onColorFor(moodMid), onHigh = onColorFor(moodHigh);
    // 语义色：全部从主题色家族派生，不保留写死绿/黄/红
    const srcGood = accent, srcMid = a2, srcBad = a3;
    const corrPos = accent, corrNeg = a3;
    const ok = accent, warn = a2, bad = a3;
    const onOk = onAccent, onWarn = onColorFor(warn), onBad = onColorFor(bad);
    // 各维度数据色（图表/概览）：保证彼此可区分且全部来自主题色家族
    const energy = a2, sleep = a3, tension = a4;
    // 背景/文字/玻璃：保持深或浅基调，仅以主题色轻微染色；纯灰度时给出真正的黑白
    let bg0, bg1, bg2, ink, inkSoft, inkDim, glass, glass2, glassBrd, glassIn, line, shadow;
    if (theme === 'light') {
      if (isGray) {
        bg0 = hslToHex(0, 0, 1.0);
        bg1 = hslToHex(0, 0, 0.975);
        bg2 = hslToHex(0, 0, 0.95);
      } else {
        bg0 = hslToHex(h, clamp(sat * 0.32, 0.1, 0.4), 0.95);
        bg1 = hslToHex(h, clamp(sat * 0.28, 0.08, 0.35), 0.975);
        bg2 = hslToHex(h, clamp(sat * 0.24, 0.06, 0.3), 1.0);
      }
      ink = '#0f172a'; inkSoft = '#334155'; inkDim = '#64748b';
      glass = 'rgba(255,255,255,0.58)'; glass2 = 'rgba(255,255,255,0.8)'; glassBrd = 'rgba(20,40,80,0.12)'; glassIn = 'rgba(255,255,255,0.7)'; line = 'rgba(20,40,80,0.08)';
      shadow = '0 30px 70px -30px rgba(40,60,110,0.42)';
    } else {
      if (isGray) {
        bg0 = hslToHex(0, 0, 0);
        bg1 = hslToHex(0, 0, 0.045);
        bg2 = hslToHex(0, 0, 0.09);
      } else {
        bg0 = hslToHex(h, clamp(sat * 0.5, 0.08, 0.38), 0.045);
        bg1 = hslToHex(h, clamp(sat * 0.45, 0.07, 0.34), 0.065);
        bg2 = hslToHex(h, clamp(sat * 0.4, 0.06, 0.3), 0.09);
      }
      ink = '#eef2fb'; inkSoft = '#c8d2e0'; inkDim = '#8892a6';
      glass = 'rgba(255,255,255,0.08)'; glass2 = 'rgba(255,255,255,0.11)'; glassBrd = 'rgba(255,255,255,0.18)'; glassIn = 'rgba(255,255,255,0.14)'; line = 'rgba(255,255,255,0.09)';
      shadow = '0 30px 80px -28px rgba(0,0,0,0.72)';
    }
    const set = (k, v) => root.style.setProperty(k, v);
    set('--accent', accent); set('--accent-2', a2);
    set('--accent-soft', soft); set('--accent-glow', glow);
    set('--a1', accent); set('--a2', a2); set('--a3', a3); set('--a4', a4);
    set('--mood-low', moodLow); set('--mood-mid', moodMid); set('--mood-high', moodHigh);
    set('--on-accent', onAccent); set('--on-mood-low', onLow); set('--on-mood-mid', onMid); set('--on-mood-high', onHigh);
    set('--src-good', srcGood); set('--src-mid', srcMid); set('--src-bad', srcBad);
    set('--corr-pos', corrPos); set('--corr-neg', corrNeg);
    set('--ok', ok); set('--warn', warn); set('--bad', bad);
    set('--on-ok', onOk); set('--on-warn', onWarn); set('--on-bad', onBad);
    set('--energy', energy); set('--sleep', sleep); set('--tension', tension);
    set('--bg-0', bg0); set('--bg-1', bg1); set('--bg-2', bg2);
    set('--ink', ink); set('--ink-soft', inkSoft); set('--ink-dim', inkDim);
    set('--glass', glass); set('--glass-2', glass2); set('--glass-brd', glassBrd); set('--glass-in', glassIn); set('--line', line);
    set('--shadow', shadow);
  }
  function applyCustom(hex) {
    derivePalette(hex, localStorage.getItem('mood.theme') || 'dark');
    localStorage.setItem('mood.custom', hex);
    localStorage.removeItem('mood.palette');
    root.removeAttribute('data-palette');
    syncSwatches(null);
    const cc = document.getElementById('customColor'); if (cc) cc.value = hex;
  }
  function applyPalette(key) {
    const p = PALETTES[key]; if (!p) return;
    derivePalette(p.accent, localStorage.getItem('mood.theme') || 'dark');
    root.setAttribute('data-palette', key);
    localStorage.setItem('mood.palette', key);
    localStorage.removeItem('mood.custom');
    const cc = document.getElementById('customColor'); if (cc) cc.value = p.accent;
    syncSwatches(key);
  }
  function initTheme() {
    const custom = localStorage.getItem('mood.custom');
    const pal = localStorage.getItem('mood.palette');
    const theme = localStorage.getItem('mood.theme') || 'dark';
    root.setAttribute('data-theme', theme);
    if (custom) applyCustom(custom);
    else if (pal && PALETTES[pal]) applyPalette(pal);
    else { root.setAttribute('data-palette', 'aurora'); derivePalette(PALETTES.aurora.accent, theme); syncSwatches('aurora'); document.getElementById('customColor').value = PALETTES.aurora.accent; }
    document.getElementById('modeDark').classList.toggle('active', theme === 'dark');
    document.getElementById('modeLight').classList.toggle('active', theme === 'light');
  }
  function buildSwatches() {
    const wrap = document.getElementById('swatches'); wrap.innerHTML = '';
    Object.entries(PALETTES).forEach(([key, p]) => {
      const s = document.createElement('div');
      s.className = 'swatch'; s.dataset.key = key;
      s.style.background = `linear-gradient(135deg, ${p.accent}, ${hslToHex((hexToHsl(p.accent).h + 30) % 360, hexToHsl(p.accent).s, Math.min(0.95, hexToHsl(p.accent).l + 0.05))})`;
      s.innerHTML = `<span class="nm">${p.name}</span>`;
      s.addEventListener('click', () => applyPalette(key));
      wrap.appendChild(s);
    });
  }
  function syncSwatches(active) {
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.key === active));
  }

  /* ---------- 工具 ---------- */
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  // 安全事件绑定：元素不存在时静默跳过，避免单个 null 引用中断整段初始化（曾因 #tlBtn 被删导致连锁失效）
  const on = (sel, ev, fn, opt) => { const n = typeof sel === 'string' ? $(sel) : sel; if (n) n.addEventListener(ev, fn, opt); return n; };
  // 初始化熔断：任何一步出错只影响它自己，不再连锁瘫痪后续所有交互
  function safeInit(name, fn) { try { fn(); } catch (e) { console.error('[Mood Atlas] 初始化「' + name + '」失败：', e); } }
  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 1) => Number(n).toFixed(d);
  const avg = (arr, k) => arr.length ? arr.reduce((s, x) => s + (x[k] || 0), 0) / arr.length : 0;

  // 应用内确认弹窗（替代原生 confirm，避免移动端/PWA 被抑制且外观不统一）
  function appConfirm(message, okText) {
    return new Promise(function (resolve) {
      const ov = $('#appConfirm'); if (!ov) { resolve(window.confirm(message)); return; }
      const msgEl = ov.querySelector('.ac-msg');
      const okEl = ov.querySelector('.ac-ok');
      const cancelEl = ov.querySelector('.ac-cancel');
      if (msgEl) msgEl.textContent = message || '';
      if (okEl) okEl.textContent = okText || '确定';
      ov.classList.add('show');
      function close(v) {
        ov.classList.remove('show');
        if (okEl) okEl.removeEventListener('click', onOk);
        if (cancelEl) cancelEl.removeEventListener('click', onCancel);
        if (ov) ov.removeEventListener('click', onBack);
        resolve(v);
      }
      function onOk() { close(true); }
      function onCancel() { close(false); }
      function onBack(e) { if (e.target === ov) close(false); }
      if (okEl) okEl.addEventListener('click', onOk);
      if (cancelEl) cancelEl.addEventListener('click', onCancel);
      if (ov) ov.addEventListener('click', onBack);
    });
  }
  function animateValue(node, end, dur = 1100, dec = 1) {
    const start = 0, t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(start + (end - start) * e, dec);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------- 柔光粒子背景（替换星星网线） ---------- */
  function initCanvas() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.getElementById('bg'); const ctx = cv.getContext('2d');
    let W, H, parts = []; const mouse = { x: -999, y: -999 };
    function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
    resize(); addEventListener('resize', resize);
    addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    const N = Math.min(46, Math.floor(innerWidth / 32));
    for (let i = 0; i < N; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, r: 18 + Math.random() * 46, vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18, a: 0.04 + Math.random() * 0.06 });
    let frame = 0, cCache = '#5eead4';
    function loop() {
      ctx.clearRect(0, 0, W, H);
      if (frame % 16 === 0) cCache = getComputedStyle(root).getPropertyValue('--accent').trim() || '#5eead4';
      frame++;
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -60 || p.x > W + 60) p.vx *= -1;
        if (p.y < -60 || p.y > H + 60) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < 160) { p.x += dx / d * 0.4; p.y += dy / d * 0.4; }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, cCache); g.addColorStop(1, 'transparent');
        ctx.globalAlpha = p.a; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      requestAnimationFrame(loop);
    }
    loop();
  }

  /* ---------- 鼠标聚光 + 磁性按钮 ---------- */
  function initGlowAndMagnetic() {
    const glow = document.getElementById('glow');
    let gx = 0, gy = 0, raf = 0;
    addEventListener('mousemove', e => {
      gx = (e.clientX / innerWidth) * 100; gy = (e.clientY / innerHeight) * 100;
      if (!raf) raf = requestAnimationFrame(() => { glow.style.setProperty('--mx', gx + '%'); glow.style.setProperty('--my', gy + '%'); raf = 0; });
    });
    /* 【已移除磁性位移】原来对所有 .btn 施加 transform: translate(dx,dy)，会带来两类硬伤：
       1) 覆盖按钮自身的定位 transform（如 #aiSend 的 translateY(-50%)），导致按钮"点一下就飘走 / 往右移"；
       2) 鼠标在按钮上移动时位置持续变化，点击判定容易落空。
       按钮反馈改由 CSS 的 hover 高亮 + :active 缩放完成，稳定不偏移。 */
  }

  /* ---------- 涟漪 ---------- */
  function bindRipple() {
    // 事件委托：动态生成的按钮（模态框、标签图等）也能有涟漪，且不依赖启动时的快照
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('.btn') : null;
      if (!b || b.disabled) return;
      const r = b.getBoundingClientRect();
      const rip = el('span', 'ripple');
      const sz = Math.max(r.width, r.height);
      rip.style.width = rip.style.height = sz + 'px';
      rip.style.left = (e.clientX - r.left - sz / 2) + 'px';
      rip.style.top = (e.clientY - r.top - sz / 2) + 'px';
      b.appendChild(rip); setTimeout(() => rip.remove(), 600);
    });
  }

  /* ---------- 时间筛选 ---------- */
  const state = { mode: 'all', year: null, month: null, day: null, editingId: null, histQ: '', histTag: '', histMood: 0, histAuthor: '', calMonth: '', trendSelf: false };
  function pad2(n) { return ('0' + n).slice(-2); }
  function getViewRecs() {
    if (state.mode === 'all') return recs;
    return recs.filter(r => {
      if (state.mode === 'year') return r.date.startsWith(state.year + '-');
      if (state.mode === 'month') return r.date.startsWith(state.year + '-' + pad2(state.month) + '-');
      if (state.mode === 'day') return r.date === state.day;
      return true;
    });
  }
  // 本地日期（避免 toISOString 在 GMT+8 下被偏移一天，导致热力图等按日期比对错位）
  function isoLocal(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // 仪表盘统一的「自己 / 共同」过滤：时间维度由 getViewRecs 处理，作者维度由 state.trendSelf 处理
  function dashRecs() {
    let v = getViewRecs();
    if (state.trendSelf) { const me = ghNick() || '未署名'; v = v.filter(r => authorKey(r) === me); }
    return v;
  }
  // 切换「自己 / 共同」，同步所有 data-self-toggle 控件并重渲染整个仪表盘
  function setViewSelf(v) {
    state.trendSelf = (v === 'self');
    document.querySelectorAll('[data-self-toggle] button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    renderDash();
    if (_viewName === 'tl') renderInsights();
  }
  function syncSelfToggles() {
    const show = authorList().length > 1;
    document.querySelectorAll('[data-self-toggle]').forEach(t => t.style.display = show ? '' : 'none');
  }
  function renderDash() {
    renderStats(); renderTrend(); renderHeat(); renderTags(); renderSleep(); renderScatter(); renderPeaks(); renderCalendar(); syncSelfToggles();
  }
  // 皮尔逊相关系数
  function pearson(pts) {
    const n = pts.length; if (n < 2) return NaN;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const x = p[0], y = p[1]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    const cov = n * sxy - sx * sy;
    const dx = n * sxx - sx * sx, dy = n * syy - sy * sy;
    if (dx <= 0 || dy <= 0) return NaN;
    return cov / Math.sqrt(dx * dy);
  }
  // 情绪洞察：来源分析（标签 / 场景）+ 跨维度相关性，统一接入 dashRecs() 的 自己/共同 过滤
  function renderInsights() {
    const box = $('#insightPanel'); if (!box) return;
    box.classList.add('inline-mode'); // 时间轴里去掉卡片矩形背景，改为内联样式
    const v = dashRecs();
    // 来源：按标签分组
    const tagMap = {};
    v.forEach(r => (r.tags || []).forEach(t => { (tagMap[t] = tagMap[t] || []).push(+r.mood || 3); }));
    const tagRows = Object.keys(tagMap)
      .map(t => ({ name: t, n: tagMap[t].length, avg: tagMap[t].reduce((a, b) => a + b, 0) / tagMap[t].length }))
      .filter(x => x.n >= 2).sort((a, b) => b.avg - a.avg);
    // 来源：按场景分组
    const sceneMap = {};
    v.forEach(r => { const s = (r.scene || '').trim(); if (s) (sceneMap[s] = sceneMap[s] || []).push(+r.mood || 3); });
    const sceneRows = Object.keys(sceneMap)
      .map(s => ({ name: s, n: sceneMap[s].length, avg: sceneMap[s].reduce((a, b) => a + b, 0) / sceneMap[s].length }))
      .filter(x => x.n >= 2).sort((a, b) => b.avg - a.avg);
    const srcBar = (rows, empty) => {
      if (!rows.length) return '<div class="src-empty">' + empty + '</div>';
      const maxN = Math.max.apply(null, rows.map(r => r.n));
      return rows.map(r => {
        const pct = Math.max(10, Math.round(r.n / maxN * 100));
        const cls = r.avg >= 3.5 ? 'good' : (r.avg <= 2.5 ? 'bad' : 'mid');
        return '<div class="src-row ' + cls + '">' +
          '<div class="src-name">' + escapeHtml(r.name) + '</div>' +
          '<div class="src-track"><div class="src-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="src-meta">' + fmt(r.avg) + '<small>/5</small> · ' + r.n + '次</div>' +
          '</div>';
      }).join('');
    };
    $('#insightTagSrc').innerHTML = srcBar(tagRows, '标签数据不足（每个标签至少记 2 次）');
    $('#insightSceneSrc').innerHTML = srcBar(sceneRows, '场景数据不足（同一场景至少 2 次）');
    // 跨维度相关性
    const pairs = [['sleep', 'mood', '睡眠', '心情'], ['energy', 'mood', '精力', '心情'], ['tension', 'mood', '紧绷', '心情'], ['energy', 'tension', '精力', '紧绷'], ['sleep', 'energy', '睡眠', '精力'], ['sleep', 'tension', '睡眠', '紧绷']];
    const corrHtml = pairs.map(([a, b, la, lb]) => {
      const pts = v.map(r => [+r[a], +r[b]]).filter(p => p[0] > 0 && !isNaN(p[0]) && p[1] != null && !isNaN(p[1]));
      if (pts.length < 5) return '';
      const r = pearson(pts); if (isNaN(r)) return '';
      const mag = Math.abs(r);
      const dir = r > 0 ? '正相关' : '负相关';
      const strength = mag >= 0.6 ? '强' : mag >= 0.3 ? '中' : '弱';
      const cls = r > 0 ? 'pos' : 'neg';
      return '<div class="corr-row ' + cls + '">' +
        '<div class="corr-name">' + la + ' ↔ ' + lb + '</div>' +
        '<div class="corr-track"><div class="corr-fill" style="width:' + Math.round(mag * 100) + '%"></div></div>' +
        '<div class="corr-meta">r=' + r.toFixed(2) + ' · ' + dir + strength + '</div>' +
        '</div>';
    }).filter(Boolean).join('') || '<div class="src-empty">维度数据不足（睡眠/精力/紧绷每项至少 5 条）</div>';
    $('#insightCorr').innerHTML = corrHtml;
  }
  async function insightAiSummary() {
    const btn = $('#insightAi'); if (!btn) return;
    const out = $('#insightAiOut');
    if (!dsKey()) { if (out) out.textContent = '请先在「⚙ 设置」里填入 DeepSeek API Key。'; return; }
    const tagTxt = ($('#insightTagSrc').textContent || '').trim();
    const corrTxt = ($('#insightCorr').textContent || '').trim();
    if (!tagTxt && !corrTxt) { if (out) out.textContent = '当前范围数据不足，先多记几笔再来解读。'; return; }
    const sys = '你是情绪数据分析师。基于下面整理的「来源分析」和「维度相关性」，用中文写一段不超过 150 字的解读：哪些来源最滋养 / 最消耗用户，睡眠、精力、紧绷和心情的关系意味着什么，最后给一句温和的提醒。不要诊断、不要恐吓。';
    const user = '来源分析（标签）：\n' + tagTxt + '\n\n维度相关性：\n' + corrTxt;
    btn.disabled = true; btn.textContent = '解读中…';
    if (out) out.textContent = '';
    try {
      const res = await callDeepSeek(sys, user, { task: 'chat' });
      if (out) out.textContent = res.text;
    } catch (e) { if (out) out.textContent = '解读失败：' + ((e && e.message) || e); }
    finally { btn.disabled = false; btn.textContent = '让 AI 解读'; }
  }
  function yearsOf() { return [...new Set(recs.map(r => r.date.slice(0, 4)))].sort(); }
  function buildSel(opts, val) {
    const s = document.createElement('select');
    opts.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); });
    s.value = val; return s;
  }
  function renderPick() {
    const pick = $('#tbPick'); pick.innerHTML = '';
    if (state.mode === 'all') { updateViewLabel(); return; }
    const years = yearsOf();
    if (state.mode === 'year') {
      if (!state.year) state.year = years[years.length - 1];
      const s = buildSel(years, state.year);
      s.onchange = () => { state.year = s.value; renderAll(); };
      pick.appendChild(s);
    } else if (state.mode === 'month') {
      if (!state.year) state.year = years[years.length - 1];
      const yr = buildSel(years, state.year);
      const mo = buildSel(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'], pad2(state.month || 1));
      yr.onchange = () => { state.year = yr.value; renderAll(); };
      mo.onchange = () => { state.month = +mo.value; renderAll(); };
      pick.append(yr, mo);
    } else if (state.mode === 'day') {
      if (!state.day) state.day = recs.length ? recs[recs.length - 1].date : new Date().toISOString().slice(0, 10);
      const inp = document.createElement('input'); inp.type = 'date'; inp.value = state.day;
      inp.onchange = () => { state.day = inp.value; renderAll(); };
      pick.appendChild(inp);
    }
    updateViewLabel();
  }
  // 说明作用范围：这条时间筛选只管上面的图表，不影响「历史 / 时间轴」里的搜索筛选。
  // 之前两套筛选长得像、作用域却不同，看着就像互相打架。
  function updateViewLabel() {
    const lab = $('#viewLabel'); if (!lab) return;
    const v = getViewRecs();
    const scope = '<span class="tb-scope">只作用于下方图表</span>';
    if (state.mode === 'all') { lab.innerHTML = `共 ${recs.length} 条记录` + scope; return; }
    if (state.mode === 'year') { lab.innerHTML = `${state.year} 年 · ${v.length} 条` + scope; return; }
    if (state.mode === 'month') { lab.innerHTML = `${state.year}-${pad2(state.month)} · ${v.length} 条` + scope; return; }
    if (state.mode === 'day') { lab.innerHTML = `${state.day} · ${v.length ? (v.length + ' 条 · 平均心情 ' + fmt(avg(v, 'mood')) + '/5') : '无记录'}` + scope; if (v.length) { lab.style.cursor = 'pointer'; lab.title = '点击查看这一天的全部记录'; } else { lab.style.cursor = 'default'; lab.title = ''; } return; }
  }
  function setupTimebar() {
    document.querySelectorAll('#tbSeg .tb-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#tbSeg .tb-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.mode = b.dataset.mode; renderPick(); renderAll();
      });
    });
    renderPick();
  }

  /* ---------- 统计 ---------- */
  function streak() {
    const set = new Set(recs.map(r => r.date)); let n = 0; const d = new Date();
    for (let i = 0; i < 400; i++) { const k = d.toISOString().slice(0, 10); if (set.has(k)) { n++; d.setDate(d.getDate() - 1); } else break; }
    return n;
  }

  /* ---------- Hero（光球随主题变色） ---------- */
  let curView = [];
  function renderHero() {
    const v = getViewRecs(); const has = v.length; const m = has ? v[v.length - 1].mood : 3;
    const mc = moodColor(m);
    $('#orb').innerHTML = `
      <svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="og" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.95"/>
            <stop offset="60%" stop-color="var(--accent)" stop-opacity="0.42"/>
            <stop offset="100%" stop-color="var(--accent-2)" stop-opacity="0.05"/>
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="78" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.35" class="orb-ring"/>
        <circle cx="100" cy="100" r="62" fill="var(--bg-2)" fill-opacity="0.55" class="orb-core"/>
        <circle cx="100" cy="100" r="62" fill="none" stroke="${mc}" stroke-width="2.4" opacity="0.75" class="orb-core"/>
      </svg>`;
    $('#orbVal').innerHTML = `<div class="num" id="orbNum">0</div><div class="lab" style="color:${mc}">${has ? (moodBand(m) + ' · ' + m + '/5') : '无记录'}</div>`;
    animateValue($('#orbNum'), m, 1200, 0);
    $('#heroDate').textContent = !has ? '该范围内暂无记录'
      : (state.mode === 'day' ? state.day
        : state.mode === 'year' ? state.year + ' 年'
        : state.mode === 'month' ? state.year + '-' + pad2(state.month)
        : '最近记录 · ' + v[v.length - 1].date);
    $('#heroSub').textContent = !has ? '这个范围内还没有记录。'
      : (state.mode === 'all' ? (`已连续记录 ${streak()} 天 · 最近一次心情 ${m}/5`)
        : `当前区间 · ${v.length} 条记录 · 平均心情 ${fmt(avg(v, 'mood'))}/5`);

    const box = $('#todayQ'); box.innerHTML = ''; let i = 0; const cur = el('span', 'cursor');
    function tick() {
      if (i <= TODAY_Q.length) { box.textContent = TODAY_Q.slice(0, i); box.appendChild(cur); i++; setTimeout(tick, 24 + Math.random() * 28); }
      else cur.remove();
    }
    setTimeout(tick, 400);
    box.onclick = () => openModal('q0');
  }

  /* 概览胶囊。
     电脑端：数字 + 单位（信息密度高，桌面看得清）。
     手机端：同一行 4 格，不出现数字，改成 5 段「可数」的刻度 —— 亮几段就是几分，
             小数部分体现在最后一段的深浅上。一眼可比，也不用眯眼读小字。  */
  function statSegments(val, max, col) {
    const seg = 5;
    const lit = Math.max(0, Math.min(seg, (val || 0) / max * seg));
    let s = '';
    for (let i = 0; i < seg; i++) {
      const f = Math.max(0, Math.min(1, lit - i));
      s += '<i class="pv-seg" style="--f:' + f.toFixed(2) + ';--c:' + col + '"></i>';
    }
    return '<span class="pv-segs">' + s + '</span>';
  }
  function renderStats() {
    const wrap = $('#stats'); if (!wrap) return;
    wrap.innerHTML = '';
    const v = dashRecs();
    const items = [
      { v: avg(v, 'mood'), max: 5, dec: 1, k: '平均心情', suf: ' / 5', col: 'var(--accent)' },
      { v: avg(v, 'sleep'), max: 10, dec: 1, k: '平均睡眠', suf: ' h', col: 'var(--sleep)' },
      { v: avg(v, 'energy'), max: 5, dec: 1, k: '平均精力', suf: ' / 5', col: 'var(--energy)' },
      { v: avg(v, 'tension'), max: 5, dec: 1, k: '平均紧绷', suf: ' / 5', col: 'var(--tension)' }
    ];
    items.forEach((it, idx) => {
      const p = el('div', 'pill');
      p.title = it.k + ' ' + fmt(it.v) + it.suf;
      p.innerHTML = '<div class="v"><span class="num">0</span>' + it.suf + '</div>'
        + '<div class="pill-viz" aria-hidden="true">' + statSegments(it.v, it.max, it.col) + '</div>'
        + '<div class="k">' + it.k + '</div>';
      wrap.appendChild(p);
      setTimeout(() => {
        animateValue($('.num', p), it.v, 1100, it.dec);
        $$('.pv-seg', p).forEach((sg, si) => setTimeout(() => sg.classList.add('in'), si * 90));
      }, 150 + idx * 100);
    });
  }

  function renderTrend() {
    const wrap = $('#trend'); if (!wrap) return;
    const tip = $('#mapTip');
    let recs = dashRecs().slice(-30);
    // 时间升序，与「起点 → 此刻」语义一致
    recs.sort(function (a, b) { return (String(a.date) + String(a.time || '')) < (String(b.date) + String(b.time || '')) ? -1 : 1; });
    curView = recs;
    const n = recs.length;
    if (n < 2) { wrap.innerHTML = '<div class="empty">这片地形还空着，先落下第一处坐标。</div>'; const lg = $('#trendLegend'); if (lg) lg.innerHTML = ''; syncSelfToggles(); return; }
    const W = 1000, H = 560, padL = 52, padR = 28, padT = 26, padB = 44;
    const X = i => padL + (n === 1 ? 0 : i * (W - padL - padR) / (n - 1));
    const Y = m => padT + (1 - (Math.max(1, Math.min(5, m)) - 1) / 4) * (H - padT - padB);
    const pts = recs.map((r, i) => ({ x: X(i), y: Y(r.mood || 3), r }));
    let g = '';
    for (let m = 1; m <= 5; m++) { const yy = Y(m); g += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="var(--ink-faint,#64748b)" stroke-width="1" stroke-dasharray="3 5" opacity=".35"/>'; g += '<text x="' + (padL - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="var(--ink-dim,#64748b)" font-size="11">' + m + '</text>'; }
    const tcount = Math.min(7, n);
    for (let t = 0; t < tcount; t++) { const i = Math.round(t * (n - 1) / (tcount - 1)); const p = pts[i]; g += '<text x="' + p.x + '" y="' + (H - padB + 18) + '" text-anchor="middle" fill="var(--ink-dim,#64748b)" font-size="11">' + String(recs[i].date).slice(5) + '</text>'; }
    let area = 'M' + pts[0].x + ' ' + (H - padB);
    pts.forEach(p => area += ' L' + p.x + ' ' + p.y);
    area += ' L' + pts[n - 1].x + ' ' + (H - padB) + ' Z';
    let line = 'M' + pts[0].x + ' ' + pts[0].y;
    for (let i = 1; i < n; i++) line += ' L' + pts[i].x + ' ' + pts[i].y;
    let dots = '';
    pts.forEach((p, idx) => {
      const r = p.r, col = moodColor(r.mood || 3);
      dots += '<circle class="map-pt" data-i="' + idx + '" cx="' + p.x + '" cy="' + p.y + '" r="' + (r.important ? 5.5 : 3.5) + '" fill="' + col + '" stroke="var(--bg,#0b1020)" stroke-width="1.2"/>';
      if (r.important) { const lbl = escapeHtml(String(r.scene || '重要事件').slice(0, 8)); const below = p.y < 52; const ty = below ? 16 : -14; dots += '<g class="map-pin" data-i="' + idx + '" transform="translate(' + p.x + ',' + (p.y - 9) + ')"><path d="M0 0 L-4 -10 L0 -7 L4 -10 Z" fill="' + col + '"/><text x="0" y="' + ty + '" text-anchor="middle" font-size="10" fill="var(--ink-dim,#64748b)">' + lbl + '</text></g>'; }
    });
    const start = pts[0], end = pts[n - 1];
    const markers = '<circle cx="' + start.x + '" cy="' + start.y + '" r="8" fill="none" stroke="var(--accent,#5eead4)" stroke-width="1.5"/>'
      + '<text x="' + start.x + '" y="' + (start.y + 22) + '" text-anchor="middle" fill="var(--ink-dim,#64748b)" font-size="10">起点</text>'
      + '<circle cx="' + end.x + '" cy="' + end.y + '" r="8" fill="none" stroke="var(--accent,#5eead4)" stroke-width="1.5"/>'
      + '<text x="' + end.x + '" y="' + (end.y + 22) + '" text-anchor="middle" fill="var(--ink-dim,#64748b)" font-size="10">此刻</text>';
    const comp = '<g transform="translate(' + (W - 40) + ',40)"><circle r="16" fill="none" stroke="var(--ink-faint,#64748b)" stroke-width="1"/><path d="M0 -12 L4 0 L0 12 L-4 0 Z" fill="var(--accent,#5eead4)" opacity=".85"/><text x="0" y="-20" text-anchor="middle" fill="var(--ink-dim,#64748b)" font-size="9">N</text></g>';
    const svg = '<svg viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet" class="map-svg">'
      + '<defs><linearGradient id="mapFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent,#5eead4)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent,#5eead4)" stop-opacity="0"/></linearGradient>'
      + '<pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--ink-faint,#64748b)" stroke-width=".5" opacity=".4"/></pattern></defs>'
      + '<rect x="0" y="0" width="1000" height="560" fill="url(#mapGrid)"/>'
      + g
      + '<path d="' + area + '" fill="url(#mapFill)" stroke="none"/>'
      + '<path class="map-line" d="' + line + '" fill="none" stroke="var(--accent,#5eead4)" stroke-width="1.6" stroke-linejoin="round" opacity=".9"/>'
      + markers + dots + comp
      + '</svg>';
    wrap.innerHTML = svg;
    const lg = $('#trendLegend');
    if (lg) lg.innerHTML = '<span class="ml-i"><i class="ml-dot" style="background:var(--mood-low)"></i>低落</span>'
      + '<span class="ml-i"><i class="ml-dot" style="background:var(--mood-mid)"></i>平稳</span>'
      + '<span class="ml-i"><i class="ml-dot" style="background:var(--mood-high)"></i>高涨</span>'
      + '<span class="ml-i"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 L4 11 L7 8 L10 11 Z" fill="var(--accent)"/></svg>重要事件</span>'
      + '<span class="ml-i">○ 起点 → 此刻</span>';
    wrap.querySelectorAll('.map-pt,.map-pin').forEach(el => {
      const i = +el.getAttribute('data-i'); const r = recs[i]; const p = pts[i];
      el.addEventListener('mouseenter', e => showTip(r, p, e));
      el.addEventListener('mousemove', e => moveTip(e));
      el.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
      el.addEventListener('click', () => { if (typeof openRecordDetail === 'function') openRecordDetail(r.id); });
    });
    function showTip(r, p, e) {
      if (!tip) return; const d = String(r.date); const mood = r.mood != null ? r.mood : '-'; const sc = r.scene || '—'; const note = String(r.note || r.cause || '');
      tip.innerHTML = '<div class="mt-date">' + d + '</div><div class="mt-mood" style="color:' + moodColor(r.mood || 3) + '">心情 ' + mood + '/5</div>'
        + '<div class="mt-sc">' + escapeHtml(sc) + '</div>' + (note ? '<div class="mt-note">' + escapeHtml(note.slice(0, 60)) + '</div>' : '');
      tip.hidden = false; moveTip(e);
    }
    function moveTip(e) {
      if (!tip) return; const rw = wrap.getBoundingClientRect();
      let xx = e.clientX - rw.left + 12, yy = e.clientY - rw.top + 12;
      if (xx + 180 > rw.width) xx = xx - 200; if (yy + 90 > rw.height) yy = yy - 100;
      tip.style.left = xx + 'px'; tip.style.top = yy + 'px';
    }
    syncSelfToggles();
  }

  function renderHeat() {
    const weeks = 13, days = weeks * 7;
    const v = dashRecs();
    const map = {}; v.forEach(r => map[r.date] = r);
    const end = new Date();
    const start = new Date(end); start.setDate(start.getDate() - (days - 1));
    const grid = $('#heat'); grid.innerHTML = '';
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = isoLocal(d); const r = map[k];
      const cell = el('div', 'cell');
      if (r) { cell.style.background = moodColor(r.mood); cell.style.opacity = 0.28 + r.mood * 0.14; cell.title = `${k} · 心情 ${r.mood}`; }
      grid.appendChild(cell);
    }
    $('#heatMonths').textContent = isoLocal(start).slice(5) + ' → ' + isoLocal(end).slice(5);
  }

  function renderTags() {
    const v = dashRecs();
    const cnt = {}, byAuthor = {};
    v.forEach(r => {
      const a = authorKey(r);
      (r.tags || []).forEach(t => {
        cnt[t] = (cnt[t] || 0) + 1;
        byAuthor[t] = byAuthor[t] || {};
        byAuthor[t][a] = (byAuthor[t][a] || 0) + 1;
      });
    });
    let arr = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const wrap = $('#tags'); wrap.innerHTML = '';
    if (!arr.length) { wrap.innerHTML = '<div class="empty" style="padding:18px">暂无标签</div>'; return; }
    const max = arr[0][1];
    const authors = authorList();
    const multi = authors.length > 1 && !state.trendSelf;
    const me = ghNick() || '未署名';
    const mainOf = t => Object.entries(byAuthor[t] || {}).sort((x, y) => y[1] - x[1])[0];
    // “我们”模式下：把「我」作为主要记录人的标签排前面，再按次数排；chip 加作者色小点
    if (multi) {
      arr.sort((a, b) => {
        const ma = mainOf(a[0]), mb = mainOf(b[0]);
        const aIsMe = ma && ma[0] === me;
        const bIsMe = mb && mb[0] === me;
        if (aIsMe !== bIsMe) return aIsMe ? -1 : 1;
        return b[1] - a[1];
      });
    }
    arr.forEach(([name, c], i) => {
      // 改成真正的 button：可点、可聚焦、可键盘操作；点了直接跳到历史并筛出这个标签
      const chip = el('button', 'chip' + (state.histTag === name ? ' on' : ''));
      chip.type = 'button';
      chip.dataset.tag = name;
      chip.title = '查看「' + name + '」下的全部记录（共 ' + c + ' 条）';
      let dot = '';
      if (multi) {
        const main = mainOf(name);
        if (main) dot = '<i class="au" style="background:' + authorColor(main[0]) + '" title="主要记录人：' + escapeHtml(main[0]) + '"></i>';
      }
      chip.innerHTML = dot + '<span>' + escapeHtml(name) + '</span><span class="n">' + c + '</span>';
      // 不再用 translateY 做入场：任何 transform 都可能和点击热区打架，这里只用透明度
      chip.style.opacity = 0;
      chip.addEventListener('click', () => jumpToTag(name));
      wrap.appendChild(chip);
      setTimeout(() => { chip.style.transition = 'opacity .45s'; chip.style.opacity = 0.66 + (c / max) * 0.34; }, 120 + i * 60);
    });
  }

  function renderSleep() {
    const box = $('#sleep'); if (!box) return;
    let v = recs, label = '日均', target = 8;
    const now = new Date();
    if (state.sleepPeriod === 'month') { const cut = new Date(now); cut.setDate(cut.getDate() - 30); v = recs.filter(r => new Date(r.date) >= cut); label = '月均'; }
    else if (state.sleepPeriod === 'year') { const cut = new Date(now); cut.setFullYear(cut.getFullYear() - 1); v = recs.filter(r => new Date(r.date) >= cut); label = '年均'; }
    else if (state.sleepPeriod === 'custom' && state.sleepRange.start) {
      const s = state.sleepRange.start, e = state.sleepRange.end || s;
      v = recs.filter(r => r.date >= s && r.date <= e); label = '区间';
    }
    const val = avg(v, 'sleep'); const pct = Math.min(1, val / target);
    const R = 52, C = 2 * Math.PI * R;
    const col = val >= 7 ? 'var(--accent)' : val >= 6 ? 'var(--warn)' : 'var(--bad)';
    box.innerHTML = `
      <svg viewBox="0 0 140 140" style="width:100%;max-width:170px">
        <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
        <circle class="draw" cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="12"
          stroke-linecap="round" transform="rotate(-90 70 70)" style="stroke-dasharray:${C};stroke-dashoffset:${C}"/>
        <text x="70" y="66" text-anchor="middle" fill="var(--ink)" font-size="26" font-family="JetBrains Mono, monospace" font-weight="700">${fmt(val)}</text>
        <text x="70" y="88" text-anchor="middle" fill="var(--ink-dim)" font-size="11">小时 / ${label}</text>
      </svg>`;
    const arc = box.querySelector('.draw');
    requestAnimationFrame(() => requestAnimationFrame(() => { if (arc) arc.style.strokeDashoffset = C * (1 - pct); }));
  }
  function setSleepPeriod(p) {
    state.sleepPeriod = p;
    const wrap = $('#sleepPeriod'); if (wrap) wrap.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === p));
    const cr = $('#sleepCustom'); if (cr) cr.style.display = (p === 'custom') ? '' : 'none';
    renderSleep();
  }

  function renderScatter() {
    const v = dashRecs();
    const W = 240, H = 200, pad = 26;
    const x = vx => pad + (W - 2 * pad) * ((vx - 1) / 4);
    const y = vy => H - pad - (H - 2 * pad) * ((vy - 1) / 4);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
    svg += `<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--line)"/>`;
    svg += `<line x1="${pad}" y1="${H - pad}" x2="${pad}" y2="${pad}" stroke="var(--line)"/>`;
    svg += `<text x="${W - pad}" y="${H - 8}" fill="var(--ink-dim)" font-size="10" text-anchor="end">精力 →</text>`;
    svg += `<text x="${pad + 4}" y="${pad - 8}" fill="var(--ink-dim)" font-size="10">紧绷 ↑</text>`;
    v.forEach(r => {
      const cx = x(r.energy || 3), cy = y(r.tension || 3);
      svg += `<circle cx="${cx}" cy="${cy}" r="6" fill="${moodColor(r.mood)}" opacity="0.7" style="transition:r .2s"><title>${r.date} · 精力${r.energy}/紧绷${r.tension}</title></circle>`;
    });
    svg += `</svg>`;
    $('#scatter').innerHTML = svg;
  }

  function renderPeaks() {
    const v = dashRecs();
    if (!v.length) { $('#peaks').innerHTML = ''; return; }
    const best = v.reduce((a, b) => (b.mood > a.mood ? b : a));
    const worst = v.reduce((a, b) => (b.mood < a.mood ? b : a));
    $('#peaks').innerHTML = `
      <div class="peak"><div class="t">最高光</div><div class="d">${best.date} · 心情 ${best.mood}</div><div class="n">${(best.note || '').slice(0, 30) || '—'}</div></div>
      <div class="peak"><div class="t">最低谷</div><div class="d">${worst.date} · 心情 ${worst.mood}</div><div class="n">${(worst.note || '').slice(0, 30) || '—'}</div></div>`;
  }

  /* ---------- 上下文联动提问 ---------- */
  function trendQuestion() {
    const v = getViewRecs(); if (v.length < 3) return null;
    const dims = [['mood', '心情'], ['energy', '精力'], ['sleep', '睡眠'], ['tension', '紧绷']];
    let worst = null, best = 1e9;
    dims.forEach(([k, name]) => { const a = avg(v, k); if (a && a < best) { best = a; worst = { k, name, a }; } });
    if (!worst) return null;
    const map = {
      mood: '最近心情整体偏低，是同一件事在反复拉低它，还是好几件叠在一起？',
      energy: '这阵子精力普遍不高，通常在一天里哪个时段最累？',
      sleep: '睡眠天数偏少，是睡得晚，还是夜里容易醒？',
      tension: '紧绷感偏高，身体哪个部位最先绷紧？当时在想什么？'
    };
    return { q: map[worst.k] || `你最近的${worst.name}偏低（约 ${fmt(worst.a)}），今天多留意一下它。`, hints: ['不用马上解决，先观察。', '方便的话，记下来当时在做什么、和谁在一起。'] };
  }
  function qaStore() { try { return JSON.parse(localStorage.getItem('mood.qa') || '{}'); } catch (e) { return {}; } }
  function qaSave(o) { localStorage.setItem('mood.qa', JSON.stringify(o)); }
  let QA_MAP = {};
  function buildQA() {
    const grid = $('#qaList'); grid.innerHTML = ''; QA_MAP = {};
    const items = [];
    (NEXT_Q || []).forEach((q, i) => {
      const o = (typeof q === 'string') ? { q, hint: '' } : q;
      items.push({ id: 'n' + i, text: o.q, hints: ((o.hint || '').split('\n').filter(Boolean)).concat(['这条根据之前的回答生成，回答案后会成为下一天的素材。']), tag: '上下文联动' });
    });
    const tq = trendQuestion(); if (tq) items.push({ id: 'trend', text: tq.q, hints: tq.hints, tag: '数据观察' });
    EXTRA_Q.forEach((t, i) => items.push({ id: 'q' + i, text: t, hints: ['随便写，不用有逻辑。', '也可以只写一两个词。'], tag: '自由反思' }));
    items.push({ id: 'free', text: '自由记录 · 用语音或文字，把此刻任何念头倒出来', hints: [], tag: '随手记', free: true });

    const store = qaStore();
    items.forEach((it, idx) => {
      QA_MAP[it.id] = it;
      const done = !!store[it.id];
      const card = el('div', 'qa-item' + (done ? ' done' : ''));
      card.style.opacity = 0; card.style.transform = 'translateY(20px)';
      card.innerHTML = `
        <div class="qmark">${idx + 1}</div>
        <div class="qbody"><span class="qtag">${it.tag}</span><div class="qtext">${it.text}</div><div class="qhint">点开${it.free ? '记录' : '写下你的回答'} →</div></div>
        <div class="badge">已答 ✓</div>`;
      card.addEventListener('click', () => openModal(it.id));
      grid.appendChild(card);
      setTimeout(() => { card.style.transition = 'opacity .6s, transform .6s'; card.style.opacity = 1; card.style.transform = 'none'; }, 100 + idx * 90);
    });
  }

  let curQid = null;
  function openModal(id) {
    curQid = id;
    const it = QA_MAP[id] || { text: TODAY_Q, hints: [], free: false };
    $('#mQ').textContent = it.text || '';
    const ph = $('#mPrompts');
    if (it.free || !it.hints || !it.hints.length) { ph.style.display = 'none'; }
    else { ph.style.display = 'block'; ph.textContent = it.hints.join(' · '); }
    $('#mInput').value = qaStore()[id] || '';
    $('#mInput').placeholder = it.free ? '想到什么说什么…' : '想到什么写什么，不用命名情绪。';
    $('#mSaved').classList.remove('show');
    $('#qModal').classList.add('show'); $('#scrim').classList.add('show');
  }
  function closeModal() {
    const txt = $('#mInput').value.trim();
    if (txt && curQid) {
      const store = qaStore(); store[curQid] = txt; qaSave(store);
      const qtext = $('#mQ').textContent;
      const nq = NEXT_Q.find(x => x.q === qtext);
      if (nq) { nq.answer = txt; saveData(); }
    }
    $('#qModal').classList.remove('show'); $('#scrim').classList.remove('show');
  }
  function deployAnswerToMap() {
    const txt = $('#mInput').value.trim();
    if (!txt) { $('#mInput').focus(); return; }
    const q = $('#mQ').textContent || '自由记录';
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8);
    const rec = {
      id: genId(), // 没有 id 的记录只能靠内容指纹去重，跨设备容易重复或误合，这里补上
      date: date,
      time: time,
      mood: 3,
      energy: null, tension: null, sleep: null,
      scene: '反思作答',
      tags: ['反思作答'],
      body: [], behavior: [],
      note: q + '\n' + txt,
      cause: '',
      important: true,
      _device: DEVICE
    };
    if (ghProfile() === 'shared') {
      const nick = ghNick();
      if (nick) rec.author = nick;
    }
    DATA.records.push(rec);
    DATA.records.sort((a, b) => a.date < b.date ? -1 : 1);
    saveData();
    if (curQid) {
      const store = qaStore(); store[curQid] = txt; qaSave(store);
      const nq = NEXT_Q.find(x => x.q === q);
      if (nq) { nq.answer = txt; saveData(); }
    }
    const c = ghConf();
    if (c.enabled && c.token && c.auto) ghSync(null, false);
    const sv = $('#mSaved');
    sv.textContent = '已落到地图上，可在时间轴高亮回看' + (c.enabled && c.token ? '，正在后台同步…' : '');
    sv.classList.add('show');
    setTimeout(() => { closeModal(); location.reload(); }, 800);
  }
  function bindModal() {
    $('#mClose').addEventListener('click', closeModal);
    $('#scrim').addEventListener('click', closeModal);
    $('#mDeploy').addEventListener('click', deployAnswerToMap);
  }

  /* ---------- 随手写：边写边自动建议（DeepSeek 单次提取，可选采用） ---------- */
  let liveTimer = null;
  function liveSuggest() {
    const ta = $('#recFree'); if (!ta) return;
    const txt = ta.value.trim();
    const box = $('#recSuggest'); if (!box) return;
    if (txt.length < 8) { box.style.display = 'none'; box.innerHTML = ''; return; }
    if (!dsKey()) { box.style.display = 'block'; box.innerHTML = '<div class="rec-free-hint">填了 DeepSeek Key 后，这里会边写边自动给出结构化建议。</div>'; return; }
    box.style.display = 'block';
    box.innerHTML = '<div class="rec-free-hint">AI 正在理解你的文字…</div>';
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      try {
        const sys = '你是情绪记录助手。把用户的口语描述整理成结构化字段。只输出一个 JSON 对象，不要任何额外文字：\n'
          + '{"fields":{"mood":整数1-5,"energy":整数1-5或null,"tension":整数1-5或null,"sleep":数字或null,"scene":字符串,"tags":[2-4字短标签],"body":[身体信号],"behavior":[行为],"note":"整理后当下想法1-2句","cause":""},"summary":"一句话复述你对他状态的理解（让他确认）"}';
        const res = await callDeepSeek(sys, txt, { task: 'suggest', json: true });
        const obj = parseExtract(res.text);
        if (!obj || !obj.fields) { box.innerHTML = '<div class="rec-free-hint">暂时没读懂，你可以继续写，或直接手填下面的字段。</div>'; return; }
        const f = obj.fields, parts = [];
        if (f.mood) parts.push('心情 ' + f.mood + '/5');
        if (f.energy) parts.push('精力 ' + f.energy);
        if (f.tension) parts.push('紧绷 ' + f.tension);
        if (f.sleep) parts.push('睡眠 ' + f.sleep + 'h');
        if (f.scene) parts.push('场景：' + f.scene);
        if (f.tags && f.tags.length) parts.push('标签：' + f.tags.join('/'));
        box.innerHTML = '<div class="xsug">'
          + '<span class="xsug-t">AI 建议</span>'
          + (obj.summary ? '<div class="xsug-s">' + escapeHtml(obj.summary) + '</div>' : '')
          + (parts.length ? '<div class="xsug-f">' + escapeHtml(parts.join(' · ')) + '</div>' : '')
          + '<button class="btn sm" id="recAdopt" type="button">采用并填入</button></div>';
        const adopt = $('#recAdopt');
        if (adopt) adopt.addEventListener('click', () => {
          fillRecordForm(f, f.note || txt);
          box.innerHTML = '<div class="rec-free-hint">已填入下面的字段，你可以直接修改或补充，再点「保存并同步」。</div>';
        });
      } catch (e) {
        box.innerHTML = '<div class="rec-free-hint">建议生成失败（' + escapeHtml((e && e.message) || e) + '），可继续写或手动填。</div>';
      }
    }, 1200);
  }

  /* ---------- 记一笔（网页内直接录入，可写回文件） ---------- */
  function saveDraft(rec) {
    try {
      const d = JSON.parse(localStorage.getItem('mood.drafts') || '[]');
      d.push(rec); localStorage.setItem('mood.drafts', JSON.stringify(d));
    } catch (e) { /* ignore */ }
  }
  function submitRecord() {
    const f = id => $('#' + id).value.trim();
    const rec = {
      id: state.editingId || genId(),
      date: f('recDate') || new Date().toISOString().slice(0, 10),
      time: f('recTime') || new Date().toTimeString().slice(0, 8),
      mood: +($('#recMood').dataset.val || 3),
      energy: f('recEnergy') ? +f('recEnergy') : null,
      tension: f('recTension') ? +f('recTension') : null,
      sleep: f('recSleep') ? +f('recSleep') : null,
      scene: f('recScene'),
      tags: f('recTags') ? f('recTags').split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
      body: f('recBody') ? f('recBody').split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
      behavior: f('recBehavior') ? f('recBehavior').split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
      note: f('recNote'),
      cause: f('recCause'),
      important: $('#recImportant') ? $('#recImportant').checked : false,
      _device: DEVICE
    };
    if (ghProfile() === 'shared') {
      const nick = ghNick();
      if (nick) rec.author = nick;
    }
    const sv = $('#recSaved');
    const SERVE = 'http://127.0.0.1:' + PORT + '/';
    const finishLocal = () => {
      if (state.editingId) { updateRecord(state.editingId, rec); }
      else { DATA.records.push(rec); DATA.records.sort((a, b) => a.date < b.date ? -1 : 1); refreshRecs(); }
      saveData();
      try { localStorage.setItem('mood.lastRecordDate', rec.date); } catch(e){}
      const c = ghConf();
      sv.innerHTML = (c.enabled && c.token)
        ? ('✓ 已保存' + (c.auto ? '，正在同步到云端…' : '。可在「设置」点「立即同步」上传到云端。'))
        : '✓ 已保存。建议点「设置」启用 GitHub 云同步，手机电脑即可共用一份数据。';
      sv.classList.add('show');
      // 以前是「发起同步 + 900ms 后强制刷新」，同步一般要 1 秒以上，
      // 刷新会把还在飞的请求打断，于是这条要等下次操作才真正上云。改成等同步跑完再刷新。
      if (c.enabled && c.token && c.auto) {
        let done = false;
        const go = () => { if (done) return; done = true; location.reload(); };
        setTimeout(go, 8000); // 兜底：网络太慢也不能一直卡着不刷新
        ghSync(null, false).then(function () {
          sv.innerHTML = '✓ 已保存，并已同步到云端。';
          setTimeout(go, 500);
        }).catch(function () { setTimeout(go, 500); });
      } else {
        setTimeout(() => location.reload(), 900);
      }
    };
    if (API_OK) {
      fetch(API_BASE + '/api/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec)
      }).then(r => r.json()).then(j => {
        if (j && j.ok) { sv.textContent = '✓ 已同步写回文件，看板已更新'; sv.classList.add('show'); setTimeout(() => location.reload(), 900); }
        else throw 0;
      }).catch(() => finishLocal());
    } else {
      finishLocal();
    }
  }
  function updateRecord(id, rec) {
    const merged = Object.assign({}, (DATA.records || []).find(r => r.id === id) || {}, rec, { id: id });
    // 两个数组都要更新：recs 是 UI 用的副本，DATA.records 才是存进 localStorage / 推上云的那份。
    // 以前只改了 recs，结果编辑完一刷新就变回旧内容，云端也拿不到修改。
    const di = (DATA.records || []).findIndex(r => r.id === id);
    if (di >= 0) DATA.records[di] = merged; else DATA.records.push(merged);
    const i = recs.findIndex(r => r.id === id);
    if (i >= 0) recs[i] = merged; else recs.push(merged);
    saveData();
    if (ghConf().auto) ghSync(null, false);
  }
  async function deleteRecord(id) {
    const r = recs.find(x => x.id === id) || (DATA.records || []).find(x => x.id === id);
    if (!r) return;
    // 本地移除
    const i = recs.findIndex(x => x.id === id); if (i >= 0) recs.splice(i, 1);
    const di = DATA.records.findIndex(x => x.id === id); if (di >= 0) DATA.records.splice(di, 1);
    // 墓碑：让主文件的删除能跨设备 / 下次同步传播，不再被云端旧版本"复活"
    DATA.deleted = DATA.deleted || [];
    DATA.deleted = DATA.deleted.filter(t => t.id !== id);
    DATA.deleted.push({ id: id, fp: recFingerprint(r), at: Date.now() });
    DATA.revived = (DATA.revived || []).filter(t => t.id !== id); // 之前恢复过的话，这次删除要盖过它
    // 软删除：移入回收站（收集"不愿面对的"），可在回收站恢复或彻底删除
    DATA.trash = DATA.trash || [];
    DATA.trashPurged = (DATA.trashPurged || []).filter(t => t.id !== id); // 重新进回收站，清掉"已离开"标记
    if (!DATA.trash.some(t => t.id === id)) DATA.trash.push(Object.assign({}, r, { delAt: Date.now() }));
    saveData();
    const c = ghConf();
    if (c.auto) {
      await syncTrash().catch(function () {});        // 先把回收站存住，再改主文件，中途断网也不会把记录弄丢
      await ghSync(null, false).catch(function () {});
    }
  }
  // 在回收站里定位记录：先按 id 精确匹配，匹配不到（老数据 id 缺失/错位）再按内容指纹兜底，避免静默删不掉
  function findTrashIndex(id) {
    const arr = DATA.trash || [];
    let i = arr.findIndex(r => r && r.id === id);
    if (i >= 0) return i;
    if (id && String(id).indexOf('fp_') === 0) {
      const fp = String(id).slice(3);
      i = arr.findIndex(r => r && recFingerprint(r) === fp);
      if (i >= 0) return i;
    }
    return arr.findIndex(r => r && ('fp_' + recFingerprint(r)) === id);
  }
  async function restoreFromTrash(id) {
    const i = findTrashIndex(id);
    if (i < 0) return;
    const r = Object.assign({}, DATA.trash[i]);
    delete r.delAt;
    DATA.trash.splice(i, 1);
    DATA.trashPurged = mergeMarks(DATA.trashPurged, [{ id: id, at: Date.now() }]); // 让别的设备的回收站也移除它
    DATA.deleted = (DATA.deleted || []).filter(t => t.id !== id);                  // 撤销本地墓碑
    DATA.revived = mergeMarks(DATA.revived, [{ id: id, at: Date.now() }]);         // 并压过云端还留着的那份墓碑
    if (!DATA.records.some(x => x.id === id)) DATA.records.push(r);
    DATA.records.sort((a, b) => a.date < b.date ? -1 : 1);
    saveData();
    refreshRecs();
    const c = ghConf();
    if (c.enabled && c.token && c.user && c.repo) {
      await syncTrash();             // 先把"已离开回收站"的标记推上去：别的设备立刻不再显示它，避免主文件恢复后还残留在对方回收站
      await ghSync(null, false);     // 再把它放回主文件
    }
  }
  async function purgeFromTrash(id) {
    const i = findTrashIndex(id);
    if (i < 0) return;
    DATA.trash.splice(i, 1);
    // 记一笔"已彻底删除"，否则下次和云端一合并，这条又被拉回回收站，看起来像删不掉
    DATA.trashPurged = mergeMarks(DATA.trashPurged, [{ id: id, at: Date.now() }]);
    saveData();
    const c = ghConf();
    if (c.enabled && c.token && c.user && c.repo) await syncTrash();
  }
  async function purgeAllTrash() {
    const marks = (DATA.trash || []).map(function (r) { return { id: r.id, at: Date.now() }; });
    DATA.trash = [];
    DATA.trashPurged = mergeMarks(DATA.trashPurged, marks);
    saveData();
    const c = ghConf();
    if (c.enabled && c.token && c.user && c.repo) await syncTrash();
  }
  function openRecordDetail(id) {
    const r = recs.find(x => x.id === id); if (!r) return;
    state.editingId = id;
    const md = $('#recModal'); if (!md) return;
    const tag = md.querySelector('.mtag'); if (tag) tag.textContent = '编辑记录';
    const h3 = md.querySelector('h3'); if (h3) h3.textContent = '修改这条记录';
    const sv = $('#recSave'); if (sv) sv.textContent = '保存修改';
    const del = $('#recDelete'); if (del) del.style.display = '';
    const tip = $('#recTip'); if (tip) tip.style.display = 'none';
    const fr = $('#recFree'); if (fr) fr.value = '';
    const sg = $('#recSuggest'); if (sg) { sg.style.display = 'none'; sg.innerHTML = ''; }
    const imp = $('#recImportant'); if (imp) imp.checked = !!r.important;
    fillRecordForm(r);
    md.classList.add('show'); $('#scrim').classList.add('show');
  }
  function pickDayRecords(ids, dateLabel) {
    if (!ids || !ids.length) return;
    if (ids.length === 1) { openRecordDetail(ids[0]); return; }
    const list = $('#dayPickList'); if (!list) { openRecordDetail(ids[0]); return; }
    list.innerHTML = '';
    ids.forEach(function (id) {
      const r = recs.find(x => x.id === id); if (!r) return;
      const mc = moodColor(r.mood || 3);
      const item = el('div', 'daypick-item');
      const dtxt = (r.time ? r.time.slice(0, 5) : '未记时间');
      const note = String(r.note || '').slice(0, 80);
      item.innerHTML =
        '<div class="dp-mood" style="color:' + mc + '">' + (r.mood || '-') + '/5</div>' +
        '<div class="dp-body">' +
          '<div class="dp-time">' + dtxt + (r.author ? ' · 来自 ' + escapeHtml(r.author) : '') + (r.important ? ' · 重要事件' : '') + '</div>' +
          (r.scene ? '<div class="dp-scene">' + escapeHtml(r.scene) + '</div>' : '') +
          (note ? '<div class="dp-note">' + escapeHtml(note) + '</div>' : '') +
        '</div>';
      item.addEventListener('click', function () {
        $('#dayPickModal').classList.remove('show'); $('#scrim').classList.remove('show');
        openRecordDetail(id);
      });
      list.appendChild(item);
    });
    const t = $('#dayPickTitle'); if (t) t.textContent = (dateLabel || '这一天') + ' 有 ' + ids.length + ' 条记录，点开看详情';
    $('#dayPickModal').classList.add('show'); $('#scrim').classList.add('show');
  }
  function openRecModal() {
    state.editingId = null;
    const md = $('#recModal');
    const tag = md && md.querySelector('.mtag'); if (tag) tag.textContent = '记一笔';
    const h3 = md && md.querySelector('h3'); if (h3) h3.textContent = '今天的状态，随手记下';
    const sv = $('#recSave'); if (sv) sv.textContent = '落到地图';
    const del = $('#recDelete'); if (del) del.style.display = 'none';
    $('#recDate').value = new Date().toISOString().slice(0, 10);
    $('#recTime').value = new Date().toTimeString().slice(0, 8);
    const tip = $('#recTip'); if (tip) { tip.style.display = 'none'; tip.classList.remove('show'); }
    const fr = $('#recFree'); if (fr) fr.value = '';
    const imp = $('#recImportant'); if (imp) imp.checked = false;
    const sg = $('#recSuggest'); if (sg) { sg.style.display = 'none'; sg.innerHTML = ''; }
    $('#recModal').classList.add('show'); $('#scrim').classList.add('show');
  }
  function bindRecordModal() {
    on('#recBtn', 'click', openRecModal);
    on('#recFab', 'click', openRecModal);
    $('#recClose').addEventListener('click', () => { $('#recModal').classList.remove('show'); $('#scrim').classList.remove('show'); });
    on('#dayPickClose', 'click', () => { const m = $('#dayPickModal'); if (m) m.classList.remove('show'); $('#scrim').classList.remove('show'); });
    document.querySelectorAll('#recMood button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#recMood button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); $('#recMood').dataset.val = b.dataset.m;
    }));
    $('#recSave').addEventListener('click', submitRecord);
    $('#recFree').addEventListener('input', liveSuggest);

    /* 标签预设：点选即填入「标签」框，再点取消 */
    const tagsInput = $('#recTags');
    const presets = el('div', 'tag-presets', '');
    TAG_PRESETS.forEach(t => {
      const chip = el('button', 'tag-chip', t);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        const cur = (tagsInput.value.split(/[,，]/).map(s => s.trim()).filter(Boolean));
        const i = cur.indexOf(t);
        if (i >= 0) cur.splice(i, 1); else cur.push(t);
        tagsInput.value = cur.join(', ');
        chip.classList.toggle('on', i < 0);
      });
      presets.appendChild(chip);
    });
    tagsInput.insertAdjacentElement('afterend', presets);
    // 手动输入时，让已选预设高亮状态与输入框同步
    tagsInput.addEventListener('input', () => {
      const cur = new Set(tagsInput.value.split(/[,，]/).map(s => s.trim()).filter(Boolean));
      presets.querySelectorAll('.tag-chip').forEach(c => c.classList.toggle('on', cur.has(c.textContent)));
    });
    const delBtn = $('#recDelete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!state.editingId) return;
      const ok = await appConfirm('移入回收站？之后可在「回收站」里恢复，或彻底删除。', '移入回收站');
      if (!ok) return;
      await deleteRecord(state.editingId);
      const md = $('#recModal'); if (md) md.classList.remove('show');
      $('#scrim').classList.remove('show');
      renderAll();
      location.reload();
    });
  }

  /* ---------- 空状态 ---------- */
  function renderEmpty() {
    const w = $('#bento'); w.innerHTML = '';
    const c = el('div', 'empty reveal in',
      '<div class="big">记录第一天</div><div class="sm">点右上角「<b style="color:var(--accent)">记一笔</b>」开始记录。数据会保存在你配置的 GitHub 仓库，手机与电脑同步。</div>');
    w.appendChild(c);
  }

  /* ---------- 交互绑定 ---------- */
  function bindInteractions() {
    const panel = $('#themePanel');
    $('#themeBtn').addEventListener('click', () => { panel.classList.toggle('show'); $('#scrim').classList.toggle('show'); });
    $('#scrim').addEventListener('click', () => { panel.classList.remove('show'); closeModal(); closeHistory(); closeTimeline(); $('#extractModal').classList.remove('show'); $('#dayPickModal').classList.remove('show'); });
    $('#viewLabel').addEventListener('click', () => { if (state.mode === 'day') { const ids = recs.filter(r => r.date === state.day).map(r => r.id); if (ids.length) pickDayRecords(ids, state.day); } });

    /* ---------- 设置：DeepSeek / 云同步与备份 ---------- */
    $('#setBtn').addEventListener('click', () => {
      const lm = localStorage.getItem('mood.dsModel');
      if (lm === 'deepseek-chat' || lm === 'deepseek-reasoner') localStorage.setItem('mood.dsModel', dsModel()); // 退役模型自动迁移
      $('#dsKey').value = dsKey(); $('#dsModel').value = dsModel(); updateDsKeyHint();
      const route = dsRouteMode();
      $('#dsRoute').value = route;
      const manual = route === 'manual';
      $('#dsModel').disabled = !manual;
      $('#dsModel').style.opacity = manual ? '1' : '0.5';
      loadGh();
      $('#setModal').classList.add('show'); $('#scrim').classList.add('show');
      renderSetVer();
    });
    $('#setClose').addEventListener('click', () => { $('#setModal').classList.remove('show'); $('#scrim').classList.remove('show'); });
    $('#dsKey').addEventListener('input', e => {
      let v = e.target.value.trim();
      if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, ''); // 自动剥掉误粘的 Bearer 前缀
      localStorage.setItem('mood.dsKey', v);
      if (e.target.value !== v) e.target.value = v; // 回写清洗后的值，让用户看到
      updateDsKeyHint();
    });
    $('#dsModel').addEventListener('change', e => localStorage.setItem('mood.dsModel', e.target.value));
    $('#dsRoute').addEventListener('change', e => {
      localStorage.setItem('mood.dsRoute', e.target.value);
      const manual = e.target.value === 'manual';
      $('#dsModel').disabled = !manual;
      $('#dsModel').style.opacity = manual ? '1' : '0.5';
    });
    $('#dsTest').addEventListener('click', async () => {
      const sm = $('#setMsg');
      const r = validateDsKey(dsKey());
      if (!r.ok) { sm.textContent = '✗ ' + r.msg; return; }
      sm.textContent = '连接测试中…';
      try { await callDeepSeek('你是测试助手，只回复「ok」', 'hi', { task: 'chat' }); sm.textContent = '✓ DeepSeek 连接成功'; }
      catch (e) { sm.textContent = '✗ 连接失败：' + (e && e.message ? e.message : e); }
    });
    // 密码框显示/隐藏眼睛
    const dsEye = $('#dsKeyEye');
    if (dsEye) dsEye.addEventListener('click', () => {
      const inp = $('#dsKey'); const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      dsEye.textContent = show ? '🙈' : '👁';
      dsEye.title = show ? '隐藏 Key' : '显示 Key';
    });
    // GitHub 令牌框的眼睛（复用同一套逻辑）
    const ghEye = $('#ghTokenEye');
    if (ghEye) ghEye.addEventListener('click', () => {
      const inp = $('#ghToken'); const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      ghEye.textContent = show ? '🙈' : '👁';
      ghEye.title = show ? '隐藏令牌' : '显示令牌';
    });
    $('#setExport').addEventListener('click', exportData);
    $('#setImportBtn').addEventListener('click', () => $('#setImport').click());
    $('#setImport').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });

    /* ---------- GitHub 云同步：双档案（个人 / 共享） ---------- */
    $('#ghSeg').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      localStorage.setItem('mood.ghProfile', b.dataset.profile); loadGh();
    }));
    $('#ghUser').addEventListener('input', e => localStorage.setItem('mood.ghUser' + ghSuffix(), e.target.value.trim()));
    $('#ghRepo').addEventListener('input', e => localStorage.setItem('mood.ghRepo' + ghSuffix(), e.target.value.trim()));
    $('#ghToken').addEventListener('input', e => { localStorage.setItem('mood.ghToken' + ghSuffix(), e.target.value.trim()); if (typeof updateGhTokenHint === 'function') updateGhTokenHint(); });
    $('#ghEnable').addEventListener('change', e => localStorage.setItem('mood.ghEnabled' + ghSuffix(), e.target.checked ? '1' : '0'));
    $('#ghAuto').addEventListener('change', e => localStorage.setItem('mood.ghAuto' + ghSuffix(), e.target.checked ? '1' : '0'));
    $('#ghNick').addEventListener('input', e => localStorage.setItem('mood.ghNick' + ghSuffix(), e.target.value.trim()));
    // 明确的「保存设置」按钮：把四个字段整体强制覆盖写回，保证改错/误贴的密钥被彻底替换，并弹「已保存」确认
    function saveGhSettings() {
      const p = ghSuffix();
      const token = $('#ghToken').value.trim();
      // 一并把 DeepSeek 钥匙 / 模型 / 路由落盘：这个按钮名为「保存设置」，理应保存全部设置，
      // 而不是只存 GitHub 部分（之前钥匙只靠输入时实时存，用户点了保存却没存到钥匙，造成“保存后又变回旧值”的错觉）
      const dsk = $('#dsKey'); if (dsk) localStorage.setItem('mood.dsKey', dsk.value.trim());
      const dsm = $('#dsModel'); if (dsm) localStorage.setItem('mood.dsModel', dsm.value);
      const dsr = $('#dsRoute'); if (dsr) localStorage.setItem('mood.dsRoute', dsr.value);
      localStorage.setItem('mood.ghUser' + p, $('#ghUser').value.trim());
      localStorage.setItem('mood.ghRepo' + p, $('#ghRepo').value.trim() || (ghProfile() === 'shared' ? 'mood-atlas-shared' : 'mood-atlas-sync'));
      localStorage.setItem('mood.ghToken' + p, token);
      localStorage.setItem('mood.ghEnabled' + p, $('#ghEnable').checked ? '1' : '0');
      localStorage.setItem('mood.ghAuto' + p, $('#ghAuto').checked ? '1' : '0');
      localStorage.setItem('mood.ghNick' + p, $('#ghNick').value.trim());
      localStorage.setItem('mood.aiRecord', $('#aiRecordAuto').checked ? 'on' : 'off');
      if (typeof updateDsKeyHint === 'function') updateDsKeyHint();
      if (typeof updateGhTokenHint === 'function') updateGhTokenHint();
      if (typeof renderSetVer === 'function') renderSetVer();
      const r = validateGhToken(token);
      if (r.ok) ghTestAlert(true, '已保存', '设置已保存（含 DeepSeek Key 与 GitHub 同步）。可以点「测试连接」验证，或记一条触发自动同步。');
      else ghTestAlert(false, '已保存（令牌待验证）', '设置已保存，但 GitHub 令牌格式看起来不太对：' + r.msg + ' 请检查后再点「测试连接」确认。');
    }
    $('#setSave').addEventListener('click', saveGhSettings);
    // GitHub 测试连接：成功 / 失败都弹窗（独立浮层，叠加在设置面板之上），同时保留行内状态文字
    function ghTestAlert(ok, title, body) {
      const m = $('#ghTestModal'), s = $('#ghTestScrim');
      $('#ghTestTitle').textContent = title;
      $('#ghTestBody').textContent = body;
      $('#ghTestIco').textContent = ok ? '✓' : '✕';
      m.classList.toggle('ok', ok);
      m.classList.toggle('err', !ok);
      m.classList.add('show'); s.classList.add('show');
    }
    const ghTestClose = () => { $('#ghTestModal').classList.remove('show'); $('#ghTestScrim').classList.remove('show'); };
    $('#ghTestOk').addEventListener('click', ghTestClose);
    $('#ghTestScrim').addEventListener('click', ghTestClose);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { const am = $('#ghTestModal'); if (am && am.classList.contains('show')) ghTestClose(); }
    });
    $('#ghTest').addEventListener('click', async () => {
      const sm = $('#ghMsg'); const c = ghConf();
      if (!c.token) { sm.textContent = '请先填写访问令牌 PAT'; ghTestAlert(false, '还差一步', '请先填写 GitHub 访问令牌（PAT）再测试连接。'); return; }
      const tr = validateGhToken(c.token);
      if (!tr.ok) { sm.textContent = '✗ ' + tr.msg; ghTestAlert(false, '令牌格式不对', tr.msg); return; }
      if (!c.repo) { sm.textContent = '请填写仓库名'; ghTestAlert(false, '还差一步', '请填写私有仓库名（如 mood-atlas-sync）再测试连接。'); return; }
      sm.textContent = '连接测试中…';
      try {
        const me = await fetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ' + c.token } });
        if (me.status === 401) { sm.textContent = '✗ 令牌无效（检查权限是否勾了 Contents 读写、是否过期）'; ghTestAlert(false, '令牌无效', '这个令牌被 GitHub 拒绝了（HTTP 401）。请检查：令牌是否过期、有没有勾选 Contents 读写权限，必要时去重新生成一个。'); return; }
        if (!me.ok) { sm.textContent = '✗ 连接失败 HTTP ' + me.status; ghTestAlert(false, '连接失败', 'GitHub 返回了 HTTP ' + me.status + '，暂时连不上，稍后重试。'); return; }
        /* 用户名留空时，用令牌自动认出你的 GitHub 用户名并填好，省一步 */
        let user = c.user;
        if (!user) {
          try {
            const j = await me.json();
            if (j && j.login) {
              user = j.login;
              $('#ghUser').value = user;
              localStorage.setItem('mood.ghUser' + ghSuffix(), user);
            }
          } catch (e) {}
        }
        if (!user) { sm.textContent = '✗ 请填写 GitHub 用户名'; ghTestAlert(false, '还差一步', '没拿到用户名，请在上方填写你的 GitHub 用户名再测试。'); return; }
        const r = await fetch('https://api.github.com/repos/' + encodeURIComponent(user) + '/' + encodeURIComponent(c.repo), { headers: { 'Authorization': 'Bearer ' + c.token } });
        if (r.status === 404) {
          sm.textContent = '✓ 令牌有效，但仓库不存在';
          ghTestAlert(false, '仓库还没建好', '令牌有效，但仓库「' + c.repo + '」还不存在，或这个令牌没被选上它。请先在 GitHub 建好这个私有仓库，并在令牌里选上它，之后就能同步了。');
        } else if (r.ok) {
          sm.textContent = '✓ 已连上 ' + user + '/' + c.repo;
          ghTestAlert(true, '连接成功', '已连上 ' + user + '/' + c.repo + '，可以开始同步了。点击「立即同步」把数据推上去吧。');
        } else {
          sm.textContent = '✓ 令牌有效（仓库检查返回 ' + r.status + '）';
          ghTestAlert(false, '基本可用', '令牌有效，但仓库检查返回 ' + r.status + '。如果仓库确实存在，多半能正常同步；若同步失败，请检查仓库名与令牌权限。');
        }
      } catch (e) {
        const msg = '✗ 连接出错：' + (e && e.message ? e.message : e);
        sm.textContent = msg;
        ghTestAlert(false, '连接出错', '测试过程中出了点问题：' + (e && e.message ? e.message : e) + '。请检查网络后重试。');
      }
    });
    $('#ghSync').addEventListener('click', () => ghSync($('#ghMsg'), true));
    $('#setClear').addEventListener('click', clearLocal);
    $('#aiGen').addEventListener('click', genQuestions);

    /* ---------- AI 帮填入口（顶部按钮 + 记一笔内「随手写」按钮） ---------- */
    const openExtract = (prefill) => {
      if (prefill != null) $('#extractText').value = prefill;
      extractReset();
      $('#extractModal').classList.add('show'); $('#scrim').classList.add('show');
      setTimeout(() => { const t = $('#extractText'); if (t) t.focus(); }, 50);
    };
    $('#aiFillBtn').addEventListener('click', () => openExtract($('#recFree') ? $('#recFree').value.trim() : null));
    $('#recAiFill').addEventListener('click', () => {
      const free = $('#recFree').value.trim();
      openExtract(free || null);
      if (free) extractStart();
    });
    // 注意：以下一律用安全绑定 on()。#tlBtn 已从 HTML 删除（改用底部导航），
    // 之前的 $('#tlBtn').addEventListener 会因 null 抛错，连带下面的发送键、浅色键、
    // 以及 bindBotNav/bindExtractModal 全部中断绑定——这是大量"点不动"的真正根因。
    on('#tlBtn', 'click', openTimeline);
    on('#tlClose', 'click', closeTimeline);
    on('#histClose', 'click', closeHistory);
    on('#aiSend', 'click', aiChat);
    on('#aiInput', 'keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') aiChat(); });
    on('#customColor', 'input', e => applyCustom(e.target.value));
    on('#modeDark', 'click', () => { root.setAttribute('data-theme', 'dark'); localStorage.setItem('mood.theme', 'dark'); derivePalette(currentAccent, 'dark'); const d = $('#modeDark'); if (d) d.classList.add('active'); const l = $('#modeLight'); if (l) l.classList.remove('active'); });
    on('#modeLight', 'click', () => { root.setAttribute('data-theme', 'light'); localStorage.setItem('mood.theme', 'light'); derivePalette(currentAccent, 'light'); const l = $('#modeLight'); if (l) l.classList.add('active'); const d = $('#modeDark'); if (d) d.classList.remove('active'); });

    // 同步状态点一下就能真的同步 / 重试；没配置过就直接把设置面板打开
    on('#connDot', 'click', () => {
      const c = ghConf();
      if (!c.enabled || !c.token || !c.user || !c.repo) { const b = $('#setBtn'); if (b) b.click(); return; }
      // 不刷新页面，同步完直接重绘：正在写的东西不会丢
      ghSync($('#ghMsg'), false).then(() => { refreshRecs(); renderAll(); }).catch(() => {});
    });

    // 断网时改的东西不会丢：网络回来、或从后台切回来时，自动把没推上去的补推一次
    const autoResync = function () {
      const c = ghConf();
      if (!c.enabled || !c.token || !c.user || !c.repo || !c.auto) return;
      if (!navigator.onLine) return;
      if (syncState.status !== 'error' && pendingCount() <= 0) return;
      ghSync(null, false).then(() => { refreshRecs(); renderAll(); }).catch(() => {});
    };
    window.addEventListener('online', autoResync);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(autoResync, 800); });

    // 折叠：高频标签 / 标签关系图（用户想「平常收起来」）
    const bindCollapse = (btnSel, bodySel, key) => {
      const btn = $(btnSel), body = $(bodySel);
      if (!btn || !body) return;
      const apply = (open) => {
        body.classList.toggle('collapsed', !open);
        btn.textContent = open ? '收起' : '展开';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      apply(localStorage.getItem(key) !== 'closed');
      btn.addEventListener('click', () => {
        const open = body.classList.contains('collapsed');
        localStorage.setItem(key, open ? 'open' : 'closed');
        apply(open);
      });
    };
    bindCollapse('#tagsToggle', '#tagsBody', 'mood.ui.tagsOpen');
    bindCollapse('#tgToggle', '#tgBody', 'mood.ui.graphOpen');
    bindCollapse('#insightCollapse', '#insightBody', 'mood.ui.insightOpen');
    on('#insightAi', 'click', insightAiSummary);
    on('#tgReset', 'click', () => {
      state.histTag = ''; state.histAuthor = ''; state.histMood = 0; state.histQ = '';
      const hs = $('#histSearch'); if (hs) hs.value = '';
      $$('.mood-chip').forEach(x => x.classList.remove('active'));
      refreshLists();
    });

    const tip = $('#tip');
    $('#trend') && $('#trend').addEventListener('mousemove', e => {
      const hit = e.target.closest('.hit'); if (!hit) { tip.style.opacity = 0; return; }
      const d = curView[+hit.dataset.i]; if (!d) return;
      tip.innerHTML = `<b>${d.date}</b><br>心情 ${d.mood} · 精力 ${d.energy || '-'} · 紧绷 ${d.tension || '-'}<br>${(d.note || '').slice(0, 30) || ''}`;
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.style.opacity = 1;
    });
    $('#trend') && $('#trend').addEventListener('mouseleave', () => tip.style.opacity = 0);

    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach((n, i) => { n.style.transitionDelay = (i % 6) * 60 + 'ms'; io.observe(n); });

  }

  /* ---------- AI 开场白：按历史记录生成一句开场语（每日缓存，避免重复消耗） ---------- */
  async function genOpening() {
    const box = $('#heroAi'); if (!box) return;
    if (!dsKey()) { box.textContent = '在「设置」填入 DeepSeek Key，让 AI 每天为你写一句开场白。'; box.classList.add('show'); return; }
    if (!recs.length) { box.textContent = '还没有记录，先从「记一笔」开始吧。'; box.classList.add('show'); return; }
    const day = new Date().toISOString().slice(0, 10);
    const cached = localStorage.getItem('mood.opening-' + day);
    if (cached) { box.textContent = cached; box.classList.add('show'); return; }
    box.textContent = 'AI 正在根据你的记录，写下今天的开场白…'; box.classList.add('show');
    const recent = recs.slice(-10).reverse().map(r => `${r.date} 心情${r.mood || '?'}/5${(r.tags && r.tags.length) ? ' [' + r.tags.join('/') + ']' : ''}${r.note ? '：' + String(r.note).slice(0, 40) : ''}`).join('\n');
    const sys = '你是用户的私人情绪陪伴助手。下面是该用户最近的情绪记录（按时间）。请用一句温柔、有洞察的话作为今天的「开场白」，帮助用户回看自己的状态。要求：不超过 40 字；不要使用表情符号；不要重复用户原话；语气温和、像朋友。只输出这句话本身，不要任何解释或引号。';
    try {
      const r = await callDeepSeek(sys, recent, { task: 'opening' });
      const line = (r.text || '').trim().replace(/^["'「」]+|["'「」]+$/g, '');
      if (line) { box.textContent = line; localStorage.setItem('mood.opening-' + day, line); }
      else { box.textContent = '今天也辛苦了，慢慢来，我在这里陪你。'; }
    } catch (e) {
      box.textContent = '今天也辛苦了，慢慢来，我在这里陪你。';
    }
  }

  /* ---------- 总渲染 ---------- */
  function renderCalendar() {
    const wrap = $('#calCard'); if (!wrap) return;
    const grid = $('#calGrid'); if (!grid) return;
    if (!state.calMonth) { const d = new Date(); state.calMonth = d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
    const parts = state.calMonth.split('-'); const y = +parts[0], m = +parts[1];
    const title = $('#calTitle'); if (title) title.textContent = y + '年' + m + '月';
    const map = {};
    dashRecs().forEach(r => {
      if (r.date && r.date.indexOf(state.calMonth + '-') === 0) {
        const day = +r.date.slice(8, 10);
        if (!map[day]) map[day] = { sum: 0, n: 0, ids: [] };
        map[day].sum += (+r.mood || 3); map[day].n += 1; map[day].ids.push(r.id);
      }
    });
    grid.innerHTML = '';
    ['日','一','二','三','四','五','六'].forEach(w => grid.appendChild(el('div', 'cal-wk', w)));
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    for (let i = 0; i < first; i++) grid.appendChild(el('div', 'cal-cell empty'));
    for (let d = 1; d <= days; d++) {
      const cell = el('div', 'cal-cell');
      const info = map[d];
      cell.appendChild(el('span', 'cal-d', String(d)));
      if (info) {
        const avg = info.sum / info.n;
        cell.style.background = moodColor(avg);
        const oc = onMood(avg);
        cell.style.color = oc;
        const cd = cell.querySelector('.cal-d'); if (cd) cd.style.color = oc;
        cell.style.opacity = 0.35 + avg * 0.13;
        cell.classList.add('has');
        cell.title = d + '日 · 平均心情 ' + fmt(avg) + ' · ' + info.n + ' 条';
        cell.addEventListener('click', () => pickDayRecords(info.ids, y + '-' + pad2(m) + '-' + pad2(d)));
      } else { cell.classList.add('none'); }
      grid.appendChild(cell);
    }
  }
  function calShift(delta) {
    const parts = state.calMonth.split('-'); let y = +parts[0], m = +parts[1] + delta;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    state.calMonth = y + '-' + pad2(m); renderCalendar();
  }
  function renderRemind() {
    const bar = $('#remindBar'); if (!bar) return;
    if (localStorage.getItem('mood.remind') === 'off') { bar.style.display = 'none'; return; }
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = recs.some(r => r.date === today);
    const last = localStorage.getItem('mood.lastRecordDate');
    let gap = true;
    if (last) { const diff = Math.floor((new Date(today) - new Date(last)) / 86400000); gap = diff >= 1; }
    if (hasToday || !gap) { bar.style.display = 'none'; return; }
    bar.style.display = '';
  }
  async function genReport() {
    const box = $('#reportBody');
    const open = () => { $('#reportModal').classList.add('show'); $('#scrim').classList.add('show'); };
    if (!dsKey()) { if (box) box.textContent = '请先在「⚙ 设置」里填入 DeepSeek API Key 再生成总结。'; open(); return; }
    const p = reportRangeParams();
    const slice = reportSlice(p.range, p.start, p.end);
    if (!slice.length) { renderReportStats([]); if (box) box.textContent = '这段时间还没有记录，先记几笔再来生成总结吧。'; open(); return; }
    renderReportStats(slice);   // 纯前端统计，立即显示，不用等 AI
    const text = slice.map(r => [r.date + ' 心情' + r.mood, r.scene ? '场景:' + r.scene : '', (r.tags || []).length ? '标签:' + r.tags.join('/') : '', r.note ? '备注:' + r.note : '', r.cause ? '原因:' + r.cause : ''].filter(Boolean).join(' · ')).join('\n');
    const sys = '你是温柔而专业的情绪陪伴与分析师。基于用户提供的情绪记录，给出一段结构化总结：1) 这段时间整体情绪基调；2) 反复出现的场景或触发因素；3) 一两个值得注意的模式；4) 一句温和的提醒或建议。语言平实、不诊断、不恐吓。';
    const usr = '时间范围：' + p.label + '，共 ' + slice.length + ' 条记录：\n' + text;
    const btn = $('#genReport'); if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    try {
      const r = await callDeepSeek(sys, usr, { task: 'summary' });
      if (box) box.textContent = r.text;
    } catch (err) {
      if (box) box.textContent = '生成失败：' + (err && err.message ? err.message : err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '生成 AI 总结'; }
      open();
    }
  }
  // 切换范围选择时同步 UI：显示/隐藏自定义日期、刷新预览统计
  function syncReportRangeUI() {
    const sel = $('#repRange'); if (!sel) return;
    const custom = sel.value === 'custom';
    const box = $('#repCustom'); if (box) box.style.display = custom ? '' : 'none';
    const p = reportRangeParams();
    renderReportStats(reportSlice(p.range, p.start, p.end));
  }
  // 首页「回顾」入口：直接打开弹窗并渲染纯前端统计（不强制 AI），有 Key 再点「生成 AI 总结」
  function openReview(range) {
    const sel = $('#repRange'); if (sel && range) sel.value = range;
    syncReportRangeUI();
    const m = $('#reportModal'), sc = $('#scrim');
    if (m) m.classList.add('show');
    if (sc) sc.classList.add('show');
  }
  // 回顾：纯前端自动统计（记录数/均值/最好最差日/高频标签/平均睡眠），把图变成一眼能看的结论
  let lastReportSlice = [];
  function renderReportStats(slice) {
    const el = $('#reportStats'); if (!el) return;
    lastReportSlice = slice || [];
    if (!slice || !slice.length) { el.innerHTML = ''; return; }
    const n = slice.length;
    const avg = slice.reduce((a, r) => a + (+r.mood || 3), 0) / n;
    const byDay = {};
    slice.forEach(r => { const d = r.date; if (!byDay[d]) byDay[d] = { s: 0, n: 0 }; byDay[d].s += (+r.mood || 3); byDay[d].n++; });
    let best = null, worst = null;
    Object.keys(byDay).forEach(d => { const a = byDay[d].s / byDay[d].n; if (!best || a > best.a) best = { d, a }; if (!worst || a < worst.a) worst = { d, a }; });
    const tagCount = {};
    slice.forEach(r => (r.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    const topTags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);
    const sleeps = slice.map(r => +r.sleep).filter(v => v > 0);
    const avgSleep = sleeps.length ? (sleeps.reduce((a, b) => a + b, 0) / sleeps.length) : 0;
    const card = (k, v, sub, stat) => '<div class="rs' + (stat ? ' clickable' : '') + '"' + (stat ? ' data-stat="' + stat + '"' : '') + '><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + (stat ? '<span class="rs-go">›</span>' : '') + '</div>';
    el.innerHTML =
      card('记录数', n + ' 笔') +
      card('平均心情', fmt(avg) + '<small>/5</small>', moodBand(avg), 'mood') +
      card('最好一天', best ? best.d.slice(5) : '—', best ? '心情 ' + fmt(best.a) : '') +
      card('最低一天', worst ? worst.d.slice(5) : '—', worst ? '心情 ' + fmt(worst.a) : '') +
      card('高频标签', topTags.length ? topTags.slice(0, 3).join('、') : '—', topTags.length > 3 ? '等 ' + topTags.length + ' 个' : '') +
      (avgSleep ? card('平均睡眠', fmt(avgSleep) + '<small>h</small>', '', 'sleep') : '');
  }
  // 平均心情 / 平均睡眠 点开详情（手机端替代导出 PDF）
  function openStatDetail(type) {
    const slice = lastReportSlice; const box = $('#statDetail'); if (!box) return;
    const title = box.querySelector('.sd-title'); const body = box.querySelector('.sd-body');
    if (title) title.textContent = type === 'sleep' ? '平均睡眠详情' : '平均心情详情';
    const rows = slice.map(r => ({ d: r.date, v: type === 'sleep' ? (+r.sleep || null) : (+r.mood || 3), tags: r.tags || [] })).filter(r => r.v != null && !isNaN(r.v));
    if (!rows.length) { if (body) body.innerHTML = '<div class="sd-empty">这段时间没有可统计的数据。</div>'; }
    else {
      const lo = type === 'sleep' ? 0 : 1, hi = type === 'sleep' ? 10 : 5;
      const avgV = rows.reduce((s, r) => s + r.v, 0) / rows.length;
      const buckets = {}; rows.forEach(r => { const b = Math.round(r.v); buckets[b] = (buckets[b] || 0) + 1; });
      let bars = '';
      for (let v = lo; v <= hi; v += (type === 'sleep' ? 1 : 1)) {
        const c = buckets[v] || 0; const pct = rows.length ? Math.round(c / rows.length * 100) : 0;
        bars += '<div class="sd-bar"><span class="sd-bar-k">' + (type === 'sleep' ? v + 'h' : v + '分') + '</span>'
          + '<span class="sd-bar-track"><i style="width:' + pct + '%"></i></span>'
          + '<span class="sd-bar-n">' + c + '</span></div>';
      }
      const tagCount = {}; rows.forEach(r => r.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
      const top = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]).slice(0, 5);
      if (body) body.innerHTML =
        '<div class="sd-avg">平均 <b>' + fmt(avgV, type === 'sleep' ? 1 : 1) + (type === 'sleep' ? ' h' : ' / 5') + '</b> · 共 ' + rows.length + ' 条</div>'
        + '<div class="sd-bars">' + bars + '</div>'
        + (top.length ? '<div class="sd-tags"><span>高频标签</span>' + top.map(t => '<i>' + escapeHtml(t) + '</i>').join('') + '</div>' : '');
    }
    box.classList.add('show'); $('#scrim').classList.add('show');
    const close = () => { box.classList.remove('show'); $('#scrim').classList.remove('show'); };
    on(box.querySelector('.sd-x'), 'click', close);
  }
  // 问数据：把近 180 条记录作为上下文，让 DeepSeek 基于历史回答自然语言问题
  async function askData() {
    const inp = $('#askInput'), sv = $('#askStatus'), box = $('#askChat');
    const txt = inp.value.trim(); if (!txt) return;
    if (!dsKey()) {
      appendBubble(box, 'ai', '还没配置 DeepSeek API Key，我暂时没法查你的数据～\n点右上角 ⚙ 设置，把 Key 填进去就能问啦。');
      if (sv) sv.textContent = '请先在「⚙ 设置」里填入 DeepSeek API Key';
      return;
    }
    appendBubble(box, 'user', txt); inp.value = '';
    if (sv) sv.textContent = '';
    const ctx = recs.slice(-180).map(r => [r.date + ' 心情' + r.mood, r.scene ? '场景:' + r.scene : '', (r.tags || []).length ? '标签:' + r.tags.join('/') : '', r.note ? '备注:' + r.note : '', r.cause ? '原因:' + r.cause : ''].filter(Boolean).join(' · ')).join('\n');
    const sys = '你是一个基于用户历史情绪记录的数据分析助手。用户会用自然语言提问（例如「上月我最低谷那周怎么了」「什么场景最让我焦虑」）。请基于下面提供的历史记录，用中文、具体、有依据地回答，可引用具体日期和记录内容，不要编造不存在的数据。如果记录不足以回答，就如实说样本不够。';
    const user = '我的历史情绪记录（最近 180 条）：\n' + (ctx || '（暂无记录）') + '\n\n我的问题：' + txt;
    const loading = appendBubble(box, 'ai', '查数据中…');
    try {
      const res = await callDeepSeek(sys, user, { task: 'summary' });
      loading.textContent = res.text;
    } catch (e) {
      loading.textContent = '查询失败：' + (e && e.message ? e.message : e);
    }
  }
  // 导出回顾为 PDF（纯前端：构造精美打印区 + 浏览器打印，不引入任何外部依赖，保持离线可用）
  /* ---------- 导出 PDF（纯前端：Canvas 绘制 → JPEG → 内嵌 PDF，离线可用，支持中文） ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapText(ctx, text, maxW, font) {
    ctx.font = font; const out = []; let line = '';
    for (const ch of String(text)) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = ch; }
      else line = test;
    }
    if (line) out.push(line);
    return out;
  }
  // 读取报告弹窗当前选择的范围（预设 or 自定义起止日期）
  function reportRangeParams() {
    const range = $('#repRange') ? $('#repRange').value : 'month';
    let start = '', end = '', label = '';
    if (range === 'custom') {
      start = $('#repStart') ? $('#repStart').value : '';
      end = $('#repEnd') ? $('#repEnd').value : '';
      label = (start || '起始') + ' 至 ' + (end || '今天');
    } else {
      label = { week: '近 7 天', month: '近 30 天', year: '近 1 年', all: '全部' }[range] || range;
    }
    return { range, start, end, label };
  }
  function reportSlice(range, start, end) {
    const all = recs;
    if (range === 'all' && !start && !end) return all.slice();
    let s, e;
    if (range === 'custom') { s = start || '0000-01-01'; e = end || isoLocal(new Date()); }
    else {
      const endD = new Date(), startD = new Date(endD);
      if (range === 'week') startD.setDate(startD.getDate() - 6);
      else if (range === 'month') startD.setDate(startD.getDate() - 29);
      else if (range === 'year') startD.setDate(startD.getDate() - 364);
      else { s = '0000-01-01'; e = isoLocal(new Date()); return all.filter(r => r.date >= s && r.date <= e); }
      s = isoLocal(startD); e = isoLocal(endD);
    }
    return all.filter(r => r.date >= s && r.date <= e);
  }
  // 绘制 PDF 内的趋势折线图（心情/精力/紧绷），返回新的 y 光标
  function drawReportTrend(ctx, slice, L, R, top, dim, ink, accent, line) {
    const data = slice.filter(r => r.mood != null).slice(-60);
    const w = R - L, h = 150;
    ctx.fillStyle = accent; ctx.font = 'bold 14px sans-serif'; ctx.fillText('心情趋势', L, top);
    top += 9; ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(L, top); ctx.lineTo(R, top); ctx.stroke(); top += 12;
    const plotH = h - 34, baseY = top;
    const yy = v => baseY + plotH - plotH * ((v - 1) / 4);
    ctx.strokeStyle = '#ececec'; ctx.fillStyle = dim; ctx.font = '9px sans-serif';
    for (let g = 1; g <= 5; g++) { const gy = yy(g); ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(R, gy); ctx.stroke(); ctx.fillText(String(g), L - 13, gy + 3); }
    if (!data.length) { ctx.fillStyle = dim; ctx.fillText('该范围暂无心情数据', L, baseY + plotH / 2); return top + h; }
    const n = data.length, xx = i => L + (n === 1 ? w / 2 : w * i / (n - 1));
    const series = [{ key: 'mood', color: accent }, { key: 'energy', color: '#818cf8' }, { key: 'tension', color: '#f472b6' }];
    series.forEach(se => {
      if (!data.some(d => d[se.key] != null)) return;
      ctx.strokeStyle = se.color; ctx.lineWidth = 1.6; ctx.beginPath();
      let started = false;
      data.forEach((d, i) => { const v = d[se.key]; if (v == null) return; const px = xx(i), py = yy(v); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); });
      ctx.stroke();
    });
    ctx.fillStyle = dim; ctx.font = '9px sans-serif';
    [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).forEach(i => { ctx.fillText(String(data[i].date).slice(5), xx(i) - 12, top + h - 6); });
    return top + h + 8;
  }
  // 绘制 PDF 内的每日明细，返回新的 y 光标
  function drawReportDaily(ctx, slice, L, R, top, dim, ink, accent, line) {
    ctx.fillStyle = accent; ctx.font = 'bold 14px sans-serif'; ctx.fillText('每日明细', L, top);
    top += 9; ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(L, top); ctx.lineTo(R, top); ctx.stroke(); top += 18;
    const byDay = {}; slice.forEach(r => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    const dates = Object.keys(byDay).sort();
    const w = R - L;
    if (!dates.length) { ctx.fillStyle = dim; ctx.fillText('该范围暂无记录', L, top); return top + 16; }
    dates.forEach(d => {
      const recsDay = byDay[d];
      const dt = new Date(d + 'T00:00:00');
      const wd = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
      ctx.fillStyle = ink; ctx.font = 'bold 12px sans-serif';
      ctx.fillText(d.slice(5) + ' ' + wd + ' · ' + recsDay.length + ' 条', L, top);
      top += 18;
      recsDay.forEach(r => {
        ctx.fillStyle = moodColor(r.mood || 3); ctx.beginPath(); ctx.arc(L + 4, top - 4, 4, 0, 7); ctx.fill();
        ctx.fillStyle = ink; ctx.font = '11px sans-serif';
        const line1 = '心情' + (r.mood || '-') + '/5' + (r.time ? '  ' + r.time : '') + (r.scene ? '  · ' + r.scene : '');
        ctx.fillText(line1, L + 14, top); top += 16;
        if ((r.tags || []).length) { ctx.fillStyle = dim; ctx.font = '10px sans-serif'; wrapText(ctx, '#' + (r.tags || []).join(' #'), w - 14, '10px sans-serif').forEach(ln => { ctx.fillText(ln, L + 14, top); top += 14; }); }
        if (r.note) { ctx.fillStyle = ink; ctx.font = '10px sans-serif'; wrapText(ctx, r.note, w - 14, '10px sans-serif').forEach(ln => { ctx.fillText(ln, L + 14, top); top += 14; }); }
        if (r.cause) { ctx.fillStyle = dim; ctx.font = '10px sans-serif'; wrapText(ctx, '原因：' + r.cause, w - 14, '10px sans-serif').forEach(ln => { ctx.fillText(ln, L + 14, top); top += 14; }); }
        top += 8;
      });
      top += 6;
    });
    return top;
  }
  function paintReport() {
    const p = reportRangeParams();
    const slice = reportSlice(p.range, p.start, p.end);
    const includeDaily = $('#repDaily') ? $('#repDaily').checked : true;
    renderReportStats(slice);
    const aiText = (($('#reportBody') && $('#reportBody').textContent) || '').trim();
    const s = 2, W = 595, MU = 30000;
    const ink = '#1f2937', dim = '#6b7280', accent = '#10b981', card = '#f3f4f6', line = '#e5e7eb';
    const big = document.createElement('canvas'); big.width = W * s; big.height = MU;
    const x = big.getContext('2d'); x.scale(s, s); x.textBaseline = 'alphabetic';
    const L = 42, R = W - 42;
    let y = 46;
    x.fillStyle = accent; x.fillRect(L, y - 18, 6, 22);
    x.fillStyle = ink; x.font = 'bold 22px sans-serif'; x.fillText('情绪回顾报告', L + 16, y);
    x.fillStyle = dim; x.font = '12px sans-serif';
    x.fillText(p.label + ' · 生成于 ' + new Date().toLocaleString('zh-CN'), L + 16, y + 18);
    y += 46;
    const cards = Array.from(document.querySelectorAll('#reportStats .rs'))
      .map(el => ({ k: el.querySelector('.k') ? el.querySelector('.k').textContent : '', v: el.querySelector('.v') ? el.querySelector('.v').textContent : '', sub: el.querySelector('.sub') ? el.querySelector('.sub').textContent : '' }))
      .filter(c => c.k || c.v);
    if (cards.length) {
      const cols = 3, gap = 12, cw = (R - L - gap * (cols - 1)) / cols, ch = 58;
      cards.forEach((c2, i) => {
        const cx = L + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap);
        x.fillStyle = card; roundRect(x, cx, cy, cw, ch, 8); x.fill();
        x.fillStyle = dim; x.font = '11px sans-serif'; x.fillText(c2.k, cx + 12, cy + 20);
        x.fillStyle = ink; x.font = 'bold 18px sans-serif'; x.fillText(c2.v, cx + 12, cy + 42);
        if (c2.sub) { x.fillStyle = dim; x.font = '10px sans-serif'; x.fillText(c2.sub, cx + 12, cy + 54); }
      });
      y += Math.ceil(cards.length / cols) * (ch + gap) + 18;
    }
    y = drawReportTrend(x, slice, L, R, y, dim, ink, accent, line);
    // AI 总结
    x.fillStyle = accent; x.font = 'bold 14px sans-serif'; x.fillText('AI 总结', L, y);
    y += 9; x.strokeStyle = line; x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke(); y += 16;
    const aiLines = aiText ? wrapText(x, aiText, R - L, '13px sans-serif') : ['（还没有生成 AI 总结，回到弹窗点「生成 AI 总结」后再导出即可）'];
    x.fillStyle = ink; x.font = '13px sans-serif';
    aiLines.forEach(ln => { x.fillText(ln, L, y); y += 20; });
    y += 18;
    // 高频标签
    const tc = {}; slice.forEach(r => (r.tags || []).forEach(t => { tc[t] = (tc[t] || 0) + 1; }));
    const topTags = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topTags.length) {
      x.fillStyle = accent; x.font = 'bold 14px sans-serif'; x.fillText('高频标签', L, y);
      y += 9; x.strokeStyle = line; x.beginPath(); x.moveTo(L, y); x.lineTo(R, y); x.stroke(); y += 18;
      let tx = L; x.font = '12px sans-serif';
      topTags.forEach(([t, c]) => {
        const tw = x.measureText(t + ' ' + c).width + 18;
        if (tx + tw > R) { tx = L; y += 30; }
        x.fillStyle = card; roundRect(x, tx, y - 16, tw, 22, 11); x.fill();
        x.fillStyle = ink; x.fillText(t + ' ' + c, tx + 9, y);
        tx += tw + 8;
      });
      y += 34;
    }
    if (includeDaily) y = drawReportDaily(x, slice, L, R, y, dim, ink, accent, line);
    x.fillStyle = dim; x.font = '11px sans-serif'; x.fillText('情绪地图 · Mood Atlas', L, y);
    y += 20;
    const Hh = Math.max(y, 200);
    const out = document.createElement('canvas'); out.width = W * s; out.height = Hh * s;
    const ox = out.getContext('2d'); ox.fillStyle = '#fff'; ox.fillRect(0, 0, out.width, out.height);
    ox.drawImage(big, 0, 0, W * s, Hh * s, 0, 0, W * s, Hh * s);
    return out;
  }
  // 多页 PDF：images 为每页的 JPEG 字节数组（Uint8Array），所有页尺寸一致 (cw x ch)
  function buildPdf(w, h, images, cw, ch) {
    const enc = new TextEncoder();
    const chunks = []; const offs = {}; let pos = 0;
    const add = str => { const b = enc.encode(str); chunks.push(b); pos += b.length; };
    const addB = b => { chunks.push(b); pos += b.length; };
    const n = images.length;
    const totalObjs = 2 + n * 3;
    add('%PDF-1.4\n');
    offs[1] = pos; add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    const kids = []; for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    offs[2] = pos; add('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');
    for (let i = 0; i < n; i++) {
      const pId = 3 + i * 3, cId = 4 + i * 3, imId = 5 + i * 3;
      offs[pId] = pos; add(pId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im' + i + ' ' + imId + ' 0 R >> >> /Contents ' + cId + ' 0 R >>\nendobj\n');
      const content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im' + i + ' Do Q\n';
      offs[cId] = pos; add(cId + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
      offs[imId] = pos; add(imId + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + cw + ' /Height ' + ch + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + images[i].length + ' >>\nstream\n');
      addB(images[i]); add('\nendstream\nendobj\n');
    }
    const xrefStart = pos;
    let xref = 'xref\n0 ' + (totalObjs + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= totalObjs; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    add(xref);
    add('trailer\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');
    let total = 0; chunks.forEach(c => total += c.length);
    const out = new Uint8Array(total); let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; });
    return new Blob([out], { type: 'application/pdf' });
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  function exportReportPdf() {
    const canvas = paintReport();
    const s = 2, W = 595, H = 842;
    const pw = W * s, ph = H * s; // A4 @2x
    const pages = [];
    for (let top = 0; top < canvas.height; top += ph) {
      const c = document.createElement('canvas'); c.width = pw; c.height = ph;
      const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, pw, ph);
      const sh = Math.min(ph, canvas.height - top);
      cx.drawImage(canvas, 0, top, pw, sh, 0, 0, pw, sh);
      pages.push(c);
    }
    const images = pages.map(c => {
      const jpeg = c.toDataURL('image/jpeg', 0.9);
      const bin = atob(jpeg.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    });
    const blob = buildPdf(W, H, images, pw, ph);
    const p = reportRangeParams();
    const safe = (p.label || 'report').replace(/[\\/:*?"<>|]/g, '_');
    downloadBlob(blob, '情绪回顾_' + safe + '_' + isoLocal(new Date()) + '.pdf');
  }
  function renderAll() {
    renderHero(); renderStats(); renderTrend(); renderHeat(); renderTags(); renderSleep(); renderScatter(); renderPeaks(); buildQA();
    renderCalendar(); renderRemind();
    updateViewLabel();
    // 列表 / 标签图 / 作者图例也一起刷新，避免「记完一笔，历史和关系图还是旧的」
    safeInit('refreshLists', refreshLists);
    updateConn();
  }

  function bindExtras() {
    const cp = $('#calPrev'); if (cp) cp.addEventListener('click', () => calShift(-1));
    const cn = $('#calNext'); if (cn) cn.addEventListener('click', () => calShift(1));
    const hs = $('#histSearch'); if (hs) hs.addEventListener('input', () => { state.histQ = hs.value; refreshLists(); });
    const tfb = $('#histTagFilterBtn'); if (tfb) tfb.addEventListener('click', openTagSheet);
    const tsx = $('#tagSheetX'); if (tsx) tsx.addEventListener('click', closeSheet);
    const tss = $('#tagSheet'); if (tss) tss.addEventListener('click', e => { if (e.target === tss) closeSheet(); });
    const tga = $('#tgArrange'); if (tga) tga.addEventListener('click', () => { _tgLayout = { key: '', pts: null }; tgView = { x: 0, y: 0, k: 1 }; renderTagGraph(); });
    // 选择器修正：HTML 里的类名是 .mood-chip（旧代码写成 .hmood-chip，导致心情筛选点了没反应）
    document.querySelectorAll('.mood-chip').forEach(c => c.addEventListener('click', () => {
      const v = +c.dataset.m;
      state.histMood = (state.histMood === v) ? 0 : v;
      document.querySelectorAll('.mood-chip').forEach(x => x.classList.toggle('active', +x.dataset.m === state.histMood));
      refreshLists();
    }));
    const gr = $('#genReport'); if (gr) gr.addEventListener('click', () => genReport());
    document.querySelectorAll('#sleepPeriod button').forEach(b => b.addEventListener('click', () => setSleepPeriod(b.dataset.v)));
    const ss = $('#sleepStart'); if (ss) ss.addEventListener('change', () => { state.sleepRange.start = ss.value; renderSleep(); });
    const se = $('#sleepEnd'); if (se) se.addEventListener('change', () => { state.sleepRange.end = se.value; renderSleep(); });
    const rc = $('#reportClose'); if (rc) rc.addEventListener('click', () => { $('#reportModal').classList.remove('show'); $('#scrim').classList.remove('show'); });
    on('#reportStats', 'click', e => { const c = e.target.closest('[data-stat]'); if (c) openStatDetail(c.dataset.stat); });
    const sdB = $('#statBack'); if (sdB) sdB.addEventListener('click', () => { const m = $('#statDetail'); if (m) m.classList.remove('show'); $('#scrim').classList.remove('show'); });
    // 自己 / 共同 切换：趋势、热力图、标签等所有带 data-self-toggle 的控件共用同一状态
    document.querySelectorAll('[data-self-toggle] button').forEach(b => {
      b.addEventListener('click', () => setViewSelf(b.dataset.v));
    });
    const rb = $('#remindGo'); if (rb) rb.addEventListener('click', () => { $('#recModal').classList.add('show'); $('#scrim').classList.add('show'); });
    const rmL = $('#remindLater'); if (rmL) rmL.addEventListener('click', () => { const b = $('#remindBar'); if (b) b.style.display = 'none'; });
    const ro = $('#remindOn'); if (ro) { ro.checked = localStorage.getItem('mood.remind') !== 'off'; ro.addEventListener('change', () => { localStorage.setItem('mood.remind', ro.checked ? 'on' : 'off'); renderRemind(); }); }
    const ara = $('#aiRecordAuto'); if (ara) { ara.checked = localStorage.getItem('mood.aiRecord') !== 'off'; ara.addEventListener('change', () => localStorage.setItem('mood.aiRecord', ara.checked ? 'on' : 'off')); }
    // 回顾 + 问数据 新功能绑定
    on('#reviewBtn', 'click', () => openReview('month'));
    on('#repRange', 'change', syncReportRangeUI);
    on('#repStart', 'change', syncReportRangeUI);
    on('#repEnd', 'change', syncReportRangeUI);
    on('#reportPdf', 'click', exportReportPdf);
    on('#heroPdf', 'click', exportReportPdf);
    on('#aiRecordSave', 'click', () => {
      const rp = $('#aiRecordPrompt');
      const txt = '和 AI 聊到的：\n' + (rp ? (rp.dataset.user || '') : '') + '\n\n（AI 回应：' + (rp ? (rp.dataset.ai || '') : '') + '）';
      openNewRecordWithNote(txt);
      if (rp) rp.style.display = 'none';
    });
    on('#aiRecordSkip', 'click', () => { const rp = $('#aiRecordPrompt'); if (rp) rp.style.display = 'none'; });
    on('#askDataBtn', 'click', () => { const m = $('#askModal'); if (m) m.classList.add('show'); const sc = $('#scrim'); if (sc) sc.classList.add('show'); });
    on('#askClose', 'click', () => { const m = $('#askModal'); if (m) m.classList.remove('show'); const sc = $('#scrim'); if (sc) sc.classList.remove('show'); });
    on('#askSend', 'click', askData);
    on('#askInput', 'keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); askData(); } });
    // 时间轴日期跳转
    on('#tlDateJump', 'change', () => {
      const dp = $('#tlDateJump'); if (!dp || !dp.value) return;
      const target = dp.value; // YYYY-MM-DD
      const groups = document.querySelectorAll('#viewTlList .tl-date-group');
      let found = false;
      groups.forEach(g => {
        const label = g.querySelector('.tl-date-label');
        if (label && label.textContent.trim() === target) {
          g.classList.remove('collapsed'); // 展开该天
          g.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // 高亮一下
          g.querySelector('.tl-date-head').style.background = 'var(--accent-soft)';
          setTimeout(() => { const h = g.querySelector('.tl-date-head'); if (h) h.style.background = ''; }, 1500);
          found = true;
        }
      });
      if (!found) {
        // 该日期没有记录，清空选择器提示用户
        dp.value = '';
      }
    });
    on('#scrim', 'click', () => {
      ['#reportModal', '#askModal', '#tagSheet'].forEach(s => { const m = $(s); if (m && m.classList.contains('show') && !m.classList.contains('keep')) { m.classList.remove('show'); const sc = $('#scrim'); if (sc) sc.classList.remove('show'); } });
    });
  }

  /* ---------- 运行时自检：按钮能不能点 / 会不会飘 / 有没有被挡住 ----------
     打开浏览器控制台即可看到报告；有问题会以警告列出具体元素。            */
  function selfCheck() {
    const issues = [];
    const sel = 'button, .btn, .tb-btn, .bnav-btn, .mood-chip, .seg-btn, .chip, .cal-arrow, .tag-chip, .tg-node';
    const nodes = Array.from(document.querySelectorAll(sel));
    let checked = 0;
    nodes.forEach(n => {
      // 收起/隐藏容器里的元素不参与检查，避免误报
      if (n.closest('.modal:not(.show)') || n.closest('.theme-panel:not(.show)') || n.closest('[hidden]')) return;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      checked++;
      const label = (n.id ? '#' + n.id : '.' + String(n.className || '').split(' ')[0])
        + '「' + (n.textContent || '').trim().slice(0, 8) + '」';
      if (cs.pointerEvents === 'none') issues.push(label + ' → pointer-events:none，点不动');
      if (n.style.transform) issues.push(label + ' → 残留内联 transform（会飘）：' + n.style.transform);
      if (r.width < 28 || r.height < 24) issues.push(label + ' → 点击热区过小 ' + Math.round(r.width) + '×' + Math.round(r.height));
      // 中心点被别的元素盖住 = 实际点不到
      if (r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== n && !n.contains(hit) && !hit.contains(n)) {
          issues.push(label + ' → 中心被遮挡，实际点不到（遮挡者：' + (hit.id ? '#' + hit.id : String(hit.className).slice(0, 30)) + '）');
        }
      }
    });
    if (issues.length) console.warn('[Mood Atlas 自检] 检查 ' + checked + ' 个可交互元素，发现 ' + issues.length + ' 处隐患：\n· ' + issues.join('\n· '));
    else console.info('[Mood Atlas 自检] ✓ ' + checked + ' 个可交互元素全部可点击、无位移、无遮挡');
    window.__moodSelfCheck = issues;
    return issues;
  }

  /* ---------- 启动 ---------- */
  safeInit('loadSyncState', loadSyncState);   // 先恢复上次的同步结果，顶栏状态才不是瞎写的
  safeInit('buildSwatches', buildSwatches);
  safeInit('initTheme', initTheme);
  safeInit('initCanvas', initCanvas);
  safeInit('initGlowAndMagnetic', initGlowAndMagnetic);
  safeInit('bindRipple', bindRipple);
  safeInit('bindExtras', bindExtras);
  safeInit('setupTimebar', setupTimebar);

  safeInit('renderAll', renderAll);
  // 版本标记：电脑版 / 手机版对不上时，一眼能看出哪台没更新
  // 同步次数：每次成功推送 +1，并实时显示在设置底部「版本」行，方便一眼确认同步真的发生了
  function renderSetVer() {
    const el = $('#setVer'); if (!el) return;
    let n = 0;
    try { n = parseInt(localStorage.getItem('mood.syncCount' + ghSuffix()) || '0', 10) || 0; } catch (e) {}
    let tail = ' · 已同步 ' + n + ' 次';
    if (syncState && syncState.at) tail += ' · 最近 ' + timeAgo(syncState.at);
    el.textContent = '版本 ' + (window.__BUILD__ || '未知') + tail;
  }
  function bumpSyncCount() {
    let n = 0;
    try { n = parseInt(localStorage.getItem('mood.syncCount' + ghSuffix()) || '0', 10) || 0; } catch (e) {}
    n += 1;
    try { localStorage.setItem('mood.syncCount' + ghSuffix(), String(n)); } catch (e) {}
    renderSetVer();
  }
  renderSetVer();
  const _sc = ghConf();
  if (_sc.enabled && _sc.token) {
    // 打开页面即拉取云端数据：配置好同步的浏览器立刻就能看到历史，无需手动点同步
    // 同步期间顶栏显示「同步中…」，成功/失败都有明确提示（不再静默吞错误）
    setSyncState('syncing');
    ghSync(null, false).then(function () {
      renderAll(); genOpening();
    }).catch(function (e) {
      // 加载时同步失败：仍然用本地数据渲染（可能是离线或临时网络问题），不白屏
      renderAll(); genOpening();
      var m = (e && e.message ? e.message : '同步失败');
      if (!(e && e.status)) m = '无法连接 GitHub（' + m + '），目前显示的是本地缓存数据';
      setSyncState('error', '· ' + m);
      console.warn('[Mood Atlas] 启动同步失败:', m, e);
    });
  } else {
    genOpening();
  }

  safeInit('bindModal', bindModal);
  safeInit('bindRecordModal', bindRecordModal);
  safeInit('bindInteractions', bindInteractions);
  safeInit('bindExtractModal', bindExtractModal);
  safeInit('bindBotNav', bindBotNav);
  safeInit('setBotNav', () => setBotNav('dash'));
  safeInit('probeApi', probeApi);
  safeInit('selfCheck', selfCheck);
  if (GEN_DATE) { const g = $('#genDate'); if (g) g.textContent = '生成于 ' + GEN_DATE; }
})();
