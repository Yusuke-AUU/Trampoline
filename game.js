'use strict';
// ═══════════════════════════════════════════════════════
//  TRAMPOLINE GAME v4
//  - 最初からジャンプ中（固定高さ・サイン波）
//  - コマンド: 姿勢スワイプ → (タップ + 捻りスワイプ) × N
//  - 姿勢: 円=抱え込み / V字=屈伸 / 斜め=伸身
//  - 捻り: 円=1回 / 斜め=0.5回
//  - 縦長スマホレイアウト
// ═══════════════════════════════════════════════════════

const C  = document.getElementById('c');
const cx = C.getContext('2d');
let W, H;
function resize(){ W = C.width = window.innerWidth; H = C.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

// ── 定数 ─────────────────────────────────────
const JUMP_PERIOD  = 1.8;   // 1ジャンプの秒数
const BED_Y_FRAC   = 0.75;  // ベッドの縦位置（画面上からの割合）
const PEAK_Y_FRAC  = 0.12;  // 頂点の縦位置
const SKILL_COUNT  = 10;
const CMD_TIMEOUT  = 1500;  // ms: 入力が止まったら確定

const DIFF_BASE = { 1: 0.5, 2: 1.2, 3: 2.0 };
const DIFF_POS  = { tuck: 0, pike: 0.1, layout: 0.2 };

// ── フェーズ ──────────────────────────────────
const Ph = { TITLE: 'TITLE', PLAY: 'PLAY', RESULT: 'RESULT' };

// ── ゲーム状態 ────────────────────────────────
let G;

function newGame() {
  G = {
    phase: Ph.PLAY,
    jumpT: 0,           // ジャンプ周期内の時間 0..JUMP_PERIOD
    skillIdx: 0,
    done: [],

    // ── コマンド入力 ──
    cmdPhase: 'posture', // 'posture' | 'body'
    posture: null,       // 'tuck' | 'pike' | 'layout'
    // 宙返りリスト: [{twists: 0.5}]  タップするたびに追加
    soms: [],
    commitTimer: null,
    locked: false,
    pending: null,       // 確定した技オブジェクト

    // ── スコア ──
    sDiff: 0, sH: 0, sTiming: 0,

    // ── アニメ ──
    spinAngle: 0,
    spinRate:  0,
    spinning:  false,
    spinTimer: 0,
    posAnim:   'layout', // 表示中の姿勢

    // ── ジェスチャー検出 ──
    ptStart: null,
    pts: [],
  };

  updateDots();
  renderCmd();
  setPhase(`技 1/${SKILL_COUNT}（前方）`);
  document.getElementById('result').classList.add('hidden');
}

// ── 技ヘルパー ────────────────────────────────
const isFwd = i => i % 2 === 0;

function calcDiff(sk) {
  const som = sk.soms.length;
  const tw  = sk.soms.reduce((a, s) => a + s.twists, 0);
  const base = DIFF_BASE[som] || 0;
  return Math.round((base + tw * 0.1 * 2 + DIFF_POS[sk.posture] * som) * 10) / 10;
}

function skillLabel(sk, fwd) {
  const pn = { tuck: '抱え込み', pike: '屈伸', layout: '伸身' }[sk.posture];
  const som = sk.soms.length;
  const tw  = sk.soms.reduce((a, s) => a + s.twists, 0);
  const tn  = tw > 0 ? `${tw}捻り` : '';
  return `${fwd ? '前方' : '後方'} ${pn}${som}回宙${tn}`;
}

// ── コマンド入力 ──────────────────────────────

function resetCmd() {
  clearTimeout(G.commitTimer);
  G.cmdPhase = 'posture';
  G.posture  = null;
  G.soms     = [];
  G.locked   = false;
  G.pending  = null;
  renderCmd();
}

// 入力が止まったら技を確定
function scheduleCommit() {
  clearTimeout(G.commitTimer);
  G.commitTimer = setTimeout(commitSkill, CMD_TIMEOUT);
}

function commitSkill() {
  clearTimeout(G.commitTimer);
  if (!G.posture || G.soms.length === 0) { resetCmd(); return; }

  const sk = buildSkill();
  G.pending = sk;
  G.locked  = true;

  const fwd = isFwd(G.skillIdx);
  setPhase(`技 ${G.skillIdx + 1}/${SKILL_COUNT}（${fwd ? '前方' : '後方'}）✓`);
  showMsg(skillLabel(sk, fwd), 1.6);
  renderCmd();
}

function buildSkill() {
  const fwd = isFwd(G.skillIdx);
  const soms = G.soms.slice(0, 3); // 最大3回宙
  // 最後の宙返りの捻りを方向ルールに合わせて補正
  const totalTw = soms.reduce((a, s) => a + s.twists, 0);
  const last = soms[soms.length - 1];
  if (fwd) {
    // 前方: 合計捻りが0.5の奇数倍になるよう最後を補正
    const target = nearestHalfOdd(totalTw);
    const diff   = target - totalTw;
    last.twists  = Math.max(0, Math.round((last.twists + diff) * 2) / 2);
  } else {
    // 後方: 合計捻りが整数になるよう最後を補正
    const target = Math.max(1, Math.round(totalTw));
    const diff   = target - totalTw;
    last.twists  = Math.max(0, Math.round((last.twists + diff) * 2) / 2);
  }
  return { posture: G.posture, soms };
}

function nearestHalfOdd(v) {
  // 0.5, 1.5, 2.5, 3.5 の中で一番近い値
  const candidates = [0.5, 1.5, 2.5, 3.5];
  return candidates.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
}

// ジェスチャーが来たときの処理
function onGesture(type, x, y) {
  if (G.phase !== Ph.PLAY) return;
  if (G.locked) return;

  if (G.cmdPhase === 'posture') {
    // 姿勢入力フェーズ
    const posMap = { circle: 'tuck', vee: 'pike', slash: 'layout' };
    const pos = posMap[type];
    if (!pos) return;
    G.posture  = pos;
    G.cmdPhase = 'body';
    const icons = { tuck: '○', pike: '＜', layout: '／' };
    flashLbl(icons[pos], x, y - 30, '#00e5ff');
    renderCmd();
    showMsg({ tuck: '抱え込み', pike: '屈伸', layout: '伸身' }[pos], 0.8);

  } else {
    // body フェーズ: 捻りスワイプ（前の宙返りに付ける）
    if (G.soms.length === 0) return; // 宙返りがないと付けられない
    const last = G.soms[G.soms.length - 1];
    if (type === 'circle') {
      last.twists = Math.min(last.twists + 1, 3);
      flashLbl('〇', x, y - 30, '#a0ff6f');
    } else if (type === 'slash') {
      last.twists = Math.min(last.twists + 0.5, 3);
      flashLbl('／', x, y - 30, '#a0ff6f');
    }
    renderCmd();
    scheduleCommit();
  }
}

function onTap(x, y) {
  if (G.phase !== Ph.PLAY) return;
  if (G.locked) return;
  if (G.cmdPhase !== 'body') return; // 姿勢がまだ
  if (G.soms.length >= 3) return;    // 最大3回

  G.soms.push({ twists: 0 });
  flashLbl('・', x, y - 30, '#ffd700');
  renderCmd();
  scheduleCommit();
}

// ── コマンド表示 ──────────────────────────────
function renderCmd() {
  const fwd = isFwd(G.skillIdx);

  // 方向ラベル
  document.getElementById('cmd-dir').textContent =
    G.posture ? (fwd ? '前方' : '後方') : '';

  // シーケンス文字列
  let seq = '';
  if (G.posture) {
    seq += { tuck: '○', pike: '＜', layout: '／' }[G.posture];
    for (const s of G.soms) {
      seq += ' ·';
      if (s.twists > 0) {
        const full  = Math.floor(s.twists);
        const half  = (s.twists % 1 > 0) ? 1 : 0;
        seq += '〇'.repeat(full) + (half ? '/' : '');
      }
    }
  }
  document.getElementById('cmd-seq').textContent = seq || '—';
  document.getElementById('cmd-seq').style.color = fwd ? '#00e5ff' : '#ff6b35';

  // ヒント
  let hint = '';
  if (!G.posture) {
    hint = '円スワイプ=抱え込み　V字=屈伸　斜め=伸身';
  } else if (G.cmdPhase === 'body') {
    if (G.locked) hint = '✓ 確定 — 着地で発動';
    else if (G.soms.length === 0) hint = 'タップ = 宙返り1回';
    else hint = '円/斜めスワイプ=捻り　タップ=次の宙返り';
  }
  document.getElementById('cmd-hint').textContent = hint;
}

// ── ジャンプ周期 ──────────────────────────────
function update(dt) {
  if (G.phase !== Ph.PLAY) return;

  G.jumpT += dt;
  if (G.jumpT >= JUMP_PERIOD) {
    G.jumpT -= JUMP_PERIOD;
    onLanding(); // 着地タイミング
  }

  // スピン
  if (G.spinning) {
    G.spinTimer -= dt;
    G.spinAngle += G.spinRate * dt;
    if (G.spinTimer <= 0) {
      G.spinning  = false;
      G.spinRate  = 0;
      G.spinAngle = 0;
    }
  }
}

function onLanding() {
  if (!G.pending || !G.locked) return;
  execSkill();
}

function execSkill() {
  const sk  = G.pending;
  const fwd = isFwd(G.skillIdx);
  const d   = calcDiff(sk);

  G.sDiff = Math.round((G.sDiff + d) * 10) / 10;
  G.sH    = Math.round((G.sH + 0.5) * 10) / 10;
  G.done.push({ sk, fwd, d, name: skillLabel(sk, fwd) });

  // スピンアニメ
  const som = sk.soms.length;
  const tw  = sk.soms.reduce((a, s) => a + s.twists, 0);
  G.spinRate  = som * 360 / JUMP_PERIOD;
  G.spinning  = true;
  G.spinTimer = JUMP_PERIOD * 0.72;
  G.spinAngle = 0;
  G.posAnim   = sk.posture;

  // リセット
  resetCmd();
  G.skillIdx++;
  updateDots();

  if (G.skillIdx >= SKILL_COUNT) {
    setPhase('ストレートジャンプ — 終了!');
    setCmdSeq('—'); setCmdHint('');
    setTimeout(() => { G.phase = Ph.RESULT; showResult(); }, JUMP_PERIOD * 1100);
  } else {
    const nf = isFwd(G.skillIdx);
    setPhase(`技 ${G.skillIdx + 1}/${SKILL_COUNT}（${nf ? '前方' : '後方'}）`);
  }
}

// ── 描画 ─────────────────────────────────────
function playerFrac() {
  // 0=ベッド, 1=頂点 (sin波)
  return Math.sin((G.jumpT / JUMP_PERIOD) * Math.PI);
}

function draw() {
  cx.clearRect(0, 0, W, H);
  cx.fillStyle = '#07090f';
  cx.fillRect(0, 0, W, H);

  // グリッド
  cx.strokeStyle = 'rgba(0,229,255,0.035)';
  cx.lineWidth = 1;
  const gs = Math.min(W, H) / 9;
  for (let x = 0; x < W; x += gs) { cx.beginPath(); cx.moveTo(x,0); cx.lineTo(x,H); cx.stroke(); }
  for (let y = 0; y < H; y += gs) { cx.beginPath(); cx.moveTo(0,y); cx.lineTo(W,y); cx.stroke(); }

  const bedY  = H * BED_Y_FRAC;
  const peakY = H * PEAK_Y_FRAC;

  // 高さ目盛
  cx.setLineDash([3, 7]);
  cx.lineWidth = 1;
  cx.font = '10px "Share Tech Mono"';
  cx.textAlign = 'left';
  for (let m = 1; m <= 8; m++) {
    const ry = bedY - m * (bedY - peakY) / 8;
    if (ry < 30) break;
    cx.strokeStyle = `rgba(0,229,255,${m % 2 === 0 ? 0.10 : 0.05})`;
    cx.beginPath(); cx.moveTo(36, ry); cx.lineTo(W - 8, ry); cx.stroke();
    cx.fillStyle = 'rgba(0,229,255,0.28)';
    cx.fillText(`${m}m`, 6, ry + 4);
  }
  cx.setLineDash([]);

  drawBed(bedY);

  if (G.phase === Ph.PLAY) {
    const frac  = playerFrac();
    const px    = W * 0.5;
    const py    = bedY - frac * (bedY - peakY);
    drawAthlete(px, py, G.spinAngle, G.spinning ? G.posAnim : 'layout');
  }
}

function drawBed(by) {
  const bw = Math.min(W * 0.55, 240);
  const bx = (W - bw) / 2;

  // フレーム
  cx.fillStyle = '#1e2430';
  cx.fillRect(bx - 10, by + 5, bw + 20, 8);
  cx.fillRect(bx - 10, by + 5, 10, 22);
  cx.fillRect(bx + bw, by + 5, 10, 22);

  // スプリング
  cx.strokeStyle = 'rgba(160,200,255,0.18)';
  cx.lineWidth = 1.2;
  const sn = 7;
  for (let i = 0; i < sn; i++) {
    const sx = bx + (i / (sn - 1)) * bw;
    cx.beginPath(); cx.moveTo(sx, by + 5);
    for (let j = 1; j <= 4; j++) {
      cx.lineTo(sx + (j % 2 ? 2.5 : -2.5), by + 5 + 8 * j / 4);
    }
    cx.stroke();
  }

  // ベッド面
  cx.fillStyle   = 'rgba(0,150,255,0.12)';
  cx.fillRect(bx, by, bw, 6);
  cx.strokeStyle = 'rgba(0,229,255,0.65)';
  cx.lineWidth   = 2;
  cx.beginPath(); cx.moveTo(bx, by); cx.lineTo(bx + bw, by); cx.stroke();
  cx.strokeStyle = 'rgba(0,229,255,0.12)';
  cx.lineWidth   = 1;
  for (let i = 1; i < 5; i++) {
    const lx = bx + (i / 5) * bw;
    cx.beginPath(); cx.moveTo(lx, by); cx.lineTo(lx, by + 5); cx.stroke();
  }
}

// ── アスリート描画（正面向き・縦構図） ──────────
function drawAthlete(px, py, angleDeg, posture) {
  cx.save();
  cx.translate(px, py);
  cx.rotate((angleDeg % 360) * Math.PI / 180);

  const fwd = isFwd(G.skillIdx > 0 ? G.skillIdx - 1 : 0);
  const col = fwd ? '#00e5ff' : '#ff6b35';

  cx.shadowColor = col;
  cx.shadowBlur  = 16;
  cx.fillStyle   = col;
  cx.strokeStyle = col;
  cx.lineCap     = 'round';

  if (posture === 'tuck') {
    drawTuck(col);
  } else if (posture === 'pike') {
    drawPike(col);
  } else {
    drawLayout(col);
  }

  cx.shadowBlur = 0;
  cx.restore();
}

// 伸身（まっすぐ）
function drawLayout(col) {
  cx.fillStyle = col; cx.strokeStyle = col;
  // 頭
  cx.beginPath(); cx.arc(0, -32, 8, 0, Math.PI * 2); cx.fill();
  // 胴体
  cx.lineWidth = 5;
  cx.beginPath(); cx.moveTo(0, -24); cx.lineTo(0, 10); cx.stroke();
  // 腕（バンザイ）
  cx.lineWidth = 3.5;
  cx.beginPath(); cx.moveTo(0, -18); cx.lineTo(-12, -28); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -18); cx.lineTo(12, -28); cx.stroke();
  // 脚（まっすぐ）
  cx.lineWidth = 4;
  cx.beginPath(); cx.moveTo(0, 10); cx.lineTo(-5, 30); cx.stroke();
  cx.beginPath(); cx.moveTo(0, 10); cx.lineTo(5, 30); cx.stroke();
  // 足先
  cx.lineWidth = 3;
  cx.beginPath(); cx.moveTo(-5, 30); cx.lineTo(-7, 36); cx.stroke();
  cx.beginPath(); cx.moveTo(5, 30); cx.lineTo(7, 36); cx.stroke();
}

// 抱え込み（膝を抱えた丸まった形）
function drawTuck(col) {
  cx.fillStyle = col; cx.strokeStyle = col;
  // 頭
  cx.beginPath(); cx.arc(0, -22, 7, 0, Math.PI * 2); cx.fill();
  // 胴体（丸まっている）
  cx.lineWidth = 5;
  cx.beginPath(); cx.moveTo(0, -15); cx.lineTo(0, 2); cx.stroke();
  // 膝を抱える腕
  cx.lineWidth = 3.5;
  cx.beginPath(); cx.moveTo(-4, -10); cx.lineTo(-12, 4); cx.lineTo(-6, 14); cx.stroke();
  cx.beginPath(); cx.moveTo(4, -10);  cx.lineTo(12, 4);  cx.lineTo(6, 14);  cx.stroke();
  // 膝（引き上げた脚）
  cx.lineWidth = 4;
  cx.beginPath(); cx.moveTo(0, 2); cx.lineTo(-8, 12); cx.lineTo(-4, 20); cx.stroke();
  cx.beginPath(); cx.moveTo(0, 2); cx.lineTo(8, 12);  cx.lineTo(4, 20);  cx.stroke();
}

// 屈伸（L字型・腰から折れている）
function drawPike(col) {
  cx.fillStyle = col; cx.strokeStyle = col;
  // 頭
  cx.beginPath(); cx.arc(0, -30, 7, 0, Math.PI * 2); cx.fill();
  // 上半身（前傾）
  cx.lineWidth = 5;
  cx.beginPath(); cx.moveTo(0, -23); cx.lineTo(0, -4); cx.stroke();
  // 腕（脚に向かって伸びる）
  cx.lineWidth = 3.5;
  cx.beginPath(); cx.moveTo(0, -16); cx.lineTo(-14, 4); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -16); cx.lineTo(14, 4);  cx.stroke();
  // 腰で折れる
  cx.lineWidth = 5;
  cx.beginPath(); cx.moveTo(0, -4); cx.lineTo(-10, 8); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -4); cx.lineTo(10, 8);  cx.stroke();
  // 脚（水平に伸びる）
  cx.lineWidth = 4;
  cx.beginPath(); cx.moveTo(-10, 8); cx.lineTo(-10, 26); cx.stroke();
  cx.beginPath(); cx.moveTo(10, 8);  cx.lineTo(10, 26);  cx.stroke();
  // 足先
  cx.lineWidth = 3;
  cx.beginPath(); cx.moveTo(-10, 26); cx.lineTo(-12, 32); cx.stroke();
  cx.beginPath(); cx.moveTo(10, 26);  cx.lineTo(12, 32);  cx.stroke();
}

// ── UI ───────────────────────────────────────
function setPhase(t) { document.getElementById('phase-txt').textContent = t; }
function setCmdSeq(t) { document.getElementById('cmd-seq').textContent = t; }
function setCmdHint(t){ document.getElementById('cmd-hint').textContent = t; }

function updateDots() {
  const c = document.getElementById('dots');
  c.innerHTML = '';
  for (let i = 0; i < SKILL_COUNT; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    if (i < G.skillIdx)      d.classList.add(i % 2 === 0 ? 'fwd' : 'bwd');
    else if (i === G.skillIdx) d.classList.add('cur');
    c.appendChild(d);
  }
  document.getElementById('skill-no').innerHTML =
    `${Math.min(G.skillIdx + 1, SKILL_COUNT)}<span class="unit">/${SKILL_COUNT}</span>`;
}

function updateScore() {
  document.getElementById('score-val').textContent =
    (G.sDiff + G.sH + G.sTiming).toFixed(1);
}

let _mt = null;
function showMsg(text, dur = 1.5) {
  const el = document.getElementById('msg');
  el.textContent = text; el.style.opacity = '1';
  clearTimeout(_mt);
  _mt = setTimeout(() => { el.style.opacity = '0'; }, dur * 1000);
}

function flashLbl(text, x, y, col = '#a0ff6f') {
  const d = document.createElement('div');
  d.className = 'fl';
  d.textContent = text;
  d.style.cssText = `left:${x}px;top:${y}px;color:${col}`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 800);
}

function tapRing(x, y) {
  const el = document.getElementById('tap-ring');
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ── リザルト ──────────────────────────────────
function showResult() {
  const rows = document.getElementById('r-rows');
  rows.innerHTML = '';
  G.done.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'r-item';
    div.innerHTML = `<span class="rn">${i+1}</span><span class="rname">${s.name}</span><span class="rd">D${s.d.toFixed(1)}</span>`;
    rows.appendChild(div);
  });
  document.getElementById('r-total').textContent = (G.sDiff + G.sH + G.sTiming).toFixed(2);
  document.getElementById('result').classList.remove('hidden');
}

// ── ジェスチャー認識 ──────────────────────────
// シンプル・確実な方向スワイプ + 円判定
let _ptStart = null, _pts = [];

C.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  _ptStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  _pts = [{ x: t.clientX, y: t.clientY }];
}, { passive: false });

C.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  _pts.push({ x: t.clientX, y: t.clientY });
}, { passive: false });

C.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  handleUp(t.clientX, t.clientY);
}, { passive: false });

C.addEventListener('mousedown', e => {
  _ptStart = { x: e.clientX, y: e.clientY, time: Date.now() };
  _pts = [{ x: e.clientX, y: e.clientY }];
});
C.addEventListener('mousemove', e => {
  if (e.buttons) _pts.push({ x: e.clientX, y: e.clientY });
});
C.addEventListener('mouseup', e => handleUp(e.clientX, e.clientY));

function handleUp(x, y) {
  if (!_ptStart) return;
  if (G.phase === Ph.TITLE) { startGame(); _ptStart = null; return; }

  const dx   = x - _ptStart.x;
  const dy   = y - _ptStart.y;
  const dist = Math.hypot(dx, dy);
  const dt   = Date.now() - _ptStart.time;

  tapRing(x, y);

  if (dist < 20 && dt < 400) {
    // タップ
    onTap(x, y);
  } else if (dist >= 20) {
    // スワイプ → ジェスチャー認識
    const gesture = classify(_pts);
    onGesture(gesture, x, y);
  }
  _ptStart = null;
}

function classify(pts) {
  if (pts.length < 2) return 'slash';

  const s = pts[0], e = pts[pts.length - 1];
  const closeD = Math.hypot(e.x - s.x, e.y - s.y);

  // 総移動距離
  let len = 0;
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);

  // 円: 終点が始点に近い & 十分な移動量
  if (closeD < len * 0.42 && len > 50) return 'circle';

  // V字: 中間点が両端より大幅に下（Y大）
  if (pts.length >= 5) {
    const mid = pts[Math.floor(pts.length / 2)];
    const topY = Math.min(s.y, e.y);
    if (mid.y > topY + 30) return 'vee';
  }

  // 斜め vs 縦横: 斜め成分が大きければ slash
  const adx = Math.abs(e.x - s.x), ady = Math.abs(e.y - s.y);
  if (adx > 20 && ady > 20) return 'slash'; // 両方向成分あり = 斜め
  return 'slash'; // デフォルト
}

// ── ボタン ────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', () => newGame());

function startGame() {
  document.getElementById('title').style.display = 'none';
  newGame();
}

// ── メインループ ──────────────────────────────
let _last = 0;
function loop(ts) {
  const dt = Math.min((ts - _last) / 1000, 0.05);
  _last = ts;
  if (G && G.phase !== Ph.TITLE) {
    update(dt);
    updateScore();
  }
  draw();
  requestAnimationFrame(loop);
}

// 起動
G = { phase: Ph.TITLE, done: [], skillIdx: 0, jumpT: 0,
      spinning: false, spinAngle: 0, spinRate: 0, spinTimer: 0,
      posAnim: 'layout', sDiff: 0, sH: 0, sTiming: 0 };
requestAnimationFrame(ts => { _last = ts; requestAnimationFrame(loop); });
