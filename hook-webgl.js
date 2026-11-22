(() => {
  const { method, proto, profile, apply } = globalThis[Symbol.for('dntm.hooks')];
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    method(proto(name), 'getParameter', 'webgl', (fn, receiver, args) => {
      const native = apply(fn, receiver, args);
      const current = profile();
      // Never synthesize support for an unavailable debug extension.
      if (!current || native === null) return native;
      if (args[0] === 37445 && current.gpuVendor) return current.gpuVendor;
      if (args[0] === 37446 && current.gpuRenderer) return current.gpuRenderer;
      return native;
    });
  }
})();
