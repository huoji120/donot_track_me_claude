import { maskProfile } from './feature-rules.js';
const RULESET_ID = 'privacy_rules';
const LOCAL_RULE_ID_START = 1000;
const IPV4_LOCAL = '(?:(?:0|10|127)\\.[0-9]+\\.[0-9]+\\.[0-9]+|172\\.(?:1[6-9]|2[0-9]|3[01])\\.[0-9]+\\.[0-9]+|192\\.168\\.[0-9]+\\.[0-9]+|169\\.254\\.[0-9]+\\.[0-9]+)';
// Chromium canonicalizes IPv4 literals (including integer, octal and hexadecimal
// spellings) and IPv6 literals before DNR matching. Mapped IPv4 becomes two hex
// groups: 0/8, 10/8, 127/8, 172.16/12, 192.168/16 and 169.254/16, respectively.
const MAPPED_PRIVATE_PREFIX = '(?:[0-9a-f]{1,2}|a[0-9a-f]{2}|7f[0-9a-f]{2}|ac1[0-9a-f]|c0a8|a9fe)';
const LOCAL_HOSTS = [
  IPV4_LOCAL,
  '(?:(?:[^./:@?#]+\\.)*localhost|(?:[^./:@?#]+\\.)+local)\\.?',
  '\\[(?:::1?|f[cd][0-9a-f]{2}:[0-9a-f:]+|fe[89ab][0-9a-f]:[0-9a-f:]+)\\]',
  `\\[::ffff:${MAPPED_PRIVATE_PREFIX}:[0-9a-f]{1,4}\\]`,
];
const LOCAL_RULES = LOCAL_HOSTS.map((host, index) => ({
  id: LOCAL_RULE_ID_START + index,
  priority: 1,
  action: { type: 'block' },
  condition: {
    regexFilter: `^(?:https?|wss?)://(?:[^/?#@]*@)?${host}(?::[0-9]+)?(?:[/?#]|$)`,
    isUrlFilterCaseSensitive: false,
    // Direct top-level navigation stays available. A local page's scripts,
    // frames, images, fetches and sockets remain blocked until this option is off.
    excludedResourceTypes: ['main_frame'],
  },
}));

// This is a URL-host boundary, not a DNS firewall: public names resolving or
// rebinding to private addresses cannot be identified by DNR. WebRTC UDP/STUN
// traffic is outside these HTTP/WebSocket rules and has its own privacy setting.
export async function applyNetworkSettings(config, library) {
  const dnr = chrome.declarativeNetRequest;
  const addRules = config.enabled && config.localPorts ? [...LOCAL_RULES] : [];
  if (config.enabled && config.rules.languages) {
    const header = (languages) => languages.map((tag, index) => index ? `${tag};q=${(1 - index / 10).toFixed(1)}` : tag).join(',');
    const rule = (id, priority, regexFilter, languages) => ({
      id, priority, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: header(languages) }] },
      condition: { regexFilter, isUrlFilterCaseSensitive: false,
        resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'webtransport', 'webbundle', 'other'] }
    });
    const defaults = maskProfile(config.profile, config.rules).languages;
    if (defaults) addRules.push(rule(2000, 10, '^https?://', defaults.split(',')));
    const profiles = new Map(library.profiles.map((entry) => [entry.id, maskProfile(entry.profile, config.rules)]));
    let nativeLanguages;
    let nextId = 2001;
    for (const [host, id] of Object.entries(library.assignments)) {
      const profile = profiles.get(id);
      if (!profile || profile.languages === defaults) continue;
      if (!profile.languages) nativeLanguages ??= (await chrome.i18n.getAcceptLanguages()).slice(0, 10);
      const languages = profile.languages ? profile.languages.split(',') : nativeLanguages;
      const literal = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match the actual destination host, not its subdomains. Third-party
      // destinations follow their own binding/default rather than the initiator.
      addRules.push(rule(nextId++, 20, `^https?://(?:[^/?#@]*@)?${literal}(?::[0-9]+)?(?:[/?#]|$)`, languages));
    }
  }
  for (const rule of addRules) {
    const support = await dnr.isRegexSupported({
      regex: rule.condition.regexFilter,
      isCaseSensitive: false,
      requireCapturing: false,
    });
    if (!support.isSupported) {
      throw new Error(`Local-network rule ${rule.id} is not supported by Chrome RE2: ${support.reason ?? 'unknown reason'}`);
    }
  }

  // IDs >= 1000 belong to local-network and language rules. Replace this owned
  // range together so disabling or unbinding also removes stale language rules.
  const current = await dnr.getDynamicRules();
  const removeRuleIds = current.filter((rule) => rule.id >= LOCAL_RULE_ID_START).map((rule) => rule.id);
  if (removeRuleIds.length || addRules.length) {
    await dnr.updateDynamicRules({ removeRuleIds, addRules });
  }
  await dnr.updateStaticRules({
    rulesetId: RULESET_ID,
    enableRuleIds: [...(config.trackers ? [1] : []), ...(config.rules.privacySignals ? [3] : [])],
    disableRuleIds: [...(config.trackers ? [] : [1]), ...(config.rules.privacySignals ? [] : [3])],
  });
  await dnr.updateEnabledRulesets({
    enableRulesetIds: config.enabled ? [RULESET_ID] : [],
    disableRulesetIds: config.enabled ? [] : [RULESET_ID],
  });
}
