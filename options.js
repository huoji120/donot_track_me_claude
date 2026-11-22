import { DEFAULT_PROFILE, normalizeProfile } from './profile.js';
import { FEATURE_RULES, NETWORK_RULES, DEFAULT_RULES, DEFAULT_NETWORK_RULES } from './feature-rules.js';

const $ = (id) => document.getElementById(id);
const profileKeys = Object.keys(DEFAULT_PROFILE);
const switches = ['enabled'];
const networkKeys = new Set(NETWORK_RULES.map(({ key }) => key));
const presets = [
  { cpu: 4, memory: 4, width: 1366, height: 768, gpuVendor: 'Google Inc. (Intel)', gpuRenderer: 'ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { cpu: 12, memory: 8, width: 2560, height: 1440, gpuVendor: 'Google Inc. (NVIDIA)', gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { cpu: 16, memory: 8, width: 2560, height: 1440, gpuVendor: 'Google Inc. (AMD)', gpuRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { cpu: 8, memory: 8, width: 1920, height: 1200, gpuVendor: 'Google Inc. (Intel)', gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)' }
];
let settings;
let library = { profiles: [], assignments: {} };
let busy = false;
let dirty = false;
let editorRecordId = null;
let refreshTimer;
let configurationSaved = false;
let autoDirty = false;
let autoBusy = false;
let autoRevision = 0;
let rulesKnown = false;
let refreshPending = false;
let mutationRevision = 0;
const refreshReminder = '请刷新测试页后再比较；刷新前可能保留旧缓存值和旧钩子，全部关闭的基线也不例外。';

function ruleStatus(text, error = false) {
  $('feature-rule-status').textContent = `${text} ${refreshReminder}`;
  $('feature-rule-status').toggleAttribute('data-error', error);
}
function syncControls() {
  const locked = busy || autoBusy || !rulesKnown;
  $('controls').disabled = locked;
  $('feature-rule-controls').disabled = locked;
  $('worker-auto-controls').disabled = busy || autoBusy || !settings;
}
function renderRules() {
  const rules = { ...DEFAULT_RULES, ...settings.rules };
  let enabledCount = 0;
  for (const { key } of [...FEATURE_RULES, ...NETWORK_RULES]) {
    const checked = networkKeys.has(key) ? Boolean(settings[key]) : rules[key];
    $(`rule-${key}`).checked = checked;
    $(`rule-${key}`).indeterminate = !rulesKnown;
    if (checked) ++enabledCount;
    if (networkKeys.has(key)) $(key).checked = checked;
  }
  $('feature-rule-summary').textContent = rulesKnown
    ? `已保存开启 ${enabledCount} / ${FEATURE_RULES.length + NETWORK_RULES.length} 项。${settings.enabled ? '全局防护已开启；开启按已保存参数生效。' : '全局防护已关闭：这些规则当前不生效，不会因排查操作自动开启全局防护。'}`
    : '无法确认最新保存状态，当前勾选仅为上次读数；重新打开设置页或等待后台更新后再操作。';
}
function exclusiveRules(selected) {
  return {
    rules: Object.fromEntries(FEATURE_RULES.map(({ key }) => [key, key === selected])),
    ...Object.fromEntries(NETWORK_RULES.map(({ key }) => [key, key === selected]))
  };
}
async function saveRules(patch) {
  if (busy || autoBusy || !rulesKnown) return;
  busy = true;
  ++mutationRevision;
  syncControls();
  ruleStatus('正在保存功能开关…');
  let saved = false;
  try {
    settings = await send({ type: 'save', settings: patch });
    saved = true;
    renderRules();
    renderState(await send({ type: 'get', tabId: -1 }));
    ruleStatus('功能开关已保存，指纹参数与编辑草稿未改动。活动 Worker 同步已停止；自动模式在后续导航或刷新时按开关恢复，手动模式需重新启动。');
  } catch (error) {
    let recovered = false;
    try {
      renderState(await send({ type: 'get', tabId: -1 }));
      recovered = true;
    } catch {
      rulesKnown = false;
      renderRules();
    }
    ruleStatus(`${saved ? '保存已返回成功，但状态刷新出错' : '保存未确认成功'}：${error.message || String(error)}。${recovered ? '已重新读取后台，勾选显示实际保存状态。' : '无法确认后台状态，不将本次操作视为已应用。'}`, true);
  } finally {
    busy = false;
    syncControls();
    if (refreshPending) scheduleRefresh();
  }
}
function initRules() {
  const rows = [...FEATURE_RULES, ...NETWORK_RULES].map(({ key, label, detail }) => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    const toggle = document.createElement('label');
    toggle.className = 'setting-row';
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = label;
    const description = document.createElement('small');
    description.id = `rule-detail-${key}`;
    description.textContent = detail;
    text.append(title, description);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `rule-${key}`;
    input.setAttribute('aria-describedby', description.id);
    input.addEventListener('change', () => saveRules(networkKeys.has(key) ? { [key]: input.checked } : { rules: { [key]: input.checked } }));
    toggle.append(text, input);
    const only = document.createElement('button');
    only.type = 'button';
    only.id = `rule-only-${key}`;
    only.className = 'quiet';
    only.textContent = '只开此项';
    only.setAttribute('aria-label', `只开此项：${label}`);
    only.addEventListener('click', () => saveRules(exclusiveRules(key)));
    row.append(toggle, only);
    return row;
  });
  $('feature-rule-list').replaceChildren(...rows);
  $('rules-all-off').addEventListener('click', () => saveRules(exclusiveRules(null)));
  $('rules-reset-defaults').addEventListener('click', () => saveRules({ rules: { ...DEFAULT_RULES }, ...DEFAULT_NETWORK_RULES }));
  for (const { key } of NETWORK_RULES) {
    $(key).addEventListener('change', () => saveRules({ [key]: $(key).checked }));
  }
}
function scheduleRefresh() {
  refreshPending = true;
  clearTimeout(refreshTimer);
  if (busy || autoBusy) return;
  refreshTimer = setTimeout(() => {
    if (busy || autoBusy) return;
    refreshPending = false;
    refresh().then(() => {
      status(`${dirty ? '后台配置已更新，指纹编辑草稿已保留；网络开关已同步。' : '已同步最新配置。'} ${refreshReminder}`);
    }).catch((error) => {
      rulesKnown = false;
      renderRules();
      syncControls();
      ruleStatus(`读取后台失败：${error.message}。`, true);
    });
  }, 150);
}

function autoStatus(text, error = false) {
  $('worker-auto-status').textContent = text;
  $('worker-auto-status').toggleAttribute('data-error', error);
}
function renderWorkerAuto(value) {
  if (autoDirty || autoBusy) return;
  $('worker-auto-mode').value = value.mode;
  $('worker-auto-hosts').value = value.hosts.join('\n');
  autoStatus(`已保存：${{ manual: '仅手动', sites: '指定网站', all: '所有 HTTP(S) 网站' }[value.mode]} · ${value.hosts.length} 个主机。`);
}
$('worker-auto-form').addEventListener('input', () => {
  autoDirty = true;
  ++autoRevision;
  sessionStorage.setItem('workerAutoDraft', JSON.stringify({ mode: $('worker-auto-mode').value, hosts: $('worker-auto-hosts').value }));
  autoStatus('同步模式有未保存草稿；不会随指纹配置一起保存。');
});
$('worker-auto-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (autoBusy || busy || !settings) return;
  autoBusy = true;
  ++mutationRevision;
  const revision = autoRevision;
  syncControls();
  autoStatus('正在保存并应用到已打开的标签页…');
  try {
    const value = await send({ type: 'workerAutoSave', workerAuto: { mode: $('worker-auto-mode').value, hosts: $('worker-auto-hosts').value } });
    if (revision === autoRevision) {
      autoDirty = false;
      sessionStorage.removeItem('workerAutoDraft');
      autoBusy = false;
      renderWorkerAuto(value);
      autoStatus(`${$('worker-auto-status').textContent} 已应用到现有标签页，手动暂停的标签页保持暂停。`);
    }
  } catch (error) { autoStatus(error.message || String(error), true); }
  finally {
    autoBusy = false;
    syncControls();
    if (refreshPending) scheduleRefresh();
  }
});

function status(text, error = false) {
  $('status').textContent = text;
  $('status').toggleAttribute('data-error', error);
}
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result || result.error) throw new Error(result?.error || '无法连接扩展后台。');
  if (message.type === 'save' || message.type === 'librarySave') configurationSaved = true;
  return result.value;
}
function renderProfile(profile) {
  for (const key of profileKeys) {
    if (typeof DEFAULT_PROFILE[key] === 'boolean') $(key).checked = profile[key];
    else $(key).value = profile[key];
  }
}
function readProfile() {
  return normalizeProfile(Object.fromEntries(profileKeys.map((key) => [key,
    typeof DEFAULT_PROFILE[key] === 'boolean' ? $(key).checked : $(key).value])));
}
function readZone() {
  const zone = $('zone').value.trim();
  if (zone) {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); }
    catch { throw new Error('请输入有效的 IANA 时区，例如 Asia/Shanghai。'); }
  }
  return zone;
}
function renderState(value) {
  settings = value.settings;
  rulesKnown = true;
  renderRules();
  syncControls();
  $('mode').textContent = settings.enabled ? '防护已开启' : '防护已暂停';
  $('mode').dataset.enabled = settings.enabled;
  const rtc = value.webrtc;
  $('rtc-state').textContent = rtc?.value === 'disable_non_proxied_udp'
    ? '浏览器当前已限制非代理 UDP。'
    : ['not_controllable', 'controlled_by_other_extensions'].includes(rtc?.levelOfControl)
      ? '当前 WebRTC 策略由浏览器策略或其他扩展控制。' : '浏览器当前未限制非代理 UDP。';
}
function renderSettings() {
  renderProfile(settings.profile);
  $('zone').value = settings.zone;
  for (const key of switches) $(key).checked = settings[key];
  editorRecordId = null;
  $('editing').textContent = '编辑区当前为默认配置。载入记录只修改编辑草稿；保存到所选记录不会修改默认配置。';
  dirty = false;
}
function renderLibrary(selected = $('profile-list').value) {
  const binding = $('binding-profile').value;
  for (const id of ['profile-list', 'binding-profile']) {
    const options = library.profiles.map((record) => new Option(record.name, record.id));
    $(id).replaceChildren(new Option('选择一条记录', ''), ...options);
    $(id).value = id === 'profile-list' ? selected : binding;
  }
  $('profile-count').textContent = `${library.profiles.length} 条记录`;
  const rows = Object.entries(library.assignments).sort(([a], [b]) => a.localeCompare(b)).map(([host, id]) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = host;
    const detail = document.createElement('small');
    detail.textContent = library.profiles.find((record) => record.id === id)?.name || '记录不存在';
    text.append(title, detail);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'quiet';
    remove.textContent = '解除绑定';
    remove.setAttribute('aria-label', `解除 ${host} 的绑定`);
    remove.addEventListener('click', () => run(async () => {
      await changeLibrary((next) => { delete next.assignments[host]; });
      status(`已解除 ${host} 的绑定。刷新该站点后使用默认配置。`);
    }));
    li.append(text, remove);
    return li;
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'help';
    empty.textContent = '还没有站点绑定。未绑定的网站使用默认指纹。';
    rows.push(empty);
  }
  $('bindings').replaceChildren(...rows);
}
async function changeLibrary(change, selected) {
  const next = await send({ type: 'libraryGet' });
  change(next);
  library = await send({ type: 'librarySave', library: next });
  renderLibrary(selected);
}
function generatedProfile() {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % presets.length;
  return normalizeProfile({ ...DEFAULT_PROFILE, ...presets[index], seed: crypto.randomUUID(),
    canvas: $('canvas').checked, audio: $('audio').checked, font: $('font').value, languages: $('languages').value });
}
function recordName() {
  const name = $('profile-name').value.trim();
  return name || `指纹 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
}
async function addRecord(profile, zone) {
  const record = { id: crypto.randomUUID(), name: recordName(), profile, zone };
  await changeLibrary((next) => { next.profiles.push(record); }, record.id);
  $('profile-name').value = record.name;
  return record;
}
function loadRecord(record) {
  renderProfile(record.profile);
  $('zone').value = record.zone;
  $('profile-name').value = record.name;
  editorRecordId = record.id;
  dirty = true;
  $('editing').textContent = `正在编辑「${record.name}」。保存到所选记录只更新此记录；“保存并设为默认”另行更新默认配置。`;
}
async function refresh() {
  const revision = mutationRevision;
  const [state, records] = await Promise.all([send({ type: 'get', tabId: -1 }), send({ type: 'libraryGet' })]);
  if (busy || autoBusy || revision !== mutationRevision) {
    scheduleRefresh();
    return;
  }
  renderState(state);
  renderWorkerAuto(state.workerAuto);
  library = records;
  renderLibrary();
  if (!dirty) renderSettings();
}
async function run(action) {
  if (busy || autoBusy || !rulesKnown) return;
  busy = true;
  ++mutationRevision;
  configurationSaved = false;
  syncControls();
  try { await action(); }
  catch (error) { status(error.message || String(error), true); }
  finally {
    if (configurationSaved) {
      status(`${$('status').textContent} 活动 Worker 同步已停止；自动模式可在下次导航或刷新时恢复，手动模式需重新启动。`, $('status').hasAttribute('data-error'));
    }
    busy = false;
    renderRules();
    syncControls();
    if (refreshPending) scheduleRefresh();
  }
}
async function applyDefaultProfile(profile) {
  settings = await send({ type: 'save', settings: { profile } });
  renderProfile(settings.profile);
  editorRecordId = null;
  dirty = true;
  $('editing').textContent = '编辑区指纹已应用为默认；时区草稿未被修改，其他未保存改动仍需手动保存。网络开关独立立即保存。';
}
$('settings').addEventListener('input', (event) => {
  if (['hostname', 'profile-name'].includes(event.target.id) || networkKeys.has(event.target.id)) return;
  dirty = true;
  status('编辑区有未保存修改。请选择保存为默认、更新所选记录或另存新记录。');
});
$('settings').addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const profile = readProfile();
    const zone = readZone();
    const next = { profile, zone, ...Object.fromEntries(switches.map((key) => [key, $(key).checked])) };
    settings = await send({ type: 'save', settings: next });
    renderSettings();
    renderState(await send({ type: 'get', tabId: -1 }));
    status('已保存并应用默认配置。已绑定站点仍使用各自记录；建议刷新受影响网站，以清除旧值和旧 API 引用。');
  });
});
$('profile-list').addEventListener('change', () => {
  const record = library.profiles.find((item) => item.id === $('profile-list').value);
  $('profile-name').value = record?.name || '';
});
$('load-profile').addEventListener('click', () => run(async () => {
  const record = library.profiles.find((item) => item.id === $('profile-list').value);
  if (!record) throw new Error('请先选择一条指纹记录。');
  loadRecord(record);
  status(`已将「${record.name}」载入编辑区，尚未修改默认配置或保存记录。`);
}));
$('save-copy').addEventListener('click', () => run(async () => {
  const profile = readProfile();
  const zone = readZone();
  const record = await addRecord(profile, zone);
  loadRecord(record);
  status('已另存新记录。可在站点绑定区选择使用；默认配置未改变。应用后建议刷新受影响网站，以清除旧值和旧 API 引用。');
}));
$('generate-record').addEventListener('click', () => run(async () => {
  const zone = readZone();
  const record = await addRecord(generatedProfile(), zone);
  loadRecord(record);
  status('已随机生成并保存一条新记录，已有记录与绑定未改变。选择站点即可绑定；应用后建议刷新受影响网站，以清除旧值和旧 API 引用。');
}));
$('update-profile').addEventListener('click', () => run(async () => {
  const id = $('profile-list').value;
  if (!id || editorRecordId !== id) throw new Error('请先将所选记录载入编辑区，再修改并保存。');
  const profile = readProfile();
  const zone = readZone();
  const name = recordName();
  await changeLibrary((next) => {
    const record = next.profiles.find((item) => item.id === id);
    if (!record) throw new Error('该记录已被删除，请重新选择。');
    Object.assign(record, { name, profile, zone });
  }, id);
  loadRecord(library.profiles.find((item) => item.id === id));
  status('记录已更新，绑定保持不变。默认配置未改变；建议刷新绑定网站，以清除旧值和旧 API 引用。');
}));
$('delete-profile').addEventListener('click', () => run(async () => {
  const id = $('profile-list').value;
  if (!id) throw new Error('请先选择要删除的记录。');
  if (!window.confirm('删除所选指纹记录，并解除使用它的全部站点绑定？默认配置不受影响。')) return;
  await changeLibrary((next) => {
    next.profiles = next.profiles.filter((item) => item.id !== id);
    for (const [host, assigned] of Object.entries(next.assignments)) if (assigned === id) delete next.assignments[host];
  }, '');
  if (editorRecordId === id) {
    editorRecordId = null;
    $('editing').textContent = '原记录已删除，编辑区保留为未保存草稿。';
  }
  $('profile-name').value = '';
  status('记录及其绑定已删除。刷新受影响站点以恢复默认配置。');
}));
$('bind-profile').addEventListener('click', () => run(async () => {
  const host = $('hostname').value.trim().toLowerCase();
  const id = $('binding-profile').value;
  if (!host || /[\s/:?#@*]/.test(host)) throw new Error('请只填写主机名，例如 example.com，不含协议、路径或端口。');
  const url = new URL(`https://${host}`);
  if (!url.hostname || url.pathname !== '/') throw new Error('主机名无效。');
  await changeLibrary((next) => {
    if (!next.profiles.some((record) => record.id === id)) throw new Error('请选择要绑定的指纹记录。');
    next.assignments[url.hostname] = id;
  });
  $('hostname').value = url.hostname;
  status(`已绑定 ${url.hostname}。刷新此站点以完整应用记录与时区。`);
}));
$('generate').addEventListener('click', () => run(async () => {
  const state = await send({ type: 'get', tabId: -1 });
  const profile = generatedProfile();
  await addRecord(profile, state.settings.zone);
  try { await applyDefaultProfile(profile); }
  catch (error) { throw new Error(`新记录已保存，但应用默认配置失败：${error.message}`); }
  status('已新增指纹记录并应用为默认。已保存的时区、网络开关与现有站点绑定不变；其他草稿仍未保存。建议刷新受影响网站，以清除旧值和旧 API 引用。');
}));
$('native').addEventListener('click', () => run(async () => {
  const profile = normalizeProfile({ ...DEFAULT_PROFILE, seed: $('seed').value.trim() || DEFAULT_PROFILE.seed,
    canvas: false, audio: false, cpu: 0, memory: 0, width: 0, height: 0, gpuVendor: '', gpuRenderer: '', font: 'native', languages: '' });
  settings = await send({ type: 'save', settings: { profile, zone: '' } });
  renderProfile(settings.profile);
  $('zone').value = settings.zone;
  editorRecordId = null;
  dirty = true;
  $('editing').textContent = '默认指纹、语言与时区已恢复原生；其他未保存改动仍需手动保存。网络开关独立立即保存。';
  status('默认指纹、字体、语言与时区已恢复原生。已有记录、站点绑定和功能开关未改变；绑定站点仍使用各自记录。API 观察与隐私信号仍可能安装钩子；要排除 API 改写，请使用“全部关闭（基线）”并刷新测试页。');
}));
async function init() {
  initRules();
  const zones = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])];
  $('zones').replaceChildren(...zones.map((zone) => new Option(zone, zone)));
  try {
    const draft = JSON.parse(sessionStorage.getItem('workerAutoDraft') || 'null');
    if (draft && ['manual', 'sites', 'all'].includes(draft.mode) && typeof draft.hosts === 'string') {
      $('worker-auto-mode').value = draft.mode;
      $('worker-auto-hosts').value = draft.hosts;
      autoDirty = true;
      autoStatus('已恢复未保存的同步模式草稿。');
    }
  } catch { sessionStorage.removeItem('workerAutoDraft'); }
  await refresh();
  syncControls();
  status('配置已读取。可以编辑默认参数、保存多条指纹，或为不同主机绑定记录。');
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') scheduleRefresh();
  });
}
init().catch((error) => {
  status(`读取失败：${error.message}。请重新打开设置页重试。`, true);
  ruleStatus(`读取失败：${error.message}。请重新打开设置页重试。`, true);
});
