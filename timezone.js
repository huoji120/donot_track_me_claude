(() => {
  const zoneKey = Symbol.for('dntm.zone');
  const installerKey = Symbol.for('dntm.installTimezone');
  const zone = globalThis[zoneKey];
  const install = globalThis[installerKey];
  delete globalThis[zoneKey];
  delete globalThis[installerKey];
  install(zone, globalThis[Symbol.for('dntm.hooks')].lifecycle);
})();
