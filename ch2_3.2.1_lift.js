(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('airflow'), ctx = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const notes = $('notes-dialog');
  const state = {angle: 6, step: 2, playing: !reducedMotion.matches, time: 0, teaching: false, elapsed: 0};
  const captions = [
    ['空氣從前緣分流，沿著機翼上下表面前進。', '看粒子的方向與快慢：上下方的空氣各自流動，不必同時抵達翼尾。'],
    ['上表面壓力較低，下表面壓力相對較高。', '藍色至橙色表示壓力；小箭頭指向機翼，表示空氣壓在表面上的作用。'],
    ['上下表面的壓力作用，合成向上的升力。', '機翼同時讓氣流向下偏轉；這是同一個升力現象的兩種觀察方式。'],
    ['試著增加迎角，觀察壓力分布與升力變化。', '在本頁的附著流模型中，迎角增加，升力也增加；實際迎角過大可能失速。']
  ];
  const field = document.createElement('canvas'), fieldCtx = field.getContext('2d');
  const background = document.createElement('canvas'), backgroundCtx = background.getContext('2d');
  let model, streams = [], wingPath, W = 1000, H = 335, scale, ox, oy, dpr;
  let frame = 0, lastTime = 0, dirty = true, geometryDirty = true;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const toScreen = (x, y) => ({x: ox + x * scale, y: oy - y * scale});
  const toWorld = (x, y) => ({x: (x - ox) / scale, y: (oy - y) / scale});
  const colors = [
    [-3, [34, 34, 167]], [-1.7, [27, 66, 207]], [-0.7, [13, 112, 165]],
    [-0.15, [13, 92, 110]], [0, [12, 57, 68]], [0.22, [26, 120, 111]],
    [0.55, [144, 163, 81]], [1, [252, 163, 82]]
  ];
  function pressureColor(cp) {
    const value = clamp(cp, -3, 1);
    let i = 1;
    while (i < colors.length - 1 && value > colors[i][0]) i++;
    const a = colors[i - 1], b = colors[i], f = (value - a[0]) / (b[0] - a[0]);
    return a[1].map((component, j) => Math.round(component + (b[1][j] - component) * f));
  }
  function makeField() {
    field.width = 360;
    field.height = Math.round(360 * H / W);
    const bitmap = fieldCtx.createImageData(field.width, field.height);
    for (let y = 0; y < field.height; y++) {
      for (let x = 0; x < field.width; x++) {
        const world = toWorld((x + 0.5) * W / field.width, (y + 0.5) * H / field.height);
        const v = model.sample(world.x, world.y);
        const color = v ? pressureColor(v.cp) : [16, 24, 29];
        const i = (y * field.width + x) * 4;
        bitmap.data[i] = color[0]; bitmap.data[i + 1] = color[1]; bitmap.data[i + 2] = color[2]; bitmap.data[i + 3] = 255;
      }
    }
    fieldCtx.putImageData(bitmap, 0, 0);
  }
  function makeStreams() {
    streams = [];
    const count = W < 800 ? 27 : 29;
    for (let line = 0; line < count; line++) {
      let point = toWorld(-8, 12 + line * (H - 24) / (count - 1));
      let elapsed = 0;
      const points = [];
      for (let i = 0; i < 1200; i++) {
        const v = model.sample(point.x, point.y);
        if (!v || v.speed < 0.012) break;
        const screen = toScreen(point.x, point.y);
        if (screen.x > W + 18 || screen.y < -45 || screen.y > H + 45) break;
        points.push({...screen, t: elapsed});
        const dt = Math.min(0.026, 0.021 / v.speed);
        const middle = model.sample(point.x + v.u * dt / 2, point.y + v.v * dt / 2);
        if (!middle) break;
        point = {x: point.x + middle.u * dt, y: point.y + middle.v * dt};
        elapsed += dt;
      }
      if (points.length > 8) {
        const path = new Path2D();
        points.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y));
        streams.push({points, path, duration: points[points.length - 1].t, phase: (line * 0.173) % 0.55});
      }
    }
  }
  function rebuildGeometry() {
    model = window.LiftFlow.makeModel(state.angle);
    wingPath = new Path2D();
    model.outline.forEach((p, i) => {
      const s = toScreen(p.x, p.y);
      if (i) wingPath.lineTo(s.x, s.y); else wingPath.moveTo(s.x, s.y);
    });
    wingPath.closePath();
    makeField();
    makeStreams();
    geometryDirty = false;
  }
  function drawGrid(c) {
    c.strokeStyle = 'rgba(164,215,226,.07)'; c.lineWidth = 0.6;
    c.beginPath();
    for (let x = 0; x < W; x += 40) {c.moveTo(x, 0); c.lineTo(x, H);}
    for (let y = 0; y < H; y += 40) {c.moveTo(0, y); c.lineTo(W, y);}
    c.stroke();
    c.strokeStyle = 'rgba(173,223,233,.10)';
    c.beginPath(); c.moveTo(0, oy); c.lineTo(W, oy); c.stroke();
  }
  function rebuildBackground() {
    background.width = Math.round(W * dpr); background.height = Math.round(H * dpr);
    const c = backgroundCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#092333'; c.fillRect(0, 0, W, H);
    if (state.step >= 1) c.drawImage(field, 0, 0, W, H);
    const shade = c.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(3,13,24,.28)'); shade.addColorStop(0.48, 'rgba(3,13,24,0)'); shade.addColorStop(1, 'rgba(3,13,24,.25)');
    c.fillStyle = shade; c.fillRect(0, 0, W, H);
    drawGrid(c);
    c.strokeStyle = state.step === 0 ? 'rgba(78,188,214,.33)' : 'rgba(153,222,227,.28)';
    c.lineWidth = 0.85;
    streams.forEach((stream) => c.stroke(stream.path));
  }
  function atTime(stream, t) {
    const points = stream.points;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid; else hi = mid;
    }
    const a = points[lo], b = points[hi], f = clamp((t - a.t) / (b.t - a.t), 0, 1);
    return {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f};
  }
  function drawParticles() {
    ctx.lineCap = 'round';
    streams.forEach((stream, index) => {
      const spacing = 0.52;
      const count = Math.floor(stream.duration / spacing);
      for (let i = 0; i < count; i++) {
        const t = (state.time * 0.72 + i * stream.duration / count + stream.phase) % stream.duration;
        if (t < 0.04) continue;
        const p = atTime(stream, t), tail = atTime(stream, Math.max(0, t - 0.06));
        ctx.strokeStyle = index % 3 === 0 ? 'rgba(225,254,247,.84)' : 'rgba(145,228,229,.67)';
        ctx.lineWidth = index % 3 === 0 ? 1.8 : 1.35;
        ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    });
  }
  function arrow(x1, y1, x2, y2, color, width, head = 8) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
    ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
    ctx.closePath(); ctx.fill();
  }
  function label(text, x, y, color = '#dfefec', size = 19, align = 'left', bold = true) {
    ctx.font = `${bold ? '600' : '400'} ${size}px "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(5,24,34,.8)';
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawWing() {
    const gradient = ctx.createLinearGradient(0, oy - 55, 0, oy + 45);
    gradient.addColorStop(0, '#56616a'); gradient.addColorStop(0.43, '#2b333a'); gradient.addColorStop(1, '#10171d');
    ctx.fillStyle = gradient; ctx.fill(wingPath);
    ctx.strokeStyle = '#d9ddd2'; ctx.lineWidth = 1.8; ctx.stroke(wingPath);
    if (state.step < 3) {
      ctx.save(); ctx.translate(ox - 35, oy - 13); ctx.rotate(model.alpha);
      label('機 翼', 0, 0, '#dbe0da', W < 800 ? 20 : 15, 'center', false); ctx.restore();
    }
  }
  function drawPressureArrows() {
    const samples = [0.72, 1.12, 1.5, 1.88, 2.23, 2.53, 3.62, 3.98, 4.35, 4.72, 5.12, 5.48];
    samples.forEach((theta) => {
      const p = model.surfaceSample(theta), s = toScreen(p.x, p.y);
      // All arrows point inward (pressure pushes). Lengths exaggerate the pressure
      // variation, not the actual ratio of absolute atmospheric pressures.
      const length = clamp(30 + p.cp * 15, 10, 47) * (W < 800 ? 0.85 : 1);
      const nx = p.nx, ny = -p.ny;
      arrow(s.x - nx * length, s.y - ny * length, s.x - nx * 3, s.y - ny * 3,
        theta < Math.PI ? '#83c9ff' : '#ffc080', 1.7, 6);
    });
  }
  function drawChord() {
    const ca = Math.cos(model.alpha), sa = Math.sin(model.alpha);
    const leading = toScreen(-2.02 * ca, 2.02 * sa), trailing = toScreen(2 * ca, -2 * sa);
    ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#e9e2c2'; ctx.beginPath(); ctx.moveTo(leading.x - 15, leading.y); ctx.lineTo(trailing.x + 20, leading.y); ctx.stroke();
    ctx.strokeStyle = '#ffd1a1'; ctx.beginPath(); ctx.moveTo(leading.x, leading.y); ctx.lineTo(trailing.x, trailing.y); ctx.stroke(); ctx.restore();
    const end = Math.max(0.012, model.alpha);
    ctx.strokeStyle = '#ffb56f'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(leading.x, leading.y, 82, 0, end); ctx.stroke();
    label(`α = ${state.angle}°`, leading.x + 92, leading.y + 20, '#ffcf9d', W < 800 ? 24 : 17);
    label('弦線', trailing.x + 15, trailing.y + 18, '#ffcf9d', W < 800 ? 20 : 14, 'left', false);
  }
  function drawAnnotations() {
    const small = W < 800;
    const leftX = small ? 22 : 31;
    label('來流', leftX, H * 0.45, '#d2e8ec', small ? 25 : 18);
    arrow(leftX, H * 0.51, leftX + (small ? 58 : 76), H * 0.51, '#b0dce4', 2, 9);
    if (state.step === 0) {
      label('上方氣流', W * 0.39, H * 0.23, '#c4ecf5', small ? 28 : 21, 'center');
      label('下方氣流', W * 0.47, H * 0.8, '#c4ecf5', small ? 28 : 21, 'center');
      label('彎曲翼型', W * 0.86, H * 0.91, '#a4bbc2', 12, 'center', false);
    } else {
      label('上表面 · 較低壓力', W * 0.36, H * 0.19, '#9ad7ff', small ? 28 : 22, 'center');
      label('局部流速較快', W * 0.36, H * 0.19 + 29, '#c5dfeb', small ? 20 : 14, 'center', false);
      label('下表面 · 相對較高壓力', W * 0.45, H * 0.83, '#ffce9a', small ? 27 : 21, 'center');
      label('小箭頭表示壓力作用', W * 0.45, H * 0.83 + 28, '#d8d5c4', small ? 20 : 13, 'center', false);
    }
    if (state.step >= 2) {
      const x = W * 0.585, start = oy - 22;
      const length = 62 + clamp(model.cl / 1.85, 0, 1) * 70;
      ctx.save(); ctx.shadowColor = 'rgba(131,245,165,.35)'; ctx.shadowBlur = 14;
      arrow(x, start, x, start - length, '#a0efb1', 5, 15); ctx.restore();
      label('升力', x + 22, start - length + 5, '#b2f7bd', small ? 32 : 26);
      label('垂直於來流', x + 22, start - length + 34, '#d0efda', small ? 20 : 14, 'left', false);
      // Trace the actual local direction in the wake, not a separate animated vortex.
      const p = toWorld(W * 0.855, H * 0.58), v = model.sample(p.x, p.y);
      const tilt = v ? Math.atan2(-v.v, v.u) : 0.15;
      const sx = W * 0.81, sy = H * 0.64;
      arrow(sx, sy, sx + 76 * Math.cos(tilt), sy + 76 * Math.sin(tilt), '#a8cbd4', 1.8, 8);
      label('向下偏轉', W * 0.865, H * 0.77, '#d5e4e4', small ? 22 : 16, 'center', false);
    }
    if (state.step === 3) drawChord();
  }
  function render() {
    if (geometryDirty) rebuildGeometry();
    if (dirty) {rebuildBackground(); dirty = false;}
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(background, 0, 0, W, H);
    drawParticles(); drawWing();
    if (state.step >= 1) drawPressureArrows();
    drawAnnotations();
    canvas.dataset.angle = String(state.angle);
    canvas.dataset.step = String(state.step);
  }
  function schedule() {
    if (!frame && !document.hidden && !notes.open) frame = requestAnimationFrame(tick);
  }
  function tick(now) {
    frame = 0;
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;
    if (state.playing) {
      state.time += dt;
      if (state.teaching) {
        state.elapsed += dt;
        if (state.elapsed >= 7) {
          state.elapsed = 0;
          if (state.step < 3) setStep(state.step + 1, false);
          else state.teaching = false;
        }
      }
    }
    render();
    if (state.playing) schedule();
  }
  function resize() {
    const width = canvas.getBoundingClientRect().width;
    const small = window.innerWidth <= 560;
    W = small ? 720 : 1000; H = small ? 460 : 335;
    scale = W * 0.132; ox = W * 0.47; oy = H * 0.55;
    dpr = Math.min(window.devicePixelRatio || 1, 2) * width / W;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    geometryDirty = true; dirty = true; schedule();
  }
  function updatePlayback() {
    $('play-label').textContent = state.playing ? '暫停' : '播放';
    $('play-icon').innerHTML = state.playing ? '<path d="M6 4v12M14 4v12"/>' : '<path d="m6 3 10 7-10 7Z"/>';
    $('flow-status').classList.toggle('paused', !state.playing);
    $('flow-status').querySelector('span').textContent = state.playing ? (state.teaching ? '教學播放中' : '流動中') : '已暫停';
    $('play-pause').setAttribute('aria-label', state.playing ? '暫停動畫' : '播放動畫');
  }
  function setPlaying(playing) {
    state.playing = playing; lastTime = 0; updatePlayback(); schedule();
  }
  function setStep(step, manual = true) {
    state.step = clamp(step, 0, 3);
    if (manual) {state.teaching = false; state.elapsed = 0;}
    document.querySelectorAll('[data-step]').forEach((button) => {
      const active = Number(button.dataset.step) === state.step;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    $('caption-index').textContent = String(state.step + 1).padStart(2, '0');
    $('caption-title').textContent = captions[state.step][0];
    $('caption-detail').textContent = captions[state.step][1];
    $('prev-step').disabled = state.step === 0;
    $('next-label').textContent = state.step === 3 ? '從頭觀察' : '下一步';
    $('next-step').setAttribute('aria-label', state.step === 3 ? '從第一個教學步驟重新觀察' : '下一個教學步驟');
    $('pressure-legend').style.visibility = state.step === 0 ? 'hidden' : 'visible';
    canvas.setAttribute('aria-label', `迎角 ${state.angle} 度。${captions[state.step][0]} ${captions[state.step][1]}`);
    updatePlayback(); dirty = true; schedule();
  }
  function setAngle(value, manual = true) {
    state.angle = clamp(Math.round(Number(value) || 0), 0, 12);
    $('angle').value = state.angle;
    $('angle').style.setProperty('--range-fill', `${state.angle / 12 * 100}%`);
    $('angle').setAttribute('aria-valuetext', `${state.angle} 度`);
    $('angle-value').innerHTML = `${state.angle}<span>°</span>`;
    document.querySelectorAll('[data-angle]').forEach((button) => {
      const active = Number(button.dataset.angle) === state.angle;
      button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
    });
    const cl = window.LiftFlow.makeModel(state.angle).cl;
    $('lift-fill').style.width = `${clamp(cl / 1.85 * 100, 0, 100)}%`;
    $('lift-level').textContent = state.angle < 4 ? '較小' : state.angle < 9 ? '中等' : '較大';
    geometryDirty = true; dirty = true;
    if (manual) setStep(3); else schedule();
    canvas.setAttribute('aria-label', `迎角 ${state.angle} 度。${captions[state.step][0]} ${captions[state.step][1]}`);
    if (state.angle === 0 && state.step === 3) {
      $('caption-title').textContent = '迎角為 0°，彎曲翼型仍然可以產生升力。';
      $('caption-detail').textContent = '機翼本身的彎曲形狀，也會改變氣流與上下表面的壓力分布。';
    }
  }
  function replay() {
    state.time = 0; state.elapsed = 0; state.teaching = true;
    setAngle(6, false); setStep(0, false); setPlaying(!reducedMotion.matches);
    $('announcement').textContent = reducedMotion.matches ? '教學已重設。已依減少動態效果偏好暫停，可按播放或下一步。' : '從第一步開始，每七秒進入下一步。';
  }
  document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => setStep(Number(button.dataset.step))));
  document.querySelectorAll('[data-angle]').forEach((button) => button.addEventListener('click', () => setAngle(button.dataset.angle)));
  $('angle').addEventListener('input', (event) => setAngle(event.target.value));
  $('play-pause').addEventListener('click', () => setPlaying(!state.playing));
  $('replay').addEventListener('click', replay);
  $('prev-step').addEventListener('click', () => setStep(state.step - 1));
  $('next-step').addEventListener('click', () => setStep((state.step + 1) % 4));
  $('show-notes').addEventListener('click', () => {
    notes.showModal();
    cancelAnimationFrame(frame); frame = 0; lastTime = 0;
  });
  $('close-notes').addEventListener('click', () => notes.close());
  notes.addEventListener('close', () => {lastTime = 0; schedule();});
  notes.addEventListener('click', (event) => {
    if (event.target !== notes) return;
    const rect = notes.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) notes.close();
  });
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else $('announcement').textContent = '此瀏覽器未提供全螢幕功能。可使用瀏覽器的全螢幕選項。';
    } catch (_) {$('announcement').textContent = '無法切換全螢幕，請使用瀏覽器的全螢幕選項。';}
  });
  document.addEventListener('fullscreenchange', () => {
    const text = document.fullscreenElement ? '離開全螢幕' : '全螢幕顯示';
    $('fullscreen').setAttribute('aria-label', text); $('fullscreen').title = text; resize();
  });
  document.addEventListener('keydown', (event) => {
    if (notes.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,button,a,textarea,select,[contenteditable]')) return;
    if (event.code === 'Space') {event.preventDefault(); setPlaying(!state.playing);}
    // 方向鍵保留給頁尾翻頁（範本腳本處理）；步驟切換用說明列的按鈕。
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {cancelAnimationFrame(frame); frame = 0;}
    else {lastTime = 0; schedule();}
  });
  reducedMotion.addEventListener('change', () => {if (reducedMotion.matches) setPlaying(false);});
  new ResizeObserver(resize).observe(canvas.parentElement);
  setAngle(6, false); setStep(2); resize();
})();
