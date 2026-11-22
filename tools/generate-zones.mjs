// Run with Node.js after updating the bundled IANA timezone catalog.
import { mkdir, writeFile } from 'node:fs/promises';
const dir = new URL('../zones/', import.meta.url);
await mkdir(dir, { recursive: true });
const names = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);
const canonical = (name) => new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone;
const all = [...new Set([...names].map(canonical))].sort();
const index = Object.fromEntries(all.map((name, id) => [name, id]));
for (const name of names) index[name] = index[canonical(name)];
// Include both alias catalogs so Chromium and Node ICU canonicalization can differ.
for (const [oldName, newName] of [
  ['Asia/Calcutta', 'Asia/Kolkata'], ['Asia/Katmandu', 'Asia/Kathmandu'], ['Asia/Rangoon', 'Asia/Yangon'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'], ['Europe/Kiev', 'Europe/Kyiv'], ['Asia/Macao', 'Asia/Macau'],
  ['America/Godthab', 'America/Nuuk'], ['Pacific/Truk', 'Pacific/Chuuk'], ['Pacific/Ponape', 'Pacific/Pohnpei'],
  ['Atlantic/Faeroe', 'Atlantic/Faroe'], ['America/Coral_Harbour', 'America/Atikokan'], ['Africa/Asmera', 'Africa/Asmara']
]) {
  const key = index[oldName] ?? index[newName];
  if (key !== undefined) index[oldName] = index[newName] = key;
}
for (let offset = -14; offset <= 12; offset++) {
  const name = `Etc/GMT${offset > 0 ? '+' : ''}${offset}`;
  try { if (offset !== 0) index[name] = all.push(canonical(name)) - 1; } catch { /* UTC offsets outside IANA's named set */ }
}
await Promise.all([
  writeFile(new URL('index.json', dir), `${JSON.stringify(index, null, 2)}\n`),
  ...all.map((name, id) => writeFile(new URL(`${id}.js`, dir), `globalThis[Symbol.for('dntm.zone')] = ${JSON.stringify(name)};\n`))
]);
