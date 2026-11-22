(() => {
  const report = globalThis[Symbol.for('dntm.report')];
  const apply = Reflect.apply;
  const desc = Object.getOwnPropertyDescriptor;
  const lifecycle = globalThis[Symbol.for('dntm.lifecycle')];
  const define = lifecycle.define.bind(lifecycle);
  const proto = (name) => globalThis[name]?.prototype;
  let config = null;
  let seed = 0;
  let preferredLanguages = null;
  const wrapped = new WeakMap();
  const claim = (target, key) => {
    let keys = wrapped.get(target);
    if (!keys) { keys = new Set(); wrapped.set(target, keys); }
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  };
  const profile = () => config?.enabled ? config.profile : null;
  document.addEventListener('dntm-profile', (event) => {
    try {
      const value = JSON.parse(event.detail);
      if (value?.enabled === false || lifecycle.restored) { config = null; preferredLanguages = null; return; }
      if (!value || typeof value.profile?.seed !== 'string') return;
      config = value;
      const locales = value.profile.languages ?? 'en-US,en';
      preferredLanguages = locales ? Object.freeze(locales.split(',')) : null;
      seed = 2166136261;
      for (const char of `${value.profile.seed}|${location.origin}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    } catch { /* Page events are not an authenticated security boundary. */ }
  });
  function method(target, key, signal, replace) {
    const d = target && desc(target, key);
    if (!d?.configurable || typeof d.value !== 'function') return;
    if (!claim(target, key)) return;
    define(target, key, { ...d, value: new Proxy(d.value, {
      apply(fn, receiver, args) {
        report(signal);
        return replace ? replace(fn, receiver, args) : apply(fn, receiver, args);
      }
    }) });
  }
  function getter(target, key, signal, map) {
    const d = target && desc(target, key);
    if (!d?.configurable || !d.get) return;
    if (!claim(target, key)) return;
    define(target, key, { ...d, get: new Proxy(d.get, {
      apply(fn, receiver, args) {
        if (signal) report(signal);
        const value = apply(fn, receiver, args);
        return map ? map(value) : value;
      }
    }) });
  }
  // Only statically selected modules receive these helpers. Finish removes the
  // temporary global; installed closures retain their own shared state.
  globalThis[Symbol.for('dntm.hooks')] = {
    report, apply, desc, lifecycle, define, proto, profile, method, getter,
    get seed() { return seed; },
    get languages() { return preferredLanguages; }
  };
})();
