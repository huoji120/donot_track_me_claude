export const DEFAULT_PROFILE = Object.freeze({ seed: 'privacy-default', canvas: true, audio: false, cpu: 8, memory: 8, gpuVendor: '', gpuRenderer: '', width: 0, height: 0, font: 'native', languages: 'en-US,en' });
export function normalizeProfile(input = {}) {
  const p = { ...DEFAULT_PROFILE, ...input };
  const integer = (key, min, max) => {
    const n = Number(p[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} 必须是 ${min}–${max} 的整数。`);
    return n;
  };
  const seed = String(p.seed).trim();
  if (!seed || seed.length > 128) throw new Error('指纹种子必须是 1–128 个字符。');
  if (!['native', 'sans-serif', 'serif', 'monospace'].includes(p.font)) throw new Error('请选择有效的字体策略。');
  const width = integer('width', 0, 16384), height = integer('height', 0, 16384);
  if (!!width !== !!height) throw new Error('屏幕宽高必须一起填写，或均为 0。');
  const text = (key) => { const s = String(p[key]).trim(); if (s.length > 200 || /[\x00-\x1f]/.test(s)) throw new Error('GPU 名称最多 200 字符，不可含控制字符。'); return s; };
  const rawLanguages = String(p.languages).trim();
  let languages = [];
  if (rawLanguages) {
    const requested = rawLanguages.split(',').map((value) => value.trim());
    if (requested.length > 10 || requested.some((value) => !value || value.length > 80)) throw new Error('语言列表最多 10 项，请使用逗号分隔的语言标签。');
    try { languages = Intl.getCanonicalLocales(requested); }
    catch { throw new Error('语言标签无效，例如 en-US,en 或 zh-CN,zh。'); }
  }
  return { seed, canvas: !!p.canvas, audio: !!p.audio, cpu: integer('cpu', 0, 128), memory: integer('memory', 0, 128), width, height, gpuVendor: text('gpuVendor'), gpuRenderer: text('gpuRenderer'), font: p.font, languages: languages.join(',') };
}
