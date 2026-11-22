import './timezone-core.js';

const timezoneInstallerKey = Symbol.for('dntm.installTimezone');
const installTimezone = globalThis[timezoneInstallerKey];
delete globalThis[timezoneInstallerKey];

const COMMAND_TIMEOUT = 5000;
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

function deadline(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), COMMAND_TIMEOUT); })
  ]).finally(() => clearTimeout(timer));
}

function originOf(url, fallback = '') {
  try {
    const parsed = new URL(url);
    const origin = new URL(parsed.origin);
    if (origin.protocol === 'http:' || origin.protocol === 'https:') return origin.origin;
  } catch { /* about:blank and opaque blob URLs inherit the attaching parent. */ }
  return fallback;
}

// Pages receive navigator/locale defaults here; their content script owns timezone.
// Dedicated Workers receive the same Date-subclass timezone installer once.
function installRealm(config, marker, expectedOrigin, timezoneInstaller) {
  if (expectedOrigin && location.origin !== expectedOrigin) return false;
  const key = Symbol.for(marker);
  const descriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const apply = Reflect.apply;
  if (descriptor(globalThis, key)) return true;
  const prototype = globalThis.WorkerNavigator?.prototype ?? globalThis.Navigator?.prototype;
  if (!prototype) throw new Error('Navigator prototype unavailable');
  const languages = config.languages ? Object.freeze(config.languages.split(',')) : null;
  const replacements = [
    ['language', languages?.[0]], ['languages', languages],
    ['hardwareConcurrency', config.cpu || null], ['deviceMemory', config.memory || null]
  ];
  const originals = replacements.map(([name, value]) => ({ name, value, original: descriptor(prototype, name) }));
  const owned = [];
  let active = true;
  function cleanup() {
    // A later page/content-script wrapper may retain our getter. Disabling the
    // closure first makes that wrapper delegate to the genuine native getter.
    active = false;
    for (let i = owned.length - 1; i >= 0; i--) {
      const { target, name, original, installed } = owned[i];
      const current = descriptor(target, name);
      if (current && current.value === installed.value && current.get === installed.get && current.set === installed.set &&
          current.configurable === installed.configurable && current.enumerable === installed.enumerable) {
        if (original) define(target, name, original);
        else delete target[name];
      }
    }
    if (descriptor(globalThis, key)?.value === cleanup) delete globalThis[key];
    return true;
  }
  define(globalThis, key, { value: cleanup, configurable: true });
  try {
    for (const { name, value, original } of originals) {
      // Do not invent APIs absent in this context, including insecure workers.
      if (value == null || !original?.configurable || typeof original.get !== 'function') continue;
      const installed = { ...original, get: new Proxy(original.get, {
        apply(fn, receiver, args) {
          const native = apply(fn, receiver, args); // Preserve WebIDL receiver checks.
          return active ? value : native;
        }
      }) };
      define(prototype, name, installed);
      owned.push({ target: prototype, name, original, installed });
    }
    // CDP locale overrides are renderer-wide and conflict across sessions.
    // Per-realm defaults avoid changing other tabs sharing the renderer.
    const locales = (args, index = 0) => {
      const value = args[index];
      if (!active || !languages || !(value === undefined || (Array.isArray(value) && value.length === 0))) return args;
      const next = args.slice();
      next[index] = languages;
      return next;
    };
    const replace = (target, name, value) => {
      const original = descriptor(target, name);
      if (!original?.configurable) return;
      const installed = { ...original, value };
      define(target, name, installed);
      owned.push({ target, name, original, installed });
    };
    if (languages) {
      for (const name of ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter', 'DurationFormat']) {
        const native = Intl[name];
        if (typeof native !== 'function') continue;
        const replacement = new Proxy(native, {
          apply(fn, receiver, args) { return apply(fn, receiver, locales(args)); },
          construct(fn, args, receiver) { return Reflect.construct(fn, locales(args), receiver); }
        });
        replace(Intl, name, replacement);
        replace(native.prototype, 'constructor', replacement);
      }
      for (const [target, names, index] of [
        [Date.prototype, ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'], 0],
        [Number.prototype, ['toLocaleString'], 0], [BigInt.prototype, ['toLocaleString'], 0],
        [String.prototype, ['toLocaleLowerCase', 'toLocaleUpperCase'], 0], [String.prototype, ['localeCompare'], 1]
      ]) for (const name of names) {
        const native = target[name];
        replace(target, name, new Proxy(native, { apply(fn, receiver, args) { return apply(fn, receiver, locales(args, index)); } }));
      }
    }
    if (config.zone) timezoneInstaller(config.zone, {
      get restored() { return !active; },
      define(target, name, installed) {
        const original = descriptor(target, name);
        define(target, name, installed);
        owned.push({ target, name, original, installed: descriptor(target, name) });
      }
    });
    return true;
  } catch (error) {
    cleanup();
    throw error;
  }
}

const emptyStatus = () => ({ phase: 'idle', attached: false, workers: 0, unsupported: [], error: '', reason: '' });
const errorText = (error) => String(error?.message ?? error).slice(0, 400);
const vanished = (error) => /No (?:session|target|tab)|Session (?:closed|with given id not found)|Target closed|not attached|Cannot find context|Inspected target navigated or closed/i.test(errorText(error));

export function createWorkerSync(resolveConfig) {
  const tabs = new Map();
  const debug = chrome.debugger;
  let keepAlive;

  function entry(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Invalid tab ID');
    if (!tabs.has(tabId)) tabs.set(tabId, { tabId, generation: 0, current: null, queue: Promise.resolve(), writes: Promise.resolve(), value: emptyStatus() });
    return tabs.get(tabId);
  }

  function snapshot(record) {
    return { ...record.value, unsupported: [...record.value.unsupported] };
  }

  function publish(record, patch) {
    Object.assign(record.value, patch);
    const attached = [...tabs.values()].some((item) => item.value.attached);
    if (attached && !keepAlive) keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
    if (!attached && keepAlive) { clearInterval(keepAlive); keepAlive = undefined; }
    const value = snapshot(record);
    record.writes = record.writes.catch(() => {}).then(() => chrome.storage.session.set({ [`sync:${record.tabId}`]: value }));
    // Storage failure must never strand a target paused at its first script.
    record.writes.catch(() => {});
    return value;
  }

  function enqueue(record, operation) {
    const work = record.queue.catch(() => {}).then(operation);
    record.queue = work.catch(() => {});
    return work;
  }

  function live(attempt) {
    return attempt.record.current === attempt && attempt.generation === attempt.record.generation && !attempt.stopping && !attempt.detached;
  }

  function assertLive(attempt) {
    if (!live(attempt)) throw new Error('Synchronization cancelled');
  }

  function target(attempt, session) {
    return session.id ? { tabId: attempt.record.tabId, sessionId: session.id } : { tabId: attempt.record.tabId };
  }

  function command(attempt, session, method, params = {}, onResult) {
    const pending = Promise.resolve().then(() => debug.sendCommand(target(attempt, session), method, params)).then((result) => {
      onResult?.(result);
      return result;
    });
    return deadline(pending, method);
  }

  async function configureCommand(attempt, session, method, params, onResult) {
    assertLive(attempt);
    const result = await command(attempt, session, method, params, onResult);
    assertLive(attempt);
    return result;
  }

  function count(attempt) {
    return [...attempt.sessions.values()].filter((session) => session.type === 'worker' && session.configured && !session.closed).length;
  }

  function fail(attempt, error) {
    if (!live(attempt)) return;
    attempt.failed = true;
    publish(attempt.record, { phase: 'error', error: errorText(error), workers: count(attempt) });
  }

  function source(attempt, config, origin, worker) {
    const zone = worker ? config.zone || '' : '';
    const selected = { zone, languages: config.profile?.languages ?? '', cpu: config.profile?.cpu ?? 0, memory: config.profile?.memory ?? 0 };
    const timezoneSource = zone ? installTimezone.toString() : 'null';
    return `(${installRealm.toString()})(${JSON.stringify(selected)},${JSON.stringify(attempt.marker)},${JSON.stringify(origin)},${timezoneSource})`;
  }

  function cleanupSource(attempt) {
    return `(() => { const d = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(${JSON.stringify(attempt.marker)})); return typeof d?.value === 'function' ? d.value() : false; })()`;
  }

  function sessionState(id, type, origin, parentId = '') {
    return { id, type, origin, parentId, configured: false, closed: false, runtime: false, autoAttach: false, installerTouched: false, scriptId: '', contexts: new Set() };
  }

  async function configure(attempt, session, config) {
    if (!config.enabled || !config.worker) throw new Error('Worker synchronization is disabled for this target');
    session.runtime = true;
    await configureCommand(attempt, session, 'Runtime.enable');
    const page = session.type !== 'worker';
    const expression = source(attempt, config, page ? session.origin : '', !page);
    session.installerTouched = true;
    if (page) {
      await configureCommand(attempt, session, 'Page.enable');
      await configureCommand(attempt, session, 'Page.addScriptToEvaluateOnNewDocument', { source: expression }, (result) => {
        session.scriptId = result.identifier;
        // A timed-out registration may finish after teardown has started.
        if (!live(attempt)) command(attempt, session, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier }).catch(() => {});
      });
    }
    const result = await configureCommand(attempt, session, 'Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Fingerprint synchronization failed in target: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    // Workers must actually install. A newly-created iframe may still be at
    // about:blank; its expected-origin preload handles the committed document.
    if (!page && result.result?.value !== true) throw new Error('Worker fingerprint synchronization did not install');
    session.autoAttach = true;
    await configureCommand(attempt, session, 'Target.setAutoAttach', AUTO_ATTACH);
    session.configured = true;
  }

  async function resume(attempt, session) {
    try {
      await command(attempt, session, 'Runtime.runIfWaitingForDebugger');
      return true;
    } catch (error) {
      if (!session.closed && !vanished(error)) fail(attempt, new Error(`Could not resume target: ${errorText(error)}`));
      // Detaching an unresumable child is the final fail-open escape hatch.
      if (session.id) {
        const parent = attempt.sessions.get(session.parentId) ?? attempt.root;
        await command(attempt, parent, 'Target.detachFromTarget', { sessionId: session.id }).catch(() => {});
      }
      // Root detach belongs to teardown, after all child restoration finishes.
      return false;
    }
  }

  async function attached(attempt, parentId, params) {
    const info = params.targetInfo;
    const parent = attempt.sessions.get(parentId) ?? attempt.root;
    const session = sessionState(params.sessionId, info.type, originOf(info.url, parent.origin), parentId);
    session.targetId = info.targetId;
    attempt.sessions.set(session.id, session);
    try {
      if (!live(attempt)) return;
      if (info.type !== 'worker' && info.type !== 'iframe') {
        const unsupported = [...new Set([...attempt.record.value.unsupported, info.type])];
        publish(attempt.record, { unsupported });
        return; // Never recursively attach to shared/service workers.
      }
      const config = await deadline(Promise.resolve().then(() => resolveConfig(session.origin)), 'Resolve target configuration');
      assertLive(attempt);
      await configure(attempt, session, config);
    } catch (error) {
      if (!session.closed) fail(attempt, error);
    } finally {
      const resumed = await resume(attempt, session);
      if (!resumed) session.configured = false;
      if (live(attempt)) publish(attempt.record, { workers: count(attempt) });
    }
  }

  async function teardown(attempt, phase, reason, initialError = '') {
    attempt.stopping = true;
    const errors = [];
    const safely = async (session, method, params) => {
      if (session.closed || attempt.detached) return;
      try {
        const result = await command(attempt, session, method, params);
        if (result?.exceptionDetails) throw new Error(`${method} cleanup failed`);
      } catch (error) {
        if (!vanished(error) && !session.closed && !attempt.detached) errors.push(errorText(error));
      }
    };
    if (attempt.attached && !attempt.detached) {
      // autoAttach:false detaches child sessions immediately. First stop
      // pausing new children, retain the sessions, and restore their state.
      await Promise.all([...attempt.sessions.values()].filter((session) => session.autoAttach).map((session) =>
        safely(session, 'Target.setAutoAttach', { ...AUTO_ATTACH, waitForDebuggerOnStart: false })));
      await Promise.allSettled([...attempt.tasks]);
      await Promise.all([...attempt.sessions.values()].map(async (session) => {
        if (session.scriptId) await safely(session, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId });
        if (session.installerTouched) {
          const contexts = [...session.contexts];
          const evaluations = contexts.length ? contexts.map((contextId) => ({ contextId })) : [{}];
          await Promise.all(evaluations.map((context) => safely(session, 'Runtime.evaluate', { expression: cleanupSource(attempt), returnByValue: true, ...context })));
        }
        await resume(attempt, session);
      }));
      await Promise.all([...attempt.sessions.values()].filter((session) => session.autoAttach).map((session) =>
        safely(session, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })));
    }
    // Also attempt detach after a timed-out attach. Its late completion has a
    // separate detach guard, and new starts are blocked until it settles.
    if (attempt.attachStarted && !attempt.detached) {
      attempt.expectedDetach = true;
      try {
        await deadline(Promise.resolve().then(() => debug.detach({ tabId: attempt.record.tabId })), 'Debugger detach');
        attempt.detached = true;
        attempt.attached = false;
      } catch (error) {
        if (vanished(error)) { attempt.detached = true; attempt.attached = false; }
        else errors.push(errorText(error));
      }
    }
    const error = [initialError, ...errors].filter(Boolean).join('; ').slice(0, 400);
    publish(attempt.record, { phase: error ? 'error' : phase, reason, error, attached: attempt.attached && !attempt.detached, workers: 0 });
  }

  async function detachOrphan(tabId) {
    if (!debug?.detach) return;
    try { await deadline(debug.detach({ tabId }), 'Stale debugger detach'); }
    catch (error) { if (!vanished(error)) throw error; }
  }

  async function status(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return emptyStatus();
    const record = entry(tabId);
    if (!record.current && !record.initialized) {
      record.initialized = true;
      const stored = (await chrome.storage.session.get(`sync:${tabId}`))[`sync:${tabId}`];
      if (!record.current && stored) {
        // An interrupted service-worker lifetime is not proof of a live sync.
        if (stored.attached || stored.phase === 'starting') await detachOrphan(tabId);
        publish(record, { ...emptyStatus(), phase: stored.attached || stored.phase === 'starting' ? 'disconnected' : stored.phase,
          reason: stored.attached ? 'background_restarted' : stored.reason || '', error: stored.error || '', unsupported: Array.isArray(stored.unsupported) ? stored.unsupported : [] });
      }
    }
    return snapshot(record);
  }

  async function start(tabId) {
    const record = entry(tabId);
    if (record.current && live(record.current) && (record.value.phase === 'starting' || record.value.phase === 'active')) return snapshot(record);
    const generation = ++record.generation;
    return enqueue(record, async () => {
      if (!record.current) await detachOrphan(tabId);
      if (generation !== record.generation) return snapshot(record);
      const previous = record.current;
      if (previous?.attachPending) return publish(record, { phase: 'error', error: 'Previous debugger attach is still pending; retry after it settles' });
      if (previous?.attached && !previous.detached) {
        await teardown(previous, 'needsReload', 'restart');
        if (previous.attached && !previous.detached) return snapshot(record);
      }
      if (generation !== record.generation) return snapshot(record);
      const attempt = { record, generation, marker: `dntm.workerSync.${crypto.randomUUID()}`, sessions: new Map(), tasks: new Set(), attached: false, detached: false, stopping: false, failed: false, attachPending: false, attachStarted: false, expectedDetach: false };
      record.current = attempt;
      publish(record, { ...emptyStatus(), phase: 'starting' });
      try {
        if (!debug?.attach) throw new Error('Debugger API unavailable; reload the extension with its required permission');
        assertLive(attempt);
        const tab = await chrome.tabs.get(tabId);
        if (!/^https?:\/\//i.test(tab.url ?? '')) throw new Error('Worker synchronization requires an HTTP(S) tab');
        attempt.origin = originOf(tab.url);
        attempt.root = sessionState('', 'page', attempt.origin);
        attempt.sessions.set('', attempt.root);
        const config = await deadline(Promise.resolve().then(() => resolveConfig(tab.url)), 'Resolve tab configuration');
        if (!config.enabled || !config.worker) throw new Error('Worker synchronization is disabled');
        assertLive(attempt);
        attempt.attachStarted = true;
        attempt.attachPending = true;
        const pending = Promise.resolve().then(() => debug.attach({ tabId }, '1.3')).then(async () => {
          attempt.attached = true;
          attempt.detached = false;
          if (!live(attempt)) {
            attempt.expectedDetach = true;
            try {
              await deadline(Promise.resolve().then(() => debug.detach({ tabId })), 'Late debugger detach');
              attempt.attached = false;
              attempt.detached = true;
            } catch (error) {
              publish(record, { phase: 'error', attached: true, error: `Late attach cleanup failed: ${errorText(error)}` });
            }
          }
        }).finally(() => { attempt.attachPending = false; });
        await deadline(pending, 'Debugger attach');
        assertLive(attempt);
        publish(record, { attached: true });
        await configure(attempt, attempt.root, config);
        await deadline((async () => {
          while (attempt.tasks.size) {
            assertLive(attempt);
            await Promise.allSettled([...attempt.tasks]);
          }
        })(), 'Initial target synchronization');
        assertLive(attempt);
        if (attempt.failed) throw new Error(record.value.error || 'Target synchronization failed');
        // Recheck the URL in case navigation raced permission/configuration.
        const current = await chrome.tabs.get(tabId);
        if (originOf(current.url) !== attempt.origin) throw new Error('Tab origin changed before synchronization was ready');
        assertLive(attempt);
        await chrome.tabs.reload(tabId);
        assertLive(attempt);
        publish(record, { phase: attempt.failed ? 'error' : 'active', workers: count(attempt) });
      } catch (error) {
        const cancelled = generation !== record.generation;
        await teardown(attempt, attempt.disconnectReason ? 'disconnected' : cancelled ? 'needsReload' : 'error',
          attempt.disconnectReason || (cancelled ? 'cancelled' : 'start_failed'), cancelled ? '' : errorText(error));
      }
      return snapshot(record);
    });
  }

  async function stop(tabId, reason = 'stopped') {
    const record = entry(tabId);
    ++record.generation;
    if (record.current) record.current.stopping = true;
    return enqueue(record, async () => {
      const attempt = record.current;
      if (attempt) await teardown(attempt, attempt.attachStarted ? 'needsReload' : 'idle', reason);
      else {
        const stored = (await chrome.storage.session.get(`sync:${tabId}`))[`sync:${tabId}`];
        const orphan = stored?.attached || stored?.phase === 'starting';
        try {
          await detachOrphan(tabId);
          publish(record, { ...emptyStatus(), phase: orphan ? 'needsReload' : 'idle', reason });
        } catch (error) {
          publish(record, { ...emptyStatus(), phase: 'error', attached: Boolean(orphan), reason, error: errorText(error) });
        }
      }
      return snapshot(record);
    });
  }

  async function stopAll(reason = 'config_changed') {
    const known = new Set(tabs.keys());
    // Invalidate known starts before the first asynchronous storage lookup.
    const pending = Promise.all([...known].map((tabId) => stop(tabId, reason)));
    const persisted = chrome.storage.session.get(null).then((values) => Promise.all(
      Object.entries(values).filter(([key, value]) => /^sync:\d+$/.test(key) && (value?.attached || value?.phase === 'starting'))
        .map(([key]) => Number(key.slice(5))).filter((tabId) => !known.has(tabId))
        .map((tabId) => stop(tabId, reason))
    ));
    return (await Promise.all([pending, persisted])).flat();
  }

  function onDebuggerEvent(source, method, params) {
    const attempt = tabs.get(source.tabId)?.current;
    if (!attempt) {
      // A restarted background must never leave an orphan Worker paused.
      if (method === 'Target.attachedToTarget') {
        const record = entry(source.tabId);
        const child = { tabId: source.tabId, sessionId: params.sessionId };
        deadline(debug.sendCommand(child, 'Runtime.runIfWaitingForDebugger'), 'Resume orphan target').catch(() => {}).then(() => enqueue(record, async () => {
          if (record.current) return;
          await detachOrphan(source.tabId);
          publish(record, { ...emptyStatus(), phase: 'disconnected', reason: 'background_restarted' });
        })).catch(() => {});
      }
      return;
    }
    if (attempt.detached) return;
    const session = attempt.sessions.get(source.sessionId ?? '');
    if (method === 'Target.attachedToTarget') {
      const task = attached(attempt, source.sessionId ?? '', params);
      attempt.tasks.add(task);
      task.finally(() => attempt.tasks.delete(task)).catch(() => {});
    } else if (method === 'Target.detachedFromTarget') {
      const close = (id) => {
        const child = attempt.sessions.get(id);
        if (!child) return;
        child.closed = true;
        child.configured = false;
        for (const nested of attempt.sessions.values()) if (nested.parentId === id && nested.id !== id) close(nested.id);
        attempt.sessions.delete(id);
      };
      close(params.sessionId);
      if (live(attempt)) publish(attempt.record, { workers: count(attempt) });
    } else if (method === 'Runtime.executionContextCreated' && session) {
      if (session.type === 'worker' || params.context.auxData?.isDefault) session.contexts.add(params.context.id);
    } else if (method === 'Runtime.executionContextDestroyed' && session) {
      session.contexts.delete(params.executionContextId);
    } else if (method === 'Runtime.executionContextsCleared' && session) {
      session.contexts.clear();
    } else if (method === 'Target.targetInfoChanged' && live(attempt)) {
      for (const child of attempt.sessions.values()) {
        if (child.targetId === params.targetInfo.targetId && child.type === 'iframe' && originOf(params.targetInfo.url, child.origin) !== child.origin) {
          stop(source.tabId, 'navigation').catch(() => {});
          break;
        }
      }
    }
  }

  function onDebuggerDetach(source, reason) {
    const record = tabs.get(source.tabId);
    const attempt = record?.current;
    if (!attempt) return;
    attempt.detached = true;
    attempt.attached = false;
    if (attempt.expectedDetach) return;
    attempt.disconnectReason = reason || 'debugger_detached';
    ++record.generation;
    attempt.stopping = true;
    publish(record, { phase: 'disconnected', attached: false, workers: 0, reason, error: '' });
  }

  debug.onEvent.addListener(onDebuggerEvent);
  debug.onDetach.addListener(onDebuggerDetach);

  function navigation(tabId, url) {
    const attempt = tabs.get(tabId)?.current;
    if (attempt && live(attempt) && attempt.origin && originOf(url) !== attempt.origin) stop(tabId, 'navigation').catch(() => {});
  }
  chrome.webNavigation?.onBeforeNavigate?.addListener(({ tabId, frameId, url }) => { if (frameId === 0) navigation(tabId, url); });
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url) navigation(tabId, change.url); });
  chrome.tabs.onRemoved.addListener((tabId) => {
    const record = tabs.get(tabId);
    if (!record) return;
    stop(tabId, 'tab_closed').then(async () => {
      await record.writes.catch(() => {});
      await chrome.storage.session.remove(`sync:${tabId}`);
      tabs.delete(tabId);
    }).catch(() => {});
  });

  return { start, stop, stopAll, status };
}
