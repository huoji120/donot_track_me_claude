(() => {
  const { getter, proto, profile } = globalThis[Symbol.for('dntm.hooks')];
  for (const property of ['width', 'height', 'availWidth', 'availHeight']) {
    getter(proto('Screen'), property, 'screen', (value) => {
      const p = profile();
      if (!p?.width) return value;
      return property === 'width' || property === 'availWidth' ? p.width : p.height;
    });
  }
})();
