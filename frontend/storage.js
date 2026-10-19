'use strict';
// Local-only accounts. This is not server authentication.
window.GCStore = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  const key = 'gamecoach-users-v2';
  const legacyKey = 'gamecoach-static-v1';
  const uuid = () => globalThis.crypto?.randomUUID?.() || 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const defaults = () => ({ rank: '', level: '', role: 'other', championPool: [], preferences: '' });
  const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
  const text = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
  function cleanDraft(draft) {
    const game = window.GameCoachGames?.get(draft?.gameId) || window.GAMECOACH_DATA;
    return window.GameCoachDraft.normalize(draft, id => game.champions.some(champion => champion.id === id));
  }
  function cleanProfile(p) {
    const result = defaults();
    if (!p || typeof p !== 'object') return result;
    for (const field of ['rank', 'level', 'preferences']) result[field] = text(p[field]);
    result.role = ['support', 'top', 'jungle', 'mid', 'adc', 'other'].includes(p.role) ? p.role : 'other';
    if (Array.isArray(p.championPool)) result.championPool = p.championPool.filter(x => typeof x === 'string').slice(0, 100).map(x => x.slice(0, 80));
    return result;
  }
  function cleanMessage(message) {
    if (!message || !['user', 'coach'].includes(message.role)) return null;
    return { role: message.role, content: text(message.content, 6000),
      mode: message.mode === 'coach' ? 'coach' : 'quick', draft: cleanDraft(message.draft),
      created: text(message.created, 80),
      id: safeId(message.id) ? message.id : undefined,
      status: ['complete', 'cancelled', 'error'].includes(message.status) ? message.status : message.status === 'pending' ? 'cancelled' : 'complete',
      provider: text(message.provider, 80), model: text(message.model, 120),
      isDemo: message.isDemo !== false, reasoningEffort: text(message.reasoningEffort, 20),
      finishReason: text(message.finishReason, 40),
      inReplyTo: safeId(message.inReplyTo) ? message.inReplyTo : undefined,
      localOnly: message.localOnly === true,
      usedMemories: (Array.isArray(message.usedMemories) ? message.usedMemories : []).slice(0, 6)
        .filter(item => item && safeId(item.id)).map(item => ({ id: item.id, title: text(item.title, 80) })),
      attempts: Number.isInteger(message.attempts) && message.attempts >= 1 && message.attempts <= 3 ? message.attempts : undefined,
      sources: (Array.isArray(message.sources) ? message.sources : []).slice(0, 24).flatMap(source => {
        try {
          const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol)) return [];
          return [{ url: url.href, title: text(source.title, 160) || url.hostname, kind: source.kind === 'local' ? 'local' : 'web',
            gameId: text(source.gameId, 20), version: text(source.version, 80), fetchedOn: text(source.fetchedOn, 40) }];
        } catch { return []; }
      }),
      searched: message.searched === true, searchSuggestions: text(message.searchSuggestions, 30000),
      usage: message.usage && Number.isFinite(message.usage.totalTokens) ? {
        inputTokens: Number.isFinite(message.usage.inputTokens) ? Math.max(0, message.usage.inputTokens) : undefined,
        outputTokens: Number.isFinite(message.usage.outputTokens) ? Math.max(0, message.usage.outputTokens) : undefined,
        totalTokens: Math.max(0, message.usage.totalTokens),
      } : undefined,
      timings: message.timings && Number.isFinite(message.timings.totalMs) && Number.isFinite(message.timings.firstDeltaMs)
        ? { totalMs: Math.max(0, message.timings.totalMs), firstDeltaMs: Math.max(0, message.timings.firstDeltaMs) } : undefined };
  }
  function cleanUser(raw) {
    if (!raw || !safeId(raw.id) || !text(raw.name, 24).trim()) throw new Error(tr("无效的用户备份文件。"));
    const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).slice(-30).filter(s => s && safeId(s.id)).map(s => ({
      id: s.id, title: text(s.title, 80), created: text(s.created, 80),
      messages: (Array.isArray(s.messages) ? s.messages : []).slice(-100).map(cleanMessage).filter(Boolean),
    }));
    const draft = cleanDraft(raw.draft); const drafts = {};
    for (const game of window.GameCoachGames?.list || [{ gameId: 'lolm' }]) {
      if (raw.drafts?.[game.gameId]) drafts[game.gameId] = cleanDraft({ ...raw.drafts[game.gameId], gameId: game.gameId });
    }
    drafts[draft.gameId] = draft;
    return { id: raw.id, name: raw.name.trim().slice(0, 24), profile: cleanProfile(raw.profile),
      memory: window.GameCoachMemory.normalize(raw.memory, cleanProfile(raw.profile)),
      draft, drafts, sessions, updatedAt: text(raw.updatedAt, 80) || new Date().toISOString() };
  }
  const newUser = name => ({ id: uuid(), name: name.trim(), profile: defaults(), memory: window.GameCoachMemory.seed(), draft: window.GameCoachDraft.empty(), sessions: [], updatedAt: new Date().toISOString() });
  let database;
  let browserAvailable = true;
  let directory = null;
  let writeQueue = Promise.resolve();
  let notices = [];
  let reporter = null;
  function notify(message) { if (reporter) reporter(message); else notices.push(message); }
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && raw.version === 2 && Array.isArray(raw.users)) {
      const ids = new Set();
      const users = raw.users.map(cleanUser).filter(user => { if (ids.has(user.id)) return false; ids.add(user.id); return true; });
      if (!users.length) throw new Error('Empty account store');
      database = { version: 2, activeId: users.some(u => u.id === raw.activeId) ? raw.activeId : users[0].id, users };
    }
  } catch { browserAvailable = false; notify(tr("浏览器中的用户数据无法读取，请导入备份；当前改动暂不覆盖原数据。")); }
  if (!database) {
    const user = newUser(tr("我的用户"));
    // Keep the old storage untouched so migration is reversible.
    try {
      const old = JSON.parse(localStorage.getItem(legacyKey) || 'null');
      if (old) {
        user.profile = cleanProfile(old.profile);
        user.memory = window.GameCoachMemory.withProfile(user.memory, user.profile);
        const rows = Array.isArray(old.analyses) ? old.analyses.slice(-30) : [];
        user.sessions = rows.filter(r => r && r.input && r.result).map(row => ({
          id: uuid(), title: text(row.input.question, 40) || tr("历史阵容分析"), created: text(row.created, 80),
          messages: [{ role: 'user', content: text(row.input.question, 4000) || tr("分析这套阵容。"), mode: row.result.mode === 'coach' ? 'coach' : 'quick', draft: cleanDraft(row.input), created: text(row.created, 80) },
            { role: 'coach', content: text(row.result.summary, 6000), mode: row.result.mode === 'coach' ? 'coach' : 'quick', draft: cleanDraft(row.input), created: text(row.created, 80) }],
        }));
      }
    } catch { notify(tr("旧版资料暂时无法读取，可通过导入 JSON 备份恢复。")); }
    database = { version: 2, activeId: user.id, users: [user] };
  }
  const current = () => database.users.find(u => u.id === database.activeId);
  async function writeJSON(dir, name, value) {
    const file = await dir.getFileHandle(name, { create: true });
    const writer = await file.createWritable();
    try { await writer.write(JSON.stringify(value, null, 2)); await writer.close(); }
    catch (error) { try { await writer.abort(); } catch {} throw error; }
  }
  async function writeDatabase(dir, snapshot) {
    // Write users first; publish the manifest only after every user succeeds.
    for (const user of snapshot.users) await writeJSON(dir, user.id + '.json', { format: 'gamecoach-user', version: 2, user });
    await writeJSON(dir, 'gamecoach-index.json', { format: 'gamecoach-index', version: 2, activeId: snapshot.activeId, users: snapshot.users.map(u => ({ id: u.id, name: u.name })) });
  }
  function persist({ touch = true, syncFolder = true } = {}) {
    if (touch) current().updatedAt = new Date().toISOString();
    let ok = false;
    if (browserAvailable) {
      try { localStorage.setItem(key, JSON.stringify(database)); ok = true; }
      catch { notify(tr("浏览器无法保存数据。请导出备份，或连接本地用户文件夹。")); }
    } else notify(tr("浏览器存储不可用。请导出备份或连接本地文件夹保存。"));
    if (directory && syncFolder) {
      const snapshot = JSON.parse(JSON.stringify(database));
      const dir = directory;
      writeQueue = writeQueue.then(() => writeDatabase(dir, snapshot)).then(() => notify(tr("已同步到本地用户文件夹。"))).catch(() => notify(tr("文件夹同步失败，浏览器记录仍保留。请重新连接目录或导出备份。")));
    }
    return ok;
  }
  function create(name) {
    name = name.trim();
    if (!name || name.length > 24) throw new Error(tr("请输入 1–24 字的昵称。"));
    if (database.users.some(u => u.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(tr("这个昵称已存在，请直接切换到该用户。"));
    const user = newUser(name); database.users.push(user); database.activeId = user.id; persist(); return user;
  }
  function saveDraft(draft) {
    const cleaned = cleanDraft(draft); const user = current(); user.drafts ||= {};
    user.draft = cleaned; user.drafts[cleaned.gameId] = cleaned; persist(); return cleaned;
  }
  function selectGame(id) {
    if (!window.GameCoachGames?.has(id)) throw new Error(tr("这个游戏暂未接入。"));
    // Carry the current lineup across games; target validation clears unavailable
    // heroes in place, without restoring an older per-game draft.
    return saveDraft({ ...current().draft, gameId: id });
  }
  function select(id) {
    if (!database.users.some(u => u.id === id)) throw new Error(tr("用户不存在。"));
    database.activeId = id; persist({ touch: false });
  }
  function mergeUsers(users) {
    const merged = new Map(database.users.map(u => [u.id, u]));
    for (const user of users) {
      const old = merged.get(user.id);
      if (!old || (Date.parse(user.updatedAt) || 0) > (Date.parse(old.updatedAt) || 0)) merged.set(user.id, user);
    }
    database.users = [...merged.values()];
  }
  async function connectFolder() {
    if (!window.showDirectoryPicker) throw new Error(tr("此浏览器不支持直接保存到文件夹，请在 Chrome 或 Edge 打开 HTTPS 网页；也可以使用导入 / 导出。"));
    const chosen = await window.showDirectoryPicker({ id: 'gamecoach-users', mode: 'readwrite', startIn: 'documents' });
    // Drain writes to the previous folder before switching handles.
    await writeQueue;
    let manifest;
    try {
      const handle = await chosen.getFileHandle('gamecoach-index.json');
      const file = await handle.getFile();
      if (file.size > 2_000_000) throw new Error(tr("用户索引文件过大。"));
      manifest = JSON.parse(await file.text());
    } catch (error) { if (error.name !== 'NotFoundError') throw new Error(tr("无法读取用户文件夹，请检查 gamecoach-index.json；没有覆盖现有文件。")); }
    const imported = [];
    if (manifest) {
      if (manifest.format !== 'gamecoach-index' || manifest.version !== 2 || !Array.isArray(manifest.users) || manifest.users.length > 200) throw new Error(tr("文件夹不是有效的 GameCoach 用户目录。"));
      for (const entry of manifest.users) {
        if (!safeId(entry.id)) throw new Error(tr("用户索引包含无效 ID，已停止连接。"));
        const handle = await chosen.getFileHandle(entry.id + '.json');
        const file = await handle.getFile();
        if (file.size > 10_000_000) throw new Error(tr("用户文件过大，已停止连接。"));
        const raw = JSON.parse(await file.text());
        if (raw.format !== 'gamecoach-user' || raw.version !== 2 || raw.user?.id !== entry.id) throw new Error(tr("用户文件格式错误，已停止连接。"));
        imported.push(cleanUser(raw.user));
      }
    }
    mergeUsers(imported);
    await writeDatabase(chosen, database);
    directory = chosen;
    persist({ touch: false, syncFolder: false });
    return chosen.name;
  }
  function importBackup(raw) {
    let user;
    if (raw?.format === 'gamecoach-user' && raw.version === 2) user = cleanUser(raw.user);
    else if (raw?.profile && Array.isArray(raw.analyses)) {
      user = newUser(tr("导入的用户")); user.profile = cleanProfile(raw.profile);
      user.memory = window.GameCoachMemory.withProfile(user.memory, user.profile);
      const rows = raw.analyses.slice(-30).filter(r => r?.input && r?.result);
      user.sessions = rows.map(row => ({ id: uuid(), title: text(row.input.question, 40) || tr("导入的分析"), created: text(row.created, 80), messages: [
        { role: 'user', content: text(row.input.question, 4000) || tr("分析阵容"), mode: 'quick', draft: cleanDraft(row.input), created: text(row.created, 80) },
        { role: 'coach', content: text(row.result.summary, 6000), mode: 'quick', draft: cleanDraft(row.input), created: text(row.created, 80) },
      ] }));
    } else throw new Error(tr("请选择 GameCoach 用户备份 JSON。"));
    // Import as a separate user so an existing user's data is never overwritten.
    if (database.users.some(u => u.id === user.id)) user.id = uuid();
    const base = user.name;
    let suffix = 1;
    while (database.users.some(u => u.name === user.name)) user.name = base.slice(0, 16) + tr("（导入 ") + suffix++ + '）';
    database.users.push(user); database.activeId = user.id; persist(); return user;
  }
  return {
    uuid, current, cleanProfile, cleanDraft, create, select, saveDraft, selectGame, persist, connectFolder, importBackup,
    users: () => database.users,
    folderConnected: () => !!directory,
    browserAvailable: () => browserAvailable,
    exportUser: () => ({ format: 'gamecoach-user', version: 2, exportedAt: new Date().toISOString(), user: current() }),
    setReporter(callback) { reporter = callback; for (const notice of notices) callback(notice); notices = []; },
  };
})();
