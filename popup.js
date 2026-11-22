import { FEATURE_RULES, NETWORK_RULES, DEFAULT_RULES } from './feature-rules.js';

const $ = (id) => document.getElementById(id);
const signals = {
  canvas: 'Canvas 文本绘制访问', webgl: 'WebGL 参数或像素访问', webgpu: 'WebGPU API 访问',
  audio: '音频采样或渲染访问', rects: 'Client Rects 布局尺寸', screen: '屏幕尺寸或色深',
  touch: '触控点数', hardware: 'CPU 核数或内存读取', media: '媒体设备 API',
  webrtc: 'WebRTC 建立连接', browser: '浏览器、系统或 UA 高熵信息', language: '浏览器语言',
  plugins: '浏览器插件、MIME 或 PDF 能力', cookies: 'Cookie 状态或读取', location: '地理位置 API',
  fonts: '字体 API 或文本尺寸', timezone: '时区、本地时间或 Intl 格式化'
};
const fieldset = $('settings').querySelector('fieldset');
let tabId;
let refreshTimer;
let saving = false;
let workerBusy = false;
let workerSync;
let autoState = { mode: 'all', paused: false, owner: null };
let privacyEnabled = false;
let privacyBusy = false;
let autoBusy = false;
let workerRuleEnabled = false;
let savedWebrtc = false;

function renderPrivacy() {
  $('privacy-toggle').textContent = privacyEnabled ? '关闭全部防护' : '开启已保存的防护';
  $('privacy-toggle').setAttribute('aria-pressed', String(privacyEnabled));
  $('privacy-toggle').disabled = privacyBusy;
}
$('privacy-toggle').addEventListener('click', async () => {
  if (privacyBusy) return;
  const enabled = !privacyEnabled;
  privacyBusy = true;
  renderPrivacy();
  $('privacy-message').textContent = enabled ? '正在恢复已保存的防护…' : '正在关闭防护并停止全部调试同步…';
  $('privacy-message').removeAttribute('data-error');
  try {
    const value = await send({ type: 'privacyToggle', enabled });
    privacyEnabled = value.enabled;
    await refresh();
    $('privacy-message').textContent = enabled
      ? '已恢复保存的防护选项和自动模式；请刷新已打开页面以重新安装防护。自动启动可能刷新符合条件的标签页。未随机化指纹或开启额外网络选项。'
      : '防护已关闭，调试同步已停止；已保存选项保持不变。当前页面或 Worker 已执行的修改仍可能需要刷新清除。';
  } catch (error) {
    $('privacy-message').textContent = error.message || String(error);
    $('privacy-message').setAttribute('data-error', '');
  } finally {
    privacyBusy = false;
    renderPrivacy();
    renderWorkerSync(workerSync);
  }
});

function workerMessage(text, error = false) {
  $('worker-message').textContent = text;
  $('worker-message').toggleAttribute('data-error', error);
}
function renderWorkerSync(value) {
  workerSync = value;
  const unsupported = tabId === undefined;
  const phases = {
    idle: '未启动同步', starting: '正在连接并准备刷新', active: '调试同步已启动',
    needsReload: '需要刷新页面', error: '同步出错', disconnected: '调试连接已断开'
  };
  const label = unsupported ? '此页不支持 Worker 同步（仅 HTTP / HTTPS）。'
    : !value ? '无法读取同步状态，请重新打开弹窗。'
      : `${phases[value.phase] || '未知同步状态'} · ${value.attached ? '已连接' : '未连接'} · 已同步 Worker：${value.workers ?? 0}`;
  const details = unsupported || !value ? [] : [
    value.unsupported?.length ? `未覆盖类型：${value.unsupported.join('、')}` : '',
    value.error, value.reason,
    ['needsReload', 'disconnected'].includes(value.phase) ? '已执行的修改可能需刷新清除；自动模式可在后续导航恢复，手动暂停除外。' : ''
  ].filter(Boolean);
  $('worker-state').textContent = [label, ...details].join('。');
  $('worker-state').toggleAttribute('data-error', !unsupported && (!value || Boolean(value.error)));
  $('worker-auto-state').textContent = `模式：${{ manual: '仅手动', sites: '指定网站自动', all: '所有 HTTP(S) 自动' }[autoState.mode]} · ${autoState.paused ? '此标签页自动同步已暂停，手动启动可恢复' : autoState.owner === 'manual' ? '手动会话' : autoState.owner === 'auto' ? '自动管理' : '未暂停'}${privacyEnabled ? '' : ' · 全局防护已关闭'}${workerRuleEnabled ? '' : ' · Worker 排查开关已关闭，不能启动同步'}`;
  if (!autoBusy) $('worker-auto-mode').value = autoState.mode;
  $('worker-auto-mode').disabled = autoBusy || workerBusy || privacyBusy || !value;
  $('worker-start').disabled = unsupported || workerBusy || autoBusy || privacyBusy || !privacyEnabled || !workerRuleEnabled || !value || value.attached || value.phase === 'starting';
  $('worker-stop').disabled = unsupported || workerBusy || !value || (autoState.paused && !value.attached && value.phase !== 'starting');
}

function status(text, error = false) {
  $('status').textContent = text;
  $('status').toggleAttribute('data-error', error);
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result || result.error) throw new Error(result?.error || '无法连接扩展后台。');
  return result.value;
}
function renderList(id, rows, empty) {
  const items = rows.map(([title, detail]) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'result-title';
    label.textContent = title;
    item.append(label);
    if (detail) {
      const note = document.createElement('span');
      note.className = 'result-detail';
      note.textContent = detail;
      item.append(note);
    }
    return item;
  });
  if (!items.length) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = empty;
    items.push(item);
  }
  const list = $(id);
  const scrollTop = list.scrollTop;
  list.replaceChildren(...items);
  list.scrollTop = scrollTop;
}
async function refresh(initial = false) {
  const { settings, tab, webrtc, activeProfile, workerSync: sync, workerAuto } = await send({ type: 'get', tabId: tabId ?? -1 });
  privacyEnabled = settings.enabled;
  const rules = { ...DEFAULT_RULES, ...settings.rules };
  workerRuleEnabled = rules.worker;
  savedWebrtc = settings.webrtc;
  $('webrtc').checked = savedWebrtc;
  $('webrtc').indeterminate = false;
  $('webrtc').disabled = false;
  const disabledRules = [
    ...FEATURE_RULES.filter(({ key }) => !rules[key]),
    ...NETWORK_RULES.filter(({ key }) => !settings[key])
  ];
  $('feature-rules-note').textContent = `功能排查：${disabledRules.length ? `${disabledRules.length} 项已关闭` : '所有开关已开启'}，在配置面板中调整。${settings.enabled ? '开启仍按已保存参数生效。' : '全局防护已关闭，规则均不生效。'} 改动后请刷新测试页清除旧值与钩子。`;
  $('feature-rules-note').title = disabledRules.map(({ label }) => label).join('、');
  autoState = workerAuto;
  renderPrivacy();
  renderWorkerSync(sync);
  if (initial) {
    $('zone').value = settings.zone;
    fieldset.disabled = false;
    $('reload').disabled = tabId === undefined;
  }
  if (tabId !== undefined && tab?.host) $('site').textContent = tab.host;
  $('mode').textContent = settings.enabled ? '防护已开启' : '防护已暂停';
  $('mode').dataset.enabled = settings.enabled;
  $('active-profile').textContent = tabId === undefined ? '本页不支持页面指纹替换。'
    : `${settings.enabled ? '站点配置' : '防护已暂停 · 站点配置'}：${activeProfile?.name || '默认指纹'} · ${activeProfile?.zone || '系统时区'}`;
  $('zone-summary').textContent = settings.zone || '系统时区';
  $('rtc-state').textContent = webrtc.value === 'disable_non_proxied_udp'
    ? '当前已限制；视频通话可能受影响。'
    : webrtc.levelOfControl === 'not_controllable' || webrtc.levelOfControl === 'controlled_by_other_extensions'
      ? '当前由浏览器策略或其他扩展控制。' : '当前未限制。';

  const other = (tab?.hosts ?? []).slice().sort((a, b) => a.host.localeCompare(b.host)).map(({ host }) => [host]);
  const observations = tab?.signals ?? [];
  const fingerprintRows = Object.entries(signals).flatMap(([category, label]) =>
    observations.filter(({ key }) => key === category).map(({ source }) => [label, source]));
  const unsupported = tabId === undefined;
  $('blocked-count').textContent = '—';
  $('signals-count').textContent = unsupported ? '—' : new Set(observations.map(({ key }) => key)).size;
  $('other-count').textContent = unsupported ? '—' : other.length;
  renderList('blocked', [
    ['追踪域名规则', settings.enabled && settings.trackers ? '配置已开启' : '配置未开启'],
    ['本地端口规则', settings.enabled && settings.localPorts ? '配置已开启' : '配置未开启']
  ], '');
  renderList('signals', fingerprintRows, unsupported ? '本页不支持监测' : !settings.enabled || !rules.observe ? 'API 观察已关闭，刷新后不再安装观察钩子。' : '还没观察到。刚安装？请刷新页面。');
  renderList('other', other, unsupported ? '本页不支持监测' : '未观察到跨主机请求。');
  $('limit').hidden = !tab?.capped;
}
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:/.test(tab.url)) {
    tabId = tab.id;
    $('site').textContent = new URL(tab.url).hostname;
  } else {
    $('site').textContent = '本页不支持监测（仅 HTTP / HTTPS）';
  }
  $('zones').replaceChildren(...Intl.supportedValuesOf('timeZone').map((zone) => {
    const option = document.createElement('option');
    option.value = zone;
    return option;
  }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area !== 'local' && (area !== 'session' || (!changes[`tab:${tabId}`] && !changes[`sync:${tabId}`] && !changes[`workerAutoTab:${tabId}`]))) || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refresh().catch(showError);
    }, 150);
  });
  await refresh(true);
}
function showError(error) {
  $('settings-section').open = true;
  status(error.message, true);
}
$('webrtc').addEventListener('change', async () => {
  if (saving) return;
  saving = true;
  fieldset.disabled = true;
  const webrtc = $('webrtc').checked;
  try {
    const config = await send({ type: 'save', settings: { webrtc } });
    savedWebrtc = config.webrtc;
    $('webrtc').checked = savedWebrtc;
    await refresh();
    status('WebRTC 开关已独立保存，时区草稿未改动。请刷新测试页；旧值或钩子可能保留到刷新。');
  } catch (error) {
    $('webrtc').checked = savedWebrtc;
    try {
      await refresh();
      status(`操作出错：${error.message}。已重新读取后台，显示实际保存状态。`, true);
    } catch {
      $('webrtc').indeterminate = true;
      $('webrtc').disabled = true;
      status(`操作出错：${error.message}。无法确认最新状态，请重新打开弹窗。`, true);
    }
  } finally {
    saving = false;
    fieldset.disabled = false;
  }
});
$('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  fieldset.disabled = true;
  try {
    const config = await send({ type: 'save', settings: { zone: $('zone').value } });
    $('zone').value = config.zone;
    await refresh();
    status('已保存，请刷新页面清除旧值。活动 Worker 同步已停止；自动模式可在下次导航或刷新恢复，手动模式需重新启动。');
  } catch (error) {
    showError(error);
  } finally {
    saving = false;
    fieldset.disabled = false;
  }
});
$('worker-auto-mode').addEventListener('change', async () => {
  if (autoBusy) return;
  const mode = $('worker-auto-mode').value;
  autoBusy = true;
  renderWorkerSync(workerSync);
  workerMessage('正在保存同步范围并应用到已打开的网页…');
  try {
    const current = await send({ type: 'workerAutoGet' });
    const saved = await send({ type: 'workerAutoSave', workerAuto: { ...current, mode } });
    await refresh();
    workerMessage(mode === 'sites' && !saved.hosts.length
      ? '已切换为指定网站模式，列表为空。请打开指纹配置面板填写网站。'
      : '同步范围已保存。手动暂停的标签页仍保持暂停。');
  } catch (error) {
    workerMessage(`同步范围保存失败：${error.message || String(error)}`, true);
  } finally {
    autoBusy = false;
    renderWorkerSync(workerSync);
  }
});
$('worker-start').addEventListener('click', async () => {
  if (workerBusy || tabId === undefined || $('worker-start').disabled) return;
  workerBusy = true;
  renderWorkerSync(workerSync);
  workerMessage('正在等待后台连接并刷新当前页…');
  try {
    renderWorkerSync(await send({ type: 'workerStart', tabId }));
    await refresh();
    workerMessage('');
  } catch (error) {
    workerMessage(`启动未完成：${error.message || String(error)}。请检查调试提示或 DevTools 冲突。`, true);
  } finally {
    workerBusy = false;
    renderWorkerSync(workerSync);
  }
});
$('worker-stop').addEventListener('click', async () => {
  if (workerBusy || tabId === undefined || $('worker-stop').disabled) return;
  workerBusy = true;
  renderWorkerSync(workerSync);
  workerMessage('正在等待后台停止同步…');
  try {
    renderWorkerSync(await send({ type: 'workerStop', tabId }));
    await refresh();
    workerMessage(workerSync?.attached ? '后台仍报告连接，请查看状态或错误。' : '此标签页自动同步已暂停；手动启动或关闭标签页才能解除。已执行的修改可能需要刷新清除。', Boolean(workerSync?.attached));
  } catch (error) {
    workerMessage(`停止未完成：${error.message || String(error)}`, true);
  } finally {
    workerBusy = false;
    renderWorkerSync(workerSync);
  }
});
$('reload').addEventListener('click', () => chrome.tabs.reload(tabId).then(() => window.close(), showError));
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage().then(() => window.close(), showError));
document.querySelector('.metric.neutral').addEventListener('click', () => { $('other-section').open = true; });
init().catch(showError);
