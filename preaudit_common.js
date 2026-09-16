/* Quanta-Audit 供應商自評對照稽核站 共用引擎 v1.0
   ─────────────────────────────────────────────────────────────
   骨架＝廣達供應商自評表 MF-00032 3M 全 15 章 431 條。每條並列 TW／PH 雙方的
   對應文件與自評分數，另掛建議查核重點、複核提醒、TW 歷史缺失與差異標記。
   查核結果分兩組：自身(r/note) 與 客戶(cr/cnote)，同一題可各自登錄。
   離線優先：全部先寫 localStorage（qa_state），照片壓縮暫存 IndexedDB。
   身分模式 aces／customer：客戶模式隱藏複核提醒與 TW 歷史缺失。
   頁面先定義 window.SEED = {remote, seed}，再載入本檔。 */
(function (w) {
  'use strict';
  var SEED = w.SEED || {};
  var REMOTE = SEED.remote || null;
  var BANK = SEED.seed || { sections: [], items: [] };
  var LS_STATE = 'qa_state_v1', LS_LANG = 'qa_lang', LS_BY = 'qa_by', LS_CUR = 'qa_cur', LS_MODE = 'qa_mode';

  /* ── 小工具 ── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now() { return Date.now(); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtTs(ts) { if (!ts) return ''; var d = new Date(ts); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  var toastT;
  function toast(msg, ms) {
    var t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast show';
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, ms || 2400);
  }
  function status(cls, msg) { var el = $('st'); if (el) { el.className = 'status ' + cls; el.textContent = msg; } }

  /* ── 語言 ── */
  function lang() { try { return localStorage.getItem(LS_LANG) || 'zh'; } catch (e) { return 'zh'; } }
  function setLang(l) { try { localStorage.setItem(LS_LANG, l); } catch (e) {} applyLang(); }
  function t(zh, en) { return lang() === 'en' ? (en || zh) : (zh || en); }
  /* 元素寫 data-zh / data-en，切換時整頁套用；placeholder 用 data-pzh / data-pen */
  function applyLang() {
    var l = lang();
    document.documentElement.setAttribute('lang', l === 'en' ? 'en' : 'zh-Hant');
    var els = document.querySelectorAll('[data-zh]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i], v = l === 'en' ? (e.getAttribute('data-en') || e.getAttribute('data-zh')) : e.getAttribute('data-zh');
      if (e.hasAttribute('data-html')) e.innerHTML = v; else e.textContent = v;
    }
    els = document.querySelectorAll('[data-pzh]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('placeholder', l === 'en' ? (els[i].getAttribute('data-pen') || els[i].getAttribute('data-pzh')) : els[i].getAttribute('data-pzh'));
    var b = $('langBtn'); if (b) b.textContent = l === 'en' ? '中文' : 'EN';
    renderStatus();                     /* 狀態列文字也要跟著換語言 */
    document.dispatchEvent(new CustomEvent('aud:lang', { detail: l }));
  }
  function by() { try { return localStorage.getItem(LS_BY) || ''; } catch (e) { return ''; } }
  function setBy(v) { try { localStorage.setItem(LS_BY, v || ''); } catch (e) {} }

  /* ── 狀態 ── */
  var S = { sessions: [], results: {}, findings: [], custom: { items: [], hidden: {} }, online: false, lastSync: 0, dirty: false };
  function loadLocal() {
    try { var o = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); if (o) { S.sessions = o.sessions || []; S.results = o.results || {}; S.findings = o.findings || []; S.custom = o.custom || { items: [], hidden: {} }; S.dirty = !!o.dirty; S.lastSync = o.lastSync || 0; } } catch (e) {}
    if (!S.custom.hidden || Array.isArray(S.custom.hidden)) S.custom.hidden = {};
  }
  function saveLocal() {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ sessions: S.sessions, results: S.results, findings: S.findings, custom: S.custom, dirty: S.dirty, lastSync: S.lastSync })); }
    catch (e) { toast(t('⚠️ 本機儲存空間不足', '⚠️ Local storage full')); }
  }
  function curId() { try { return localStorage.getItem(LS_CUR) || ''; } catch (e) { return ''; } }
  function setCur(id) { try { localStorage.setItem(LS_CUR, id || ''); } catch (e) {} }
  function cur() {
    var id = curId(), s = null;
    for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === id && !S.sessions[i].del) s = S.sessions[i];
    if (!s) { var live = liveSessions(); if (live.length) { s = live[0]; setCur(s.id); } }
    return s;
  }
  function liveSessions() { return S.sessions.filter(function (s) { return !s.del; }).sort(function (a, b) { return (b.date || '') < (a.date || '') ? -1 : 1; }); }

  /* ── 合併（本機 vs 雲端，ts 新者勝）── */
  function mergeInto(dst, src) {
    if (!src) return;
    var i, j, m = {};
    for (i = 0; i < dst.sessions.length; i++) m[dst.sessions[i].id] = i;
    (src.sessions || []).forEach(function (s) { var k = m[s.id]; if (k == null) dst.sessions.push(s); else if ((s.ts || 0) > (dst.sessions[k].ts || 0)) dst.sessions[k] = s; });
    var R = src.results || {};
    for (var sid in R) { if (!dst.results[sid]) dst.results[sid] = {}; for (var iid in R[sid]) { var a = dst.results[sid][iid], b = R[sid][iid]; if (!a || (b.ts || 0) > (a.ts || 0)) dst.results[sid][iid] = b; } }
    m = {}; for (i = 0; i < dst.findings.length; i++) m[dst.findings[i].id] = i;
    (src.findings || []).forEach(function (f) { var k = m[f.id]; if (k == null) dst.findings.push(f); else if ((f.ts || 0) > (dst.findings[k].ts || 0)) { /* 保留本機尚未上傳的照片 */ var loc = (dst.findings[k].photos || []).filter(function (p) { return p.pid && !p.url; }); dst.findings[k] = f; if (loc.length) { f.photos = (f.photos || []).concat(loc); } } });
    var C = src.custom || {};
    m = {}; for (i = 0; i < dst.custom.items.length; i++) m[dst.custom.items[i].id] = i;
    (C.items || []).forEach(function (it) { var k = m[it.id]; if (k == null) dst.custom.items.push(it); else if ((it.ts || 0) > (dst.custom.items[k].ts || 0)) dst.custom.items[k] = it; });
    var H = C.hidden || {};
    for (var hid in H) { var ha = dst.custom.hidden[hid]; if (!ha || (H[hid].ts || 0) > (ha.ts || 0)) dst.custom.hidden[hid] = H[hid]; }
  }
  function payload() {
    // 照片只送已上傳的 url（本機暫存 pid 不上雲）
    var fs = S.findings.map(function (f) { var c = JSON.parse(JSON.stringify(f)); c.photos = (c.photos || []).filter(function (p) { return p.url; }); return c; });
    return { sessions: S.sessions, results: S.results, findings: fs, custom: S.custom };
  }

  /* ── 雲端 ── */
  function apiGet(what, field, cb) {
    if (!REMOTE || !REMOTE.url) { cb(false, null); return; }
    fetch(REMOTE.url + '?what=' + what + '&_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(!!(j && j.ok && j[field] !== undefined), j); })
      .catch(function () { cb(false, null); });
  }
  function apiPost(p, cb) {
    if (!REMOTE || !REMOTE.url) { cb(false, null); return; }
    p.token = REMOTE.token;
    fetch(REMOTE.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) })
      .then(function (r) { return r.json(); }).then(function (j) { cb(!!(j && j.ok), j); }).catch(function () { cb(false, null); });
  }
  /* ⚠️ 欄位名必須是 dataUrl、連結取 j.file.url（pec_kpi_store.gs action:'upload' 契約） */
  function uploadFile(name, dataUrl, cb) { apiPost({ action: 'upload', name: name, dataUrl: dataUrl }, function (ok, j) { cb(ok && j && j.file ? j.file.url : null); }); }
  /* Drive 連結放 <img> 會被擋成 0×0，顯示時轉 thumbnail */
  function imgSrc(url, wd) {
    var m = /drive\.google\.com\/(?:uc\?.*?id=|file\/d\/|thumbnail\?id=)([A-Za-z0-9_-]{20,})/.exec(String(url || ''));
    if (!m) return url || '';
    return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w' + (wd || 1600);
  }

  var syncing = false, syncCbs = [];
  /* 同步：拉雲端合併 → 推本機（伺服器端再合併一次）→ 採用回傳結果 → 補上傳照片 */
  function sync(cb) {
    if (cb) syncCbs.push(cb);
    if (syncing) return;
    if (!REMOTE || !REMOTE.url || !navigator.onLine) { S.online = false; fire(false); return; }
    syncing = true;
    apiGet('audit', 'data', function (ok, j) {
      if (!ok) { syncing = false; S.online = false; fire(false); return; }
      mergeInto(S, j.data);
      apiPost({ action: 'auditsave', data: payload(), by: by() }, function (ok2, j2) {
        syncing = false;
        if (ok2) { if (j2 && j2.data) mergeInto(S, j2.data); S.online = true; S.dirty = false; S.lastSync = now(); saveLocal(); dedupeAuto(); fire(true); flushPhotos(); }
        else { S.online = false; saveLocal(); fire(false); }
      });
    });
  }
  function fire(ok) { var cbs = syncCbs; syncCbs = []; cbs.forEach(function (c) { try { c(ok); } catch (e) {} }); document.dispatchEvent(new CustomEvent('aud:sync', { detail: ok })); }
  function touch() { S.dirty = true; saveLocal(); document.dispatchEvent(new CustomEvent('aud:change')); scheduleSync(); }
  var syncT;
  function scheduleSync() { clearTimeout(syncT); syncT = setTimeout(function () { sync(); }, 1500); }

  /* ── IndexedDB 照片暫存 ── */
  var dbP;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var rq = indexedDB.open('qa_photos', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('p'); };
      rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); };
    });
    return dbP;
  }
  function idbPut(k, v) { return db().then(function (d) { return new Promise(function (res, rej) { var tx = d.transaction('p', 'readwrite'); tx.objectStore('p').put(v, k); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }); }
  function idbGet(k) { return db().then(function (d) { return new Promise(function (res, rej) { var rq = d.transaction('p').objectStore('p').get(k); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); }); }
  function idbDel(k) { return db().then(function (d) { return new Promise(function (res) { var tx = d.transaction('p', 'readwrite'); tx.objectStore('p').delete(k); tx.oncomplete = res; tx.onerror = res; }); }); }

  /* 壓縮：長邊 ≤1280、JPEG 0.78（現場一張約 150~300KB） */
  function compress(file, cb) {
    var rd = new FileReader();
    rd.onload = function () {
      var img = new Image();
      img.onload = function () {
        var mx = 1280, sc = Math.min(1, mx / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = function () { cb(null); };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }
  /* 加照片到缺失：先入 IDB，立刻可看；有網路再上傳 */
  function addPhoto(f, file, cb) {
    compress(file, function (durl) {
      if (!durl) { toast(t('照片讀取失敗', 'Photo read failed')); cb && cb(false); return; }
      var pid = uid('p');
      idbPut(pid, durl).then(function () {
        f.photos = f.photos || []; f.photos.push({ pid: pid, url: '', ts: now() }); f.ts = now();
        touch(); cb && cb(true); flushPhotos();
      }).catch(function () { toast(t('本機照片暫存失敗', 'Local photo cache failed')); cb && cb(false); });
    });
  }
  var flushing = false;
  function flushPhotos() {
    if (flushing || !REMOTE || !REMOTE.url || !navigator.onLine) return;
    var job = null;
    for (var i = 0; i < S.findings.length && !job; i++) { var ps = S.findings[i].photos || []; for (var k = 0; k < ps.length; k++) if (ps[k].pid && !ps[k].url) { job = { f: S.findings[i], p: ps[k] }; break; } }
    if (!job) return;
    flushing = true;
    idbGet(job.p.pid).then(function (durl) {
      if (!durl) { job.f.photos = job.f.photos.filter(function (p) { return p !== job.p; }); flushing = false; touch(); flushPhotos(); return; }
      uploadFile('audit_' + (job.f.sid || '') + '_' + (job.f.item || '') + '_' + job.p.pid + '.jpg', durl, function (url) {
        flushing = false;
        if (url) { job.p.url = url; job.f.ts = now(); idbDel(job.p.pid); job.p.pid = ''; touch(); document.dispatchEvent(new CustomEvent('aud:photo')); flushPhotos(); }
      });
    }).catch(function () { flushing = false; });
  }
  /* 顯示用：有 url 走 thumbnail，沒有就從 IDB 取 dataURL */
  function photoSrc(p, cb) { if (p.url) { cb(imgSrc(p.url, 800)); return; } idbGet(p.pid).then(function (d) { cb(d || ''); }).catch(function () { cb(''); }); }
  function pendingPhotos() { var n = 0; S.findings.forEach(function (f) { (f.photos || []).forEach(function (p) { if (p.pid && !p.url) n++; }); }); return n; }

  /* ── 題庫 ── */
  function sections() { return BANK.sections; }
  function section(id) { for (var i = 0; i < BANK.sections.length; i++) if (BANK.sections[i].id === id) return BANK.sections[i]; return null; }
  function subs(sec) { var s = section(sec); return (s && s.subs) || []; }
  function items(sec) {
    var all = BANK.items.concat(S.custom.items.filter(function (i) { return !i.del && !i.k; }));
    return all.filter(function (i) { return (!sec || i.sec === sec) && !(S.custom.hidden[i.id] && S.custom.hidden[i.id].h); });
  }
  /* TW 文件覆寫與待辦完成狀態都寄生在 custom.items（帶 k 標記），
     這樣可以沿用既有的 id＋ts 合併邏輯，雲端 gs 不必為了新欄位改版。 */
  function cRec(id) { for (var i = 0; i < S.custom.items.length; i++) if (S.custom.items[i].id === id) return S.custom.items[i]; return null; }
  function cPut(id, kind, o) {
    var r = cRec(id);
    if (!r) { r = { id: id, k: kind }; S.custom.items.push(r); }
    for (var x in o) r[x] = o[x];
    r.by = by(); r.ts = now(); touch(); return r;
  }
  function item(id) { for (var i = 0; i < BANK.items.length; i++) if (BANK.items[i].id === id) return BANK.items[i]; for (i = 0; i < S.custom.items.length; i++) if (S.custom.items[i].id === id) return S.custom.items[i]; return null; }
  function secName(id) { var s = section(id); return s ? t(s.zh, s.en) : id; }
  function histBy(id) { var it = item(id); return (it && it.hist) || []; }
  function history() { var out = []; BANK.items.forEach(function (i) { (i.hist || []).forEach(function (h) { out.push(h); }); }); return out; }

  /* TW 對應文件可在站上直接補填／修改，存 custom.tw（伺服器端同樣依 ts 新者勝） */
  function twDoc(iid) {
    var o = cRec('tw:' + iid), it = item(iid);
    if (o && o.doc != null && !o.del) return { doc: o.doc, edited: true, by: o.by, ts: o.ts };
    return { doc: (it && it.tw && it.tw.doc) || '', edited: false, src: (it && it.tw && it.tw.src) || '' };
  }
  function setTwDoc(iid, doc) { cPut('tw:' + iid, 'tw', { doc: doc }); }

  /* ── 待辦提醒（整合待辦清單 47 筆）：完成狀態全站共用，不分場次 ── */
  function todos() { return (BANK.todos || []); }
  function todosFor(iid) { var m = (BANK.todoByItem || {})[iid] || []; return todos().filter(function (x) { return m.indexOf(x.no) >= 0; }); }
  function todosGeneral() { return todos().filter(function (x) { return !x.items || !x.items.length; }); }
  function todoDone(no) { var o = cRec('todo:' + no); return o && o.done ? { done: true, by: o.by, ts: o.ts, note: o.note || '' } : null; }
  function setTodoDone(no, done, note) { cPut('todo:' + no, 'todo', { done: !!done, note: note || '' }); }
  function todoStat() {
    var all = todos(), d = 0, p1 = 0, p1d = 0;
    all.forEach(function (x) { var k = !!todoDone(x.no); if (k) d++; if (x.pri === 'P1') { p1++; if (k) p1d++; } });
    return { total: all.length, done: d, open: all.length - d, p1: p1, p1done: p1d };
  }

  /* 身分模式：aces＝內部（看得到複核提醒與 TW 歷史缺失）／customer＝客戶 */
  function mode() { try { return localStorage.getItem(LS_MODE) || 'aces'; } catch (e) { return 'aces'; } }
  function setMode(m) { try { localStorage.setItem(LS_MODE, m === 'customer' ? 'customer' : 'aces'); } catch (e) {} }
  function isCustomer() { return mode() === 'customer'; }

  /* ── 場次 / 結果 / 缺失 ── */
  /* 同日期＋同廠別＋同名稱的場次已存在就直接沿用，不重複建立（多裝置各建一場 → 雲端合併後出現一堆同名場次的防呆） */
  function findSame(o) { var nm = String(o.name || '').trim(), dt = o.date || today(), pl = o.plant || 'PH'; return liveSessions().filter(function (s) { return String(s.name || '').trim() === nm && (s.date || '') === dt && (s.plant || 'PH') === pl; })[0] || null; }
  function newSession(o) {
    var ex = findSame(o); if (ex) { setCur(ex.id); return ex; }
    var s = { id: uid('s'), name: o.name || '', plant: o.plant || 'PH', date: o.date || today(), auditors: o.auditors || '', scope: o.scope || 'all', note: o.note || '', ts: now() };
    if (o.auto) s.auto = true;
    S.sessions.push(s); setCur(s.id); touch(); return s;
  }
  function sessionEmpty(s) { var R = S.results[s.id] || {}; for (var k in R) if (R[k] && R[k].r) return false; return !S.findings.some(function (f) { return f.sid === s.id && !f.del; }); }
  /* 同步後清理：自動建立、沒填任何東西、且同日同名另有一場的預設場次 → 標記刪除 */
  function dedupeAuto() {
    var live = liveSessions(), changed = false;
    live.forEach(function (s) {
      if (!s.auto || !sessionEmpty(s)) return;
      var other = live.filter(function (x) { return x !== s && !x.del && String(x.name || '').trim() === String(s.name || '').trim() && (x.date || '') === (s.date || '') && (x.plant || 'PH') === (s.plant || 'PH'); })[0];
      if (other) { s.del = true; s.ts = now(); changed = true; if (curId() === s.id) setCur(other.id); }
    });
    if (changed) touch();
  }
  function saveSession(s) { s.ts = now(); touch(); }
  function delSession(s) { s.del = true; s.ts = now(); touch(); }
  function result(sid, iid) { return (S.results[sid] || {})[iid] || null; }
  /* who: 'self'（ACES 自身）或 'cust'（客戶）。兩組獨立欄位，整筆物件同步、依 ts 新者勝。 */
  function setResult(sid, iid, r, note, who) {
    if (!S.results[sid]) S.results[sid] = {};
    var o = S.results[sid][iid] || {}, c = who === 'cust';
    if (r !== undefined) { if (c) o.cr = r; else o.r = r; }
    if (note !== undefined) { if (c) o.cnote = note; else o.note = note; }
    if (c) { o.cts = now(); o.cby = by(); } else { o.ts = now(); o.by = by(); }
    o.ts = o.ts || now();
    S.results[sid][iid] = o; touch();
  }
  function resultOf(sid, iid, who) {
    var o = result(sid, iid) || {};
    return who === 'cust' ? { r: o.cr || '', note: o.cnote || '', by: o.cby || '', ts: o.cts || 0 }
                          : { r: o.r || '', note: o.note || '', by: o.by || '', ts: o.ts || 0 };
  }
  function findings(sid) { return S.findings.filter(function (f) { return !f.del && (!sid || f.sid === sid); }); }
  function findingsFor(sid, iid) { return findings(sid).filter(function (f) { return f.item === iid; }); }
  function newFinding(sid, iid) {
    var it = item(iid);
    var f = { id: uid('f'), sid: sid, item: iid, who: isCustomer() ? 'cust' : 'self', section: it ? it.sec : '', desc: '', sev: 'Minor', dept: '', owner: '', due: '', photos: [], by: by(), ts: now(), created: today() };
    S.findings.push(f); touch(); return f;
  }
  function saveFinding(f) { f.ts = now(); touch(); }
  function delFinding(f) { f.del = true; f.ts = now(); (f.photos || []).forEach(function (p) { if (p.pid) idbDel(p.pid); }); touch(); }

  function progress(sid, sec, who) {
    var its = items(sec), R = S.results[sid] || {}, k = who === 'cust' ? 'cr' : 'r';
    var c = { total: its.length, ok: 0, ng: 0, na: 0, done: 0 };
    its.forEach(function (i) { var o = R[i.id], r = o && o[k]; if (r) { c.done++; c[r] = (c[r] || 0) + 1; } });
    c.pct = c.total ? Math.round(c.done / c.total * 100) : 0;
    return c;
  }

  /* ── 啟動 ── */
  function init(cb) {
    loadLocal(); applyLang();
    var b = $('langBtn'); if (b) b.onclick = function () { setLang(lang() === 'en' ? 'zh' : 'en'); };
    /* 首場預設（菲律賓廠模擬稽核）改成「先同步雲端，雲端也沒有場次」才建，避免每台裝置各建一場 */
    function ensureDefault() { if (!cur() && !liveSessions().length) newSession({ name: '廣達供應商稽核 Quanta Supplier Audit', plant: 'PH', auditors: by(), auto: true }); }
    if (!REMOTE || !REMOTE.url || !navigator.onLine) ensureDefault();
    cb && cb(S);
    sync(function (ok) { dedupeAuto(); ensureDefault(); cb && cb(S, ok); });
    window.addEventListener('online', function () { sync(); });
    setInterval(function () { if (S.dirty || pendingPhotos()) sync(); }, 60000);
  }
  function syncBadge() {
    var pp = pendingPhotos();
    if (!REMOTE || !REMOTE.url) return { cls: 'warn', msg: t('未設定雲端，僅本機記錄', 'No cloud configured – local only') };
    if (S.online && !S.dirty && !pp) return { cls: 'sync', msg: t('☁️ 已同步雲端 ', '☁️ Synced ') + (S.lastSync ? fmtTs(S.lastSync) : '') };
    if (!navigator.onLine) return { cls: 'off', msg: t('📴 離線中 — 記錄已存本機，連網後自動同步', '📴 Offline – saved locally, auto-sync when online') + (pp ? '・📷 ' + pp : '') };
    return { cls: 'warn', msg: t('⏳ 待同步', '⏳ Pending sync') + (pp ? t('・照片 ', ' · photos ') + pp : '') + (S.dirty ? '' : '') };
  }
  function renderStatus() { var b = syncBadge(); status(b.cls, b.msg); }
  document.addEventListener('aud:sync', renderStatus); document.addEventListener('aud:change', renderStatus); document.addEventListener('aud:photo', renderStatus);

  w.AUD = { $: $, esc: esc, uid: uid, now: now, today: today, fmtTs: fmtTs, toast: toast, status: status,
    lang: lang, setLang: setLang, t: t, applyLang: applyLang, by: by, setBy: setBy,
    S: S, init: init, sync: sync, touch: touch, saveLocal: saveLocal, renderStatus: renderStatus, syncBadge: syncBadge,
    cur: cur, setCur: setCur, liveSessions: liveSessions, newSession: newSession, saveSession: saveSession, delSession: delSession,
    sections: sections, section: section, subs: subs, items: items, item: item, secName: secName,
    histBy: histBy, history: history, BANK: BANK, REMOTE: REMOTE,
    twDoc: twDoc, setTwDoc: setTwDoc, todos: todos, todosFor: todosFor, todosGeneral: todosGeneral,
    todoDone: todoDone, setTodoDone: setTodoDone, todoStat: todoStat, mode: mode, setMode: setMode, isCustomer: isCustomer, resultOf: resultOf,
    result: result, setResult: setResult, findings: findings, findingsFor: findingsFor, newFinding: newFinding, saveFinding: saveFinding, delFinding: delFinding,
    progress: progress, addPhoto: addPhoto, photoSrc: photoSrc, imgSrc: imgSrc, pendingPhotos: pendingPhotos, flushPhotos: flushPhotos, apiPost: apiPost, apiGet: apiGet };
})(window);
