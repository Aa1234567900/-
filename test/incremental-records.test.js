/* ============================================================
 * 安记 incremental QA — record find / edit / delete
 * jsdom end-to-end tests (real DOM, simulated user interaction).
 * No test framework: node:assert + simple PASS/FAIL output.
 *
 * Run (from repo root, jsdom required):
 *   npm i -D jsdom && node test/incremental-records.test.js
 *   # or point NODE_PATH at an existing jsdom install:
 *   NODE_PATH=/path/to/node_modules node test/incremental-records.test.js
 * ============================================================ */

'use strict';

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const APP = path.join(ROOT, 'app.js');
const CLOUD = path.join(ROOT, 'cloud.js');
const LOCALDB = path.join(ROOT, 'localdb.js');

const FILES = {
  html: fs.readFileSync(INDEX, 'utf8'),
  app: fs.readFileSync(APP, 'utf8'),
  cloud: fs.readFileSync(CLOUD, 'utf8'),
  localdb: fs.readFileSync(LOCALDB, 'utf8'),
};

// Strip external <script src=...> tags so jsdom does not hit the network;
// we inject the three files inline, in order (cloud -> localdb -> app).
function htmlWithoutExternalScripts() {
  return FILES.html.replace(/<script src=[^>]*><\/script>/g, '');
}

function injectScript(window, code) {
  const s = window.document.createElement('script');
  s.textContent = code;
  window.document.body.appendChild(s);
}

/**
 * Build a fresh jsdom app instance.
 * @param {Array} txns  transactions to preload into the localStorage fallback key
 * @param {Object} opts { loggedIn: bool }
 * @returns {Promise<{window, document, dom, pushCalls}>}
 */
async function createApp(txns, opts) {
  opts = opts || {};
  const dom = new JSDOM(htmlWithoutExternalScripts(), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Force LocalDB to use the localStorage fallback (no IndexedDB in jsdom).
  Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  window.IDBTransaction = undefined;
  window.IDBKeyRange = undefined;
  // jsdom does not implement scrollTo; navigate() calls it.
  window.scrollTo = function () {};
  // No backend: fetch always rejects. Cloud.checkBackend() must catch -> false (no throw).
  window.fetch = function () { return Promise.reject(new Error('no backend')); };

  // Preload transactions into the fallback storage key ('anjie_txn_v2')
  // BEFORE app.js runs init() -> load() reads them.
  if (txns) window.localStorage.setItem('anjie_txn_v2', JSON.stringify(txns));

  // Inject scripts in dependency order.
  injectScript(window, FILES.cloud);
  injectScript(window, FILES.localdb);
  injectScript(window, FILES.app);

  if (opts.loggedIn) window.Cloud.isLoggedIn = function () { return true; };

  // Spy on Cloud.pushTxns so we can assert tombstone propagation.
  const pushCalls = [];
  window.Cloud.pushTxns = function (items) { pushCalls.push(items); return Promise.resolve(); };

  // Trigger init(). app.js registers init on DOMContentLoaded, but that has
  // already fired before we injected the script, so we invoke it directly.
  if (typeof window.init === 'function') {
    await window.init();
  } else {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((r) => setTimeout(r, 50));
  }
  // Let any async afterLogin()/pull() microtasks settle (logged-in path).
  await new Promise((r) => setTimeout(r, 10));

  return { window, document: window.document, dom, pushCalls };
}

function navigateTo(view, document) {
  document.querySelector('[data-view="' + view + '"]').click();
}

/* ---------------- tiny runner ---------------- */
let pass = 0;
let fail = 0;
const failures = [];
const tests = [];

function test(name, fn) {
  // Register the case; the promise is collected and awaited by the summary block.
  tests.push((async () => {
    try {
      await fn();
      pass++;
      console.log('PASS  ' + name);
    } catch (e) {
      fail++;
      failures.push({ name, msg: e.message });
      console.log('FAIL  ' + name);
      console.log('        ' + (e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e.message));
    }
  })());
}

/* =====================================================================
 * CASE 1 — syntax / structure: `node --check app.js`
 * ===================================================================== */
test('1) syntax: node --check app.js passes', () => {
  execSync(process.execPath + ' --check ' + JSON.stringify(APP), { stdio: 'pipe' });
});

/* =====================================================================
 * CASE 2 — cross-file id consistency (static analysis)
 * Assert every id referenced by app.js via $('x') / getElementById('x')
 * exists in index.html.
 * ===================================================================== */
test('2) cross-file id consistency: every app.js id ref is declared somewhere', () => {
  // A referenced id is valid if it appears either in static index.html OR is
  // dynamically generated via innerHTML in app.js (e.g. goal/rule form fields).
  const knownIds = new Set();
  const idRe = /id="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(FILES.html)) !== null) knownIds.add(m[1]);
  while ((m = idRe.exec(FILES.app)) !== null) knownIds.add(m[1]);

  const refRe = /\$\('([^']+)'\)|getElementById\('([^']+)'\)/g;
  const missing = new Set();
  while ((m = refRe.exec(FILES.app)) !== null) {
    const id = m[1] || m[2];
    if (!knownIds.has(id)) missing.add(id);
  }
  assert.strictEqual(
    missing.size, 0,
    'app.js references id(s) not declared anywhere (index.html or app.js innerHTML): ' +
      Array.from(missing).join(', ')
  );
  assert.ok(knownIds.size > 0, 'sanity: should find ids in source');
});

/* =====================================================================
 * CASE 3 — list renders rows, newest first (desc by createdAt)
 * ===================================================================== */
test('3) list renders rows, newest first (desc order)', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
    { id: 't-ccc', amount: 88.8, note: '买书', category: 'study', createdAt: Date.parse('2026-08-01T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    const list = document.getElementById('records-list');
    assert.strictEqual(list.children.length, 3, 'expected 3 rows, got ' + list.children.length);
    const first = list.children[0].querySelector('.records-note').textContent;
    const last = list.children[list.children.length - 1].querySelector('.records-note').textContent;
    assert.strictEqual(first, '买书', 'first row should be newest (买书), got ' + first);
    assert.strictEqual(last, '午餐外卖', 'last row should be oldest (午餐外卖), got ' + last);
  }
});

/* =====================================================================
 * CASE 4 — keyword filter (note + amount contains)
 * ===================================================================== */
test('4) keyword filter: narrows to matching rows, clears to full', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
    { id: 't-ccc', amount: 88.8, note: '买书', category: 'study', createdAt: Date.parse('2026-07-20T10:00:00') },
    { id: 't-ddd', amount: 18, note: '咖啡', category: 'food', createdAt: Date.parse('2026-07-25T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    const kw = document.getElementById('records-keyword');
    kw.value = '外卖';
    kw.dispatchEvent(new window.Event('input'));
    let rows = document.getElementById('records-list').children;
    assert.strictEqual(rows.length, 1, 'expected 1 row for keyword 外卖, got ' + rows.length);
    assert.strictEqual(rows[0].querySelector('.records-note').textContent, '午餐外卖');

    // keyword also matches amount string
    kw.value = '88.8';
    kw.dispatchEvent(new window.Event('input'));
    rows = document.getElementById('records-list').children;
    assert.strictEqual(rows.length, 1, 'expected 1 row for amount keyword 88.8, got ' + rows.length);
    assert.strictEqual(rows[0].querySelector('.records-note').textContent, '买书');

    // clear -> full list
    kw.value = '';
    kw.dispatchEvent(new window.Event('input'));
    rows = document.getElementById('records-list').children;
    assert.strictEqual(rows.length, 4, 'after clearing keyword expected 4 rows, got ' + rows.length);
  }
});

/* =====================================================================
 * CASE 5 — category filter
 * ===================================================================== */
test('5) category filter: keeps only selected category', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
    { id: 't-ccc', amount: 88.8, note: '买书', category: 'study', createdAt: Date.parse('2026-07-20T10:00:00') },
    { id: 't-ddd', amount: 18, note: '咖啡', category: 'food', createdAt: Date.parse('2026-07-25T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    const sel = document.getElementById('records-cat-filter');
    sel.value = 'food';
    sel.dispatchEvent(new window.Event('change'));
    const rows = document.getElementById('records-list').children;
    assert.strictEqual(rows.length, 2, 'expected 2 food rows, got ' + rows.length);
    for (const r of rows) {
      assert.ok(r.querySelector('.records-cat').textContent.indexOf('餐饮') !== -1,
        'non-food row present: ' + r.querySelector('.records-cat').textContent);
    }
    // reset to all
    sel.value = 'all';
    sel.dispatchEvent(new window.Event('change'));
    assert.strictEqual(document.getElementById('records-list').children.length, 4,
      'after resetting to 全部 expected 4 rows');
  }
});

/* =====================================================================
 * CASE 6 — date range filter (createdAt within [from 00:00, to 23:59:59.999])
 * ===================================================================== */
test('6) date range filter: keeps only in-range rows', async () => {
  const txns = [
    { id: 't-aaa', amount: 10, note: 'a', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 20, note: 'b', category: 'food', createdAt: Date.parse('2026-07-15T10:00:00') },
    { id: 't-ccc', amount: 30, note: 'c', category: 'food', createdAt: Date.parse('2026-08-01T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    const from = document.getElementById('records-from');
    const to = document.getElementById('records-to');
    from.value = '2026-07-10';
    from.dispatchEvent(new window.Event('change'));
    to.value = '2026-07-31';
    to.dispatchEvent(new window.Event('change'));
    const rows = document.getElementById('records-list').children;
    assert.strictEqual(rows.length, 1, 'expected 1 row in range, got ' + rows.length);
    assert.strictEqual(rows[0].querySelector('.records-note').textContent, 'b');
  }
});

/* =====================================================================
 * CASE 7 — empty result shows neutral hint, no error
 * ===================================================================== */
test('7) empty result: shows #records-empty, no rows, no throw', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    const kw = document.getElementById('records-keyword');
    kw.value = '不存在的关键词zzz';
    kw.dispatchEvent(new window.Event('input'));
    const list = document.getElementById('records-list');
    const empty = document.getElementById('records-empty');
    assert.strictEqual(list.children.length, 0, 'expected 0 rows for non-matching keyword');
    assert.strictEqual(empty.hidden, false, '#records-empty should be visible (hidden=false)');
  }
});

/* =====================================================================
 * CASE 8 — edit (unlogged): modal prefilled, save updates DOM + no tombstone push
 * ===================================================================== */
test('8) edit (unlogged): prefilled modal, save updates row, no cloud tombstone', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
  ];
  const { window, document, dom, pushCalls } = await createApp(txns);
  {
    navigateTo('log', document);
    document.querySelector('[data-edit="t-aaa"]').click();
    const modal = document.getElementById('edit-modal');
    assert.strictEqual(modal.hidden, false, 'edit modal should be visible after clicking 编辑');
    assert.strictEqual(document.getElementById('edit-amount').value, '12.5', 'amount should be prefilled');
    assert.strictEqual(document.getElementById('edit-note').value, '午餐外卖', 'note should be prefilled');

    // change values
    document.getElementById('edit-amount').value = '99.9';
    document.getElementById('edit-note').value = '晚餐公交';
    const chips = document.getElementById('edit-cat-list').querySelectorAll('.cat-chip');
    let picked = false;
    chips.forEach((c) => { if (c.textContent === '交通') { c.click(); picked = true; } });
    assert.ok(picked, 'transport (交通) chip not found in edit modal');

    document.getElementById('edit-save').click();
    assert.strictEqual(modal.hidden, true, 'edit modal should close after 保存');

    const row = document.querySelector('[data-del="t-aaa"]').closest('.records-row');
    assert.ok(row, 'edited row for t-aaa missing after save');
    assert.strictEqual(row.querySelector('.records-note').textContent, '晚餐公交', 'note not updated');
    assert.strictEqual(row.querySelector('.records-amt').textContent, '¥99.9',
      'amount not updated, got ' + row.querySelector('.records-amt').textContent);
    assert.ok(row.querySelector('.records-cat').textContent.indexOf('交通') !== -1, 'category not updated');

    // unlogged: Cloud.pushTxns must NOT be called with a tombstone
    const hasTomb = pushCalls.some((arr) => arr.some((it) => it && it._deleted === true));
    assert.strictEqual(hasTomb, false, 'unlogged edit must not push a tombstone');
  }
});

/* =====================================================================
 * CASE 9 — delete (unlogged): confirm modal neutral, row removed,
 *         home recent no longer shows it
 * ===================================================================== */
test('9) delete (unlogged): neutral confirm, row removed, home recent updates', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
    { id: 't-ccc', amount: 88.8, note: '买书', category: 'study', createdAt: Date.parse('2026-08-01T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    document.querySelector('[data-del="t-bbb"]').click();
    const cm = document.getElementById('confirm-modal');
    assert.strictEqual(cm.hidden, false, 'confirm modal should show after clicking 删除');
    assert.strictEqual(document.getElementById('confirm-text').textContent, '确定要移除这笔记录吗？',
      'confirm text should be neutral, got: ' + document.getElementById('confirm-text').textContent);

    document.getElementById('confirm-remove').click();
    assert.strictEqual(cm.hidden, true, 'confirm modal should close after 移除');

    const list = document.getElementById('records-list');
    assert.strictEqual(list.querySelector('[data-del="t-bbb"]'), null, 'deleted row should be gone from list');
    assert.strictEqual(list.children.length, 2, 'expected 2 rows remaining, got ' + list.children.length);

    navigateTo('home', document);
    const recent = document.getElementById('home-recent');
    const found = Array.from(recent.querySelectorAll('.recent-note'))
      .some((n) => n.textContent.indexOf('地铁充值') !== -1);
    assert.strictEqual(found, false, 'deleted note should NOT appear in home recent');
  }
});

/* =====================================================================
 * CASE 10 — delete (logged in): tombstone pushed to cloud
 * ===================================================================== */
test('10) delete (logged in): Cloud.pushTxns called with tombstone {id,_deleted,updatedAt}', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
  ];
  const { window, document, dom, pushCalls } = await createApp(txns, { loggedIn: true });
  {
    assert.strictEqual(window.Cloud.isLoggedIn(), true, 'precondition: should be logged in');
    navigateTo('log', document);
    document.querySelector('[data-del="t-bbb"]').click();
    document.getElementById('confirm-remove').click();

    const tomb = pushCalls.find((arr) => arr.some((it) => it && it._deleted === true && it.id === 't-bbb'));
    assert.ok(tomb, 'expected a Cloud.pushTxns call containing tombstone {id:t-bbb,_deleted:true}; calls=' +
      JSON.stringify(pushCalls.map((a) => a.length)));
    const tombItem = tomb.find((it) => it && it._deleted === true && it.id === 't-bbb');
    assert.ok(typeof tombItem.updatedAt === 'number', 'tombstone should carry numeric updatedAt');

    // the remaining-items push (from save) must NOT contain the deleted id
    const remaining = pushCalls.find((arr) => !arr.some((it) => it && it._deleted === true));
    if (remaining) {
      assert.ok(!remaining.some((it) => it.id === 't-bbb'),
        'remaining push should not contain deleted t-bbb');
    }
  }
});

/* =====================================================================
 * CASE 11 — undo: deleted row restored within 5s window
 * ===================================================================== */
test('11) undo: clicking 撤销 restores the deleted row', async () => {
  const txns = [
    { id: 't-aaa', amount: 12.5, note: '午餐外卖', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
    { id: 't-bbb', amount: 30, note: '地铁充值', category: 'transport', createdAt: Date.parse('2026-07-15T10:00:00') },
  ];
  const { window, document, dom } = await createApp(txns);
  {
    navigateTo('log', document);
    document.querySelector('[data-del="t-bbb"]').click();
    document.getElementById('confirm-remove').click();

    assert.strictEqual(document.getElementById('records-list').querySelector('[data-del="t-bbb"]'), null,
      'row should be gone before undo');

    const toast = document.getElementById('undo-toast');
    assert.strictEqual(toast.hidden, false, 'undo toast should be visible after delete');

    toast.querySelector('.undo-toast-btn').click();

    const row = document.getElementById('records-list').querySelector('[data-del="t-bbb"]');
    assert.ok(row, 'row should reappear after clicking 撤销');
    assert.strictEqual(row.closest('.records-row').querySelector('.records-note').textContent, '地铁充值',
      'restored note mismatch');
  }
});

/* =====================================================================
 * CASE 12 (bonus, security contract) — XSS: malicious note is escaped,
 * not injected as live HTML (design hard-constraint #5: escapeHtml on
 * every user-visible text). Proves the protection works, not just exists.
 * ===================================================================== */
test('12) XSS: malicious note is escaped, not parsed as HTML', async () => {
  const txns = [
    { id: 't-xss', amount: 5, note: '<img src=x onerror=alert(1)>', category: 'food', createdAt: Date.parse('2026-07-01T10:00:00') },
  ];
  const { window, document } = await createApp(txns);
  {
    navigateTo('log', document);
    const noteEl = document.querySelector('#records-list .records-note');
    // Security contract: the malicious payload must NOT become a live DOM element.
    assert.strictEqual(noteEl.querySelector('img'), null,
      'malicious <img> must NOT be parsed into a live element (XSS gap)');
    // The raw tag must be escaped in the HTML source (no live <img ...>).
    assert.ok(noteEl.innerHTML.toLowerCase().indexOf('<img') === -1,
      'innerHTML must not contain a raw <img tag; escaping expected');
    // And the escaped form must be present.
    assert.ok(noteEl.innerHTML.indexOf('&lt;img') !== -1,
      'innerHTML should escape < as &lt; (escapeHtml contract)');
    // textContent carries the literal (safe) string, truncated per design (>24 chars).
    assert.ok(noteEl.textContent.indexOf('<img src=x onerror=alert') === 0,
      'textContent should show the literal (escaped) note text');
  }
});

/* ---------------- summary ---------------- */
(async () => {
  await Promise.all(tests); // wait for every registered case to finish
  console.log('\n========================================');
  console.log('  QA incremental-records  —  SUMMARY');
  console.log('========================================');
  console.log('  Total cases : ' + (pass + fail));
  console.log('  Passed      : ' + pass);
  console.log('  Failed      : ' + fail);
  if (fail > 0) {
    console.log('\n  FAILURES:');
    failures.forEach((f) => console.log('   - ' + f.name + ': ' + f.msg));
  }
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
})();
