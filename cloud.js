/* 安记云端层：账号与数据同步（同源 API）。
   设计：localStorage 仍是离线缓存；登录后云端为权威源，save() 时增量推送到云端。 */
window.Cloud = (function () {
  var TOKEN_KEY = 'anjie_token_v1';
  var EMAIL_KEY = 'anjie_email_v1';
  var token = null;
  var email = null;
  try { token = localStorage.getItem(TOKEN_KEY) || null; } catch (e) {}
  try { email = localStorage.getItem(EMAIL_KEY) || null; } catch (e) {}

  function setToken(t, em) {
    token = t; email = em || email;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
      if (email) localStorage.setItem(EMAIL_KEY, email); else localStorage.removeItem(EMAIL_KEY);
    } catch (e) {}
  }
  function isLoggedIn() { return !!token; }
  function getToken() { return token; }
  function getEmail() { return email || ''; }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(path, Object.assign({ headers: headers }, opts)).then(function (r) {
      // 先取文本再解析：避免后端不存在时静态托管返回 HTML 导致 JSON.parse 抛 "Unexpected token '<'"
      return r.text().then(function (text) {
        var j;
        try { j = text ? JSON.parse(text) : {}; }
        catch (e) {
          throw new Error('云端返回了非 JSON 响应（当前环境可能未连接后端服务），请改用「仅本地使用」或部署带后端的版本。');
        }
        if (r.status === 401) { setToken(null); throw new Error(j.error || '登录已失效'); }
        if (!r.ok) throw new Error(j.error || ('请求失败 ' + r.status));
        return j;
      });
    }).catch(function (err) {
      // fetch 自身抛错（后端不存在 / 网络不可达）→ 友好提示，而非裸奔的网络错误
      if (err && err.message && /非 JSON|未连接|云端返回/.test(err.message)) throw err;
      throw new Error('无法连接云端（未检测到可用的后端服务），请改用「仅本地使用」或部署带后端的版本。');
    });
  }

  // 检测云端后端是否可达（复用 server/index.js 的 /api/health）。不可达时前端应引导用户走本地模式。
  function checkBackend() {
    return fetch('/api/health', { method: 'GET' }).then(function (r) {
      return !!r.ok;
    }).catch(function () { return false; });
  }

  function register(email, password) {
    return api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: email, password: password }) })
      .then(function (j) { setToken(j.token, j.user && j.user.email); return j.user; });
  }
  function login(email, password) {
    return api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: password }) })
      .then(function (j) { setToken(j.token, j.user && j.user.email); return j.user; });
  }
  function logout() { setToken(null, null); }

  // 拉取全部数据：交易 + 目标
  function pull() {
    return Promise.all([ api('/api/txns'), api('/api/goals') ]).then(function (rs) {
      return { txns: (rs[0].items || []), goals: rs[1] || {} };
    });
  }
  // 推送交易（全量，带 updatedAt）
  function pushTxns(items) {
    var withTs = (items || []).map(function (t) {
      return Object.assign({}, t, { updatedAt: t.updatedAt || t.createdAt || Date.now() });
    });
    return api('/api/txns/sync', { method: 'POST', body: JSON.stringify({ items: withTs }) });
  }
  // 推送目标（完整 payload）
  function pushGoals(payload) {
    return api('/api/goals', { method: 'POST', body: JSON.stringify(payload || {}) });
  }

  return {
    isLoggedIn: isLoggedIn, getToken: getToken, getEmail: getEmail, login: login, register: register,
    logout: logout, pull: pull, pushTxns: pushTxns, pushGoals: pushGoals, setToken: setToken,
    checkBackend: checkBackend
  };
})();
