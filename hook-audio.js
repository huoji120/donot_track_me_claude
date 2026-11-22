(() => {
  const state = globalThis[Symbol.for('dntm.hooks')];
  const { method, proto, profile, apply } = state;
  for (const name of ['getByteFrequencyData', 'getFloatFrequencyData', 'getByteTimeDomainData', 'getFloatTimeDomainData']) {
    method(proto('AnalyserNode'), name, 'audio', (fn, receiver, args) => {
      const result = apply(fn, receiver, args);
      const data = args[0];
      if (profile()?.audio && data?.length) {
        const i = state.seed % data.length;
        if (data instanceof Uint8Array) data[i] = (data[i] & 254) | (state.seed & 1);
        else if (Number.isFinite(data[i]) && data[i] !== 0) data[i] += (state.seed & 1 ? 1 : -1) * Math.abs(data[i]) * 1e-7;
      }
      return result;
    });
  }
})();
