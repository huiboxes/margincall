/* ═══════════════════════════════════════════════════════════
   WebAudio 合成音效引擎（零素材，纯代码发声）
   每套主题一种「音色预设」：synth 合成波 / guqin 古琴拨弦
   crt 显像管哔声 / toy 玩具马林巴 / felt 毛毡钢琴
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  let AC = null, master = null, space = null, comp = null;
  let enabled = true, preset = 'synth';
  let chargeNodes = null, alarmTimer = null, lastType = 0;

  function ctx() {
    if (!AC) {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      comp = AC.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 8;
      master = AC.createGain();
      master.gain.value = 0.55;
      // 简易空间感：反馈延迟 + 低通
      space = AC.createGain();
      const d = AC.createDelay(1.0); d.delayTime.value = 0.22;
      const fb = AC.createGain(); fb.gain.value = 0.24;
      const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      space.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
      master.connect(comp); comp.connect(AC.destination);
    }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }

  const P = () => PRESETS[preset] || PRESETS.synth;

  /* ── 基本元件 ─────────────────────────────────────── */
  function tone(o) {
    const ac = ctx(), t = o.at || ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + (o.sweepDur || o.dur || 0.2));
    const g = ac.createGain();
    const peak = (o.gain === undefined ? 0.2 : o.gain);
    const atk = o.attack === undefined ? 0.005 : o.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + (o.dur || 0.15));
    let node = osc;
    if (o.filter) {
      const f = ac.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.value = o.filter.freq || 1200;
      f.Q.value = o.filter.q || 1;
      osc.connect(f); node = f;
    }
    node.connect(g);
    g.connect(o.dryOnly ? master : master);
    if (!o.dryOnly && o.space !== false) g.connect(space);
    osc.start(t); osc.stop(t + atk + (o.dur || 0.15) + 0.05);
    return osc;
  }

  function noise(o) {
    const ac = ctx(), t = o.at || ac.currentTime;
    const dur = o.dur || 0.1;
    const buf = ac.createBuffer(1, Math.max(1, ac.sampleRate * dur), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (o.taper ? (1 - i / data.length) : 1);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + dur);
    f.Q.value = o.q || 1;
    const g = ac.createGain();
    g.gain.setValueAtTime(o.gain === undefined ? 0.15 : o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    if (o.space !== false) g.connect(space);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /* Karplus-Strong 拨弦（古琴 / 木质感） */
  function pluck(freq, o) {
    o = o || {};
    const ac = ctx(), t = o.at || ac.currentTime;
    const dur = o.dur || 1.4, gain = o.gain === undefined ? 0.3 : o.gain;
    const n = Math.max(2, Math.floor(ac.sampleRate / freq));
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(n);
    for (let i = 0; i < n; i++) ring[i] = (Math.random() * 2 - 1);
    const damp = o.damp === undefined ? 0.996 : o.damp;
    let idx = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      const cur = ring[idx];
      const next = ring[(idx + 1) % n];
      const v = damp * 0.5 * (cur + next) * (1 - 0.0) + prev * 0.0;
      prev = ring[idx] = v;
      d[i] = cur;
      idx = (idx + 1) % n;
    }
    const src = ac.createBufferSource(); src.buffer = buf;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.bright || 3200;
    src.connect(lp); lp.connect(g); g.connect(master); g.connect(space);
    src.start(t);
  }

  function chord(freqs, o) { freqs.forEach((f, i) => tone(Object.assign({}, o, { freq: f, at: (o.at || 0) + i * (o.stagger || 0.02) }))); }

  /* ── 音色预设 ─────────────────────────────────────── */
  const PRESETS = {
    synth: { // 霓虹：锯齿合成波
      click: () => tone({ freq: 900, to: 620, type: 'square', dur: 0.05, gain: 0.06 }),
      trade: () => { tone({ freq: 140, to: 55, type: 'sawtooth', dur: 0.22, gain: 0.3, filter: { freq: 900 } }); noise({ freq: 3000, to: 400, dur: 0.18, gain: 0.12 }); },
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.16, gain: 0.1, at: ctx().currentTime + i * 0.07, filter: { freq: 2400 } })),
      lose: () => [392, 370, 311].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.22, gain: 0.1, at: ctx().currentTime + i * 0.09, filter: { freq: 900 } })),
      bust: () => { tone({ freq: 220, to: 28, type: 'sawtooth', dur: 0.9, gain: 0.3, filter: { freq: 700 } }); setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.4, gain: 0.12, dryOnly: true }), 900); },
      fanfare: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.3, gain: 0.09, at: ctx().currentTime + i * 0.1, filter: { freq: 3000 } })),
      stamp: () => { noise({ freq: 200, dur: 0.12, gain: 0.3, filterType: 'lowpass' }); tone({ freq: 70, to: 40, dur: 0.15, gain: 0.25 }); },
      chargeWave: 'sawtooth', chargeBase: 55, chargeTop: 640,
    },
    guqin: { // 水墨：古琴拨弦 + 木鱼
      click: () => pluck(880, { dur: 0.25, gain: 0.12, bright: 2000 }),
      trade: () => { pluck(196, { dur: 1.6, gain: 0.34 }); pluck(294, { dur: 1.2, gain: 0.2, at: ctx().currentTime + 0.05 }); noise({ freq: 800, dur: 0.25, gain: 0.05, filterType: 'lowpass' }); },
      win: () => [392, 466, 587, 784].forEach((f, i) => pluck(f, { dur: 1.5, gain: 0.22, at: ctx().currentTime + i * 0.12 })),
      lose: () => [233, 220, 175].forEach((f, i) => pluck(f, { dur: 1.8, gain: 0.22, at: ctx().currentTime + i * 0.16, damp: 0.992 })),
      bust: () => { pluck(98, { dur: 3, gain: 0.4, damp: 0.995 }); noise({ freq: 300, to: 80, dur: 1.2, gain: 0.15, filterType: 'lowpass' }); setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.4, gain: 0.1, dryOnly: true }), 1000); },
      fanfare: () => [294, 392, 466, 587, 784, 880].forEach((f, i) => pluck(f, { dur: 2, gain: 0.24, at: ctx().currentTime + i * 0.14 })),
      stamp: () => { noise({ freq: 160, dur: 0.14, gain: 0.32, filterType: 'lowpass' }); tone({ freq: 60, to: 36, dur: 0.18, gain: 0.22 }); },
      chargeWave: 'triangle', chargeBase: 70, chargeTop: 520,
    },
    crt: { // 显像管：方波哔哔 + 静电
      click: () => tone({ freq: 1200, type: 'square', dur: 0.03, gain: 0.05, dryOnly: true }),
      trade: () => { tone({ freq: 880, type: 'square', dur: 0.06, gain: 0.1, dryOnly: true }); tone({ freq: 1320, type: 'square', dur: 0.09, gain: 0.1, at: ctx().currentTime + 0.07, dryOnly: true }); noise({ freq: 5000, dur: 0.15, gain: 0.05, space: false }); },
      win: () => [660, 880, 1100].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.08, gain: 0.08, at: ctx().currentTime + i * 0.09, dryOnly: true })),
      lose: () => [440, 330, 220].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.12, gain: 0.08, at: ctx().currentTime + i * 0.12, dryOnly: true })),
      bust: () => { tone({ freq: 900, to: 100, type: 'square', dur: 0.7, gain: 0.12, dryOnly: true }); noise({ freq: 2000, dur: 0.7, gain: 0.1, space: false }); setTimeout(() => tone({ freq: 1000, type: 'square', dur: 1.3, gain: 0.07, dryOnly: true }), 750); },
      fanfare: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.1, gain: 0.07, at: ctx().currentTime + i * 0.11, dryOnly: true })),
      stamp: () => { noise({ freq: 2500, dur: 0.05, gain: 0.2, space: false }); noise({ freq: 1200, dur: 0.06, gain: 0.16, space: false, at: ctx().currentTime + 0.09 }); },
      chargeWave: 'square', chargeBase: 90, chargeTop: 880,
    },
    toy: { // 波普：马林巴 + 滑音玩具
      click: () => tone({ freq: 700, to: 900, type: 'triangle', dur: 0.06, gain: 0.1 }),
      trade: () => { tone({ freq: 300, to: 600, type: 'triangle', dur: 0.12, gain: 0.2 }); tone({ freq: 900, to: 1200, type: 'sine', dur: 0.1, gain: 0.15, at: ctx().currentTime + 0.08 }); },
      win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.14, gain: 0.14, at: ctx().currentTime + i * 0.08 })),
      lose: () => { tone({ freq: 400, to: 150, type: 'triangle', dur: 0.4, gain: 0.16 }); tone({ freq: 390, to: 140, type: 'sine', dur: 0.45, gain: 0.12, at: ctx().currentTime + 0.05 }); },
      bust: () => { [500, 400, 300, 200, 120].forEach((f, i) => tone({ freq: f, to: f * 0.6, type: 'triangle', dur: 0.18, gain: 0.2, at: ctx().currentTime + i * 0.1 })); setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.2, gain: 0.08 }), 700); },
      fanfare: () => [392, 523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.13, at: ctx().currentTime + i * 0.11 })),
      stamp: () => { tone({ freq: 150, to: 60, type: 'sine', dur: 0.12, gain: 0.3 }); noise({ freq: 400, dur: 0.08, gain: 0.1, filterType: 'lowpass' }); },
      chargeWave: 'triangle', chargeBase: 130, chargeTop: 900,
    },
    felt: { // 老钱：毛毡钢琴 + 纸张 + 座钟
      click: () => { tone({ freq: 500, type: 'sine', dur: 0.07, gain: 0.07, attack: 0.01 }); noise({ freq: 6000, dur: 0.03, gain: 0.02, space: false }); },
      trade: () => { [174, 261, 349].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.5, gain: 0.12, attack: 0.02, at: ctx().currentTime + i * 0.012, filter: { freq: 1600 } })); },
      win: () => [349, 440, 523, 698].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.7, gain: 0.1, attack: 0.03, at: ctx().currentTime + i * 0.14, filter: { freq: 2000 } })),
      lose: () => [220, 207, 174].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.8, gain: 0.1, attack: 0.04, at: ctx().currentTime + i * 0.18, filter: { freq: 900 } })),
      bust: () => { [174, 146, 110, 82].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 1, gain: 0.14, attack: 0.05, at: ctx().currentTime + i * 0.25, filter: { freq: 600 } })); setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.5, gain: 0.06 }), 1200); },
      fanfare: () => [261, 329, 392, 523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 1.1, gain: 0.09, attack: 0.05, at: ctx().currentTime + i * 0.16, filter: { freq: 2200 } })),
      stamp: () => { noise({ freq: 1200, dur: 0.09, gain: 0.14, filterType: 'lowpass', space: false }); tone({ freq: 90, to: 50, dur: 0.2, gain: 0.18, attack: 0.01 }); },
      chargeWave: 'sine', chargeBase: 80, chargeTop: 420,
    },
    printer: { // 热敏小票：步进电机 + 收银铃 + 走纸沙沙
      click: () => { noise({ freq: 3200, dur: 0.02, gain: 0.05, space: false }); tone({ freq: 1600, type: 'square', dur: 0.025, gain: 0.04, dryOnly: true }); },
      trade: () => { // 收银机 ka-ching
        tone({ freq: 2093, type: 'sine', dur: 0.3, gain: 0.13 });
        tone({ freq: 2637, type: 'sine', dur: 0.45, gain: 0.1, at: ctx().currentTime + 0.04 });
        noise({ freq: 1400, to: 500, dur: 0.14, gain: 0.09, at: ctx().currentTime + 0.06 });
      },
      win: () => [1046, 1318, 1568, 2093].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.24, gain: 0.085, at: ctx().currentTime + i * 0.07 })),
      lose: () => { tone({ freq: 220, to: 110, type: 'square', dur: 0.3, gain: 0.07, filter: { freq: 800 } }); noise({ freq: 600, to: 200, dur: 0.4, gain: 0.08, filterType: 'lowpass' }); },
      bust: () => { // 卡纸：步进电机卡顿下行 + 长哔
        [0, 0.09, 0.18, 0.3].forEach((d, i) => tone({ freq: 300 - i * 55, type: 'square', dur: 0.08, gain: 0.11, at: ctx().currentTime + d, dryOnly: true }));
        noise({ freq: 900, to: 120, dur: 0.8, gain: 0.12, filterType: 'lowpass', at: ctx().currentTime + 0.3 });
        setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.4, gain: 0.1, dryOnly: true }), 1100);
      },
      fanfare: () => [1046, 1318, 1568, 2093, 2637].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.3, gain: 0.09, at: ctx().currentTime + i * 0.09 })),
      stamp: () => { noise({ freq: 260, dur: 0.07, gain: 0.24, filterType: 'lowpass', space: false }); tone({ freq: 90, to: 50, dur: 0.1, gain: 0.2 }); },
      chargeWave: 'square', chargeBase: 140, chargeTop: 1150,
    },
    wave: { // 蒸汽波：失谐锯齿 pad + 磁带抖动 + 梦幻长混响
      click: () => { tone({ freq: 660, type: 'sine', dur: 0.09, gain: 0.07 }); tone({ freq: 664, type: 'sine', dur: 0.13, gain: 0.05, at: ctx().currentTime + 0.012 }); },
      trade: () => { [220, 261, 329].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.7, gain: 0.065, attack: 0.06, at: ctx().currentTime + i * 0.03, filter: { freq: 1100, q: 2 } })); tone({ freq: 440, type: 'sine', dur: 0.5, gain: 0.05, at: ctx().currentTime + 0.05 }); },
      win: () => [329, 392, 493, 587, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.9, gain: 0.09, attack: 0.04, at: ctx().currentTime + i * 0.11, filter: { freq: 2400 } })),
      lose: () => [293, 261, 220, 174].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 1.1, gain: 0.06, attack: 0.08, at: ctx().currentTime + i * 0.18, filter: { freq: 700 } })),
      bust: () => { // VHS 卡带停转：整体音高缓慢垮掉
        tone({ freq: 440, to: 28, type: 'sawtooth', dur: 1.6, gain: 0.14, attack: 0.02, filter: { freq: 1200 } });
        tone({ freq: 220, to: 14, type: 'triangle', dur: 1.8, gain: 0.1, at: ctx().currentTime + 0.02 });
        noise({ freq: 800, to: 60, dur: 1.6, gain: 0.06, filterType: 'lowpass' });
        setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.5, gain: 0.08 }), 1600);
      },
      fanfare: () => [261, 329, 392, 493, 587, 784].forEach((f, i) => tone({ freq: f * 1.003, type: 'sawtooth', dur: 1.4, gain: 0.055, attack: 0.05, at: ctx().currentTime + i * 0.12, filter: { freq: 2600, q: 1.5 } })),
      stamp: () => { tone({ freq: 120, to: 55, dur: 0.4, gain: 0.16, filter: { freq: 400 } }); tone({ freq: 880, to: 1760, type: 'sine', dur: 0.5, gain: 0.05, at: ctx().currentTime + 0.05 }); },
      chargeWave: 'sawtooth', chargeBase: 60, chargeTop: 480,
    },
    harp: { // 塔罗：竖琴拨弦 + 钢片琴 + 神秘深钟
      click: () => pluck(1320, { dur: 0.35, gain: 0.09, bright: 4200 }),
      trade: () => { [392, 493, 587].forEach((f, i) => pluck(f, { dur: 1.2, gain: 0.16, at: ctx().currentTime + i * 0.05 })); tone({ freq: 1568, type: 'sine', dur: 0.6, gain: 0.045, at: ctx().currentTime + 0.15 }); },
      win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => pluck(f, { dur: 1.6, gain: 0.15, at: ctx().currentTime + i * 0.09, bright: 3800 })),
      lose: () => [311, 293, 233, 196].forEach((f, i) => pluck(f, { dur: 2, gain: 0.15, at: ctx().currentTime + i * 0.17, damp: 0.993, bright: 1200 })),
      bust: () => { // 丧钟：低频钟体 + 泛音列
        tone({ freq: 110, type: 'sine', dur: 3, gain: 0.22, attack: 0.01, filter: { freq: 600 } });
        [220, 330, 442].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 2.4 - i * 0.5, gain: 0.06, at: ctx().currentTime + 0.01 + i * 0.02 }));
        noise({ freq: 300, to: 60, dur: 1.5, gain: 0.08, filterType: 'lowpass' });
        setTimeout(() => tone({ freq: 1000, type: 'sine', dur: 1.5, gain: 0.08 }), 2600);
      },
      fanfare: () => [392, 523, 659, 784, 1046].forEach((f, i) => { pluck(f, { dur: 2.2, gain: 0.14, at: ctx().currentTime + i * 0.13 }); tone({ freq: f * 2, type: 'sine', dur: 1.2, gain: 0.035, at: ctx().currentTime + i * 0.13 + 0.02 }); }),
      stamp: () => { tone({ freq: 80, to: 45, dur: 0.25, gain: 0.2, filter: { freq: 300 } }); noise({ freq: 5000, dur: 0.05, gain: 0.05, space: false }); },
      chargeWave: 'sine', chargeBase: 96, chargeTop: 770,
    },
  };

  /* ── 通用声音（跨主题共享实现，音色取自预设） ────── */
  const api = {
    get enabled() { return enabled; },
    setPreset(name) { preset = PRESETS[name] ? name : 'synth'; },
    unlock() { ctx(); },
    toggle(v) { enabled = v === undefined ? !enabled : !!v; if (!enabled) { api.stopCharge(); api.stopAlarm(); } return enabled; },

    play(name, arg) {
      if (!enabled) return;
      try {
        const p = P();
        if (p[name]) { p[name](arg); return; }
        // 共享默认
        switch (name) {
          case 'tickUp': tone({ freq: 1500 + Math.random() * 200, type: 'sine', dur: 0.03, gain: 0.025, dryOnly: true }); break;
          case 'tickDown': tone({ freq: 1100 + Math.random() * 150, type: 'sine', dur: 0.03, gain: 0.025, dryOnly: true }); break;
          case 'card': noise({ freq: 2400, to: 900, dur: 0.12, gain: 0.07 }); break;
          case 'cardPick': noise({ freq: 1800, to: 600, dur: 0.09, gain: 0.08 }); tone({ freq: 523, to: 784, type: 'triangle', dur: 0.14, gain: 0.1 }); break;
          case 'reroll': [0, 0.05, 0.1].forEach((d, i) => tone({ freq: 600 + i * 200, type: 'triangle', dur: 0.05, gain: 0.06, at: ctx().currentTime + d })); break;
          case 'error': tone({ freq: 160, type: 'square', dur: 0.12, gain: 0.08, filter: { freq: 500 } }); break;
          case 'type': noise({ freq: 1800 + Math.random() * 1400, dur: 0.022, gain: 0.05, q: 2, space: false }); break;
          case 'notif': tone({ freq: 880, type: 'sine', dur: 0.09, gain: 0.09 }); tone({ freq: 1320, type: 'sine', dur: 0.12, gain: 0.07, at: ctx().currentTime + 0.08 }); break;
          case 'hint': tone({ freq: 660, to: 990, type: 'sine', dur: 0.25, gain: 0.08 }); break;
          case 'rescue': [261, 329, 392, 523].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 1.2, gain: 0.09, attack: 0.15, at: ctx().currentTime + i * 0.09 })); break;
          case 'reveal': noise({ freq: 100, to: 4000, dur: 0.5, gain: 0.1 }); P().stamp(); break;
          case 'award': tone({ freq: 1046, type: 'sine', dur: 0.18, gain: 0.1 }); tone({ freq: 1568, type: 'sine', dur: 0.3, gain: 0.08, at: ctx().currentTime + 0.06 }); break;
          case 'panic': tone({ freq: 700, to: 90, type: 'sawtooth', dur: 0.35, gain: 0.15, filter: { freq: 1200 } }); break;
          case 'setbonus': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.1, at: ctx().currentTime + i * 0.06 })); break;
          /* ── 倍率引擎结算音阶：逐级升高，Balatro 式爽感 ── */
          case 'scoreStep': {
            const PENTA = [523, 587, 659, 784, 880, 1046, 1174, 1318, 1568, 1760];
            const f = PENTA[Math.min(arg | 0, PENTA.length - 1)];
            tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.11 });
            tone({ freq: f * 2, type: 'sine', dur: 0.22, gain: 0.05, at: ctx().currentTime + 0.01 });
            break;
          }
          case 'scoreFinal': {
            [784, 988, 1174, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.1, at: ctx().currentTime + i * 0.045 }));
            noise({ freq: 3000, to: 1200, dur: 0.2, gain: 0.05, at: ctx().currentTime + 0.02 });
            break;
          }
          case 'crit': {
            [1046, 1318, 1568, 2093, 2637].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.22, gain: 0.075, at: ctx().currentTime + i * 0.05, filter: { freq: 4200 } }));
            noise({ freq: 5200, to: 900, dur: 0.4, gain: 0.09, at: ctx().currentTime + 0.05 });
            tone({ freq: 130, to: 60, type: 'sine', dur: 0.4, gain: 0.2 });
            break;
          }
          case 'coin': tone({ freq: 1318, type: 'sine', dur: 0.09, gain: 0.09 }); tone({ freq: 1760, type: 'sine', dur: 0.16, gain: 0.08, at: ctx().currentTime + 0.05 }); break;
          case 'lvlup': tone({ freq: 440, to: 1320, type: 'triangle', dur: 0.35, gain: 0.11 }); tone({ freq: 1760, type: 'sine', dur: 0.3, gain: 0.07, at: ctx().currentTime + 0.22 }); break;
          case 'patience': tone({ freq: 392, type: 'sine', dur: 0.3, gain: 0.07, attack: 0.02 }); tone({ freq: 588, type: 'sine', dur: 0.35, gain: 0.05, at: ctx().currentTime + 0.04 }); break;
          case 'milestone': P().fanfare ? P().fanfare() : [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.25, gain: 0.1, at: ctx().currentTime + i * 0.08 })); break;
        }
      } catch (e) { /* 音频失败不影响游戏 */ }
    },

    /* 蓄力循环音 */
    startCharge() {
      if (!enabled) return;
      const ac = ctx(), p = P();
      api.stopCharge();
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = p.chargeWave || 'sawtooth'; o2.type = 'sine';
      const g = ac.createGain(); g.gain.value = 0.0001;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 4;
      const lfo = ac.createOscillator(), lfoG = ac.createGain();
      lfo.frequency.value = 7; lfoG.gain.value = 0;
      lfo.connect(lfoG);
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
      lfoG.connect(o1.frequency);
      o1.start(); o2.start(); lfo.start();
      g.gain.linearRampToValueAtTime(0.12, ac.currentTime + 0.08);
      chargeNodes = { o1, o2, g, lfo, lfoG, f };
    },
    updateCharge(t01, tremor01) {
      if (!chargeNodes) return;
      const ac = ctx(), p = P();
      const base = p.chargeBase || 55, top = p.chargeTop || 640;
      const freq = base * Math.pow(top / base, t01);
      chargeNodes.o1.frequency.setTargetAtTime(freq, ac.currentTime, 0.03);
      chargeNodes.o2.frequency.setTargetAtTime(freq * 0.5, ac.currentTime, 0.03);
      chargeNodes.f.frequency.setTargetAtTime(400 + t01 * 3000, ac.currentTime, 0.05);
      chargeNodes.lfoG.gain.setTargetAtTime(tremor01 * freq * 0.06, ac.currentTime, 0.05);
      chargeNodes.lfo.frequency.setTargetAtTime(6 + tremor01 * 20, ac.currentTime, 0.1);
      chargeNodes.g.gain.setTargetAtTime(0.1 + t01 * 0.08, ac.currentTime, 0.08);
    },
    stopCharge() {
      if (!chargeNodes) return;
      const ac = ctx(), n = chargeNodes; chargeNodes = null;
      n.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.03);
      setTimeout(() => { try { n.o1.stop(); n.o2.stop(); n.lfo.stop(); } catch (e) { } }, 150);
    },

    /* 强平警报 */
    startAlarm() {
      if (!enabled || alarmTimer) return;
      const beep = () => { tone({ freq: 880, type: 'square', dur: 0.09, gain: 0.05, dryOnly: true }); setTimeout(() => tone({ freq: 880, type: 'square', dur: 0.09, gain: 0.05, dryOnly: true }), 140); };
      beep();
      alarmTimer = setInterval(beep, 560);
    },
    stopAlarm() { if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; } },

    /* 打字机（电报逐字）——限流，避免高频创建音频节点 */
    typeTick() {
      const n = performance.now();
      if (n - lastType < 48) return;
      lastType = n;
      api.play('type');
    },
  };

  MC.Audio = api;

})(window.MC);
