(() => {
  const state = globalThis[Symbol.for('dntm.hooks')];
  const { getter, proto, profile, apply, define, desc, report, method } = state;
  const n = proto('Navigator');
  getter(n, 'language', 'language', (value) => profile() && state.languages ? state.languages[0] : value);
  getter(n, 'languages', 'language', (value) => profile() && state.languages ? state.languages : value);
  const withLocales = (args, index = 0) => {
    const locale = args[index];
    if (!profile() || !state.languages || !(locale === undefined || (Array.isArray(locale) && locale.length === 0))) return args;
    const next = args.slice();
    next[index] = state.languages;
    return next;
  };
  for (const key of ['DateTimeFormat', 'NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter', 'DurationFormat']) {
    const native = Intl[key];
    if (typeof native !== 'function') continue;
    const replacement = new Proxy(native, {
      apply(fn, receiver, args) { report('language'); return apply(fn, receiver, withLocales(args)); },
      construct(fn, args, receiver) { report('language'); return Reflect.construct(fn, withLocales(args), receiver); }
    });
    define(Intl, key, { ...desc(Intl, key), value: replacement });
    define(native.prototype, 'constructor', { ...desc(native.prototype, 'constructor'), value: replacement });
  }
  for (const [target, names, index] of [
    [Date.prototype, ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'], 0],
    [Number.prototype, ['toLocaleString'], 0], [BigInt.prototype, ['toLocaleString'], 0],
    [String.prototype, ['toLocaleLowerCase', 'toLocaleUpperCase'], 0], [String.prototype, ['localeCompare'], 1]
  ]) for (const key of names) method(target, key, 'language', (fn, receiver, args) => apply(fn, receiver, withLocales(args, index)));
})();
