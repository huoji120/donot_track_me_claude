import { DEFAULT_PROFILE, normalizeProfile } from './profile.js';
import { applyNetworkSettings } from './network.js';
import { createWorkerSync } from './worker-sync.js';
import { createWorkerAuto, normalizeWorkerAuto } from './worker-auto.js';
import { DEFAULT_RULES, DEFAULT_NETWORK_RULES, normalizeRules, maskProfile } from './feature-rules.js';
const MATCHES = ['http://*/*', 'https://*/*'];
const REQUESTS = { urls: [...MATCHES, 'ws://*/*', 'wss://*/*'] };
const SIGNALS = new Set(['canvas', 'webgl', 'webgpu', 'audio', 'rects', 'screen', 'touch', 'hardware', 'media', 'webrtc', 'browser', 'language', 'plugins', 'cookies', 'location', 'fonts', 'timezone']);
const MAX_HOSTS = 100;
const CONFIG = { enabled: true, zone: 'Asia/Singapore', ...DEFAULT_NETWORK_RULES, profile: DEFAULT_PROFILE, rules: DEFAULT_RULES, schema: 2 };
const policy = chrome.privacy.network.webRTCIPHandlingPolicy;
const tabQueues = new Map();
const tabStates = new Map();
let settingsQueue = Promise.resolve();

const hostname = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const fresh = (host = '') => ({ host, signals: [], hosts: [], capped: false });
const settings = async () => {
  const saved = (await chrome.storage.local.get('settings')).settings ?? {};
  return { ...CONFIG, ...saved, profile: normalizeProfile(saved.profile), rules: normalizeRules(saved.rules), schema: 2 };
};

const workerSync = createWorkerSync(async (url) => {
  const config = await settings();
  const library = await getLibrary();
  const selected = library.profiles.find((entry) => entry.id === library.assignments[hostname(url)]);
  const p = maskProfile(selected?.profile ?? config.profile, config.rules);
  // The debugger path needs only enabled identity values, never a seed or ID.
  return { enabled: config.enabled, worker: config.rules.worker, zone: config.rules.timezone ? selected?.zone ?? config.zone : '',
    profile: { languages: p.languages, cpu: p.cpu, memory: p.memory } };
});
const workerAuto = createWorkerAuto(workerSync, settings);

function forTab(id, change) {
  if (id < 0) return Promise.resolve();
  const key = `tab:${id}`;
  const work = (tabQueues.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const state = tabStates.get(id) ?? (await chrome.storage.session.get(key))[key] ?? fresh();
    const next = change(state);
    if (next === null) {
      tabStates.delete(id);
      await chrome.storage.session.remove(key);
      return;
    }
    tabStates.set(id, next ?? state);
    if (next !== undefined) await chrome.storage.session.set({ [key]: next });
    return next ?? state;
  });
  tabQueues.set(id, work);
  const clear = () => { if (tabQueues.get(id) === work) tabQueues.delete(id); };
  work.then(clear, (e) => { clear(); console.error(e); });
  return work;
}

chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0) forTab(tabId, () => fresh(hostname(url)));
});
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url, documentLifecycle }) => {
  if (frameId !== 0 || documentLifecycle !== 'active') return;
  const host = hostname(url);
  forTab(tabId, (state) => state.host === host ? undefined : { ...state, host });
});
chrome.tabs.onRemoved.addListener((id) => forTab(id, () => null));

function recordHost({ tabId, url, initiator, documentLifecycle }, block = '') {
  if (tabId < 0 || (documentLifecycle && documentLifecycle !== 'active')) return;
  const host = hostname(url);
  if (!host) return;
  forTab(tabId, (state) => {
    const pageHost = state.host || hostname(initiator);
    if (!block && (!pageHost || pageHost === host)) return;
    const item = state.hosts.find((item) => item.host === host);
    if (item) {
      if (!block || item.blocks.includes(block)) return;
      item.blocks.push(block);
    } else if (state.hosts.length < MAX_HOSTS) {
      state.hosts.push({ host, blocks: block ? [block] : [] });
    } else {
      if (state.capped && !block) return;
      state.capped = true;
      if (block) {
        const replace = state.hosts.findLastIndex((item) => item.blocks.length === 0);
        if (replace !== -1) state.hosts[replace] = { host, blocks: [block] };
      }
    }
    return state;
  });
}

chrome.webRequest.onBeforeRequest.addListener((request) => {
  if (request.type !== 'main_frame') recordHost(request);
}, REQUESTS);
// Only unpacked extensions receive this event. Do not infer blocks from failed connections.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(({ rule, request }) => {
  if (rule.rulesetId === 'privacy_rules' && rule.ruleId === 1) recordHost(request, 'tracker');
  if (rule.rulesetId === '_dynamic' && rule.ruleId >= 1000 && rule.ruleId < 1100) recordHost(request, 'port');
});

async function validateZone(input) {
  const zone = String(input ?? '').trim();
  if (!zone) return '';
  const invalid = '请输入有效的 IANA 时区，如 Asia/Shanghai。';
  if (!/^[a-z][a-z0-9_+/-]*$/i.test(zone)) throw new Error(invalid);
  let canonical;
  try { canonical = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone; }
  catch (error) { if (error instanceof RangeError) throw new Error(invalid); throw error; }
  // Runtime data comes from the bundle rather than the OS clock or the page.
  const response = await fetch(chrome.runtime.getURL('zones/index.json'));
  const available = await response.json();
  const key = available[canonical] ?? available[zone];
  if (!Number.isInteger(key)) throw new Error('此 IANA 时区不在当前扩展的时区表中。');
  return { canonical, key };
}

async function getLibrary() {
  const stored = (await chrome.storage.local.get('library')).library ?? { profiles: [], assignments: {} };
  return { ...stored, profiles: stored.profiles.map((entry) => ({ ...entry, profile: normalizeProfile(entry.profile) })) };
}

async function pageProfile(sender) {
  let page;
  try { page = new URL(sender.origin ?? sender.url); } catch { return { enabled: false }; }
  // An explicitly opaque sender origin must not fall back to its URL.
  if (!['http:', 'https:'].includes(page.protocol) || page.origin === 'null') return { enabled: false };
  await settingsQueue.catch(() => {});
  const config = await settings();
  if (!config.enabled) return { enabled: false, rules: config.rules, zone: '', profile: null };
  const library = await getLibrary();
  const selected = library.profiles.find((entry) => entry.id === library.assignments[page.hostname]);
  const profile = selected?.profile ?? config.profile;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(profile.seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`dntm-page-profile-v1\0${page.origin}`));
  const seed = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { enabled: true, rules: config.rules, profile: maskProfile({ ...profile, seed }, config.rules), zone: config.rules.timezone ? selected?.zone ?? config.zone : '' };
}

async function normalizeLibrary(input) {
  if (!Array.isArray(input?.profiles) || input.profiles.length > 100) throw new Error('最多保存 100 套指纹。');
  const ids = new Set();
  const profiles = [];
  for (const entry of input.profiles) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || ids.has(entry.id)) throw new Error('指纹档案 ID 无效或重复。');
    const name = String(entry.name).trim();
    if (!name || name.length > 80) throw new Error('档案名称必须为 1–80 个字符。');
    const zone = await validateZone(entry.zone);
    profiles.push({ id: entry.id, name, profile: normalizeProfile(entry.profile), zone: zone ? zone.canonical : '' });
    ids.add(entry.id);
  }
  const assignments = Object.create(null);
  const bindings = Object.entries(input.assignments ?? {});
  if (bindings.length > 200) throw new Error('最多绑定 200 个网站。');
  for (const [site, id] of bindings) {
    if (!ids.has(id)) throw new Error('网站绑定的指纹不存在，请先解除绑定。');
    let url;
    try { url = new URL(site.includes('://') ? site : `https://${site}`); } catch { throw new Error('网站地址无效。'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[*\s]/.test(site)) throw new Error('请输入完整网站域名，不支持通配符。');
    assignments[url.hostname] = id;
  }
  return { profiles, assignments };
}

async function applySettings(config, zone, library) {
  library ??= await getLibrary();
  const registrations = [];
  const make = (id, matches, selectedZone, rawProfile, excludeMatches = []) => {
    const rules = config.rules;
    const p = maskProfile(rawProfile, rules);
    const zone = rules.timezone ? selectedZone : '';
    const hooks = [];
    if (p.canvas || (p.font && p.font !== 'native')) hooks.push('hook-text.js');
    if (p.gpuVendor || p.gpuRenderer) hooks.push('hook-webgl.js');
    if (p.audio) hooks.push('hook-audio.js');
    if (p.languages) hooks.push('hook-languages.js');
    if (p.cpu) hooks.push('hook-cpu.js');
    if (p.memory) hooks.push('hook-memory.js');
    if (p.width) hooks.push('hook-screen.js');
    if (rules.privacySignals) hooks.push('hook-privacy.js');
    if (rules.observe) hooks.push('hook-observe.js');
    if (zone) hooks.push(`zones/${zone.key}.js`, 'timezone-core.js', 'timezone.js');
    if (!hooks.length) return;
    registrations.push({ id, matches, excludeMatches,
      js: ['report.js', 'shield.js', ...hooks, 'hook-finish.js'],
      world: 'MAIN', allFrames: true, matchOriginAsFallback: true, runAt: 'document_start' });
  };
  if (config.enabled) {
    const exclusions = [];
    for (const [host, id] of Object.entries(library.assignments)) {
      const entry = library.profiles.find((p) => p.id === id);
      if (!entry) continue;
      const match = `*://${host}/*`;
      exclusions.push(match);
      make(`page-site-${exclusions.length}`, [match], config.rules.timezone ? await validateZone(entry.zone) : '', entry.profile);
    }
    make('page-privacy', MATCHES, zone, config.profile, exclusions);
  }
  const current = await chrome.scripting.getRegisteredContentScripts();
  const ids = new Set(registrations.map((r) => r.id));
  const removals = current.filter((r) => !ids.has(r.id)).map((r) => r.id);
  const existing = new Set(current.map((r) => r.id));
  const updates = registrations.filter((r) => existing.has(r.id));
  const additions = registrations.filter((r) => !existing.has(r.id));
  if (updates.length) await chrome.scripting.updateContentScripts(updates);
  if (removals.length) await chrome.scripting.unregisterContentScripts({ ids: removals });
  if (additions.length) await chrome.scripting.registerContentScripts(additions);

  await applyNetworkSettings(config, library);

  const state = await policy.get({});
  if (config.enabled && config.webrtc) {
    if (state.levelOfControl === 'controllable_by_this_extension' || state.levelOfControl === 'controlled_by_this_extension') {
      await policy.set({ value: 'disable_non_proxied_udp' });
    }
  } else if (state.levelOfControl === 'controlled_by_this_extension') {
    await policy.clear({});
  }
}

function configure(input) {
  const release = workerAuto.hold();
  const stopping = input ? workerSync.stopAll('config_changed') : Promise.resolve();
  let resumeAuto = false;
  const work = settingsQueue.catch(() => {}).then(async () => {
    const previous = await settings();
    const zone = await validateZone(input?.zone ?? previous.zone);
    if (input?.rules !== undefined) normalizeRules(input.rules);
    const config = { ...previous, ...input, zone: zone ? zone.canonical : '', profile: normalizeProfile(input?.profile ?? previous.profile), rules: normalizeRules({ ...previous.rules, ...input?.rules }), schema: 2 };
    for (const key of ['enabled', 'webrtc', 'trackers', 'localPorts']) config[key] = !!config[key];
    resumeAuto = !previous.enabled && config.enabled;
    await stopping;
    try {
      await applySettings(config, zone);
      await chrome.storage.local.set({ settings: config });
      const library = await getLibrary();
      await chrome.storage.local.set({ library });
    } catch (error) {
      if (input) await applySettings(previous, await validateZone(previous.zone)).catch(console.error);
      throw error;
    }
    return config;
  });
  settingsQueue = work.finally(release);
  settingsQueue.then(() => { if (resumeAuto) return workerAuto.reconcileAll(); }).catch(console.error);
  return settingsQueue;
}

function saveLibrary(input) {
  const release = workerAuto.hold();
  const stopping = workerSync.stopAll('config_changed');
  const work = settingsQueue.catch(() => {}).then(async () => {
    const next = await normalizeLibrary(input);
    const previous = await getLibrary();
    const config = await settings();
    const zone = await validateZone(config.zone);
    await stopping;
    try {
      await applySettings(config, zone, next);
      await chrome.storage.local.set({ library: next });
    } catch (error) {
      await applySettings(config, zone, previous).catch(console.error);
      throw error;
    }
    return next;
  });
  settingsQueue = work.finally(release);
  return settingsQueue;
}

function initialize() {
  configure().then(() => workerAuto.reconcileAll()).catch(console.error);
}
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

function saveWorkerAuto(input) {
  const next = normalizeWorkerAuto(input);
  const release = workerAuto.hold();
  const work = settingsQueue.catch(() => {}).then(async () => {
    await chrome.storage.local.set({ workerAuto: next });
    return next;
  });
  settingsQueue = work.finally(release);
  return settingsQueue.then(async (value) => {
    await workerAuto.reconcileAll();
    return value;
  });
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'pageProfile') {
    if (sender.id !== chrome.runtime.id || !sender.tab) return;
    pageProfile(sender).then((value) => reply({ value }), () => reply({ value: { enabled: false } }));
    return true;
  }
  if (message?.type === 'signal') {
    if (!sender.tab || !SIGNALS.has(message.signal) || (sender.documentLifecycle && sender.documentLifecycle !== 'active')) return;
    forTab(sender.tab.id, (state) => {
      if (sender.frameId === 0 && state.host && hostname(sender.url) !== state.host) return;
      const source = typeof message.source === 'string' && /^[^\s?#]{1,254}$/.test(message.source) ? message.source : '';
      if (state.signals.some((item) => item.key === message.signal && item.source === source) || state.signals.length >= 100) return;
      state.signals.push({ key: message.signal, source });
      return state;
    });
    return;
  }
  if (![chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html')].includes(sender.url?.split('#')[0])) return;
  let work;
  if (message?.type === 'get') {
    work = Promise.all([settingsQueue.catch(() => {}), forTab(message.tabId, () => {})]).then(async ([, tab]) => {
      const config = await settings();
      const library = await getLibrary();
      const browserTab = message.tabId >= 0 ? await chrome.tabs.get(message.tabId).catch(() => null) : null;
      const host = hostname(browserTab?.url) || tab?.host;
      const selected = library.profiles.find((entry) => entry.id === library.assignments[host]);
      return {
        settings: config, webrtc: await policy.get({}), tab, workerSync: await workerSync.status(message.tabId),
        workerAuto: await workerAuto.status(message.tabId),
        activeProfile: selected ? { id: selected.id, name: selected.name, zone: selected.zone }
          : { id: null, name: '默认指纹', zone: config.zone }
      };
    });
  } else if (message?.type === 'save') {
    work = configure(message.settings);
  } else if (message?.type === 'libraryGet') {
    work = settingsQueue.catch(() => {}).then(getLibrary);
  } else if (message?.type === 'librarySave') {
    work = saveLibrary(message.library);
  } else if (message?.type === 'workerAutoGet') {
    work = settingsQueue.catch(() => {}).then(workerAuto.get);
  } else if (message?.type === 'workerAutoSave') {
    try { work = saveWorkerAuto(message.workerAuto); }
    catch (error) { work = Promise.reject(error); }
  } else if (message?.type === 'privacyToggle') {
    if (typeof message.enabled !== 'boolean') work = Promise.reject(new Error('防护开关值无效。'));
    else work = configure({ enabled: message.enabled });
  } else if (message?.type === 'workerStart') {
    work = settingsQueue.catch(() => {}).then(() => workerAuto.manualStart(message.tabId));
  } else if (message?.type === 'workerStop') {
    work = workerAuto.manualStop(message.tabId);
  } else return;
  work.then((value) => reply({ value }), (error) => reply({ error: error.message }));
  return true;
});
