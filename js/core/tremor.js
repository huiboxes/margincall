/* ═══════════════════════════════════════════════════════════
   手抖指数：身体是第二个控制器
   桌面 = 鼠标速度方差 · 移动 = 陀螺仪角速度方差（需授权）
   蓄力时注入「压力抖动」：杠杆越高，手越抖（游戏性抖动）
   ═══════════════════════════════════════════════════════════ */
(function (MC) {
  'use strict';

  const state = {
    value: 0,          // 0..100 平滑后
    raw: 0,
    peak: 0,
    stress: 0,         // 蓄力压力 0..1（由 UI 注入）
    gyroOn: false,
    gyroDenied: false,
    samples: [],       // {t, v}
    _mouseBuf: [],
    _gyroBuf: [],
    _last: 0,
    _running: false,
  };

  function pushSample(buf, t, v, maxN) {
    buf.push({ t, v });
    while (buf.length > maxN) buf.shift();
  }

  function varianceOf(buf, nowMs, windowMs) {
    const pts = buf.filter(s => nowMs - s.t < windowMs);
    if (pts.length < 3) return 0;
    const mean = pts.reduce((a, b) => a + b.v, 0) / pts.length;
    const vr = pts.reduce((a, b) => a + (b.v - mean) ** 2, 0) / pts.length;
    const motion = pts.reduce((a, b) => a + Math.abs(b.v), 0) / pts.length; // 平均活动量
    return Math.sqrt(vr) * 0.6 + motion * 0.4;
  }

  let _lastX = 0, _lastY = 0, _lastT = 0;
  function onMouse(e) {
    const now = performance.now();
    if (_lastT) {
      const dt = Math.max(1, now - _lastT);
      const dist = Math.hypot(e.clientX - _lastX, e.clientY - _lastY);
      const vel = dist / dt * 1000; // px/s
      pushSample(state._mouseBuf, now, Math.min(vel, 4000), 80);
    }
    _lastX = e.clientX; _lastY = e.clientY; _lastT = now;
  }
  function onTouch(e) {
    if (!e.touches.length) return;
    onMouse({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
  }

  let _gLast = null;
  let _tiltBase = null, _tilt = 0, _tiltArmed = false;
  function onGyro(e) {
    const now = performance.now();
    const g = { a: e.alpha || 0, b: e.beta || 0, c: e.gamma || 0 };
    if (_gLast) {
      const dt = Math.max(8, now - _gLast.t);
      const rate = (Math.abs(g.b - _gLast.g.b) + Math.abs(g.c - _gLast.g.c)) / dt * 1000;
      pushSample(state._gyroBuf, now, Math.min(rate, 800), 60);
    }
    // 倾斜持机：前倾加杠杆、回正减杠杆（增强层）
    if (_tiltArmed) {
      if (_tiltBase === null) _tiltBase = g.b;
      else {
        const target = MC.clamp((g.b - _tiltBase) / 22, -1, 1);
        _tilt += (target - _tilt) * 0.15;
      }
    }
    _gLast = { t: now, g };
  }

  function loop() {
    if (!state._running) return;
    const now = performance.now();
    let base = 0;
    if (state.gyroOn) {
      base = varianceOf(state._gyroBuf, now, 900) / 3.2;
    } else {
      base = varianceOf(state._mouseBuf, now, 900) / 14;
    }
    // 静止衰减：没有新样本 → 归零
    const recent = state.gyroOn ? state._gyroBuf : state._mouseBuf;
    const fresh = recent.length && now - recent[recent.length - 1].t < 400;
    if (!fresh) base *= 0.25;

    state.raw = MC.clamp(base, 0, 100);
    // 压力抖动：蓄力时叠加（重仓的人手真的会抖）
    const stressed = Math.min(100, state.raw + state.stress * 42 + Math.sin(now / 90) * state.stress * 6);
    // 平滑
    state.value += (stressed - state.value) * 0.14;
    if (state.value > state.peak) state.peak = state.value;
    MC.bus.emit('tremor', state.value);
    requestAnimationFrame(loop);
  }

  MC.Tremor = {
    init() {
      if (state._inited) return;
      state._inited = true;
      window.addEventListener('mousemove', onMouse, { passive: true });
      window.addEventListener('touchmove', onTouch, { passive: true });
      state._running = true;
      requestAnimationFrame(loop);
    },
    get value() { return state.value; },
    get raw() { return state.raw; },
    get peak() { return state.peak; },
    get gyroOn() { return state.gyroOn; },
    get gyroAvailable() { return typeof DeviceOrientationEvent !== 'undefined'; },
    setStress(s) { state.stress = MC.clamp(s, 0, 1); },
    resetPeak() { state.peak = 0; },
    startTilt() { _tiltArmed = true; _tiltBase = null; _tilt = 0; },
    stopTilt() { _tiltArmed = false; _tiltBase = null; _tilt = 0; },
    get tilt() { return _tilt; },
    /* iOS 13+ 需要 HTTPS + 用户手势内调用 */
    async requestGyro() {
      try {
        if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
          const res = await DeviceOrientationEvent.requestPermission();
          if (res !== 'granted') { state.gyroDenied = true; return false; }
        }
        window.addEventListener('deviceorientation', onGyro, { passive: true });
        state.gyroOn = true;
        return true;
      } catch (e) {
        state.gyroDenied = true;
        return false;
      }
    },
  };

})(window.MC);
