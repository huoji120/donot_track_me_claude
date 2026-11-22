const DEFAULT_AUTO = { mode: 'all', hosts: [] };
const httpURL = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
};

export function normalizeWorkerAuto(input) {
  if (!['manual', 'sites', 'all'].includes(input?.mode)) throw new Error('请选择有效的自动同步模式。');
  const lines = typeof input.hosts === 'string' ? input.hosts.split(/\r?\n/) : input.hosts;
  if (!Array.isArray(lines)) throw new Error('请每行填写一个主机名或 HTTP(S) URL。');
  const entries = lines.map((line) => String(line).trim()).filter(Boolean);
  if (entries.length > 200) throw new Error('最多填写 200 个网站。');
  const hosts = new Set();
  for (const entry of entries) {
    const explicitURL = /^[a-z][a-z\d+.-]*:\/\//i.test(entry);
    const url = httpURL(explicitURL ? entry : `https://${entry}`);
    if (!url || !url.hostname || /[*\s]/.test(url.hostname) || url.username || url.password || /[*\s\\@]/.test(entry)
        || (!explicitURL && /[/?#]/.test(entry))
        || (!explicitURL && entry.includes(':') && !/^\[[\da-f:.]+\](?::\d+)?$/i.test(entry) && !/^[^:]+:\d+$/.test(entry))) {
      throw new Error(`网站地址无效：${entry}。不支持凭据、通配符或非 HTTP(S) 地址。`);
    }
    hosts.add(url.hostname);
  }
  return { mode: input.mode, hosts: [...hosts] };
}

export function createWorkerAuto(sync, readSettings) {
  let holds = 0;
  let generation = 0;
  const queues = new Map();
  const revisions = new Map();
  const starting = new Set();
  const navigationReady = new Set();
  const closed = new Set();
  const key = (id) => `workerAutoTab:${id}`;
  const get = async () => (await chrome.storage.local.get('workerAuto')).workerAuto ?? { ...DEFAULT_AUTO, hosts: [] };
  const tabState = async (id) => (await chrome.storage.session.get(key(id)))[key(id)] ?? { paused: false, owner: null };
  const store = (id, state) => closed.has(id) ? Promise.resolve() : chrome.storage.session.set({ [key(id)]: state });
  const enqueue = (id, action) => {
    const work = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    queues.set(id, work);
    const clear = () => { if (queues.get(id) === work) queues.delete(id); };
    work.then(clear, clear);
    return work;
  };
  const matches = (config, url) => Boolean(url && (config.mode === 'all' || (config.mode === 'sites' && config.hosts.includes(url.hostname))));
  const report = (work) => work.catch(console.error);

  async function reconcile(id, navigation = false) {
    const expected = generation;
    const revision = revisions.get(id) ?? 0;
    return enqueue(id, async () => {
      if (closed.has(id)) return;
      const [auto, config, state, tab] = await Promise.all([get(), readSettings(), tabState(id), chrome.tabs.get(id).catch(() => null)]);
      const eligible = config.enabled && config.rules.worker && matches(auto, httpURL(tab?.url));
      if (state.owner === 'auto' && !eligible) {
        await sync.stop(id, 'auto_scope_changed');
        state.owner = null;
        await store(id, state);
      }
      if (!eligible || holds || expected !== generation || revision !== (revisions.get(id) ?? 0) || state.paused || closed.has(id)) return;
      if (navigation && !navigationReady.delete(id)) return;
      const status = await sync.status(id);
      if (status.attached || status.phase === 'starting') return;
      if (holds || expected !== generation || revision !== (revisions.get(id) ?? 0) || closed.has(id)) return;
      state.owner = 'auto';
      state.origin = httpURL(tab.url).origin;
      await store(id, state);
      if (holds || expected !== generation || revision !== (revisions.get(id) ?? 0) || closed.has(id)) return;
      starting.add(id);
      navigationReady.delete(id);
      try { await sync.start(id); }
      finally { starting.delete(id); }
    });
  }

  async function reconcileAll() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => reconcile(tab.id)));
  }

  function hold() {
    ++holds;
    ++generation;
    return () => { --holds; };
  }

  async function manualStart(id) {
    if (!Number.isInteger(id) || id < 0) throw new Error('当前标签页无效。');
    const revision = (revisions.get(id) ?? 0) + 1;
    revisions.set(id, revision);
    return enqueue(id, async () => {
      const config = await readSettings();
      if (holds || revision !== revisions.get(id) || closed.has(id) || !config.enabled || !config.rules.worker) throw new Error('防护或 Worker 调试同步已关闭，或配置正在更新。');
      const state = await tabState(id);
      state.paused = false;
      state.owner = 'manual';
      await store(id, state);
      // No asynchronous boundary between this final guard and start: global off
      // can invalidate the underlying attempt as soon as it is requested.
      if (holds || revision !== revisions.get(id)) throw new Error('同步启动已取消。');
      starting.add(id);
      navigationReady.delete(id);
      try { return await sync.start(id); }
      finally { starting.delete(id); }
    });
  }

  async function manualStop(id) {
    if (!Number.isInteger(id) || id < 0) throw new Error('当前标签页无效。');
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    const stopping = sync.stop(id, 'user_stopped');
    return enqueue(id, async () => {
      await store(id, { paused: true, owner: null });
      await stopping;
      return sync.status(id);
    });
  }

  async function status(id) {
    const [auto, state] = await Promise.all([get(), Number.isInteger(id) && id >= 0 ? tabState(id) : { paused: false, owner: null }]);
    return { ...auto, ...state };
  }

  chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
    if (frameId !== 0) return;
    if (!starting.has(tabId)) navigationReady.add(tabId);
    report(enqueue(tabId, async () => {
      const [auto, state] = await Promise.all([get(), tabState(tabId)]);
      const target = httpURL(url);
      if (state.owner === 'auto' && (!matches(auto, target) || (state.origin && target?.origin !== state.origin))) {
        await sync.stop(tabId, 'auto_scope_changed');
        state.owner = null;
        await store(tabId, state);
      }
    }));
  });
  chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, documentLifecycle }) => {
    if (frameId === 0 && (!documentLifecycle || documentLifecycle === 'active')) report(reconcile(tabId, true));
  });
  chrome.tabs.onRemoved.addListener((id) => {
    closed.add(id);
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    navigationReady.delete(id);
    report(enqueue(id, async () => {
      await chrome.storage.session.remove(key(id));
      revisions.delete(id);
      closed.delete(id);
    }));
  });

  return { get, status, hold, reconcileAll, manualStart, manualStop };
}
