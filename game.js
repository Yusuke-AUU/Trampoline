'use strict';

// ─────────────────────────────────────────────
//  CANVAS SETUP
// ─────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const GRAVITY = 1800;         // px/s²
const MAX_SOMERSAULTS = 3;
const SKILL_COUNT = 10;
const PERFORM_DURATION = 1.8; // seconds per jump while performing
const BOTTOM_WINDOW = 0.35;   // seconds to tap at bottom
const MAX_HEIGHT_PX = 500;    // visual max height in px
const WARMUP_JUMPS_NEEDED = 3;

// Difficulty values per somersault count
const DIFF_BASE = { 1: 0.5, 2: 1.2, 3: 2.0 };
// Twist bonus per 0.5 twist
const DIFF_TWIST = 0.1;
// Position bonus per somersault
const DIFF_POS = { tuck: 0, pike: 0.1, layout: 0.2 };

// ─────────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────────
const Phase = {
  TITLE: 'TITLE',
  WARMUP: 'WARMUP',
  SKILL_INPUT: 'SKILL_INPUT',
  PERFORMING: 'PERFORMING',
  STRAIGHT: 'STRAIGHT',   // final straight jump before landing
  LANDING: 'LANDING',
  RESULT: 'RESULT',
};

let G = {}; // game state

function initGame() {
  G = {
    phase: Phase.WARMUP,

    // Physics
    playerY: 0,        // distance above bed in px (0 = on bed)
    playerVY: 0,       // velocity upward px/s
    bedDeform: 0,      // bed deformation (0..1, positive = pressed down)
    bedDeformV: 0,

    // Jump tracking
    warmupJumps: 0,
    currentHeight: 0,  // max height this jump px
    peakHeight: 0,     // global peak height px
    atBedBottom: false,
    bottomTimer: 0,
    isAirborne: false,
    lastAirborne: false,

    // Skill tracking
    skillIndex: 0,       // 0..9
    completedSkills: [], // array of skill objects
    builtSkill: null,    // pending skill (ready to execute)
    currentlyPerforming: false,
    performTimer: 0,

    // Command input
    cmdBuffer: [],
    cmdTimeoutId: null,
    inputActive: false,
    tapCount: 0,
    tapTimerId: null,

    // Scoring
    scoreDiff: 0,
    scoreHeight: 0,
    scoreTiming: 0,

    // Landing
    landingBonus: 0,

    // Visual
    playerAngle: 0,
    spinRate: 0,      // deg/s somersault
    twistAngle: 0,
    twistRate: 0,     // deg/s twist
    particles: [],
    bedFlash: 0,
    jumpFlash: 0,
    landFlash: 0,
  };
  updateSkillDots();
  updateCmdDisplay();
  setPhaseText('予備ジャンプ — ベッドの底でタップ!');
}

// ─────────────────────────────────────────────
//  SKILL DEFINITIONS
// ─────────────────────────────────────────────
function isForward(skillIndex) {
  return skillIndex % 2 === 0;
}

function calcDifficulty(skill) {
  const base = DIFF_BASE[skill.somersaults] || 0;
  const twist = skill.twists * DIFF_TWIST * 2; // twists is in 0.5 steps, multiply by 2 for count
  const pos = DIFF_POS[skill.position] * skill.somersaults;
  return Math.round((base + twist + pos) * 10) / 10;
}

function skillName(skill, forward) {
  const dir = forward ? '前方' : '後方';
  const posMap = { tuck: '抱え込み', pike: '屈伸', layout: '伸身' };
  const pos = posMap[skill.position];
  const som = skill.somersaults;
  const tw = skill.twists > 0 ? `${skill.twists}捻り` : '';
  return `${dir} ${pos}${som}回宙${tw}`;
}

// ─────────────────────────────────────────────
//  COMMAND PARSING
// ─────────────────────────────────────────────
// Buffer entries: 'circle' | 'slash' | 'vee' | 'tap1' | 'tap2' | 'tap3'

function parseAndBuild() {
  const buf = G.cmdBuffer;
  if (buf.length === 0) return null;

  let idx = 0;
  let position = 'tuck';

  // First entry = posture (circle, vee, slash)
  const first = buf[0];
  if (first === 'circle') { position = 'tuck'; idx = 1; }
  else if (first === 'vee') { position = 'pike'; idx = 1; }
  else if (first === 'slash') { position = 'layout'; idx = 1; }
  // if first is a tap, posture defaults to tuck and we don't advance idx

  let somersaults = 0;
  let twists = 0;

  while (idx < buf.length) {
    const entry = buf[idx];
    if (entry === 'tap1') { somersaults += 1; }
    else if (entry === 'tap2') { somersaults += 2; }
    else if (entry === 'tap3') { somersaults += 3; }
    else if (entry === 'circle') { twists += 1; }
    else if (entry === 'slash') { twists += 0.5; }
    // vee after first = ignored (posture already set)
    idx++;
  }

  somersaults = Math.max(1, Math.min(MAX_SOMERSAULTS, somersaults));
  twists = Math.round(twists * 2) / 2; // snap to 0.5 steps

  // Enforce rules per direction
  const fwd = isForward(G.skillIndex);
  if (fwd) {
    // Forward: must end with half-twist (0.5, 1.5, 2.5, 3.5)
    // If twists is integer, add 0.5
    if (twists === 0 || twists % 1 === 0) {
      twists = Math.max(0.5, twists + 0.5);
    }
    twists = Math.min(twists, 3.5);
  } else {
    // Backward: must be integer (1, 2, 3)
    twists = Math.round(twists);
    twists = Math.max(1, Math.min(3, twists));
  }

  return { somersaults, twists, position };
}

function lockSkill() {
  clearTimeout(G.cmdTimeoutId);
  G.cmdTimeoutId = null;
  const skill = parseAndBuild();
  if (!skill) { resetCmd(); return; }
  G.builtSkill = skill;
  G.inputActive = false;
  const fwd = isForward(G.skillIndex);
  showMsg(skillName(skill, fwd), 1.5);
  updateCmdDisplay();
  setCmdHint('✓ 確定 — 着地でスキル発動');
}

function resetCmd() {
  G.cmdBuffer = [];
  G.builtSkill = null;
  G.inputActive = false;
  clearTimeout(G.cmdTimeoutId);
  G.cmdTimeoutId = null;
  updateCmdDisplay();
  setCmdHint('');
}

function addToCmd(entry) {
  if (G.inputActive === false && G.builtSkill !== null) {
    // Already locked — ignore
    return;
  }
  G.inputActive = true;
  G.cmdBuffer.push(entry);
  updateCmdDisplay();
  clearTimeout(G.cmdTimeoutId);
  G.cmdTimeoutId = setTimeout(lockSkill, 1400);
}

// ─────────────────────────────────────────────
//  DISPLAY UPDATES
// ─────────────────────────────────────────────
function updateCmdDisplay() {
  const el = document.getElementById('cmd-display');
  if (G.builtSkill) {
    const fwd = isForward(G.skillIndex);
    const s = G.builtSkill;
    const posIco = { tuck: '○', pike: '<', layout: '/' }[s.position];
    el.textContent = `${posIco} ${s.somersaults}宙 ${s.twists}捻`;
    el.style.color = fwd ? '#00e5ff' : '#ff6b35';
    return;
  }
  if (G.cmdBuffer.length === 0) { el.textContent = '—'; el.style.color = ''; return; }
  let s = '';
  for (const e of G.cmdBuffer) {
    if (e === 'circle') s += '○';
    else if (e === 'vee') s += '<';
    else if (e === 'slash') s += '/';
    else if (e === 'tap1') s += '·';
    else if (e === 'tap2') s += '··';
    else if (e === 'tap3') s += '···';
  }
  el.textContent = s;
  el.style.color = '';
}

function setCmdHint(text) {
  document.getElementById('cmd-hint').textContent = text;
}

function setPhaseText(text) {
  document.getElementById('phase-text').textContent = text;
}

function updateHUD() {
  const heightM = Math.max(0, G.currentHeight / 40).toFixed(1);
  document.getElementById('height-val').innerHTML = `${heightM}<span class="hud-unit">m</span>`;
  const total = G.scoreDiff + G.scoreHeight + G.scoreTiming;
  document.getElementById('score-val').textContent = total.toFixed(2);
}

function updateSkillDots() {
  const container = document.getElementById('skill-dots');
  container.innerHTML = '';
  for (let i = 0; i < SKILL_COUNT; i++) {
    const dot = document.createElement('div');
    dot.className = 'skill-dot';
    if (i < G.skillIndex) {
      dot.classList.add(i % 2 === 0 ? 'done-fwd' : 'done-bwd');
    } else if (i === G.skillIndex) {
      dot.classList.add('active');
    }
    container.appendChild(dot);
  }
}

// ─────────────────────────────────────────────
//  MESSAGES
// ─────────────────────────────────────────────
let msgTimerId = null;
function showMsg(text, duration = 1.5) {
  const el = document.getElementById('msg-text');
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(msgTimerId);
  msgTimerId = setTimeout(() => { el.style.opacity = '0'; }, duration * 1000);
}

function flashHeight(text, x, y) {
  const div = document.createElement('div');
  div.className = 'height-flash';
  div.textContent = text;
  div.style.left = `${x}px`;
  div.style.top = `${y}px`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 900);
}

function tapRing(x, y) {
  const el = document.getElementById('tap-ring');
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ─────────────────────────────────────────────
//  PHYSICS UPDATE
// ─────────────────────────────────────────────
function update(dt) {
  if (G.phase === Phase.TITLE || G.phase === Phase.RESULT) return;

  // ── Bed spring ──
  const BED_SPRING = 120;
  const BED_DAMP = 14;
  G.bedDeformV += (-G.bedDeform * BED_SPRING - G.bedDeformV * BED_DAMP) * dt;
  G.bedDeform += G.bedDeformV * dt;
  G.bedDeform = Math.max(0, G.bedDeform);

  // ── Player ──
  G.lastAirborne = G.isAirborne;

  if (G.playerY <= 0 && G.playerVY <= 0) {
    // On bed (or just touched down)
    G.isAirborne = false;

    if (G.lastAirborne) {
      // Just landed
      onLanded();
    }

    G.playerY = 0;

    // Bed deforms on contact proportionally
    const impact = Math.abs(G.playerVY);
    G.bedDeformV -= impact * 0.015;
    G.bedDeform = Math.min(G.bedDeform + impact * 0.0002, 1.0);

    // Detect bottom of bed (max deform, velocity reversing)
    const wasAtBottom = G.atBedBottom;
    G.atBedBottom = G.bedDeform > 0.25 && G.bedDeformV > -10;
    if (!wasAtBottom && G.atBedBottom) {
      G.bottomTimer = BOTTOM_WINDOW;
      G.bedFlash = 1.0;
    }
    if (G.bottomTimer > 0) G.bottomTimer -= dt;

    // Auto launch when bed pushes back
    if (G.bedDeformV < -30 && G.bedDeform < 0.12) {
      launchPlayer();
    }
  } else {
    G.isAirborne = true;
    G.playerVY -= GRAVITY * dt;
    G.playerY += G.playerVY * dt;
    if (G.playerY < 0) G.playerY = 0;
    G.currentHeight = Math.max(G.currentHeight, G.playerY);
    G.peakHeight = Math.max(G.peakHeight, G.playerY);
  }

  // ── Performing animation ──
  if (G.currentlyPerforming) {
    G.performTimer += dt;
    G.playerAngle += G.spinRate * dt;
    G.twistAngle += G.twistRate * dt;
    if (G.performTimer >= PERFORM_DURATION * 0.75) {
      G.currentlyPerforming = false;
      G.spinRate = 0;
      G.twistRate = 0;
    }
  }

  // ── Flashes ──
  if (G.bedFlash > 0) G.bedFlash -= dt * 3;
  if (G.jumpFlash > 0) G.jumpFlash -= dt * 4;
  if (G.landFlash > 0) G.landFlash -= dt * 3;

  // ── Particles ──
  if (G.isAirborne && G.playerY > 20) {
    if (Math.random() < 0.15) {
      const bedTopY = getBedTopY();
      G.particles.push({
        x: W * 0.5 + (Math.random() - 0.5) * 24,
        y: bedTopY - G.playerY,
        vx: (Math.random() - 0.5) * 80,
        vy: -30 - Math.random() * 60,
        life: 1.0,
        color: isForward(G.skillIndex) ? '#00e5ff' : '#ff6b35',
      });
    }
  }
  G.particles = G.particles.filter(p => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 100 * dt;
    p.life -= dt * 2;
    return p.life > 0;
  });

  // Phase-specific logic
  if (G.phase === Phase.WARMUP) {
    if (G.warmupJumps >= WARMUP_JUMPS_NEEDED) {
      G.phase = Phase.SKILL_INPUT;
      setPhaseText(`技1/10 入力 (前方)`);
      showMsg('技コマンド入力スタート!', 2);
      setCmdHint('○ < / でコマンド入力');
    }
  }

  if (G.phase === Phase.LANDING) {
    // Waiting for landing tap — auto-detect
  }

  updateHUD();
}

function getBedTopY() {
  return H * 0.7 + G.bedDeform * 35;
}

// ─────────────────────────────────────────────
//  GAME EVENTS
// ─────────────────────────────────────────────
function launchPlayer() {
  // Height grows with warmup taps
  const launchSpeed = 200 + G.peakHeight * 1.5;
  G.playerVY = Math.min(launchSpeed, 900);
  G.playerY = 2;
  G.isAirborne = true;
  G.currentHeight = 0;
  G.jumpFlash = 1.0;
  G.atBedBottom = false;

  // Execute the built skill on takeoff
  if ((G.phase === Phase.SKILL_INPUT || G.phase === Phase.PERFORMING) && G.builtSkill) {
    executeSkill();
  } else if (G.phase === Phase.STRAIGHT) {
    setPhaseText('着地でタップ!');
  }
}

function onBedBottomTap(x, y) {
  // Tap at bed bottom — boost height
  if (G.phase === Phase.WARMUP || G.phase === Phase.SKILL_INPUT) {
    if (G.atBedBottom && G.bottomTimer > 0) {
      G.peakHeight = Math.min(G.peakHeight + 40, MAX_HEIGHT_PX);
      G.jumpFlash = 0.8;
      G.warmupJumps++;
      tapRing(x, y);
      flashHeight(`+HEIGHT`, x, y - 30);
      setPhaseText(G.phase === Phase.WARMUP
        ? `予備ジャンプ ${G.warmupJumps}/${WARMUP_JUMPS_NEEDED}...`
        : `技${G.skillIndex + 1}/10 入力`);
    }
  }
}

function executeSkill() {
  const skill = G.builtSkill;
  const fwd = isForward(G.skillIndex);
  const diff = calcDifficulty(skill);
  const hBonus = (G.peakHeight / MAX_HEIGHT_PX) * 2.0;

  G.scoreDiff += diff;
  G.scoreHeight = Math.round((G.scoreHeight + hBonus) * 10) / 10;

  G.completedSkills.push({
    skill,
    forward: fwd,
    diff: Math.round(diff * 10) / 10,
    hBonus: Math.round(hBonus * 10) / 10,
    name: skillName(skill, fwd),
  });

  // Spin animation
  G.spinRate = skill.somersaults * 360 / PERFORM_DURATION;
  G.twistRate = skill.twists * 360 / PERFORM_DURATION;
  G.currentlyPerforming = true;
  G.performTimer = 0;

  G.builtSkill = null;
  G.cmdBuffer = [];
  G.inputActive = false;
  updateCmdDisplay();
  setCmdHint('');

  G.skillIndex++;
  updateSkillDots();

  if (G.skillIndex >= SKILL_COUNT) {
    // All 10 done — now straight jump to landing
    G.phase = Phase.STRAIGHT;
    setPhaseText('STRAIGHT JUMP — 着地でタップ!');
    showMsg('最終ジャンプ!', 1.5);
  } else {
    G.phase = Phase.PERFORMING;
    const nextFwd = isForward(G.skillIndex);
    setPhaseText(`技${G.skillIndex + 1}/10 入力 (${nextFwd ? '前方' : '後方'})`);
    setCmdHint('空中でコマンド入力!');
  }
}

function onLanded() {
  G.landFlash = 1.0;
  G.playerAngle = 0;
  G.twistAngle = 0;
  G.currentHeight = 0;

  if (G.phase === Phase.LANDING) {
    // Final landing — score timing
    G.phase = Phase.RESULT;
    setTimeout(showResult, 600);
  }
}

function triggerLandingTap(x, y) {
  // Player tapped during landing phase — score timing
  const quality = G.landFlash > 0.6 ? 'PERFECT' : G.landFlash > 0.3 ? 'GOOD' : 'OK';
  const bonus = G.landFlash > 0.6 ? 3.0 : G.landFlash > 0.3 ? 1.5 : 0.5;
  G.scoreTiming += bonus;
  tapRing(x, y);
  showMsg(`LANDING ${quality}! +${bonus.toFixed(1)}`, 1.5);
  G.phase = Phase.RESULT;
  setTimeout(showResult, 800);
}

// When all 10 skills done and player is back in air on straight jump
function onStraightJumpApex() {
  if (G.phase === Phase.STRAIGHT && G.playerVY < 0 && G.playerY > 80) {
    G.phase = Phase.LANDING;
    setPhaseText('着地でタップ!');
  }
}

function showResult() {
  document.getElementById('result-screen').classList.remove('hidden');
  document.getElementById('res-diff').textContent = G.scoreDiff.toFixed(1);
  document.getElementById('res-height').textContent = G.scoreHeight.toFixed(1);
  document.getElementById('res-timing').textContent = G.scoreTiming.toFixed(1);
  const total = G.scoreDiff + G.scoreHeight + G.scoreTiming;
  document.getElementById('res-total').textContent = total.toFixed(2);

  const list = document.getElementById('skill-list');
  list.innerHTML = '';
  G.completedSkills.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'skill-item';
    div.innerHTML = `<span class="skill-no">${i + 1}</span><span class="skill-name">${s.name}</span><span class="skill-d">D${s.diff.toFixed(1)}</span>`;
    list.appendChild(div);
  });
}

// ─────────────────────────────────────────────
//  INPUT HANDLING
// ─────────────────────────────────────────────
let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
let touchPoints = [];
let tapAccum = 0;
let tapFlushTimer = null;

function onPointerDown(x, y) {
  touchStartX = x;
  touchStartY = y;
  touchStartTime = Date.now();
  touchPoints = [{ x, y }];
}

function onPointerMove(x, y) {
  touchPoints.push({ x, y });
}

function onPointerUp(x, y) {
  const dx = x - touchStartX;
  const dy = y - touchStartY;
  const dist = Math.hypot(dx, dy);
  const dt = Date.now() - touchStartTime;

  if (G.phase === Phase.TITLE) { startGame(); return; }

  if (dist < 18 && dt < 350) {
    handleTap(x, y);
  } else if (dist >= 18) {
    const gesture = classifyGesture(touchPoints);
    handleGesture(gesture, x, y);
  }
}

function handleTap(x, y) {
  tapRing(x, y);

  if (G.phase === Phase.WARMUP) {
    onBedBottomTap(x, y);
    return;
  }

  if (G.phase === Phase.SKILL_INPUT || G.phase === Phase.PERFORMING) {
    // Bed bottom boost
    if (!G.isAirborne && G.atBedBottom && G.bottomTimer > 0) {
      onBedBottomTap(x, y);
      return;
    }
    // Airborne tap = somersault input
    if (G.isAirborne && G.builtSkill === null) {
      tapAccum++;
      flashHeight(`×${tapAccum}`, x, y - 20);
      clearTimeout(tapFlushTimer);
      tapFlushTimer = setTimeout(() => {
        const count = Math.min(3, tapAccum);
        tapAccum = 0;
        addToCmd(`tap${count}`);
      }, 380);
    }
    return;
  }

  if (G.phase === Phase.LANDING) {
    triggerLandingTap(x, y);
    return;
  }
}

function handleGesture(type, x, y) {
  tapRing(x, y);

  if (G.phase === Phase.TITLE) { startGame(); return; }

  if (G.phase === Phase.SKILL_INPUT || G.phase === Phase.PERFORMING) {
    if (G.builtSkill !== null) return; // already locked
    addToCmd(type);
    const labels = { circle: '○', slash: '/', vee: '<' };
    flashHeight(labels[type] || type, x, y - 20);
  }
}

// Gesture classification
function classifyGesture(pts) {
  if (pts.length < 2) return 'circle';

  const sx = pts[0].x, sy = pts[0].y;
  const ex = pts[pts.length - 1].x, ey = pts[pts.length - 1].y;
  const closeDist = Math.hypot(ex - sx, ey - sy);

  // Total arc length
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }

  // Circle: ends near start, arc is substantial
  if (closeDist < len * 0.38 && len > 55) return 'circle';

  // V (vee): mid point is below both endpoints
  if (pts.length >= 4) {
    const mid = pts[Math.floor(pts.length / 2)];
    const topY = Math.min(sy, ey);
    if (mid.y > topY + 28) return 'vee';
  }

  // Slash: diagonal swipe
  return 'slash';
}

// Touch events
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  onPointerDown(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  onPointerMove(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  onPointerUp(t.clientX, t.clientY);
}, { passive: false });

// Mouse fallback
canvas.addEventListener('mousedown', e => onPointerDown(e.clientX, e.clientY));
canvas.addEventListener('mousemove', e => { if (e.buttons) onPointerMove(e.clientX, e.clientY); });
canvas.addEventListener('mouseup', e => onPointerUp(e.clientX, e.clientY));

// ─────────────────────────────────────────────
//  BUTTONS
// ─────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('title-screen').classList.add('hidden');
  G.phase = Phase.WARMUP;
});

document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('result-screen').classList.add('hidden');
  initGame();
});

function startGame() {
  document.getElementById('title-screen').classList.add('hidden');
  G.phase = Phase.WARMUP;
}

// ─────────────────────────────────────────────
//  RENDERING
// ─────────────────────────────────────────────
function drawBackground() {
  // Deep space bg
  ctx.fillStyle = '#080c14';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
  ctx.lineWidth = 1;
  const gridSize = 55;
  for (let x = 0; x < W; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Height rulers on left
  const bedY = getBedTopY();
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 1;
  for (let m = 1; m <= 10; m++) {
    const ry = bedY - m * 40;
    if (ry < 20) break;
    ctx.strokeStyle = `rgba(0, 229, 255, ${m <= 5 ? 0.12 : 0.06})`;
    ctx.beginPath(); ctx.moveTo(44, ry); ctx.lineTo(W - 8, ry); ctx.stroke();
    ctx.fillStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.font = '10px "Share Tech Mono"';
    ctx.textAlign = 'left';
    ctx.fillText(`${m}m`, 8, ry + 4);
  }
  ctx.setLineDash([]);
}

function drawBed() {
  const bedTopY = getBedTopY();
  const bedW = W * 0.68;
  const bedX = (W - bedW) / 2;
  const sag = G.bedDeform * 28;

  // Frame legs
  ctx.fillStyle = '#2a3040';
  ctx.fillRect(bedX - 12, bedTopY + 10, 12, 30);
  ctx.fillRect(bedX + bedW, bedTopY + 10, 12, 30);

  // Frame bar
  ctx.fillStyle = '#3a4050';
  ctx.fillRect(bedX - 12, bedTopY + 8, bedW + 24, 10);

  // Springs
  const springCount = 10;
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.3)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < springCount; i++) {
    const sx = bedX + (i / (springCount - 1)) * bedW;
    const topY = bedTopY + 8;
    const botY = bedTopY + 18;
    ctx.beginPath();
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      const ox = (j % 2 === 0) ? 0 : (j % 4 === 1 ? 3 : -3);
      ctx.lineTo(sx + ox, topY + (botY - topY) * t);
    }
    ctx.stroke();
  }

  // Bed surface (with sag arc)
  const glowAlpha = 0.15 + G.bedFlash * 0.35;
  ctx.beginPath();
  ctx.moveTo(bedX, bedTopY);
  ctx.quadraticCurveTo(bedX + bedW / 2, bedTopY + sag, bedX + bedW, bedTopY);
  ctx.lineTo(bedX + bedW, bedTopY + 10);
  ctx.quadraticCurveTo(bedX + bedW / 2, bedTopY + 10 + sag, bedX, bedTopY + 10);
  ctx.closePath();

  ctx.fillStyle = `rgba(0, 180, 255, ${glowAlpha})`;
  ctx.fill();

  // Bed border glow
  const bedColor = G.atBedBottom && G.bottomTimer > 0
    ? `rgba(160, 255, 111, ${0.6 + Math.sin(Date.now() / 80) * 0.3})`
    : `rgba(0, 229, 255, 0.5)`;
  ctx.strokeStyle = bedColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bedX, bedTopY);
  ctx.quadraticCurveTo(bedX + bedW / 2, bedTopY + sag, bedX + bedW, bedTopY);
  ctx.stroke();

  // Crosshatch pattern
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
  ctx.lineWidth = 1;
  const rows = 3;
  for (let r = 1; r < rows; r++) {
    const t = r / rows;
    const y1 = bedTopY + sag * t;
    ctx.beginPath();
    ctx.moveTo(bedX + bedW * 0.1 * t, y1);
    ctx.lineTo(bedX + bedW * (1 - 0.1 * t), y1);
    ctx.stroke();
  }

  // Bottom tap indicator
  if (G.atBedBottom && G.bottomTimer > 0) {
    const alpha = G.bottomTimer / BOTTOM_WINDOW;
    ctx.fillStyle = `rgba(160, 255, 111, ${alpha})`;
    ctx.font = `bold ${14 + alpha * 4}px "Share Tech Mono"`;
    ctx.textAlign = 'center';
    ctx.fillText('▼  TAP NOW  ▼', W / 2, bedTopY + 52);
    ctx.textAlign = 'left';
  }
}

function drawPlayer() {
  if (!G.isAirborne && G.playerY < 2) {
    // Draw on bed
    drawPlayerAt(W * 0.5, getBedTopY() - 18, 0, 0, false);
    return;
  }

  const bedY = getBedTopY();
  const px = W * 0.5;
  const py = bedY - G.playerY;

  // Trail
  for (let i = 0; i < 3; i++) {
    const tp = G.playerY - i * 18;
    const ty = bedY - tp;
    const ta = (3 - i) / 3 * 0.15;
    ctx.globalAlpha = ta;
    drawPlayerAt(px, ty, G.playerAngle - i * 25, G.twistAngle, G.currentlyPerforming);
  }
  ctx.globalAlpha = 1;
  drawPlayerAt(px, py, G.playerAngle, G.twistAngle, G.currentlyPerforming);

  // Jump flash ring
  if (G.jumpFlash > 0) {
    ctx.strokeStyle = `rgba(160, 255, 111, ${G.jumpFlash})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 25 + (1 - G.jumpFlash) * 30, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPlayerAt(px, py, angle, twist, performing) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((angle % 360) * Math.PI / 180);

  const isFwd = isForward(G.skillIndex > 0 ? G.skillIndex - 1 : 0);
  const bodyColor = isFwd ? '#00e5ff' : '#ff6b35';
  const glowColor = isFwd ? 'rgba(0,229,255,0.25)' : 'rgba(255,107,53,0.25)';

  // Glow
  ctx.shadowColor = bodyColor;
  ctx.shadowBlur = 12;

  if (performing) {
    // Tuck position
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    // Body ball
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 10, 0, 0, Math.PI * 2); ctx.fill();
    // Head
    ctx.beginPath(); ctx.arc(0, -14, 6, 0, Math.PI * 2); ctx.fill();
  } else {
    // Straight position
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    // Torso
    ctx.beginPath(); ctx.ellipse(0, 0, 5, 14, 0, 0, Math.PI * 2); ctx.fill();
    // Head
    ctx.beginPath(); ctx.arc(0, -20, 6, 0, Math.PI * 2); ctx.fill();
    // Arms
    ctx.beginPath();
    ctx.moveTo(-5, -8); ctx.lineTo(-14, 0);
    ctx.moveTo(5, -8); ctx.lineTo(14, 0);
    ctx.stroke();
    // Legs
    ctx.beginPath();
    ctx.moveTo(-4, 12); ctx.lineTo(-6, 24);
    ctx.moveTo(4, 12); ctx.lineTo(6, 24);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawParticles() {
  for (const p of G.particles) {
    ctx.globalAlpha = p.life * 0.7;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBottomHint() {
  const phase = G.phase;
  const el = document.getElementById('cmd-panel');
  if (phase === Phase.WARMUP || phase === Phase.SKILL_INPUT || phase === Phase.PERFORMING || phase === Phase.STRAIGHT || phase === Phase.LANDING) {
    el.style.opacity = '1';
  } else {
    el.style.opacity = '0';
  }
}

// ─────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────
let lastTs = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  update(dt);

  // Check for straight jump apex to trigger landing phase
  if (G.phase === Phase.STRAIGHT && G.isAirborne) {
    onStraightJumpApex();
  }

  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawBed();
  if (G.phase !== Phase.TITLE) {
    drawParticles();
    drawPlayer();
  }
  drawBottomHint();

  requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
G.phase = Phase.TITLE;
initGame();
G.phase = Phase.TITLE; // keep title until button pressed

requestAnimationFrame(ts => { lastTs = ts; requestAnimationFrame(loop); });
