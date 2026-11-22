(() => {
  const seen = new Set();
  let value = { enabled: false };
  let revision = 0;
  let loaded = false;
  let signature;
  let reloadRequired = false;
  let style;
  function publish() {
    if (!loaded) return;
    document.dispatchEvent(new CustomEvent('dntm-profile', { detail: JSON.stringify(value) }));
    const font = value.enabled && !reloadRequired ? value.profile?.font : 'native';
    const css = ['sans-serif', 'serif', 'monospace'].includes(font)
      ? `:root, body, body *:not(svg):not(svg *), body *::before, body *::after { font-family: ${font} !important; }` : '';
    if (!css) { style?.remove(); style = undefined; return; }
    if (!document.documentElement) return;
    if (!style?.isConnected) {
      style = document.createElement('style');
      style.dataset.dntm = 'font-replacement';
      document.documentElement.append(style);
    }
    style.textContent = css;
  }
  async function refresh() {
    const requested = ++revision;
    let next = { enabled: false };
    try {
      const response = await chrome.runtime.sendMessage({ type: 'pageProfile' });
      if (typeof response?.value?.enabled === 'boolean') next = response.value;
    } catch {}
    if (requested !== revision) return;
    const nextSignature = JSON.stringify(next);
    if (signature !== undefined && signature !== nextSignature) reloadRequired = true;
    signature = nextSignature;
    value = { ...next, reloadRequired };
    loaded = true;
    publish();
  }
  document.addEventListener('dntm-ready', refresh);
  document.addEventListener('DOMContentLoaded', publish, { once: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.library)) refresh();
  });
  refresh();
  document.addEventListener('dntm-signal', ({ detail }) => {
    if (loaded && (!value.enabled || !value.rules?.observe || reloadRequired)) return;
    if (typeof detail !== 'string' || detail.length > 288 || seen.size >= 32) return;
    const split = detail.indexOf('\n');
    if (split < 1 || split > 32) return;
    const signal = detail.slice(0, split);
    if (seen.has(signal)) return;
    seen.add(signal);
    chrome.runtime.sendMessage({ type: 'signal', signal, source: detail.slice(split + 1) }).catch(() => {});
  }, true);
})();
