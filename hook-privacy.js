(() => {
  const { getter, proto, desc, define } = globalThis[Symbol.for('dntm.hooks')];
  const n = proto('Navigator');
  getter(n, 'doNotTrack', null, () => '1');
  if (!desc(n, 'globalPrivacyControl')) define(n, 'globalPrivacyControl', { configurable: true, enumerable: true, get: () => true });
  else getter(n, 'globalPrivacyControl', null, () => true);
})();
