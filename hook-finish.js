(() => {
  delete globalThis[Symbol.for('dntm.hooks')];
  delete globalThis[Symbol.for('dntm.lifecycle')];
  delete globalThis[Symbol.for('dntm.report')];
  document.dispatchEvent(new Event('dntm-ready'));
})();
