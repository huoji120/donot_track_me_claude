(() => {
  const state = globalThis[Symbol.for('dntm.hooks')];
  const { method, proto, profile, apply } = state;
  // Canvas and font replacement share text methods but keep independent masks.
  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    for (const key of ['measureText', 'fillText', 'strokeText']) {
      method(proto(name), key, key === 'measureText' ? 'fonts' : 'canvas', (fn, receiver, args) => {
        const p = profile();
        let drawArgs = args;
        if (p?.canvas && key !== 'measureText' && args.length >= 3) {
          const text = `${args[0]}`;
          const x = +args[1], y = +args[2];
          const maxWidth = args.length >= 4 ? +args[3] : undefined;
          const dx = ((state.seed & 255) - 127.5) / 128;
          const dy = (((state.seed >>> 8) & 255) - 127.5) / 128;
          drawArgs = args.length >= 4 ? [text, x + dx, y + dy, maxWidth] : [text, x + dx, y + dy];
        }
        const family = p?.font;
        if (!family || family === 'native') return apply(fn, receiver, drawArgs);
        const previous = receiver.font;
        receiver.font = previous.replace(/(\d+(?:\.\d+)?px)\s+.+$/, `$1 ${family}`);
        try { return apply(fn, receiver, drawArgs); } finally { receiver.font = previous; }
      });
    }
  }
})();
