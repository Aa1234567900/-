/* ============================================================
   安记本地数据库 LocalDB —— 零依赖 IndexedDB 封装
   目的：让应用真正"本地可操作"，数据落在浏览器原生数据库（IndexedDB），
         而非脆弱的 localStorage。刷新、重启浏览器、离线都可正常留存。
   降级：若浏览器环境不支持 IndexedDB（极少见 / 隐私模式限制），
         自动降级到 localStorage，应用永不崩溃，只是换了个存储位置。
   同源性：本文件同时支持浏览器（window.LocalDB）与 Node 测试（module.exports）。
   ============================================================ */

(function (global) {
  'use strict';

  var DB_NAME = 'anjie_local_db';
  var DB_VERSION = 1;
  var STORE_TXNS = 'txns';     // 交易：keyPath = 'id'
  var STORE_GOALS = 'goals';   // 目标：单例记录，key = 'singleton'
  var GOALS_KEY = 'singleton';

  // localStorage 降级键（与历史版本键保持一致，便于一次性迁移）
  var LS_TXNS = 'anjie_txn_v2';
  var LS_GOALS = 'anjie_goal_v2';

  var dbPromise = null;
  var useFallback = false;

  function hasIndexedDB() {
    try {
      return !!(global.indexedDB && global.IDBTransaction && global.IDBKeyRange);
    } catch (e) { return false; }
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve /*, reject */) {
      if (!hasIndexedDB()) {
        useFallback = true;
        resolve(null);
        return;
      }
      var req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        useFallback = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_TXNS)) {
          db.createObjectStore(STORE_TXNS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_GOALS)) {
          db.createObjectStore(STORE_GOALS, { keyPath: 'key' });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (/* e */) {
        // 打开失败（如隐私模式禁用）→ 降级，不让应用崩溃
        useFallback = true;
        resolve(null);
      };
      // 某些浏览器在版本变更被拒绝时会触发 onblocked；忽略即可，下次再试
      req.onblocked = function () { /* noop */ };
    });
    return dbPromise;
  }

  function store(db, name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  function reqToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* ---------------- 交易 ---------------- */
  function getAllTxns() {
    return openDB().then(function (db) {
      if (!db) return lsGet(LS_TXNS, []);
      var s = store(db, STORE_TXNS, 'readonly');
      return reqToPromise(s.getAll());
    });
  }

  function putTxns(items) {
    items = items || [];
    return openDB().then(function (db) {
      if (!db) { lsSet(LS_TXNS, items); return items.length; }
      var s = store(db, STORE_TXNS, 'readwrite');
      var ps = items.map(function (it) { return reqToPromise(s.put(it)); });
      return Promise.all(ps).then(function () { return items.length; });
    });
  }

  function clearTxns() {
    return openDB().then(function (db) {
      if (!db) { lsSet(LS_TXNS, []); return; }
      return reqToPromise(store(db, STORE_TXNS, 'readwrite').clear());
    });
  }

  /* ---------------- 目标（单例） ---------------- */
  function getGoals() {
    return openDB().then(function (db) {
      if (!db) return lsGet(LS_GOALS, null);
      var s = store(db, STORE_GOALS, 'readonly');
      return reqToPromise(s.get(GOALS_KEY)).then(function (rec) {
        return rec ? rec.payload : null;
      });
    });
  }

  function saveGoals(payload) {
    return openDB().then(function (db) {
      if (!db) { lsSet(LS_GOALS, payload); return; }
      var s = store(db, STORE_GOALS, 'readwrite');
      return reqToPromise(s.put({ key: GOALS_KEY, payload: payload }));
    });
  }

  /* ---------------- 清空 ---------------- */
  function clearAll() {
    return openDB().then(function (db) {
      if (!db) { lsSet(LS_TXNS, []); lsSet(LS_GOALS, null); return; }
      return Promise.all([
        reqToPromise(store(db, STORE_TXNS, 'readwrite').clear()),
        reqToPromise(store(db, STORE_GOALS, 'readwrite').clear())
      ]);
    });
  }

  /* ---------------- 一次性迁移：localStorage → IndexedDB ----------------
     把历史版本（v2）留在 localStorage 里的数据搬到 IndexedDB。
     由于交易按 id 作为 keyPath、目标为单例键，重复迁移是幂等的（覆盖而非重复）。 */
  function migrateFromLocalStorage() {
    return openDB().then(function (db) {
      if (!db) return; // 降级模式下 localStorage 本身就是存储，无需迁移
      return getAllTxns().then(function (existing) {
        var chain = Promise.resolve();
        if (!existing || !existing.length) {
          var legacyTxns = lsGet(LS_TXNS, null);
          if (legacyTxns && legacyTxns.length) {
            chain = putTxns(legacyTxns).then(function () { lsSet(LS_TXNS, []); });
          }
        }
        return chain.then(function () {
          return getGoals().then(function (eg) {
            if (eg) return;
            var lg = lsGet(LS_GOALS, null);
            if (lg) return saveGoals(lg).then(function () { lsSet(LS_GOALS, null); });
          });
        });
      });
    });
  }

  /* ---------------- localStorage 降级读写 ---------------- */
  function lsGet(key, dflt) {
    try {
      var v = global.localStorage.getItem(key);
      return v ? JSON.parse(v) : dflt;
    } catch (e) { return dflt; }
  }
  function lsSet(key, val) {
    try { global.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 配额/隐私模式：忽略 */ }
  }

  var api = {
    open: openDB,
    getAllTxns: getAllTxns,
    putTxns: putTxns,
    clearTxns: clearTxns,
    getGoals: getGoals,
    saveGoals: saveGoals,
    clearAll: clearAll,
    migrateFromLocalStorage: migrateFromLocalStorage,
    isFallback: function () { return useFallback; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LocalDB = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
