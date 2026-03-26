'use strict';
// ═══════════════════════════════════════════════
//  TRAMPOLINE GAME  v3
//  - Starts already jumping (no warmup)
//  - Fixed height, auto-maintained
//  - Portrait phone layout
//  - Side-view athlete
//  - Command: posture → (tap + twist swipe) per somersault group
// ═══════════════════════════════════════════════

const C  = document.getElementById('c');
const cx = C.getContext('2d');
let W, H;
function resize(){ W=C.width=window.innerWidth; H=C.height=window.innerHeight; }
resize(); window.addEventListener('resize', resize);

// ── Constants ─────────────────────────────────
const JUMP_HEIGHT  = 0.52;   // fraction of screen height (top of arc)
const JUMP_PERIOD  = 1.8;    // seconds per full jump cycle
const BED_Y_FRAC   = 0.78;   // bed position from top
const SKILL_COUNT  = 10;
const DIFF_BASE    = {1:0.5, 2:1.2, 3:2.0};
const DIFF_POS     = {tuck:0, pike:0.1, layout:0.2};

// ── Phase ─────────────────────────────────────
const P = {TITLE:'T', PLAY:'P', RESULT:'R'};

// ── State ─────────────────────────────────────
let G;
function newGame(){
  G={
    phase: P.PLAY,
    t: 0,              // time in current jump cycle (0..JUMP_PERIOD)
    skillIdx: 0,
    done: [],          // completed skills
    // command input
    buf: [],           // [{type:'posture'|'tap'|'twist', val}]
    step: 'posture',   // 'posture' | 'body' (tap+twist pairs)
    tapInBuf: 0,       // taps accumulated since last flush
    twistInBuf: 0,     // twists accumulated for current tap group
    locked: false,     // skill confirmed
    pending: null,     // confirmed skill object
    // score
    sDiff:0, sH:0, sTiming:0,
    // animation
    spinAngle:0, spinRate:0, spinTimer:0, spinning:false,
    // input gesture
    ptStart:null, pts:[],
    tapAccum:0, tapFlushTid:null,
  };
  updateDots();
  setCmdSeq('—');
  setCmdDir('');
  setCmdHint('姿勢を入力: ○ ＜ ／');
  setPhase('技 1 / 10（前方）');
  document.getElementById('result').classList.add('hidden');
}

// ── Skill helpers ──────────────────────────────
const isFwd = i => i%2===0;

function calcDiff(s){
  return Math.round(((DIFF_BASE[s.som]||0)+s.tw*0.1*2+DIFF_POS[s.pos]*s.som)*10)/10;
}

function skillName(s, fwd){
  const pn={tuck:'抱え込み',pike:'屈伸',layout:'伸身'}[s.pos];
  const tn=s.tw>0?`${s.tw}捻り`:'';
  return `${fwd?'前方':'後方'} ${pn}${s.som}回宙${tn}`;
}

// ── Command buffer ─────────────────────────────
// Buffer structure: array of tokens
// 'posture:tuck' | 'posture:pike' | 'posture:layout'
// 'tap:N'   (N reps of this tap group)
// 'tw:N'    (twist for preceding tap group, in 0.5 units)

function resetCmd(){
  G.buf=[]; G.step='posture'; G.tapAccum=0; G.twistInBuf=0;
  G.locked=false; G.pending=null;
  setCmdSeq('—'); setCmdDir(''); setCmdHint('姿勢を入力: ○ ＜ ／');
}

function buildDisplayStr(){
  let s='';
  for(const t of G.buf){
    if(t.startsWith('pos:')) s+={tuck:'○',pike:'＜',layout:'／'}[t.slice(4)];
    else if(t.startsWith('tap:')) s+='·'.repeat(parseInt(t.slice(4)));
    else if(t.startsWith('tw:')) {
      const v=parseFloat(t.slice(3));
      const n=Math.round(v/0.5);
      s+='〇'.repeat(Math.floor(n/2))+( n%2?'/':'' );
    }
  }
  return s||'—';
}

function parseSkill(){
  // Extract posture
  const posT=G.buf.find(t=>t.startsWith('pos:'));
  if(!posT) return null;
  const pos=posT.slice(4);
  // Extract tap+twist pairs
  let som=0, tw=0;
  for(let i=0;i<G.buf.length;i++){
    const t=G.buf[i];
    if(t.startsWith('tap:')){
      const n=parseInt(t.slice(4));
      som+=n;
      // look ahead for twist
      if(i+1<G.buf.length && G.buf[i+1].startsWith('tw:')){
        tw+=parseFloat(G.buf[i+1].slice(3));
        i++;
      }
    }
  }
  som=Math.max(1,Math.min(3,som));
  tw=Math.round(tw*2)/2;
  // Enforce direction rules
  const fwd=isFwd(G.skillIdx);
  if(fwd){
    if(tw===0||tw%1===0) tw=Math.max(0.5,tw+0.5);
    tw=Math.min(tw,3.5);
  } else {
    tw=Math.max(1,Math.min(3,Math.round(tw)));
  }
  return {pos, som, tw};
}

function commitCmd(){
  const s=parseSkill();
  if(!s||s.som<1){resetCmd();return;}
  G.pending=s; G.locked=true;
  const fwd=isFwd(G.skillIdx);
  setCmdSeq(buildDisplayStr());
  setCmdDir(fwd?'前方':'後方');
  setCmdHint('✓ 確定 — 着地で発動');
  showMsg(skillName(s,fwd),1.4);
}

// tap input (airborne)
function onAirTap(x,y){
  if(G.locked) return;
  if(G.step==='posture'){
    // no posture yet => ignore
    return;
  }
  // flush previous tap group if pending twist was expected
  G.tapAccum++;
  flashLbl(`×${G.tapAccum}`,x,y-28,'#ffd700');
  clearTimeout(G.tapFlushTid);
  G.tapFlushTid=setTimeout(()=>{
    const n=Math.min(3,G.tapAccum);
    G.tapAccum=0;
    G.buf.push(`tap:${n}`);
    setCmdSeq(buildDisplayStr());
    // wait for twist or next tap
    setCmdHint('捻り: 〇 or ／ (なければ次の宙返りをタップ)');
  },360);
}

// gesture input
function onGesture(type,x,y){
  if(G.locked) return;
  const icons={circle:'〇',slash:'／',vee:'＜'};
  flashLbl(icons[type]||type,x,y-28,'#00e5ff');

  if(G.step==='posture'){
    const posMap={circle:'tuck',vee:'pike',slash:'layout'};
    const pos=posMap[type];
    if(!pos) return;
    G.buf.push(`pos:${pos}`);
    G.step='body';
    const posName={tuck:'○ 抱え込み',pike:'＜ 屈伸',layout:'／ 伸身'}[pos];
    setCmdSeq(buildDisplayStr());
    setCmdHint('宙返り: タップ回数で入力');
    setCmdDir(isFwd(G.skillIdx)?'前方':'後方');
    return;
  }

  // In body phase: gesture = twist for last tap group
  if(G.step==='body'){
    // Flush pending taps first if tapAccum>0
    if(G.tapAccum>0){
      clearTimeout(G.tapFlushTid);
      G.buf.push(`tap:${Math.min(3,G.tapAccum)}`);
      G.tapAccum=0;
    }
    // Must have a tap token to attach twist to
    const lastTap=G.buf.slice().reverse().find(t=>t.startsWith('tap:'));
    if(!lastTap) return;
    // Check if last buf entry is already a twist => replace
    if(G.buf[G.buf.length-1].startsWith('tw:')){
      const cur=parseFloat(G.buf[G.buf.length-1].slice(3));
      G.buf[G.buf.length-1]=`tw:${cur+(type==='circle'?1:0.5)}`;
    } else {
      G.buf.push(`tw:${type==='circle'?1:0.5}`);
    }
    setCmdSeq(buildDisplayStr());
    setCmdHint('続け: タップ or 長押しで確定');
    clearTimeout(G.tapFlushTid);
    G.tapFlushTid=setTimeout(commitCmd,1200);
  }
}

// ── Update ────────────────────────────────────
function update(dt){
  if(G.phase!==P.PLAY) return;

  G.t+=dt;
  if(G.t>=JUMP_PERIOD){
    G.t-=JUMP_PERIOD;
    onCycleLand(); // bottom of jump cycle
  }

  // Spin
  if(G.spinning){
    G.spinTimer-=dt;
    G.spinAngle+=G.spinRate*dt;
    if(G.spinTimer<=0){G.spinning=false;G.spinRate=0;}
  }
}

function onCycleLand(){
  // Execute pending skill on landing
  if(G.pending && G.locked){
    execSkill();
  }
}

function execSkill(){
  const s=G.pending, fwd=isFwd(G.skillIdx);
  const d=calcDiff(s);
  G.sDiff=Math.round((G.sDiff+d)*10)/10;
  G.sH   =Math.round((G.sH+0.5)*10)/10;

  // Spin animation
  G.spinRate =s.som*360/JUMP_PERIOD;
  G.twistRate=s.tw *360/JUMP_PERIOD;
  G.spinTimer=JUMP_PERIOD*0.7;
  G.spinning =true;
  G.spinAngle=0;

  G.done.push({s,fwd,d:Math.round(d*10)/10,name:skillName(s,fwd)});
  G.pending=null; G.locked=false;
  G.buf=[]; G.step='posture'; G.tapAccum=0;
  G.skillIdx++;
  updateDots();

  if(G.skillIdx>=SKILL_COUNT){
    // final straight jump → result after one more cycle
    setPhase('ストレートジャンプ!');
    setCmdSeq('—'); setCmdHint('着地で終了!'); setCmdDir('');
    setTimeout(()=>{
      G.phase=P.RESULT;
      showResult();
    }, JUMP_PERIOD*1000+300);
  } else {
    const nf=isFwd(G.skillIdx);
    setPhase(`技 ${G.skillIdx+1} / 10（${nf?'前方':'後方'}）`);
    setCmdSeq('—'); setCmdDir(nf?'前方':'後方');
    setCmdHint('姿勢を入力: ○ ＜ ／');
    G.step='posture';
  }
}

// ── Draw ──────────────────────────────────────
function playerY(){
  // Sinusoidal arc: 0 at t=0 (bed), peak at t=JUMP_PERIOD/2
  const frac=G.t/JUMP_PERIOD; // 0..1
  const sin=Math.sin(frac*Math.PI); // 0->1->0
  return sin; // 0..1
}

function draw(){
  cx.clearRect(0,0,W,H);

  // Background
  cx.fillStyle='#07090f';
  cx.fillRect(0,0,W,H);

  // Grid
  cx.strokeStyle='rgba(0,229,255,0.04)';cx.lineWidth=1;
  for(let x=0;x<W;x+=50){cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,H);cx.stroke();}
  for(let y=0;y<H;y+=50){cx.beginPath();cx.moveTo(0,y);cx.lineTo(W,y);cx.stroke();}

  const bedY=H*BED_Y_FRAC;
  const peakY=H*(BED_Y_FRAC-JUMP_HEIGHT);

  // Height markers
  cx.setLineDash([3,7]);cx.lineWidth=1;
  cx.font='10px "Share Tech Mono"';cx.fillStyle='rgba(0,229,255,0.28)';cx.textAlign='left';
  for(let m=1;m<=6;m++){
    const ry=bedY-m*(bedY-peakY)/6; if(ry<30) break;
    cx.strokeStyle=`rgba(0,229,255,${m===6?0.15:0.07})`;
    cx.beginPath();cx.moveTo(34,ry);cx.lineTo(W-8,ry);cx.stroke();
    cx.fillText(`${m}m`,6,ry+4);
  }
  cx.setLineDash([]);

  drawBed(bedY);

  if(G.phase===P.PLAY){
    const py=playerY();
    const px=W*0.5;
    const screenY=bedY - py*(bedY-peakY);
    drawAthlete(px, screenY, G.spinAngle, G.spinning);
  }
}

function drawBed(by){
  const bw=W*0.46, bx=(W-bw)/2;

  // Frame
  cx.fillStyle='#252b3a';
  cx.fillRect(bx-10,by+6,bw+20,9);
  cx.fillRect(bx-10,by+6,10,24);
  cx.fillRect(bx+bw,by+6,10,24);

  // Springs
  cx.strokeStyle='rgba(180,210,255,0.2)';cx.lineWidth=1.5;
  for(let i=0;i<8;i++){
    const sx=bx+(i/7)*bw;
    cx.beginPath();cx.moveTo(sx,by+6);
    for(let j=1;j<=4;j++){const t=j/4,ox=j%2?2.5:-2.5;cx.lineTo(sx+ox,by+6+9*t);}
    cx.stroke();
  }

  // Bed surface
  cx.fillStyle='rgba(0,160,255,0.13)';
  cx.fillRect(bx,by,bw,7);
  cx.strokeStyle='rgba(0,229,255,0.6)';cx.lineWidth=2;
  cx.beginPath();cx.moveTo(bx,by);cx.lineTo(bx+bw,by);cx.stroke();
  // cross lines
  cx.strokeStyle='rgba(0,229,255,0.1)';cx.lineWidth=1;
  for(let i=1;i<5;i++){
    const lx=bx+(i/5)*bw;
    cx.beginPath();cx.moveTo(lx,by);cx.lineTo(lx,by+6);cx.stroke();
  }
}

// Side-view athlete (horizontal orientation)
function drawAthlete(px, py, angleDeg, tuck){
  cx.save();
  cx.translate(px,py);
  cx.rotate((angleDeg%360)*Math.PI/180);

  const fwd=isFwd(G.skillIdx>0?G.skillIdx-1:0);
  const col=fwd?'#00e5ff':'#ff6b35';
  cx.shadowColor=col;cx.shadowBlur=14;

  if(tuck){
    // Tuck: compact ball, side view
    cx.fillStyle=col;
    // body
    cx.beginPath();cx.ellipse(0,2,13,11,0,0,Math.PI*2);cx.fill();
    // head (to the right in side view)
    cx.beginPath();cx.ellipse(14,-2,7,7,0,0,Math.PI*2);cx.fill();
    // knees bent forward
    cx.strokeStyle=col;cx.lineWidth=3;cx.lineCap='round';
    cx.beginPath();cx.moveTo(-6,10);cx.lineTo(-14,18);cx.lineTo(-8,24);cx.stroke();
    cx.beginPath();cx.moveTo(2,12);cx.lineTo(-2,22);cx.lineTo(5,26);cx.stroke();
  } else {
    // Layout: streamlined side-view
    // Head (right side)
    cx.fillStyle=col;
    cx.beginPath();cx.ellipse(22,0,8,8,0,0,Math.PI*2);cx.fill();
    // Neck
    cx.fillRect(12,-3,12,6);
    // Torso (horizontal rectangle, tapered)
    cx.beginPath();
    cx.moveTo(11,-6);cx.lineTo(-12,-5);cx.lineTo(-12,5);cx.lineTo(11,6);cx.closePath();cx.fill();
    // Arms up (left side, reaching)
    cx.strokeStyle=col;cx.lineWidth=3.5;cx.lineCap='round';
    cx.beginPath();cx.moveTo(-10,-4);cx.quadraticCurveTo(-20,-2,-26,2);cx.stroke();
    cx.beginPath();cx.moveTo(-10,4);cx.quadraticCurveTo(-20,2,-24,8);cx.stroke();
    // Legs (right, extended)
    cx.strokeStyle=col;cx.lineWidth=4;
    cx.beginPath();cx.moveTo(-2,-5);cx.lineTo(-16,-6);cx.stroke();
    cx.beginPath();cx.moveTo(-2,5);cx.lineTo(-16,6);cx.stroke();
    // Feet pointed
    cx.lineWidth=3;
    cx.beginPath();cx.moveTo(-16,-6);cx.lineTo(-22,-8);cx.stroke();
    cx.beginPath();cx.moveTo(-16,6);cx.lineTo(-22,8);cx.stroke();
    // Highlight
    cx.strokeStyle='rgba(255,255,255,0.2)';cx.lineWidth=2;
    cx.beginPath();cx.moveTo(8,-3);cx.lineTo(-8,-3);cx.stroke();
  }

  cx.shadowBlur=0;
  cx.restore();
}

// ── UI helpers ────────────────────────────────
function setPhase(t){document.getElementById('phase-txt').textContent=t;}
function setCmdDir(t){document.getElementById('cmd-dir').textContent=t;}
function setCmdSeq(t){document.getElementById('cmd-seq').textContent=t;}
function setCmdHint(t){document.getElementById('cmd-hint').textContent=t;}
function updateDots(){
  const c=document.getElementById('dots');c.innerHTML='';
  for(let i=0;i<SKILL_COUNT;i++){
    const d=document.createElement('div');d.className='dot';
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
  el.textContent=text;el.style.opacity='1';
  clearTimeout(_mt);_mt=setTimeout(()=>{el.style.opacity='0';},dur*1000);
}
function flashLbl(text,x,y,col='#a0ff6f'){
  const d=document.createElement('div');
  d.className='fl';d.textContent=text;
  d.style.cssText=`left:${x}px;top:${y}px;color:${col}`;
  document.body.appendChild(d);setTimeout(()=>d.remove(),800);
}
function tapRing(x,y){
  const el=document.getElementById('tap-ring');
  el.style.left=x+'px';el.style.top=y+'px';
  el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
}

// ── Result ────────────────────────────────────
function showResult(){
  const rows=document.getElementById('r-rows');rows.innerHTML='';
  G.done.forEach((s,i)=>{
    const div=document.createElement('div');div.className='r-item';
    div.innerHTML=`<span class="rn">${i+1}</span><span class="rname">${s.name}</span><span class="rd">D${s.d.toFixed(1)}</span>`;
    rows.appendChild(div);
  });
  document.getElementById('r-total').textContent=(G.sDiff+G.sH+G.sTiming).toFixed(2);
  document.getElementById('result').classList.remove('hidden');
}

// ── Input ─────────────────────────────────────
C.addEventListener('touchstart',e=>{
  e.preventDefault();
  const t=e.touches[0];
  G.ptStart={x:t.clientX,y:t.clientY,time:Date.now()};
  G.pts=[{x:t.clientX,y:t.clientY}];
},{passive:false});

C.addEventListener('touchmove',e=>{
  e.preventDefault();
  const t=e.touches[0];G.pts.push({x:t.clientX,y:t.clientY});
},{passive:false});

C.addEventListener('touchend',e=>{
  e.preventDefault();
  const t=e.changedTouches[0];
  handleUp(t.clientX,t.clientY);
},{passive:false});

C.addEventListener('mousedown',e=>{
  G.ptStart={x:e.clientX,y:e.clientY,time:Date.now()};
  G.pts=[{x:e.clientX,y:e.clientY}];
});
C.addEventListener('mousemove',e=>{if(e.buttons) G.pts.push({x:e.clientX,y:e.clientY});});
C.addEventListener('mouseup',e=>handleUp(e.clientX,e.clientY));

function handleUp(x,y){
  if(!G.ptStart) return;
  if(G.phase===P.TITLE){startGame();return;}
  const dx=x-G.ptStart.x, dy=y-G.ptStart.y;
  const dist=Math.hypot(dx,dy), dt=Date.now()-G.ptStart.time;
  tapRing(x,y);
  if(dist<22&&dt<450) onAirTap(x,y);
  else if(dist>=22)   onGesture(classifyGesture(G.pts),x,y);
  G.ptStart=null;
}

function classifyGesture(pts){
  if(pts.length<2) return 'slash';
  const s=pts[0],e=pts[pts.length-1];
  const close=Math.hypot(e.x-s.x,e.y-s.y);
  let len=0;for(let i=1;i<pts.length;i++) len+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
  if(close<len*0.40&&len>45) return 'circle';
  if(pts.length>=4){
    const mid=pts[Math.floor(pts.length/2)];
    if(mid.y>Math.min(s.y,e.y)+24) return 'vee';
  }
  return 'slash';
}

// ── Buttons ───────────────────────────────────
document.getElementById('start-btn').addEventListener('click',startGame);
document.getElementById('retry-btn').addEventListener('click',()=>{newGame();});

function startGame(){
  document.getElementById('title').style.display='none';
  newGame();
}

// ── Main loop ─────────────────────────────────
let _last=0;
function loop(ts){
  const dt=Math.min((ts-_last)/1000,0.05);_last=ts;
  if(G) update(dt);
  draw();
  updateScore();
  requestAnimationFrame(loop);
}

// Init
G={phase:P.TITLE,ptStart:null,pts:[],sDiff:0,sH:0,sTiming:0,done:[],skillIdx:0,
   t:0,spinning:false,spinAngle:0,spinRate:0,spinTimer:0,tapAccum:0,tapFlushTid:null};
requestAnimationFrame(ts=>{_last=ts;requestAnimationFrame(loop);});
