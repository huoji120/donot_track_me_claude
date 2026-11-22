(() => {
  const key = Symbol.for('dntm.report');
  const seen = new Set();
  const dispatch = document.dispatchEvent.bind(document);
  const Event = CustomEvent;
  const ErrorType = Error;
  const ownOrigin = location.origin;
  const root = /https?:\/\/[^\s)]+/;
  const entries = [];
  const targets = new WeakMap();
  const lifecycle = {
    restored: false,
    observe: false,
    define(target, name, descriptor) {
      let keys = targets.get(target);
      if (!keys) { keys = new Map(); targets.set(target, keys); }
      let entry = keys.get(name);
      if (!entry) {
        entry = { target, name, original: Object.getOwnPropertyDescriptor(target, name) };
        keys.set(name, entry);
        entries.push(entry);
      }
      Object.defineProperty(target, name, descriptor);
      entry.installed = Object.getOwnPropertyDescriptor(target, name);
    },
    restore() {
      if (this.restored) return;
      this.restored = true;
      for (let i = entries.length - 1; i >= 0; i--) {
        const { target, name, original, installed } = entries[i];
        const current = Object.getOwnPropertyDescriptor(target, name);
        // Do not overwrite an unrelated change the website made after our patch.
        if (!current || !installed || current.value !== installed.value || current.get !== installed.get || current.set !== installed.set) continue;
        if (original) Object.defineProperty(target, name, original);
        else delete target[name];
      }
    }
  };
  globalThis[Symbol.for('dntm.lifecycle')] = lifecycle;
  document.addEventListener('dntm-profile', ({ detail }) => {
    try {
      const value = JSON.parse(detail);
      // Native profile parameters no longer imply observation/privacy opt-out.
      // A changed registration needs a reload; restoration is best effort only.
      if (value.enabled === false || value.reloadRequired) lifecycle.restore();
    } catch { /* Ignore malformed page events. */ }
  });
  globalThis[key] = (signal) => {
    if (!lifecycle.observe || lifecycle.restored || seen.has(signal)) return;
    seen.add(signal);
    let source = '';
    try {
      for (const line of new ErrorType().stack?.split('\n') ?? []) {
        const frame = line.match(root)?.[0].replace(/:\d+:\d+$/, '');
        if (!frame) continue;
        const url = new URL(frame);
        const leaf = url.pathname.split('/').pop();
        source = `${url.hostname}${leaf ? `/${leaf.slice(0, 100)}` : ''}`;
        break;
      }
      if (!source && ownOrigin !== 'null') source = new URL(ownOrigin).hostname;
    } catch { /* Stack attribution is best effort. */ }
    dispatch(new Event('dntm-signal', { detail: `${signal}\n${source}` }));
  };
})();
