/* ═══════════════════════════════════════════════════════════
   《全仓以赴》 Margin Call — 基础工具
   零依赖 · file:// 双击即玩
   ═══════════════════════════════════════════════════════════ */
window.MC = window.MC || {};

(function (MC) {
  'use strict';

  /* ── 事件总线 ─────────────────────────────────────────── */
  function makeBus() {
    const map = {};
    return {
      on(ev, fn) { (map[ev] = map[ev] || []).push(fn); return () => this.off(ev, fn); },
      off(ev, fn) { if (map[ev]) map[ev] = map[ev].filter(f => f !== fn); },
      emit(ev, ...args) { (map[ev] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error('[bus:' + ev + ']', e); } }); },
    };
  }
  MC.bus = makeBus();

  /* ── 随机数（可复现） ─────────────────────────────────── */
  function mulberry32(seed) {
    let a = seed >>> 0;
    const rnd = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rnd.int = (n) => Math.floor(rnd() * n);
    rnd.range = (a, b) => a + rnd() * (b - a);
    rnd.pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    rnd.chance = (p) => rnd() < p;
    rnd.shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd.int(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };
    return rnd;
  }
  MC.rng = mulberry32;

  /* ── 数学 ─────────────────────────────────────────────── */
  MC.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  MC.lerp = (a, b, t) => a + (b - a) * t;
  MC.ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    outQuint: t => 1 - Math.pow(1 - t, 5),
    inOutCubic: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outBack: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: t => { const c = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * c) + 1; },
  };

  /* ── 数字格式化 ───────────────────────────────────────── */
  function fmtMoney(v, signed) {
    if (!isFinite(v)) v = 0;
    const neg = v < 0; const a = Math.abs(v);
    let s;
    if (a >= 1e8) s = (a / 1e8).toFixed(2) + '亿';
    else if (a >= 1e4) s = (a / 1e4).toFixed(a >= 1e5 ? 1 : 2) + '万';
    else s = Math.round(a).toLocaleString('en-US');
    return (neg ? '-' : signed && !neg ? '+' : '') + '¥' + s;
  }
  function fmtSigned(v) { return fmtMoney(v, true); }
  function fmtPct(v, digits) {
    if (!isFinite(v)) v = 0;
    const d = digits === undefined ? 1 : digits;
    return (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
  }
  function fmtNum(v) {
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(a >= 1e5 ? 1 : 2) + '万';
    return Math.round(v).toLocaleString('en-US');
  }
  MC.fmt = { money: fmtMoney, signed: fmtSigned, pct: fmtPct, num: fmtNum };

  /* ── DOM 助手 ─────────────────────────────────────────── */
  MC.$ = (sel, root) => (root || document).querySelector(sel);
  MC.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  MC.el = function (tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
    for (const c of children.flat(9)) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  };

  /* ── 计时助手 ─────────────────────────────────────────── */
  MC.sleep = (ms) => new Promise(r => setTimeout(r, ms));
  MC.waitFrames = (n) => new Promise(r => { let i = 0; (function step() { i++ >= n ? r() : requestAnimationFrame(step); })(); });
  /* 可跳过的等待：用户点击 skipBtn 立即返回 */
  MC.sleepSkippable = function (ms, check) {
    return new Promise(resolve => {
      const t0 = performance.now();
      (function loop() {
        if (performance.now() - t0 >= ms || (check && check())) return resolve(true);
        requestAnimationFrame(loop);
      })();
    });
  };

  /* ── 数字滚动动画 ─────────────────────────────────────── */
  MC.rollNumber = function (node, from, to, ms, fmt) {
    fmt = fmt || (v => Math.round(v).toLocaleString('en-US'));
    const t0 = performance.now();
    (function step(now) {
      const t = MC.clamp((now - t0) / ms, 0, 1);
      const v = from + (to - from) * MC.ease.outCubic(t);
      node.textContent = fmt(v);
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  };

  /* ── localStorage 存档 ────────────────────────────────── */
  const SAVE_KEY = 'margincall_save_v1';
  MC.save = {
    read() {
      try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
    },
    write(patch) {
      try {
        const cur = MC.save.read();
        const next = Object.assign({}, cur, patch);
        localStorage.setItem(SAVE_KEY, JSON.stringify(next));
        return next;
      } catch (e) { return {}; }
    },
  };

  /* ── 移动/触控检测 ────────────────────────────────────── */
  MC.isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;
  MC.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

})(window.MC);
