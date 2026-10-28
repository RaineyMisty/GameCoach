"use strict";

// The API origin is fixed by public deployment config, never by links or user input.
window.GameCoachBackend = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0];
  const sessions = new Map(), queues = new Map();
  const providerNames = new Set(['gemini', 'deepseek', 'openai', 'grok', 'claude']);
  let selectedProvider = '';
  const pageOrigin = window.location?.origin || 'http://localhost';
  const configuredOrigin = window.GameCoachConfig?.apiBaseUrl ?? '';
  let apiOrigin, configurationError;
  try {
    if (typeof configuredOrigin !== 'string') throw new Error();
    const address = new URL(configuredOrigin || pageOrigin);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
    if ((address.protocol !== 'https:' && !(address.protocol === 'http:' && local))
        || address.username || address.password || address.search || address.hash || address.pathname !== '/'
        || configuredOrigin.includes('?') || configuredOrigin.includes('#')) throw new Error();
    if (window.location?.protocol === 'https:' && address.protocol !== 'https:') throw new Error();
    apiOrigin = address.origin;
  } catch { configurationError = true; }
  const storageKey = id => 'gamecoach-backend-session:v2:' + encodeURIComponent(apiOrigin) + ':' + id;
  // 团队访问码按后端地址保存在本浏览器，仅用于创建 / 恢复会话。
  const accessStorageKey = () => 'gamecoach-team-access:v1:' + encodeURIComponent(apiOrigin);
  function savedAccessCode() {
    if (configurationError) return '';
    try { return localStorage.getItem(accessStorageKey()) || ''; } catch { return ''; }
  }
  function rememberAccessCode(value) {
    if (configurationError || !value) return;
    try { localStorage.setItem(accessStorageKey(), value); } catch {}
  }
  const demoProfiles = { quick: window.GameCoachAI.getProfile('quick'), coach: window.GameCoachAI.getProfile('coach') };
  function read(id) {
    if (configurationError) return null;
    if (sessions.has(id)) return sessions.get(id);
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey(id)) || 'null'); } catch {}
    if (!saved) try { saved = JSON.parse(sessionStorage.getItem(storageKey(id)) || 'null'); } catch {}
    // 旧版同源身份迁移，仍不将凭证发送到其他后端。
    if (!saved && apiOrigin === pageOrigin) {
      const oldKey = 'gamecoach-backend-session:' + id;
      try {
        const legacy = JSON.parse(sessionStorage.getItem(oldKey) || 'null');
        if (legacy?.token && legacy?.conversations) {
          saved = {...legacy, server: apiOrigin};
          sessionStorage.removeItem(oldKey);
        }
      } catch {}
    }
    if (saved?.server === apiOrigin && saved?.token && saved?.conversations) {
      save(id, saved); return saved;
    }
    return null;
  }
  function save(id, value) {
    value.server = apiOrigin;
    sessions.set(id, value);
    try { localStorage.setItem(storageKey(id), JSON.stringify(value)); } catch {}
    try { sessionStorage.setItem(storageKey(id), JSON.stringify(value)); } catch {}
  }
  const diagnostics = {
    ACCESS_CODE_REQUIRED: '请输入正确的团队访问码。',
    HTTPS_REQUIRED: '请使用 HTTPS 打开部署网站；本地开发请使用 localhost。',
    STORAGE_KEY_ERROR: '服务端无法解密数据，请恢复原来的加密主密钥。',
    STATE_CONFLICT: '另一处已更新此用户数据。本机修改仍保留，请重新连接并核对备份。',
    RECOVERY_INVALID: '私有恢复文件无效，请检查文件和服务器地址。',
    RATE_LIMITED: '团队每分钟请求额度已用完，请稍后重试。',
    SERVER_KEY_MISSING: '请输入此厂商的 API Key，或请管理员配置服务器默认 Key。',
    SERVER_PROVIDER_INVALID: '服务端默认厂商配置无效，请检查 GAMECOACH_PROVIDER。',
    UPSTREAM_DNS_ERROR: '服务器无法解析所选厂商域名，请检查服务器网络。密钥尚未验证。',
    UPSTREAM_TLS_ERROR: '服务器与模型厂商的证书校验失败，请检查服务器证书配置。',
    UPSTREAM_PROXY_ERROR: '服务器代理连接失败，请检查代理设置。',
    UPSTREAM_NETWORK_ERROR: '服务器无法连接所选模型厂商，请检查服务器网络。',
    UPSTREAM_KEY_INVALID: '所选厂商返回密钥无效或过期，请更新 API Key。',
    UPSTREAM_PERMISSION_DENIED: '所选厂商拒绝访问，请检查密钥权限、地区和项目限制。',
    UPSTREAM_MODEL_NOT_FOUND: '所选模型不可用，请检查服务器模型配置和账户权限。',
    UPSTREAM_QUOTA_EXCEEDED: '模型服务请求频率或额度达到限制，请检查账户配额。',
    UPSTREAM_BALANCE_INSUFFICIENT: '模型服务账户余额不足，请检查账户。',
    UPSTREAM_INVALID_REQUEST: '模型服务不接受本次参数，请检查服务器模型配置。',
    UPSTREAM_INVALID_RESPONSE: '模型服务返回了无法读取的回复，请重试。',
    UPSTREAM_INCOMPLETE_REPLY: '模型没有返回可用的完整回答，请调整问题后重试。',
  };
  async function request(path, { token, signal, body, method = 'GET', accessCode } = {}) {
    if (configurationError) throw new Error(tr('后端地址配置无效，请在 frontend/config.js 中填写 HTTPS 服务器地址，不要包含路径或密钥。'));
    if (!configuredOrigin && window.location?.hostname.endsWith('.github.io')) {
      throw new Error(tr('GitHub Pages 尚未配置后端，请先在 frontend/config.js 填写树莓派的 HTTPS 地址。'));
    }
    const location = window.location;
    if (location && location.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
      throw new Error(tr('请使用 HTTPS 打开部署网站；本地开发请使用 localhost。'));
    }
    let response;
    try {
      const url = (apiOrigin === pageOrigin ? '' : apiOrigin) + '/api' + path;
      response = await fetch(url, { method, signal, credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(accessCode ? { 'X-GameCoach-Access': accessCode } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(tr('无法连接服务器。本地记录仍保留，请检查后端地址、HTTPS 和服务器的 CORS 设置。'));
    }
    if (!response.ok) {
      let code;
      try { code = (await response.json())?.detail?.code; } catch {}
      if (response.status === 401 && token) for (const [id, session] of sessions) {
        if (session.token === token) { session.invalid = true; save(id, session); }
      }
      const fallback = { 401: '用户会话已失效，请重新连接或导入私有恢复文件。',
        404: '后端接口或对话不存在，请重启更新后的 Python 服务。',
        409: '此对话同时收到其他请求，请重试。', 422: '提交内容格式无效或过长，请检查后重试。',
        503: '服务器配置未完成，请检查密钥和加密设置。', 504: '模型响应超时，请重试。' };
      const error = new Error(tr(diagnostics[code] || fallback[response.status] || '服务器请求失败，请重试。')
        + (Object.hasOwn(diagnostics, code) ? ' [' + code + ']' : ''));
      error.code = code; error.status = response.status; throw error;
    }
    if (token && path !== '/sessions/current') for (const [id, session] of sessions) {
      if (session.token === token) { session.expires_at = Date.now() / 1000 + 7 * 24 * 60 * 60; save(id, session); }
    }
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw new Error(tr('服务器返回格式异常，请重试。')); }
  }
  function identity(user = window.GCStore.current()) {
    return { userId: user.id, user: { name: user.name, profile: user.profile || {} } };
  }
  async function ensureSession(person, signal, accessCode) {
    accessCode = accessCode || savedAccessCode();
    let session = read(person.userId);
    if (session && (session.invalid || session.expires_at <= Date.now() / 1000)) {
      if (!session.recovery) throw new Error(tr('用户会话已失效，请重新连接或导入私有恢复文件。'));
      session = { ...session, ...await request('/sessions/restore', { method: 'POST', signal, accessCode,
        body: { recovery: session.recovery } }), invalid: false };
      save(person.userId, session);
      rememberAccessCode(accessCode);
    }
    if (!session) {
      session = { ...await request('/sessions', { method: 'POST', body: person.user, signal, accessCode }), conversations: {} };
      save(person.userId, session);
      rememberAccessCode(accessCode);
    }
    return session;
  }
  function snapshot() {
    return structuredClone(window.GCStore.exportUser ? window.GCStore.exportUser().user : window.GCStore.current());
  }
  async function pushState(user) {
    const session = read(user.id);
    if (!session || session.invalid) return;
    if (!Number.isInteger(session.stateVersion)) {
      const remote = await request('/user-state', { token: session.token });
      session.stateVersion = remote.version;
    }
    const result = await request('/user-state', { method: 'PUT', token: session.token,
      body: { version: session.stateVersion, user } });
    session.stateVersion = result.version; save(user.id, session);
  }
  function syncUser(user = snapshot()) {
    return userOperation(user.id, () => pushState(user));
  }
  function userOperation(id, action) {
    const previous = queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(id, next);
    return next;
  }
  async function loadState(user, session) {
    return userOperation(user.id, async () => {
    const remote = await request('/user-state', { token: session.token });
    session.stateVersion = remote.version; save(user.id, session);
    if (window.GCStore.current().id !== user.id) throw new Error(tr('用户已切换，请重新连接。'));
    const local = snapshot();
    if (remote.user && window.GCStore.restoreSnapshot) {
      if ((Date.parse(remote.user.updatedAt) || 0) > (Date.parse(local.updatedAt) || 0)) {
        window.GCStore.restoreSnapshot(remote.user, user.id);
      } else if (remote.recovered_replies) {
        for (const conversation of local.sessions || []) {
          const server = remote.user.sessions?.find(item => item.id === conversation.id);
          for (const reply of conversation.messages || []) {
            const restored = server?.messages?.find(item => item.id && item.id === reply.id && item.status === 'complete');
            if (restored && ['pending','error'].includes(reply.status)) Object.assign(reply, restored);
          }
        }
        window.GCStore.restoreSnapshot(local, user.id);
      }
    }
    await pushState(snapshot());
    });
  }
  async function testConnection(provider = selectedProvider, accessCode) {
    if (provider && !providerNames.has(provider)) throw new Error(tr('请选择支持的模型厂商。'));
    const query = provider ? '?provider=' + encodeURIComponent(provider) : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const session = await ensureSession(identity(), controller.signal, accessCode);
      return await request('/connection' + query, { token: session.token, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(tr('连接测试超时，请检查服务器网络后重试。'));
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function connect({ provider = '', apiKey = '', accessCode = '' } = {}) {
    if (provider && !providerNames.has(provider)) throw new Error(tr('请选择支持的模型厂商。'));
    if (!provider) provider = (await request('/providers')).default_provider;
    const person = identity(), session = await ensureSession(person, undefined, accessCode);
    if (window.GCStore.current().id !== person.userId) throw new Error(tr('用户已切换，请重新连接。'));
    await loadState(window.GCStore.current(), session);
    if (apiKey.trim()) await request('/credentials/' + provider, { method: 'PUT', token: session.token, body: { api_key: apiKey.trim() } });
    if (window.GCStore.current().id !== person.userId) throw new Error(tr('用户已切换，请重新连接。'));
    const result = await testConnection(provider, accessCode);
    return { ...result, provider };
  }
  async function forgetKey(provider = selectedProvider) {
    if (!providerNames.has(provider)) return;
    const session = read(window.GCStore.current().id);
    if (session) await request('/credentials/' + provider, { method: 'DELETE', token: session.token });
  }
  function recoveryFile() {
    const user = window.GCStore.current(), session = read(user.id);
    if (!session?.recovery) throw new Error(tr('请先连接 API，创建可恢复的用户会话。'));
    return { format: 'gamecoach-private-access', version: 2, server: apiOrigin,
      localUserId: user.id, name: user.name, recovery: session.recovery };
  }
  async function restoreAccess(file, accessCode = '') {
    const validServer = !configurationError && file?.server === apiOrigin
      && (file.version === 2 || (file.version === 1 && apiOrigin === pageOrigin));
    if (file?.format !== 'gamecoach-private-access' || !validServer || typeof file.recovery !== 'string') {
      throw new Error(tr('私有恢复文件无效，请检查文件和服务器地址。'));
    }
    accessCode = accessCode || savedAccessCode();
    const result = await request('/sessions/restore', { method: 'POST', accessCode, body: { recovery: file.recovery } });
    rememberAccessCode(accessCode);
    let user = window.GCStore.users().find(item => item.id === file.localUserId);
    if (user) window.GCStore.select(user.id, { notifyBackend: false });
    else user = window.GCStore.create((file.name || 'Recovered user').slice(0, 20) + ' ' + Date.now().toString().slice(-3));
    const session = { ...result, recovery: file.recovery, conversations: {} };
    save(user.id, session);
    const remote = await request('/user-state', { token: session.token });
    session.stateVersion = remote.version; save(user.id, session);
    if (remote.user && window.GCStore.restoreSnapshot) window.GCStore.restoreSnapshot(remote.user, user.id);
    await syncUser(snapshot());
    return result;
  }
  window.GameCoachAI.registerProvider('backend', { isDemo: false,
    async generate({ input, conversation, model, signal, onDelta }) {
      const provider = selectedProvider;
      if (!conversation?.userId || !conversation?.id) throw new Error(tr('后端请求缺少用户或对话信息。'));
      const session = await ensureSession(conversation, signal);
      if (window.GCStore.current().id === conversation.userId) await syncUser(snapshot());
      let id = session.conversations[conversation.id];
      if (!id) {
        id = (await request('/conversations', { method: 'POST', token: session.token, signal,
          body: { local_id: conversation.id } })).conversation_id;
        session.conversations[conversation.id] = id; save(conversation.userId, session);
      }
      const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
      const result = await request('/chat', { method: 'POST', token: session.token, signal, body: {
        conversation_id: id, request_id: crypto.randomUUID(), message: messages.at(-1).content,
        context: messages.slice(0, -1).filter(item => item.role === 'user').map(item => item.content).join('\n\n'),
        instructions: messages.filter(item => ['system', 'developer'].includes(item.role)).map(item => item.content).join('\n\n'),
        mode: model === 'backend-coach' ? 'coach' : 'quick', user: conversation.user,
        ...(provider ? { provider } : {}),
        ...(conversation.replyId ? { client_reply_id: conversation.replyId } : {}),
      } });
      onDelta(result.content); return result;
    },
  });
  function activate(provider = '') {
    if (provider && !providerNames.has(provider)) throw new Error(tr('请选择支持的模型厂商。'));
    selectedProvider = provider;
    disconnect();
    window.GameCoachAI.configure({ provider: 'backend', modes: {
      quick: { ...demoProfiles.quick, model: 'backend-quick', timeoutMs: 75000 },
      coach: { ...demoProfiles.coach, model: 'backend-coach', timeoutMs: 75000 },
    } });
  }
  function disconnect() {
    window.GameCoachAI.configure({ provider: 'demo', modes: {
      quick: { ...demoProfiles.quick, instructions: '' }, coach: { ...demoProfiles.coach, instructions: '' },
    } });
  }
  if (window.addEventListener) {
    window.addEventListener('gamecoach:user-updated', event => {
      if (!read(event.detail.user.id)) return;
      syncUser(event.detail.user).catch(() => window.dispatchEvent(new Event('gamecoach:sync-failed')));
    });
    window.addEventListener('online', () => { if (read(window.GCStore.current().id)) syncUser().catch(() => {}); });
  }
  return Object.freeze({ activate, disconnect, connect, testConnection, forgetKey, recoveryFile, restoreAccess, syncUser,
    getApiOrigin: () => configurationError ? null : apiOrigin,
    getProviderName: () => selectedProvider, isActive: () => window.GameCoachAI.getProviderName() === 'backend' });
})();
