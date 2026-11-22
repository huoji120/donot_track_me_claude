// Global diagnostic gates. Saved profile values and site bindings remain intact.
export const FEATURE_RULES = Object.freeze([
  { key: 'timezone', label: '时区替换', detail: '页面 Date / Intl 与受支持 Worker 时区；仍需在档案中填写时区。' },
  { key: 'languages', label: '语言替换', detail: '默认关闭：会改写 JS 语言接口、Intl 和 Accept-Language。避免 JS 包装的替换需浏览器级支持。' },
  { key: 'cpu', label: 'CPU 核数替换', detail: '使用档案中的 CPU 核数；0 表示原生。' },
  { key: 'memory', label: '设备内存替换', detail: '使用档案中的 deviceMemory；0 表示原生。' },
  { key: 'screen', label: '屏幕尺寸替换', detail: '默认关闭：会改写 JS 的 screen 读数，不改变真实屏幕；原生级替换需浏览器级支持。' },
  { key: 'webgl', label: 'WebGL 标识替换', detail: '默认关闭：会包装 JS 的 getParameter，只替换标识；底层一致性需浏览器级支持。' },
  { key: 'canvas', label: 'Canvas 文本微扰', detail: '允许档案中的 Canvas 微扰；不修改纯色像素读回。' },
  { key: 'audio', label: '音频分析微扰', detail: '允许档案中的分析器微扰；档案原本关闭时不会强制开启。' },
  { key: 'font', label: '字体替换', detail: '允许档案中的 DOM / Canvas 字体选择；native 保持原生。' },
  { key: 'observe', label: '指纹 API 观察', detail: '默认关闭：只观察也会包装 JS API，包括已关闭替换的类别；避免这类包装需浏览器级支持。' },
  { key: 'privacySignals', label: 'DNT / GPC 隐私信号', detail: '同时控制网页 doNotTrack / globalPrivacyControl 和 DNT / Sec-GPC 请求头。' },
  { key: 'worker', label: 'Worker 调试同步', detail: '控制手动及自动调试连接；关闭立即停止。仅开启此项时不额外启用身份字段替换。' },
]);
export const NETWORK_RULES = Object.freeze([
  { key: 'trackers', label: '追踪域名拦截', detail: '直接控制现有追踪域名开关，可能影响第三方资源。' },
  { key: 'localPorts', label: '本地端口请求拦截', detail: '直接控制现有本地网络规则；可能阻止本地验证码测试页的子请求。' },
  { key: 'webrtc', label: 'WebRTC 非代理 UDP 限制', detail: '直接控制现有 Chrome WebRTC 策略，可能影响通话。' },
]);
export const DEFAULT_NETWORK_RULES = Object.freeze({ trackers: true, localPorts: true, webrtc: true });
export const DEFAULT_RULES = Object.freeze({
  ...Object.fromEntries(FEATURE_RULES.map(({ key }) => [key, true])),
  screen: false,
  webgl: false,
  observe: false,
  languages: false,
});
export function normalizeRules(input) {
  if (input === undefined) return { ...DEFAULT_RULES };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('功能规则必须是开关对象。');
  const result = { ...DEFAULT_RULES };
  for (const { key } of FEATURE_RULES) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== 'boolean') throw new Error(`规则 ${key} 必须为布尔开关。`);
    result[key] = input[key];
  }
  return result;
}
export function maskProfile(profile, rules) {
  return {
    ...profile,
    canvas: rules.canvas && profile.canvas,
    audio: rules.audio && profile.audio,
    cpu: rules.cpu ? profile.cpu : 0,
    memory: rules.memory ? profile.memory : 0,
    width: rules.screen ? profile.width : 0,
    height: rules.screen ? profile.height : 0,
    gpuVendor: rules.webgl ? profile.gpuVendor : '',
    gpuRenderer: rules.webgl ? profile.gpuRenderer : '',
    font: rules.font ? profile.font : 'native',
    languages: rules.languages ? profile.languages : '',
  };
}
