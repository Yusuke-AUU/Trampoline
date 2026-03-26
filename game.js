'use strict';
// ═══════════════════════════════════════════════════
//  TRAMPOLINE GAME v5
//  画像参考でキャラ描画を完全再現
// ═══════════════════════════════════════════════════

const C  = document.getElementById('c');
const cx = C.getContext('2d');
let W, H;
function resize(){ W = C.width = window.innerWidth; H = C.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

const JUMP_PERIOD = 1.9;
const BED_Y_FRAC  = 0.74;
const PEAK_Y_FRAC = 0.10;
const SKILL_COUNT = 10;
const CMD_TIMEOUT = 1600;

const DIFF_BASE = { 1:0.5, 2:1.2, 3:2.0 };
const DIFF_POS  = { tuck:0, pike:0.1, layout:0.2 };

const Ph = { TITLE:'T', PLAY:'P', RESULT:'R' };

let G;

function newGame() {
  G = {
    phase: Ph.PLAY,
    jumpT: 0,
    skillIdx: 0,
    done: [],
    // cmd
    cmdPhase: 'posture',
    posture: null,
    soms: [],          // [{twists:N}] per somersault
    commitTimer: null,
    locked: false,
    pending: null,
    // score
    sDiff:0, sH:0, sTiming:0,
    // anim
    spinAngle: 0,
    spinRate: 0,
    spinning: false,
    spinTimer: 0,
    posAnim: 'layout',
    // input
    ptStart: null, pts: [],
  };
  updateDots();
  renderCmd();
  setPhase(`技 1/${SKILL_COUNT}（前方）`);
  document.getElementById('result').classList.add('hidden');
}

// ── 技ヘルパー ──────────────────────────────
const isFwd = i => i % 2 === 0;

function calcDiff(sk) {
  const som = sk.soms.length;
  const tw  = sk.soms.reduce((a,s) => a + s.twists, 0);
  return Math.round(((DIFF_BASE[som]||0) + tw*0.2 + DIFF_POS[sk.posture]*som)*10)/10;
}

function skillLabel(sk, fwd) {
  const pn = {tuck:'抱え込み', pike:'屈伸', layout:'伸身'}[sk.posture];
  const som = sk.soms.length;
  const tw  = Math.round(sk.soms.reduce((a,s)=>a+s.twists,0)*10)/10;
  return `${fwd?'前方':'後方'} ${pn}${som}回宙${tw>0?tw+'捻り':''}`;
}

// ── コマンド入力 ────────────────────────────
function resetCmd() {
  clearTimeout(G.commitTimer);
  G.cmdPhase = 'posture'; G.posture = null; G.soms = [];
  G.locked = false; G.pending = null;
  renderCmd();
}

function scheduleCommit() {
  clearTimeout(G.commitTimer);
  G.commitTimer = setTimeout(commitSkill, CMD_TIMEOUT);
}

function commitSkill() {
  clearTimeout(G.commitTimer);
  if (!G.posture || G.soms.length === 0) { resetCmd(); return; }
  const sk = buildSkill();
  G.pending = sk; G.locked = true;
  const fwd = isFwd(G.skillIdx);
  showMsg(skillLabel(sk, fwd), 1.6);
  renderCmd();
}

function buildSkill() {
  const fwd  = isFwd(G.skillIdx);
  const soms = G.soms.slice(0, 3);
  const totalTw = soms.reduce((a,s)=>a+s.twists,0);
  const last = soms[soms.length-1];
  if (fwd) {
    const t = nearestHalfOdd(totalTw);
    last.twists = Math.max(0, Math.round((last.twists+(t-totalTw))*2)/2);
  } else {
    const t = Math.max(1, Math.round(totalTw));
    last.twists = Math.max(0, Math.round((last.twists+(t-totalTw))*2)/2);
  }
  return { posture: G.posture, soms };
}

function nearestHalfOdd(v) {
  return [0.5,1.5,2.5,3.5].reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a);
}

function onGesture(type, x, y) {
  if (G.phase !== Ph.PLAY || G.locked) return;
  if (G.cmdPhase === 'posture') {
    const pm = {circle:'tuck', vee:'pike', slash:'layout'};
    const pos = pm[type]; if (!pos) return;
    G.posture = pos; G.cmdPhase = 'body';
    flashLbl({tuck:'○',pike:'＜',layout:'／'}[pos], x, y-32, '#00e5ff');
    showMsg({tuck:'抱え込み',pike:'屈伸',layout:'伸身'}[pos], 0.8);
    renderCmd();
  } else {
    if (G.soms.length === 0) return;
    const last = G.soms[G.soms.length-1];
    if (type === 'circle')      { last.twists = Math.min(last.twists+1, 3);   flashLbl('〇', x, y-32, '#a0ff6f'); }
    else if (type === 'slash')  { last.twists = Math.min(last.twists+0.5, 3); flashLbl('／', x, y-32, '#a0ff6f'); }
    renderCmd(); scheduleCommit();
  }
}

function onTap(x, y) {
  if (G.phase !== Ph.PLAY || G.locked) return;
  if (G.cmdPhase !== 'body' || G.soms.length >= 3) return;
  G.soms.push({twists:0});
  flashLbl('·', x, y-32, '#ffd700');
  renderCmd(); scheduleCommit();
}

function renderCmd() {
  const fwd = isFwd(G.skillIdx);
  document.getElementById('cmd-dir').textContent = G.posture ? (fwd?'前方':'後方') : '';
  document.getElementById('cmd-seq').style.color = fwd ? '#00e5ff' : '#ff6b35';

  let seq = '';
  if (G.posture) {
    seq += {tuck:'○',pike:'＜',layout:'／'}[G.posture];
    for (const s of G.soms) {
      seq += ' ·';
      if (s.twists > 0) {
        const full = Math.floor(s.twists), half = s.twists%1>0?1:0;
        seq += '〇'.repeat(full)+(half?'/':'');
      }
    }
  }
  document.getElementById('cmd-seq').textContent = seq || '—';

  let hint = '';
  if (!G.posture)         hint = '円スワイプ=抱え込み　V字=屈伸　斜め=伸身';
  else if (G.locked)      hint = '✓ 確定 — 着地で発動';
  else if (!G.soms.length) hint = 'タップ = 宙返り1回追加';
  else                    hint = 'タップ=宙返り追加　円/斜めスワイプ=捻り';
  document.getElementById('cmd-hint').textContent = hint;
}

// ── 更新 ───────────────────────────────────
function update(dt) {
  if (G.phase !== Ph.PLAY) return;
  G.jumpT += dt;
  if (G.jumpT >= JUMP_PERIOD) { G.jumpT -= JUMP_PERIOD; onLanding(); }
  if (G.spinning) {
    G.spinTimer -= dt; G.spinAngle += G.spinRate*dt;
    if (G.spinTimer <= 0) { G.spinning=false; G.spinRate=0; G.spinAngle=0; }
  }
}

function onLanding() {
  if (G.locked && G.pending) execSkill();
}

function execSkill() {
  const sk = G.pending, fwd = isFwd(G.skillIdx);
  const d  = calcDiff(sk);
  G.sDiff  = Math.round((G.sDiff+d)*10)/10;
  G.sH     = Math.round((G.sH+0.5)*10)/10;
  G.done.push({sk, fwd, d, name:skillLabel(sk,fwd)});

  const som = sk.soms.length;
  G.spinRate  = som * 340 / JUMP_PERIOD;
  G.spinning  = true;
  G.spinTimer = JUMP_PERIOD * 0.7;
  G.spinAngle = 0;
  G.posAnim   = sk.posture;

  resetCmd();
  G.skillIdx++; updateDots();

  if (G.skillIdx >= SKILL_COUNT) {
    setPhase('ストレートジャンプ!');
    document.getElementById('cmd-wrap').style.opacity='0.3';
    setTimeout(()=>{ G.phase=Ph.RESULT; showResult(); }, JUMP_PERIOD*1100);
  } else {
    const nf = isFwd(G.skillIdx);
    setPhase(`技 ${G.skillIdx+1}/${SKILL_COUNT}（${nf?'前方':'後方'}）`);
    document.getElementById('cmd-wrap').style.opacity='1';
  }
}

// ── 描画 ───────────────────────────────────
function playerFrac() {
  return Math.sin((G.jumpT/JUMP_PERIOD)*Math.PI);
}

function draw() {
  cx.clearRect(0,0,W,H);
  cx.fillStyle='#07090f'; cx.fillRect(0,0,W,H);

  // グリッド
  cx.strokeStyle='rgba(0,229,255,0.035)'; cx.lineWidth=1;
  const gs=Math.min(W,H)/10;
  for(let x=0;x<W;x+=gs){cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,H);cx.stroke();}
  for(let y=0;y<H;y+=gs){cx.beginPath();cx.moveTo(0,y);cx.lineTo(W,y);cx.stroke();}

  const bedY  = H*BED_Y_FRAC;
  const peakY = H*PEAK_Y_FRAC;

  // 高さ目盛
  cx.setLineDash([3,7]); cx.lineWidth=1;
  cx.font='10px "Share Tech Mono"'; cx.textAlign='left';
  for(let m=1;m<=8;m++){
    const ry=bedY-m*(bedY-peakY)/8; if(ry<30) break;
    cx.strokeStyle=`rgba(0,229,255,${m%2===0?0.10:0.05})`;
    cx.beginPath();cx.moveTo(34,ry);cx.lineTo(W-8,ry);cx.stroke();
    cx.fillStyle='rgba(0,229,255,0.28)';
    cx.fillText(`${m}m`,5,ry+4);
  }
  cx.setLineDash([]);

  drawBed(bedY);

  if (G.phase===Ph.PLAY) {
    const frac = playerFrac();
    // bedYからpeakYへ（画面上方向 = Y減少）
    const py = bedY - frac*(bedY-peakY);
    const px = W*0.5;

    // ジャンプ軌跡
    cx.fillStyle='rgba(0,229,255,0.07)';
    for(let i=1;i<8;i++){
      const tf=i/8, yy=bedY-Math.sin(tf*Math.PI)*(bedY-peakY);
      cx.beginPath();cx.arc(px,yy,1.8,0,Math.PI*2);cx.fill();
    }

    // キャラ描画: 宙返り中はスピン角度を使う、静止時は0
    const angle = G.spinning ? G.spinAngle : 0;
    const pose  = G.spinning ? G.posAnim  : 'straight';
    drawAthlete(px, py, angle, pose);
  }
}

function drawBed(by) {
  const bw=Math.min(W*0.5,200), bx=(W-bw)/2;
  cx.fillStyle='#1e2430';
  cx.fillRect(bx-10,by+5,bw+20,7); cx.fillRect(bx-10,by+5,10,20); cx.fillRect(bx+bw,by+5,10,20);
  cx.strokeStyle='rgba(150,190,255,0.18)'; cx.lineWidth=1.2;
  for(let i=0;i<7;i++){
    const sx=bx+(i/6)*bw; cx.beginPath(); cx.moveTo(sx,by+5);
    for(let j=1;j<=4;j++) cx.lineTo(sx+(j%2?2:-2),by+5+7*j/4);
    cx.stroke();
  }
  cx.fillStyle='rgba(0,150,255,0.10)'; cx.fillRect(bx,by,bw,5);
  cx.strokeStyle='rgba(0,229,255,0.7)'; cx.lineWidth=2;
  cx.beginPath();cx.moveTo(bx,by);cx.lineTo(bx+bw,by);cx.stroke();
}

// ─── キャラクター描画（手書き棒人間に忠実）───────────
function drawAthlete(px, py, angleDeg, posture) {
  cx.save();
  cx.translate(px, py);
  cx.rotate((angleDeg % 360) * Math.PI / 180);
  const fwd = isFwd(G.skillIdx > 0 ? G.skillIdx - 1 : 0);
  const col = fwd ? '#00e5ff' : '#ff6b35';
  cx.shadowColor = col; cx.shadowBlur = 12;
  cx.strokeStyle = col; cx.fillStyle = col;
  cx.lineCap = 'round'; cx.lineJoin = 'round';
  const S = Math.min(W, H) * 0.044;
  switch (posture) {
    case 'tuck':   pTuck(S, col);   break;
    case 'pike':   pPike(S, col);   break;
    case 'layout': pLayout(S, col); break;
    default:       pStraight(S, col);
  }
  cx.shadowBlur = 0;
  cx.restore();
}

// ジャンプ姿勢: 腕を上に伸ばしてまっすぐ
function pStraight(S, col) {
  cx.lineWidth = S * 0.28;
  cx.beginPath(); cx.arc(0, -3.6*S, 0.58*S, 0, Math.PI*2); cx.fill();
  cx.beginPath(); cx.moveTo(0, -3.0*S); cx.lineTo(0, 0.8*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -2.2*S); cx.lineTo(-1.0*S, -3.3*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -2.2*S); cx.lineTo( 1.0*S, -3.3*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, 0.8*S); cx.lineTo(-0.5*S, 2.6*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, 0.8*S); cx.lineTo( 0.5*S, 2.6*S); cx.stroke();
  cx.beginPath(); cx.moveTo(-0.5*S, 2.6*S); cx.lineTo(-0.8*S, 3.2*S); cx.stroke();
  cx.beginPath(); cx.moveTo( 0.5*S, 2.6*S); cx.lineTo( 0.8*S, 3.2*S); cx.stroke();
}

// 抱え込み: 膝を両手で胸に引き寄せた丸い形
function pTuck(S, col) {
  cx.lineWidth = S * 0.28;
  cx.beginPath(); cx.arc(0.2*S, -2.6*S, 0.58*S, 0, Math.PI*2); cx.fill();
  cx.beginPath(); cx.moveTo(0.2*S, -2.0*S); cx.lineTo(0, -0.4*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -0.4*S); cx.lineTo(-0.9*S, 0.7*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -0.4*S); cx.lineTo( 0.9*S, 0.7*S); cx.stroke();
  cx.beginPath(); cx.moveTo(-0.9*S, 0.7*S); cx.lineTo(-0.2*S, 1.6*S); cx.stroke();
  cx.beginPath(); cx.moveTo( 0.9*S, 0.7*S); cx.lineTo( 0.2*S, 1.6*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -1.4*S); cx.lineTo(-1.1*S, 0.1*S); cx.lineTo(-0.3*S, 1.1*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0, -1.4*S); cx.lineTo( 1.1*S, 0.1*S); cx.lineTo( 0.3*S, 1.1*S); cx.stroke();
}

// 屈伸: 腰で折れてV字、脚はまっすぐ上向き
function pPike(S, col) {
  cx.lineWidth = S * 0.28;
  cx.beginPath(); cx.arc(0.1*S, -0.8*S, 0.58*S, 0, Math.PI*2); cx.fill();
  cx.beginPath(); cx.moveTo(0.1*S, -0.2*S); cx.lineTo(0.4*S, 1.5*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.1*S, 0.6*S); cx.lineTo(-1.2*S, -0.6*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.1*S, 0.6*S); cx.lineTo( 1.3*S, -0.5*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.4*S, 1.5*S); cx.lineTo(-1.0*S, 0.0*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.4*S, 1.5*S); cx.lineTo( 1.6*S, 0.1*S); cx.stroke();
  cx.beginPath(); cx.moveTo(-1.0*S, 0.0*S); cx.lineTo(-1.4*S, -0.6*S); cx.stroke();
  cx.beginPath(); cx.moveTo( 1.6*S, 0.1*S); cx.lineTo( 2.0*S, -0.4*S); cx.stroke();
}

// 伸身: 体を少し反らせた流れるような形
function pLayout(S, col) {
  cx.lineWidth = S * 0.28;
  cx.beginPath(); cx.arc(0.3*S, -3.0*S, 0.58*S, 0, Math.PI*2); cx.fill();
  cx.beginPath();
  cx.moveTo(0.3*S, -2.4*S);
  cx.quadraticCurveTo(0.9*S, -0.8*S, 0.5*S, 0.9*S);
  cx.stroke();
  cx.beginPath(); cx.moveTo(0.3*S, -1.8*S); cx.lineTo(-0.7*S, -0.9*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.3*S, -1.8*S); cx.lineTo( 1.3*S, -0.9*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.5*S, 0.9*S); cx.lineTo(-0.1*S, 2.7*S); cx.stroke();
  cx.beginPath(); cx.moveTo(0.5*S, 0.9*S); cx.lineTo( 1.0*S, 2.7*S); cx.stroke();
  cx.beginPath(); cx.moveTo(-0.1*S, 2.7*S); cx.lineTo(-0.4*S, 3.2*S); cx.stroke();
  cx.beginPath(); cx.moveTo( 1.0*S, 2.7*S); cx.lineTo( 1.3*S, 3.2*S); cx.stroke();
}



// ── UI ─────────────────────────────────────
function setPhase(t){ document.getElementById('phase-txt').textContent=t; }

function updateDots(){
  const c=document.getElementById('dots'); c.innerHTML='';
  for(let i=0;i<SKILL_COUNT;i++){
    const d=document.createElement('div'); d.className='dot';
    if(i<G.skillIdx) d.classList.add(i%2===0?'fwd':'bwd');
    else if(i===G.skillIdx) d.classList.add('cur');
    c.appendChild(d);
  }
  document.getElementById('skill-no').innerHTML=
    `${Math.min(G.skillIdx+1,SKILL_COUNT)}<span class="unit">/${SKILL_COUNT}</span>`;
}

function updateScore(){
  document.getElementById('score-val').textContent=(G.sDiff+G.sH+G.sTiming).toFixed(1);
}

let _mt=null;
function showMsg(text,dur=1.5){
  const el=document.getElementById('msg');
  el.textContent=text; el.style.opacity='1';
  clearTimeout(_mt); _mt=setTimeout(()=>{el.style.opacity='0';},dur*1000);
}

function flashLbl(text,x,y,col='#a0ff6f'){
  const d=document.createElement('div'); d.className='fl'; d.textContent=text;
  d.style.cssText=`left:${x}px;top:${y}px;color:${col}`;
  document.body.appendChild(d); setTimeout(()=>d.remove(),800);
}

function tapRing(x,y){
  const el=document.getElementById('tap-ring');
  el.style.left=x+'px'; el.style.top=y+'px';
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

function showResult(){
  const rows=document.getElementById('r-rows'); rows.innerHTML='';
  G.done.forEach((s,i)=>{
    const div=document.createElement('div'); div.className='r-item';
    div.innerHTML=`<span class="rn">${i+1}</span><span class="rname">${s.name}</span><span class="rd">D${s.d.toFixed(1)}</span>`;
    rows.appendChild(div);
  });
  document.getElementById('r-total').textContent=(G.sDiff+G.sH+G.sTiming).toFixed(2);
  document.getElementById('result').classList.remove('hidden');
}

// ── ジェスチャー認識 ───────────────────────
let _ps=null, _pts=[];
C.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];_ps={x:t.clientX,y:t.clientY,time:Date.now()};_pts=[{x:t.clientX,y:t.clientY}];},{passive:false});
C.addEventListener('touchmove', e=>{e.preventDefault();const t=e.touches[0];_pts.push({x:t.clientX,y:t.clientY});},{passive:false});
C.addEventListener('touchend',  e=>{e.preventDefault();const t=e.changedTouches[0];handleUp(t.clientX,t.clientY);},{passive:false});
C.addEventListener('mousedown',e=>{_ps={x:e.clientX,y:e.clientY,time:Date.now()};_pts=[{x:e.clientX,y:e.clientY}];});
C.addEventListener('mousemove',e=>{if(e.buttons)_pts.push({x:e.clientX,y:e.clientY});});
C.addEventListener('mouseup',  e=>handleUp(e.clientX,e.clientY));

function handleUp(x,y){
  if(!_ps) return;
  if(G.phase===Ph.TITLE){startGame();_ps=null;return;}
  const dx=x-_ps.x, dy=y-_ps.y, dist=Math.hypot(dx,dy), dt=Date.now()-_ps.time;
  tapRing(x,y);
  if(dist<22&&dt<420) onTap(x,y);
  else if(dist>=22)   onGesture(classify(_pts),x,y);
  _ps=null;
}

function classify(pts){
  if(pts.length<2) return 'slash';
  const s=pts[0], e=pts[pts.length-1];
  const closeD=Math.hypot(e.x-s.x,e.y-s.y);
  let len=0; for(let i=1;i<pts.length;i++) len+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);

  // 円: 終点が始点に近い
  if(closeD<len*0.40&&len>45) return 'circle';

  // V字: 中間が両端より下
  if(pts.length>=5){
    const mid=pts[Math.floor(pts.length/2)];
    const topY=Math.min(s.y,e.y);
    if(mid.y>topY+28) return 'vee';
  }

  // 斜め: x方向とy方向の両方に動きがある
  const adx=Math.abs(e.x-s.x), ady=Math.abs(e.y-s.y);
  if(adx>18&&ady>18) return 'slash';

  return 'slash';
}

document.getElementById('start-btn').addEventListener('click',startGame);
document.getElementById('retry-btn').addEventListener('click',()=>newGame());
function startGame(){document.getElementById('title').style.display='none';newGame();}

// ── メインループ ───────────────────────────
let _last=0;
function loop(ts){
  const dt=Math.min((ts-_last)/1000,0.05); _last=ts;
  if(G&&G.phase===Ph.PLAY){update(dt);updateScore();}
  draw();
  requestAnimationFrame(loop);
}

G={phase:Ph.TITLE,done:[],skillIdx:0,jumpT:0,spinning:false,spinAngle:0,spinRate:0,spinTimer:0,posAnim:'straight',sDiff:0,sH:0,sTiming:0};
requestAnimationFrame(ts=>{_last=ts;requestAnimationFrame(loop);});
