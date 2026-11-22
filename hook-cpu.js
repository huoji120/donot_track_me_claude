(() => {
  const { getter, proto, profile } = globalThis[Symbol.for('dntm.hooks')];
  getter(proto('Navigator'), 'hardwareConcurrency', 'hardware', (value) => profile()?.cpu || value);
})();
