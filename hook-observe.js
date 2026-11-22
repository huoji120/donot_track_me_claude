(() => {
  const { lifecycle, method, getter, proto } = globalThis[Symbol.for('dntm.hooks')];
  lifecycle.observe = true;
  // Observation is deliberately intrusive even with all replacement masks off.
  // Shared helpers skip APIs already wrapped by a selected replacement module.
  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    for (const key of ['measureText', 'fillText', 'strokeText']) method(proto(name), key, key === 'measureText' ? 'fonts' : 'canvas');
  }
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    for (const key of ['getParameter', 'readPixels', 'getBufferSubData', 'getExtension', 'getSupportedExtensions']) method(proto(name), key, 'webgl');
  }
  getter(proto('Navigator'), 'gpu', 'webgpu');
  method(proto('GPU'), 'requestAdapter', 'webgpu');
  method(proto('OfflineAudioContext'), 'startRendering', 'audio');
  for (const name of ['getByteFrequencyData', 'getFloatFrequencyData', 'getByteTimeDomainData', 'getFloatTimeDomainData']) method(proto('AnalyserNode'), name, 'audio');
  getter(proto('BaseAudioContext'), 'sampleRate', 'audio');
  const n = proto('Navigator');
  for (const [signal, keys] of Object.entries({
    browser: ['userAgent', 'userAgentData', 'appVersion', 'platform', 'vendor', 'webdriver'],
    touch: ['maxTouchPoints'], plugins: ['plugins', 'mimeTypes', 'pdfViewerEnabled', 'javaEnabled'],
    cookies: ['cookieEnabled'], location: ['geolocation'], language: ['language', 'languages'],
    hardware: ['hardwareConcurrency', 'deviceMemory']
  })) for (const key of keys) { getter(n, key, signal); method(n, key, signal); }
  method(proto('NavigatorUAData'), 'getHighEntropyValues', 'browser');
  method(proto('MediaDevices'), 'enumerateDevices', 'media');
  method(proto('MediaDevices'), 'getUserMedia', 'media');
  method(proto('RTCPeerConnection'), 'createOffer', 'webrtc');
  for (const key of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) getter(proto('Screen'), key, 'screen');
  for (const name of ['Element', 'Range']) {
    for (const key of ['getBoundingClientRect', 'getClientRects']) method(proto(name), key, 'rects');
  }
  method(proto('FontFaceSet'), 'check', 'fonts');
  method(proto('FontFaceSet'), 'load', 'fonts');
  method(globalThis, 'queryLocalFonts', 'fonts');
  getter(proto('Document'), 'cookie', 'cookies');
  method(proto('Geolocation'), 'getCurrentPosition', 'location');
  method(proto('Geolocation'), 'watchPosition', 'location');
})();
