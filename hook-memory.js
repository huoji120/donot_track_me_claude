(() => {
  const { getter, proto, profile } = globalThis[Symbol.for('dntm.hooks')];
  getter(proto('Navigator'), 'deviceMemory', 'hardware', (value) => profile()?.memory || value);
})();
