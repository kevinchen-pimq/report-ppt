/**
 * esbuild-wasm 需要、但 Apps Script V8 沒有的瀏覽器 API。
 * 只在 loadEsbuild_() 裡安裝，平常 doGet 不會碰到。
 *
 * Apps Script 沒有事件迴圈（沒有 setTimeout），只有 Promise 的 microtask。
 * 這裡的 setTimeout 用 microtask 執行：delay 0 的立即排入；有 delay 的計時器只在
 * 其他工作都做完後才觸發（Go runtime 只用它來等待閒置的計時器）。
 */
function installPolyfills_() {
  const g = globalThis;
  if (g.__polyfilled) return;
  g.__polyfilled = true;

  if (typeof g.self === 'undefined') g.self = g;

  if (typeof g.performance === 'undefined') {
    const t0 = Date.now();
    g.performance = { now: () => Date.now() - t0, timeOrigin: t0 };
  }

  if (typeof g.crypto === 'undefined') {
    g.crypto = {
      // 只給 Go runtime 當亂數種子用，不需要密碼學強度
      getRandomValues(arr) {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    };
  }

  if (typeof g.TextEncoder === 'undefined') g.TextEncoder = Utf8Encoder_;
  if (typeof g.TextDecoder === 'undefined') g.TextDecoder = Utf8Decoder_;

  if (typeof g.setTimeout === 'undefined') {
    const timers = new Map();
    let seq = 0;
    let pumping = false;

    // 依序執行到期的計時器；沒有立即可執行的就挑最早到期的（必要時等待）
    const pump = () => {
      pumping = false;
      if (!timers.size) return;
      let next = null;
      for (const [id, t] of timers) {
        if (!next || t.due < next.t.due || (t.due === next.t.due && id < next.id)) next = { id: id, t: t };
      }
      const wait = next.t.due - Date.now();
      if (wait > 0) {
        if (typeof Utilities !== 'undefined') Utilities.sleep(Math.min(wait, 1000));
        schedule();
        return;
      }
      timers.delete(next.id);
      try {
        next.t.fn.apply(null, next.t.args);
      } finally {
        schedule();
      }
    };
    // 用一連串 microtask 讓已排入的 Promise 工作先跑完，再執行計時器
    const schedule = () => {
      if (pumping || !timers.size) return;
      pumping = true;
      let p = Promise.resolve();
      for (let i = 0; i < 8; i++) p = p.then(() => {});
      p.then(pump);
    };

    g.setTimeout = function (fn, delay) {
      const id = ++seq;
      timers.set(id, { fn: fn, args: Array.prototype.slice.call(arguments, 2), due: Date.now() + (Number(delay) || 0) });
      schedule();
      return id;
    };
    g.clearTimeout = function (id) {
      timers.delete(id);
    };
    g.__pendingTimers = () => timers.size;
  }
}

class Utf8Encoder_ {
  get encoding() {
    return 'utf-8';
  }

  encode(str) {
    str = String(str === undefined ? '' : str);
    const out = new Uint8Array(str.length * 3);
    let p = 0;
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) {
        out[p++] = c;
        continue;
      }
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        } else {
          c = 0xfffd;
        }
      } else if (c >= 0xd800 && c <= 0xdfff) {
        c = 0xfffd;
      }
      if (c < 0x800) {
        out[p++] = 0xc0 | (c >> 6);
        out[p++] = 0x80 | (c & 63);
      } else if (c < 0x10000) {
        out[p++] = 0xe0 | (c >> 12);
        out[p++] = 0x80 | ((c >> 6) & 63);
        out[p++] = 0x80 | (c & 63);
      } else {
        out[p++] = 0xf0 | (c >> 18);
        out[p++] = 0x80 | ((c >> 12) & 63);
        out[p++] = 0x80 | ((c >> 6) & 63);
        out[p++] = 0x80 | (c & 63);
      }
    }
    return out.slice(0, p);
  }
}

class Utf8Decoder_ {
  get encoding() {
    return 'utf-8';
  }

  decode(input) {
    if (input === undefined) return '';
    const bytes = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const parts = [];
    const units = new Array(0x2000);
    let n = 0;
    const push = (u) => {
      units[n++] = u;
      if (n === units.length) {
        parts.push(String.fromCharCode.apply(null, units));
        n = 0;
      }
    };
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      let c;
      let need;
      if (b < 0x80) {
        c = b;
        need = 0;
      } else if (b >= 0xc2 && b < 0xe0) {
        c = b & 0x1f;
        need = 1;
      } else if (b >= 0xe0 && b < 0xf0) {
        c = b & 0x0f;
        need = 2;
      } else if (b >= 0xf0 && b < 0xf5) {
        c = b & 0x07;
        need = 3;
      } else {
        push(0xfffd);
        i++;
        continue;
      }
      if (need && i + need >= bytes.length) {
        push(0xfffd);
        break;
      }
      let ok = true;
      for (let k = 1; k <= need; k++) {
        const x = bytes[i + k];
        if ((x & 0xc0) !== 0x80) {
          ok = false;
          break;
        }
        c = (c << 6) | (x & 0x3f);
      }
      if (!ok) {
        push(0xfffd);
        i++;
        continue;
      }
      i += need + 1;
      if (c >= 0x10000) {
        c -= 0x10000;
        push(0xd800 + (c >> 10));
        push(0xdc00 + (c & 0x3ff));
      } else {
        push(c);
      }
    }
    parts.push(String.fromCharCode.apply(null, units.slice(0, n)));
    return parts.join('');
  }
}
