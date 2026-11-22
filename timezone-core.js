// Shared page/Worker timezone behavior aligned with cejckpjfigehbeecbbfhangbknpidcnh 3.0.0.
// The existing lifecycle only supplies disable/restore; native Date.prototype is untouched.
globalThis[Symbol.for('dntm.installTimezone')] = function installTimezone(zone, lifecycle) {
  if (!zone) return;
  const ODate = Date;
  const ODateTimeFormat = Intl.DateTimeFormat;
  const apply = Reflect.apply;
  const enabled = () => !lifecycle.restored;
  const {
    getTime, getDate, getDay, getFullYear, getHours, getMilliseconds, getMinutes, getMonth, getSeconds, getYear,
    getTimezoneOffset, toDateString, toLocaleString, toString, toTimeString, toLocaleTimeString, toLocaleDateString,
    setYear, setHours, setTime, setFullYear, setMilliseconds, setMinutes, setMonth, setSeconds, setDate,
    setUTCDate, setUTCFullYear, setUTCHours, setUTCMilliseconds, setUTCMinutes, setUTCMonth, setUTCSeconds
  } = ODate.prototype;

  // Adapt the saved IANA zone to the reference extension's four preference values.
  // The offset is fixed at installation, rather than recalculated for each Date.
  const now = new ODate();
  const offsetName = new ODateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(now).find((part) => part.type === 'timeZoneName').value;
  const offsetMatch = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offsetName);
  if (!offsetMatch && offsetName !== 'GMT') throw new Error('Unsupported timezone offset');
  const offset = offsetMatch ? (offsetMatch[1] === '+' ? -1 : 1) *
    (+offsetMatch[2] * 60 + +offsetMatch[3] + +(offsetMatch[4] || 0) / 60) : 0;
  const label = new ODateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' })
    .formatToParts(now).find((part) => part.type === 'timeZoneName').value;
  const prefs = [zone, offset, apply(getTimezoneOffset, now, []), label];

  const clean = (text) => {
    const toGMT = (value) => {
      const pad = (n) => n < 10 ? '0' + n : n;
      const sign = value <= 0 ? '+' : '-';
      value = Math.abs(value);
      return sign + pad(value / 60 | 0) + pad(value % 60);
    };
    text = text.replace(/([T\\(])[\\+-]\\d+/g, '$1' + toGMT(ShiftedDate.prefs[1]));
    if (text.indexOf(' (') !== -1) text = text.split(' (')[0] + ' (' + ShiftedDate.prefs[3] + ')';
    return text;
  };

  class ShiftedDate extends ODate {
    constructor(...args) {
      super(...args);
      this.nd = new ODate(apply(getTime, this, []) +
        (enabled() ? (ShiftedDate.prefs[2] - ShiftedDate.prefs[1]) * 60000 : 0));
    }
    toLocaleString(...args) { return apply(toLocaleString, enabled() ? this.nd : this, args); }
    toLocaleTimeString(...args) { return apply(toLocaleTimeString, enabled() ? this.nd : this, args); }
    toLocaleDateString(...args) { return apply(toLocaleDateString, enabled() ? this.nd : this, args); }
    toDateString(...args) { return apply(toDateString, enabled() ? this.nd : this, args); }
    getDate(...args) { return apply(getDate, enabled() ? this.nd : this, args); }
    getDay(...args) { return apply(getDay, enabled() ? this.nd : this, args); }
    getFullYear(...args) { return apply(getFullYear, enabled() ? this.nd : this, args); }
    getHours(...args) { return apply(getHours, enabled() ? this.nd : this, args); }
    getMilliseconds(...args) { return apply(getMilliseconds, enabled() ? this.nd : this, args); }
    getMinutes(...args) { return apply(getMinutes, enabled() ? this.nd : this, args); }
    getMonth(...args) { return apply(getMonth, enabled() ? this.nd : this, args); }
    getSeconds(...args) { return apply(getSeconds, enabled() ? this.nd : this, args); }
    getYear(...args) { return apply(getYear, enabled() ? this.nd : this, args); }
    setHours(...args) {
      if (!enabled()) return apply(setHours, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setHours, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setFullYear(...args) {
      if (!enabled()) return apply(setFullYear, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setFullYear, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setMilliseconds(...args) {
      if (!enabled()) return apply(setMilliseconds, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setMilliseconds, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setMinutes(...args) {
      if (!enabled()) return apply(setMinutes, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setMinutes, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setMonth(...args) {
      if (!enabled()) return apply(setMonth, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setMonth, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setSeconds(...args) {
      if (!enabled()) return apply(setSeconds, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setSeconds, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setDate(...args) {
      if (!enabled()) return apply(setDate, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setDate, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setYear(...args) {
      if (!enabled()) return apply(setYear, this, args);
      const before = apply(getTime, this.nd, []);
      const after = apply(setYear, this.nd, args);
      apply(setTime, this, [apply(getTime, this, []) + after - before]);
      return after;
    }
    setTime(...args) {
      if (!enabled()) return apply(setTime, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setTime, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCDate(...args) {
      if (!enabled()) return apply(setUTCDate, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCDate, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCFullYear(...args) {
      if (!enabled()) return apply(setUTCFullYear, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCFullYear, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCHours(...args) {
      if (!enabled()) return apply(setUTCHours, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCHours, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCMilliseconds(...args) {
      if (!enabled()) return apply(setUTCMilliseconds, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCMilliseconds, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCMinutes(...args) {
      if (!enabled()) return apply(setUTCMinutes, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCMinutes, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCMonth(...args) {
      if (!enabled()) return apply(setUTCMonth, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCMonth, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    setUTCSeconds(...args) {
      if (!enabled()) return apply(setUTCSeconds, this, args);
      const before = apply(getTime, this, []);
      const after = apply(setUTCSeconds, this, args);
      apply(setTime, this.nd, [apply(getTime, this.nd, []) + after - before]);
      return after;
    }
    toString(...args) {
      return enabled() ? clean(apply(toString, this.nd, args)) : apply(toString, this, args);
    }
    toTimeString(...args) {
      return enabled() ? clean(apply(toTimeString, this.nd, args)) : apply(toTimeString, this, args);
    }
    getTimezoneOffset() {
      return enabled() ? ShiftedDate.prefs[1] : apply(getTimezoneOffset, this, []);
    }
  }
  lifecycle.define(ODate, 'prefs', { value: prefs, writable: true, enumerable: true, configurable: true });
  const format = function (locales, options = {}) {
    if (enabled()) Object.assign(options, { timeZone: ShiftedDate.prefs[0] });
    return ODateTimeFormat(locales, options);
  };
  format.prototype = Object.create(ODateTimeFormat.prototype);
  format.supportedLocalesOf = ODateTimeFormat.supportedLocalesOf;
  lifecycle.define(Intl, 'DateTimeFormat', { ...Object.getOwnPropertyDescriptor(Intl, 'DateTimeFormat'), value: format });
  lifecycle.define(globalThis, 'Date', { ...Object.getOwnPropertyDescriptor(globalThis, 'Date'), value: ShiftedDate });
};
