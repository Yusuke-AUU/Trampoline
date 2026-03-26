'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

const GRAVITY     = 1400;
const BED_Y_RATIO = 0.72;
const MAX_ENERGY  = 1300;
const BOTTOM_WIN  = 0.32;
const WARMUP_NEED = 3;
const SKILL_COUNT = 10;

const DIFF_BASE = { 1:0.5, 2:1.2, 3:2.0 };
const DIFF_POS  = { tuck:0, pike:0.1, layout:0.2 };

const Phase = { TITLE:'TITLE', WARMUP:'WARMUP', SKILL_INPUT:'SKILL_INPUT',
                PERFORMING:'PERFORMING', STRAIGHT:'STRAIGHT', LANDING:'LANDING', RESULT:'RESULT' };

let G = {};

function mkState() {
  return {
    phase: Phase.WARMUP,
    py: 0, vy: 0, onBed: true, wasOnBed: true,
    bedSag: 0, bedSagV: 0,
    atBottom: false, bottomTimer: 0, bedFlash: 0,
    energy: 140,
    warmupCount: 0,
    skillIdx: 0, doneSkills: [],
    pending: null,
    buf: [], bufTimeout: null, inputLocked: false,
    tapAccum: 0, tapFlushTimer: null,
    sDiff: 0, sHeight: 0, sTiming: 0,
    peakThisJump: 0,
    angle: 0, spinRate: 0, twistAng: 0, twistRate: 0,
    performing: false, perfTimer: 0, perfDur: 1.7,
    particles: [], jumpFlash: 0, landFlash: 0,
    trail: [],
  };
}

function startNewGame() {
  G = mkState();
  updateDots();
  setCmdDisplay('—');
  setPhase('予備ジャンプ — ベッドの底でタップ!');
  document.getElementById('result-screen').classList.add('hidden');
}

/* ── Skill helpers ── */
function isFwd(i) { return i%2===0; }
function calcDiff(s) {
  return Math.round(((DIFF_BASE[s.somersaults]||0) + s.twists*0.1*2 + DIFF_POS[s.position]*s.somersaults)*10)/10;
}
function skillLabel(s,fwd) {
  const d={tuck:'抱え込み',pike:'屈伸',layout:'伸身'}[s.position];
  const tw=s.twists>0?`${s.twists}捻り`:'';
  return `${fwd?'前方':'後方'} ${d}${s.somersaults}回宙${tw}`;
}

/* ── Command parsing ── */
function parseCmd(buf) {
  if (!buf.length) return null;
  let idx=0, position='tuck', somersaults=0, twists=0;
  if      (buf[0]==='circle') { position='tuck';   idx=1; }
  else if (buf[0]==='vee')    { position='pike';   idx=1; }
  else if (buf[0]==='slash')  { position='layout'; idx=1; }
  while (idx<buf.length) {
    const e=buf[idx++];
    if(e==='tap1') somersaults+=1;
    else if(e==='tap2') somersaults+=2;
    else if(e==='tap3') somersaults+=3;
    else if(e==='circle') twists+=1;
    else if(e==='slash')  twists+=0.5;
  }
  somersaults=Math.max(1,Math.min(3,somersaults));
  twists=Math.round(twists*2)/2;
  const fwd=isFwd(G.skillIdx);
  if (fwd) {
    if (twists===0||twists%1===0) twists=Math.max(0.5,twists+0.5);
    twists=Math.min(twists,3.5);
  } else {
    twists=Math.max(1,Math.min(3,Math.round(twists)));
  }
  return { somersaults, twists, position };
}

function commitCmd() {
  clearTimeout(G.bufTimeout);
  const skill=parseCmd(G.buf);
  if (!skill) { resetCmd(); return; }
  G.pending=skill; G.inputLocked=true;
  const fwd=isFwd(G.skillIdx);
  const posIco={tuck:'○',pike:'<',layout:'/'}[skill.position];
  setCmdDisplay(`${posIco} ${skill.somersaults}宙 ${skill.twists}捻`);
  setCmdHint('✓ 確定 — 次の着地で発動');
  showMsg(skillLabel(skill,fwd), 1.4);
}
function resetCmd() {
  clearTimeout(G.bufTimeout); G.buf=[]; G.pending=null; G.inputLocked=false;
  setCmdDisplay('—'); setCmdHint('');
}
function pushCmd(entry) {
  if (G.inputLocked) return;
  G.buf.push(entry);
  const s=parseCmd(G.buf);
  if (s) { const p={tuck:'○',pike:'<',layout:'/'}[s.position]; setCmdDisplay(`${p} ${s.somersaults}宙 ${s.twists}捻`); }
  clearTimeout(G.bufTimeout);
  G.bufTimeout=setTimeout(commitCmd, 1300);
}

/* ── UI ── */
function setPhase(t)    { document.getElementById('phase-text').textContent=t; }
function setCmdHint(t)  { document.getElementById('cmd-hint').textContent=t; }
function setCmdDisplay(t){ document.getElementById('cmd-display').textContent=t; }
function updateHUD() {
  const hm=Math.max(0,G.peakThisJump/40).toFixed(1);
  document.getElementById('height-val').innerHTML=`${hm}<span class="hud-unit">m</span>`;
  document.getElementById('score-val').textContent=(G.sDiff+G.sHeight+G.sTiming).toFixed(2);
}
function updateDots() {
  const c=document.getElementById('skill-dots'); c.innerHTML='';
  for(let i=0;i<SKILL_COUNT;i++){
    const d=document.createElement('div'); d.className='skill-dot';
    if(i<G.skillIdx) d.classList.add(i%2===0?'done-fwd':'done-bwd');
    else if(i===G.skillIdx) d.classList.add('active');
    c.appendChild(d);
  }
}
let _mt=null;
function showMsg(text,dur=1.5){
  const el=document.getElementById('msg-text');
  el.textContent=text; el.style.opacity='1';
  clearTimeout(_mt); _mt=setTimeout(()=>{el.style.opacity='0';},dur*1000);
}
function flashLabel(text,x,y,col='#a0ff6f'){
  const d=document.createElement('div');
  d.className='height-flash'; d.textContent=text;
  d.style.cssText=`left:${x}px;top:${y}px;color:${col}`;
  document.body.appendChild(d); setTimeout(()=>d.remove(),850);
}
function tapRing(x,y){
  const el=document.getElementById('tap-ring');
  el.style.left=x+'px'; el.style.top=y+'px';
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function bedBaseY(){ return H*BED_Y_RATIO; }

/* ── Physics ── */
function update(dt) {
  if (G.phase===Phase.TITLE||G.phase===Phase.RESULT) return;

  /* Bed spring */
  const K=200, D=18;
  G.bedSagV+=(-G.bedSag*K - G.bedSagV*D)*dt;
  G.bedSag +=G.bedSagV*dt;
  if (G.bedSag<0) G.bedSag=0;

  /* Detect bottom (sag peaked = velocity just turned positive while sag is high) */
  const prevBottom=G.atBottom;
  G.atBottom = G.onBed && G.bedSag>0.18 && G.bedSagV>-5;
  if (!prevBottom && G.atBottom) { G.bottomTimer=BOTTOM_WIN; G.bedFlash=1.0; }
  if (G.bottomTimer>0) G.bottomTimer-=dt;

  G.wasOnBed=G.onBed;

  if (G.onBed) {
    G.py=0; G.vy=0;
    /* Auto launch when bed springs back hard */
    if (G.bedSagV<-80 && G.bedSag<0.04) doLaunch();
  } else {
    G.vy-=GRAVITY*dt;
    G.py+=G.vy*dt;
    if (G.py<=0) { G.py=0; onTouchBed(); }
    else { G.peakThisJump=Math.max(G.peakThisJump,G.py); }
  }

  /* Spin */
  if (G.performing) {
    G.perfTimer+=dt;
    G.angle   +=G.spinRate *dt;
    G.twistAng+=G.twistRate*dt;
    if (G.perfTimer>=G.perfDur*0.72) { G.performing=false; G.spinRate=G.twistRate=0; }
  }

  /* Trail */
  const px=W*0.5, py2=bedBaseY()-G.py;
  G.trail.push({x:px,y:py2});
  if (G.trail.length>7) G.trail.shift();

  /* Particles */
  if (!G.onBed && G.py>30 && Math.random()<0.12) {
    G.particles.push({x:W*0.5+(Math.random()-.5)*20, y:bedBaseY()-G.py,
      vx:(Math.random()-.5)*70, vy:-20-Math.random()*50, life:1,
      col:isFwd(G.skillIdx)?'#00e5ff':'#ff6b35'});
  }
  G.particles=G.particles.filter(p=>{
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=90*dt; p.life-=dt*2.2; return p.life>0;
  });

  /* Flashes */
  if(G.bedFlash>0) G.bedFlash-=dt*3;
  if(G.jumpFlash>0) G.jumpFlash-=dt*4;
  if(G.landFlash>0) G.landFlash-=dt*3;

  /* Phase transition to landing */
  if (G.phase===Phase.STRAIGHT && !G.onBed && G.vy<0 && G.py>60) {
    G.phase=Phase.LANDING;
    setPhase('着地でタップ!');
  }

  /* Warmup check */
  if (G.phase===Phase.WARMUP && G.warmupCount>=WARMUP_NEED) {
    G.phase=Phase.SKILL_INPUT;
    setPhase('技1/10 (前方) — 空中で入力!');
    showMsg('技コマンド入力スタート!',2);
    setCmdHint('○ < / + タップN回');
  }

  updateHUD();
}

function onTouchBed() {
  G.onBed=true; G.landFlash=1.0;
  const impact=Math.abs(G.vy);
  /* Compress bed */
  G.bedSagV=impact*0.055;
  G.bedSag=Math.min(G.bedSag+impact*0.0003, 0.9);
  G.vy=0;
  if (G.phase===Phase.LANDING) {
    G.sTiming=Math.round((G.sTiming+0.5)*10)/10;
    G.phase=Phase.RESULT;
    setTimeout(showResult, 700);
  }
}

function doLaunch() {
  G.onBed=false;
  G.vy=G.energy;
  G.py=2; G.jumpFlash=1.0; G.peakThisJump=0;
  if (G.pending && (G.phase===Phase.SKILL_INPUT||G.phase===Phase.PERFORMING)) execSkill();
}

function execSkill() {
  const s=G.pending, fwd=isFwd(G.skillIdx), d=calcDiff(s);
  G.sDiff  =Math.round((G.sDiff+d)*10)/10;
  G.sHeight=Math.round((G.sHeight+(G.energy/MAX_ENERGY)*1.8)*10)/10;
  G.doneSkills.push({s,fwd,d:Math.round(d*10)/10,name:skillLabel(s,fwd)});
  G.spinRate=s.somersaults*360/G.perfDur;
  G.twistRate=s.twists*360/G.perfDur;
  G.performing=true; G.perfTimer=0; G.angle=0; G.twistAng=0;
  G.pending=null; G.buf=[]; G.inputLocked=false;
  setCmdDisplay('—'); setCmdHint('');
  G.skillIdx++; updateDots();
  if (G.skillIdx>=SKILL_COUNT) {
    G.phase=Phase.STRAIGHT;
    setPhase('STRAIGHT JUMP — 着地でタップ!');
    showMsg('最終ジャンプ!',1.5);
  } else {
    G.phase=Phase.PERFORMING;
    setPhase(`技${G.skillIdx+1}/10 (${isFwd(G.skillIdx)?'前方':'後方'}) — 空中で入力`);
    setCmdHint('空中でコマンド入力!');
  }
}

/* ── Input ── */
let _ps={x:0,y:0,t:0}, _pts=[], _tacc=0, _tfl=null;
canvas.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];_ps={x:t.clientX,y:t.clientY,t:Date.now()};_pts=[{x:t.clientX,y:t.clientY}];},{passive:false});
canvas.addEventListener('touchmove', e=>{e.preventDefault();const t=e.touches[0];_pts.push({x:t.clientX,y:t.clientY});},{passive:false});
canvas.addEventListener('touchend',  e=>{e.preventDefault();const t=e.changedTouches[0];handleUp(t.clientX,t.clientY);},{passive:false});
canvas.addEventListener('mousedown', e=>{_ps={x:e.clientX,y:e.clientY,t:Date.now()};_pts=[{x:e.clientX,y:e.clientY}];});
canvas.addEventListener('mousemove', e=>{if(e.buttons)_pts.push({x:e.clientX,y:e.clientY});});
canvas.addEventListener('mouseup',   e=>handleUp(e.clientX,e.clientY));

function handleUp(x,y) {
  if (G.phase===Phase.TITLE){startGame();return;}
  const dx=x-_ps.x, dy=y-_ps.y, dist=Math.hypot(dx,dy), dt=Date.now()-_ps.t;
  if (dist<22&&dt<420) onTap(x,y);
  else if (dist>=22)   onGesture(classifyGesture(_pts),x,y);
}

function onTap(x,y) {
  tapRing(x,y);
  if (G.phase===Phase.WARMUP) {
    if (G.onBed && G.atBottom && G.bottomTimer>0) {
      G.energy=Math.min(G.energy+55,MAX_ENERGY);
      G.warmupCount++; G.bedFlash=1.0;
      flashLabel('+HEIGHT',x,y-30,'#a0ff6f');
      setPhase(`予備ジャンプ ${G.warmupCount}/${WARMUP_NEED}...`);
    }
    return;
  }
  if ((G.phase===Phase.SKILL_INPUT||G.phase===Phase.PERFORMING) && !G.onBed && !G.inputLocked) {
    _tacc++;
    flashLabel(`×${_tacc}`,x,y-25,'#ffd700');
    clearTimeout(_tfl);
    _tfl=setTimeout(()=>{pushCmd(`tap${Math.min(3,_tacc)}`);_tacc=0;},370);
    return;
  }
  if (G.phase===Phase.LANDING) {
    const bonus=G.landFlash>0.6?3.0:G.landFlash>0.3?1.5:0.5;
    G.sTiming=Math.round((G.sTiming+bonus)*10)/10;
    flashLabel('LANDED!',W/2-40,H*0.45,'#a0ff6f');
    G.phase=Phase.RESULT; setTimeout(showResult,700);
  }
}

function onGesture(type,x,y) {
  tapRing(x,y);
  const icons={circle:'○',slash:'/',vee:'<'};
  flashLabel(icons[type]||type,x,y-25,'#00e5ff');
  if ((G.phase===Phase.SKILL_INPUT||G.phase===Phase.PERFORMING)&&!G.inputLocked) pushCmd(type);
}

function classifyGesture(pts) {
  if (pts.length<2) return 'slash';
  const s=pts[0],e=pts[pts.length-1];
  const close=Math.hypot(e.x-s.x,e.y-s.y);
  let len=0; for(let i=1;i<pts.length;i++) len+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
  if (close<len*0.38&&len>50) return 'circle';
  if (pts.length>=4){const mid=pts[Math.floor(pts.length/2)];if(mid.y>Math.min(s.y,e.y)+26) return 'vee';}
  return 'slash';
}

document.getElementById('start-btn').addEventListener('click',()=>{document.getElementById('title-screen').classList.add('hidden');G.phase=Phase.WARMUP;});
document.getElementById('retry-btn').addEventListener('click',()=>startNewGame());
function startGame(){document.getElementById('title-screen').classList.add('hidden');G.phase=Phase.WARMUP;}

/* ── Result ── */
function showResult() {
  const list=document.getElementById('skill-list'); list.innerHTML='';
  G.doneSkills.forEach((s,i)=>{
    const div=document.createElement('div'); div.className='skill-item';
    div.innerHTML=`<span class="skill-no">${i+1}</span><span class="skill-name">${s.name}</span><span class="skill-d">D${s.d.toFixed(1)}</span>`;
    list.appendChild(div);
  });
  document.getElementById('res-diff').textContent=G.sDiff.toFixed(1);
  document.getElementById('res-height').textContent=G.sHeight.toFixed(1);
  document.getElementById('res-timing').textContent=G.sTiming.toFixed(1);
  document.getElementById('res-total').textContent=(G.sDiff+G.sHeight+G.sTiming).toFixed(2);
  document.getElementById('result-screen').classList.remove('hidden');
}

/* ── Drawing ── */
function drawBg() {
  ctx.fillStyle='#080c14'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(0,229,255,0.04)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=55){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=55){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  const by=bedBaseY();
  ctx.setLineDash([3,7]); ctx.lineWidth=1;
  for(let m=1;m<=10;m++){
    const ry=by-m*40; if(ry<10) break;
    ctx.strokeStyle=`rgba(0,229,255,${m<=5?0.10:0.05})`;
    ctx.beginPath();ctx.moveTo(40,ry);ctx.lineTo(W-8,ry);ctx.stroke();
    ctx.fillStyle='rgba(0,229,255,0.3)'; ctx.font='10px "Share Tech Mono"'; ctx.textAlign='left';
    ctx.fillText(`${m}m`,6,ry+4);
  }
  ctx.setLineDash([]);
}

function drawBed() {
  const by=bedBaseY(), bw=W*0.68, bx=(W-bw)/2, sag=G.bedSag*32;
  ctx.fillStyle='#252b3a';
  ctx.fillRect(bx-14,by+9,bw+28,11); ctx.fillRect(bx-14,by+9,14,32); ctx.fillRect(bx+bw,by+9,14,32);
  ctx.strokeStyle='rgba(180,210,255,0.2)'; ctx.lineWidth=1.5;
  for(let i=0;i<10;i++){
    const sx=bx+(i/9)*bw;
    ctx.beginPath(); ctx.moveTo(sx,by+9);
    for(let j=1;j<=5;j++){const t=j/5,ox=j%2===0?3:-3;ctx.lineTo(sx+ox,by+9+11*t);}
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(bx,by); ctx.quadraticCurveTo(bx+bw/2,by+sag,bx+bw,by);
  ctx.lineTo(bx+bw,by+9); ctx.quadraticCurveTo(bx+bw/2,by+9+sag,bx,by+9); ctx.closePath();
  ctx.fillStyle=`rgba(0,180,255,${0.10+G.bedFlash*0.28})`; ctx.fill();
  const gc=G.atBottom&&G.bottomTimer>0?`rgba(160,255,111,${0.7+Math.sin(Date.now()/70)*0.25})`:`rgba(0,229,255,0.55)`;
  ctx.strokeStyle=gc; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(bx,by); ctx.quadraticCurveTo(bx+bw/2,by+sag,bx+bw,by); ctx.stroke();
  ctx.strokeStyle='rgba(0,229,255,0.08)'; ctx.lineWidth=1;
  for(let r=1;r<4;r++){const t=r/4,y2=by+sag*t;ctx.beginPath();ctx.moveTo(bx,y2);ctx.lineTo(bx+bw,y2);ctx.stroke();}
  if (G.atBottom&&G.bottomTimer>0) {
    const a=G.bottomTimer/BOTTOM_WIN;
    ctx.fillStyle=`rgba(160,255,111,${a*0.9})`; ctx.font=`bold ${13+a*4}px "Share Tech Mono"`;
    ctx.textAlign='center'; ctx.fillText('▼  TAP NOW  ▼',W/2,by+55); ctx.textAlign='left';
  }
}

function drawPlayer() {
  const px=W*0.5, py=bedBaseY()-G.py;
  const fwd=isFwd(G.skillIdx>0?G.skillIdx-1:0);
  const col=fwd?'#00e5ff':'#ff6b35';

  /* Trail */
  if (!G.onBed && G.py>10) {
    for(let i=0;i<G.trail.length;i++){
      const t=G.trail[i], a=(i/G.trail.length)*0.15;
      ctx.globalAlpha=a;
      drawAthlete(t.x,t.y,G.angle-(G.trail.length-i)*22,col,false,0.5);
    }
    ctx.globalAlpha=1;
  }

  /* jump flash */
  if (G.jumpFlash>0){
    ctx.strokeStyle=`rgba(160,255,111,${G.jumpFlash*0.8})`; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.arc(px,py,32+(1-G.jumpFlash)*40,0,Math.PI*2); ctx.stroke();
  }

  /* particles */
  for(const p of G.particles){
    ctx.globalAlpha=p.life*0.6; ctx.fillStyle=p.col;
    ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;

  drawAthlete(px, py, G.angle, col, G.performing, 1.0);
}

function drawAthlete(px, py, angleDeg, color, tuck, alpha) {
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.translate(px, py);
  ctx.rotate((angleDeg%360)*Math.PI/180);
  ctx.shadowColor=color; ctx.shadowBlur=16;

  if (tuck) {
    /* ── Tuck position ── */
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.ellipse(0,2,11,13,0,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0,-15,7,7,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=color; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-8,6); ctx.lineTo(-12,15); ctx.lineTo(-6,20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8,6);  ctx.lineTo(12,15);  ctx.lineTo(6,20);  ctx.stroke();
  } else {
    /* ── Layout / straight ── */
    /* Head */
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.ellipse(0,-27,7,8,0,0,Math.PI*2); ctx.fill();
    /* Neck */
    ctx.fillRect(-3,-19,6,6);
    /* Torso */
    ctx.beginPath();
    ctx.moveTo(-7,-13); ctx.lineTo(-5,8); ctx.lineTo(5,8); ctx.lineTo(7,-13); ctx.closePath(); ctx.fill();
    /* Arms streamlined */
    ctx.strokeStyle=color; ctx.lineWidth=3.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-6,-11); ctx.quadraticCurveTo(-15,-5,-13,4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6,-11);  ctx.quadraticCurveTo(15,-5,13,4);   ctx.stroke();
    /* Hands */
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.arc(-13,4,3.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(13,4,3.5,0,Math.PI*2);  ctx.fill();
    /* Hips */
    ctx.beginPath(); ctx.ellipse(0,10,6,3,0,0,Math.PI*2); ctx.fill();
    /* Legs */
    ctx.strokeStyle=color; ctx.lineWidth=4.5;
    ctx.beginPath(); ctx.moveTo(-3,12); ctx.lineTo(-3,30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,12);  ctx.lineTo(3,30);  ctx.stroke();
    /* Feet pointed */
    ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(-3,30); ctx.lineTo(-6,37); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3,30);  ctx.lineTo(6,37);  ctx.stroke();
    /* Highlight */
    ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(-2,-10); ctx.lineTo(-2,7); ctx.stroke();
  }

  ctx.shadowBlur=0;
  ctx.restore();
}

/* ── Main loop ── */
let _last=0;
function loop(ts){
  const dt=Math.min((ts-_last)/1000,0.05); _last=ts;
  update(dt);
  ctx.clearRect(0,0,W,H);
  drawBg(); drawBed();
  if (G.phase!==Phase.TITLE) drawPlayer();
  requestAnimationFrame(loop);
}

startNewGame();
G.phase=Phase.TITLE;
requestAnimationFrame(ts=>{_last=ts;requestAnimationFrame(loop);});
