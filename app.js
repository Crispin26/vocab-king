// ═══════════════════════════════════════════════════
// 쏙쏙 어휘왕 TOPIK I · Vocab King v3 — Application Logic
// Modularized & Upgraded: TTS, Keyboard Nav, Study Mode,
// Searchable Dictionary, POS-Matched Distractors
// ═══════════════════════════════════════════════════

// ── STATE ──
let g = {
  progDay:1, bookDay:1, words:[],
  queue:[], fails:[], sfails:[],
  ok:0, bad:0, idx:0, streak:0, best:0, answered:false,
  done:{}, dfails:{},
  user:{name:'',sid:'',nick:'',cohort:'2026-1'},
  mode:'level', // 'level', 'study', 'fr', 'exam'
  studyIdx:0
};
const KEY='topik_vk3';

// ── COHORT SYSTEM (Per-Semester Differentiation) ──
const DEFAULT_COHORTS = [
  { id: '2026-1', name: '2026 Spring Cohort (Current)', semester: 'Spring', year: 2026, active: true },
  { id: '2025-2', name: '2025 Fall Cohort', semester: 'Fall', year: 2025, active: false },
  { id: '2025-1', name: '2025 Spring Cohort', semester: 'Spring', year: 2025, active: false },
  { id: '2024-2', name: '2024 Fall Cohort', semester: 'Fall', year: 2024, active: false },
  { id: 'alumni', name: 'Alumni / Former Students', semester: 'Former', year: 2024, active: false }
];

function getCohorts(){
  try {
    const raw = localStorage.getItem('topik_cohorts');
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch(e){}
  return DEFAULT_COHORTS;
}

function saveCohorts(list){
  try { localStorage.setItem('topik_cohorts', JSON.stringify(list)); } catch(e){}
}

function getActiveCohort(){
  const list = getCohorts();
  return list.find(c => c.active) || list[0];
}

function populateCohortSelects(){
  const cohorts = getCohorts();
  const regSel = document.getElementById('reg-cohort');
  if(regSel){
    const prev = regSel.value;
    regSel.innerHTML = cohorts.map(c => `
      <option value="${c.id}" ${(prev ? prev === c.id : c.active) ? 'selected' : ''}>
        ${c.name} ${c.active ? '★ (Current)' : ''}
      </option>`).join('');
  }
  const lbSel = document.getElementById('lb-cohort-filter');
  if(lbSel){
    const prev = lbSel.value || 'all';
    lbSel.innerHTML = '<option value="all">All Semesters (전체 학기)</option>' +
      cohorts.map(c => `<option value="${c.id}" ${prev === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  }
  const admSel = document.getElementById('adm-student-cohort');
  if(admSel){
    const prev = admSel.value || 'all';
    admSel.innerHTML = '<option value="all">All Cohorts (전체 학기)</option>' +
      cohorts.map(c => `<option value="${c.id}" ${prev === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  }
}

// Student record caching for offline and admin roster view
function getCachedStudents(){
  try {
    const raw = localStorage.getItem('topik_students_cache');
    if(raw) return JSON.parse(raw);
  } catch(e){}
  return [];
}

function saveCachedStudents(list){
  try { localStorage.setItem('topik_students_cache', JSON.stringify(list)); } catch(e){}
}

function cacheStudentRecord(student){
  if(!student || !student.sid) return;
  const list = getCachedStudents();
  const idx = list.findIndex(s => s.sid === student.sid);
  const doneCount = Object.values(g.done||{}).filter(Boolean).length;
  const record = {
    sid: student.sid,
    name: student.name || 'Student',
    nick: student.nick || '',
    cohort: student.cohort || getActiveCohort().id,
    words: student.words || (g.user && g.user.sid === student.sid ? doneCount * 30 : 0),
    levels: student.levels || (g.user && g.user.sid === student.sid ? doneCount : 0),
    examPassed: student.examPassed || (g.user && g.user.sid === student.sid ? (localStorage.getItem('topik_exam_passed')==='1') : false),
    examScore: student.examScore || parseInt(localStorage.getItem('topik_exam_best')||'0', 10),
    lastSeen: new Date().toISOString()
  };
  if(idx >= 0){ list[idx] = { ...list[idx], ...record }; }
  else { list.push(record); }
  saveCachedStudents(list);
}

function save(){try{localStorage.setItem(KEY,JSON.stringify({fails:g.fails,best:g.best,done:g.done,dfails:g.dfails,user:g.user}))}catch(e){}}
function load(){
  try{
    const d=localStorage.getItem(KEY);
    if(d){
      const s=JSON.parse(d);
      g.fails=s.fails||[];
      g.best=s.best||0;
      g.done=s.done||{};
      g.dfails=s.dfails||{};
      g.user=s.user||{name:'',sid:'',nick:'',cohort:'2026-1'};
      if(!g.user.cohort) g.user.cohort = getActiveCohort().id;
    }
  }catch(e){}
}
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
function allWords(){return Object.values(VOCAB).flat().map(bd=>bd.words).flat();}
function levelKey(progDay,bookDay){return `${progDay}_${bookDay}`;}
function cleanKR(str){return String(str||'').replace(/[¹²³]/g,'').trim();}
function getSentence(w){return SENTENCES[w] || SENTENCES[cleanKR(w)] || null;}

function show(id){
  stopSpeech();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(id);
  if(el) el.classList.add('active');
  window.scrollTo(0,0);
}

// ═══════════════════════════════════════════════════
// PHASE 1: KOREAN PRONUNCIATION (Web Speech API ko-KR)
// ═══════════════════════════════════════════════════
let currentUtterance = null;

function stopSpeech(){
  try{
    if(typeof window !== 'undefined' && 'speechSynthesis' in window){
      window.speechSynthesis.cancel();
    }
    if(typeof document !== 'undefined'){
      document.querySelectorAll('.tts-btn.speaking').forEach(b=>b.classList.remove('speaking'));
    }
    currentUtterance = null;
  }catch(e){}
}

function speakKR(text, btnEl){
  const cleaned = cleanKR(text);
  if(!cleaned) return false;
  if(typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined'){
    if(btnEl){
      const orig = btnEl.textContent;
      btnEl.textContent = '🔇 Not supported';
      setTimeout(()=>{ btnEl.textContent = orig; }, 1500);
    }
    return false;
  }
  try{
    stopSpeech();
    const u = new SpeechSynthesisUtterance(cleaned);
    u.lang = 'ko-KR';
    u.rate = 0.92;
    const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const koVoice = voices.find(v=>v.lang && (v.lang.toLowerCase().startsWith('ko')));
    if(koVoice) u.voice = koVoice;
    if(btnEl) btnEl.classList.add('speaking');
    u.onend = ()=>{ if(btnEl) btnEl.classList.remove('speaking'); currentUtterance = null; };
    u.onerror = ()=>{ if(btnEl) btnEl.classList.remove('speaking'); currentUtterance = null; };
    currentUtterance = u;
    window.speechSynthesis.speak(u);
    return true;
  }catch(e){
    if(btnEl) btnEl.classList.remove('speaking');
    return false;
  }
}

function bindTTSButton(btnId, textGetter){
  const btn = document.getElementById(btnId);
  if(!btn) return;
  btn.onclick = (e)=>{
    e.stopPropagation();
    const txt = typeof textGetter === 'function' ? textGetter() : textGetter;
    if(txt) speakKR(txt, btn);
  };
}

// ═══════════════════════════════════════════════════
// PHASE 4: BETTER MULTIPLE-CHOICE DISTRACTORS
// ═══════════════════════════════════════════════════
function pickDistractors(targetWord, pool, count=3){
  const all = pool || allWords();
  const targetW = cleanKR(targetWord.w);
  const targetE = (targetWord.e||'').trim().toLowerCase();
  const seenW = new Set([targetW]);
  const seenE = new Set([targetE]);
  const result = [];

  // 1. Prefer candidates matching part of speech (t)
  const samePOS = shuffle(all.filter(x => x.t === targetWord.t));
  for(const cand of samePOS){
    if(result.length >= count) break;
    const cw = cleanKR(cand.w);
    const ce = (cand.e||'').trim().toLowerCase();
    if(!seenW.has(cw) && !seenE.has(ce)){
      seenW.add(cw);
      seenE.add(ce);
      result.push(cand);
    }
  }

  // 2. Safe fallback if POS category has fewer than count unique words
  if(result.length < count){
    const fallbackPool = shuffle(all);
    for(const cand of fallbackPool){
      if(result.length >= count) break;
      const cw = cleanKR(cand.w);
      const ce = (cand.e||'').trim().toLowerCase();
      if(!seenW.has(cw) && !seenE.has(ce)){
        seenW.add(cw);
        seenE.add(ce);
        result.push(cand);
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════
// SUPABASE DATABASE INTEGRATION
// KDU Korean Program · Vocab King v3
// ═══════════════════════════════════════════════════
const SB_URL = "https://rrcinkfoszcpoblgnkeb.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyY2lua2Zvc3pjcG9ibGdua2ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Nzk3MjIsImV4cCI6MjA5ODA1NTcyMn0.4N0kdFCraOXCO3fpf_5XF7lN65X9pIXqAODFqyd5rqI";

async function sbFetch(path, method='GET', body=null){
  const opts = {
    method,
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': method==='POST'?'return=representation,resolution=merge-duplicates':''
    }
  };
  if(body) opts.body = JSON.stringify(body);
  try{
    const r = await fetch(SB_URL + path, opts);
    if(!r.ok) throw new Error(await r.text());
    const txt = await r.text();
    return txt ? JSON.parse(txt) : [];
  }catch(e){ console.warn('DB error:', e.message); return null; }
}

async function dbRegisterStudent(user){
  if(!user.name||!user.sid) return;
  await sbFetch('/rest/v1/students', 'POST', {
    student_id: user.sid,
    name: user.name,
    nickname: user.nick||'',
    last_seen: new Date().toISOString()
  });
}

async function dbUpdateLastSeen(sid){
  if(!sid) return;
  await sbFetch(`/rest/v1/students?student_id=eq.${sid}`, 'PATCH', {
    last_seen: new Date().toISOString()
  });
}

async function dbSaveProgress(sid, progDay, bookDay, correct, wrong, pct, streak){
  if(!sid) return;
  const key = progDay + '_' + bookDay;
  await sbFetch('/rest/v1/progress', 'POST', {
    student_id: sid,
    prog_day: progDay,
    book_day: bookDay,
    level_key: key,
    completed: correct >= 24,
    correct,
    wrong,
    score_pct: pct,
    best_streak: streak,
    attempts: 1,
    updated_at: new Date().toISOString()
  });
}

async function dbSaveFailWords(sid, fails, progDay, bookDay){
  if(!sid || !fails.length) return;
  for(const f of fails){
    await sbFetch('/rest/v1/fail_words', 'POST', {
      student_id: sid,
      word_kr: f.w,
      word_en: f.e,
      word_type: f.t||'',
      prog_day: progDay,
      book_day: bookDay,
      fail_count: 1,
      last_failed: new Date().toISOString()
    });
  }
}

async function dbClearMasteredWords(sid, words){
  if(!sid || !words.length) return;
  for(const w of words){
    await sbFetch(`/rest/v1/fail_words?student_id=eq.${sid}&word_kr=eq.${encodeURIComponent(w.w)}`, 'DELETE');
  }
}

async function dbLoadLeaderboard(){
  const data = await sbFetch('/rest/v1/leaderboard?select=*&order=levels_done.desc,avg_score.desc&limit=20');
  return data || [];
}

async function dbLoadMyProgress(sid){
  if(!sid) return [];
  return await sbFetch(`/rest/v1/progress?student_id=eq.${sid}&select=*`) || [];
}

async function dbLoadMyFails(sid){
  if(!sid) return [];
  return await sbFetch(`/rest/v1/fail_words?student_id=eq.${sid}&select=*`) || [];
}

// ── REGISTER ──
function doRegister(){
  const name=document.getElementById('reg-name').value.trim();
  const sid=document.getElementById('reg-id').value.trim();
  const nick=document.getElementById('reg-nick').value.trim();
  const cohort=document.getElementById('reg-cohort')?.value || getActiveCohort().id;
  const err=document.getElementById('reg-err');
  if(!name){err.style.display='block';err.textContent='Please enter your full name.';return;}
  if(!sid){err.style.display='block';err.textContent='Please enter your student ID.';return;}
  err.style.display='none';
  g.user={name:name.toUpperCase(),sid:sid.toUpperCase(),nick:nick,cohort:cohort};
  save();
  cacheStudentRecord(g.user);
  dbRegisterStudent(g.user).then(()=>console.log('Registered in DB'));
  initHome(); show('home');
}
function skipReg(){
  g.user={name:'',sid:'',nick:'',cohort:getActiveCohort().id};
  try{localStorage.setItem('topik_skip','1');}catch(e){}
  initHome();show('home');
}

function switchTab(tab){
  const isNew = tab==='new';
  document.getElementById('panel-new').style.display=isNew?'flex':'none';
  document.getElementById('panel-login').style.display=isNew?'none':'flex';
  document.getElementById('tab-new').className = isNew ? 'tab-active' : 'tab-inactive';
  document.getElementById('tab-login').className = isNew ? 'tab-inactive' : 'tab-active';
  document.getElementById('tab-new').style.cssText = isNew
    ? 'flex:1;padding:10px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:var(--gold);color:var(--navy);transition:all 0.2s'
    : 'flex:1;padding:10px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:transparent;color:rgba(255,255,255,0.5);transition:all 0.2s';
  document.getElementById('tab-login').style.cssText = isNew
    ? 'flex:1;padding:10px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:transparent;color:rgba(255,255,255,0.5);transition:all 0.2s'
    : 'flex:1;padding:10px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;background:var(--gold);color:var(--navy);transition:all 0.2s';
}

async function doLogin(){
  const sid = document.getElementById('login-sid').value.trim().toUpperCase();
  const err = document.getElementById('login-err');
  const found = document.getElementById('login-found');
  const btn = document.getElementById('login-btn');
  if(!sid){err.style.display='block';err.textContent='Please enter your Student ID.';return;}
  err.style.display='none';
  btn.textContent='Searching... ⏳';
  btn.disabled=true;

  const data = await sbFetch('/rest/v1/students?student_id=eq.'+encodeURIComponent(sid)+'&select=*');
  btn.disabled=false;

  if(!data || data.length===0){
    err.style.display='block';
    err.textContent='Student ID not found. Please register as a new student.';
    btn.textContent='Find My Profile 🔍';
    found.style.display='none';
    return;
  }

  const student = data[0];
  found.style.display='block';
  document.getElementById('login-found-name').textContent=student.name+(student.nickname?' ('+student.nickname+')':'');
  btn.textContent='✓ Continue as '+( student.nickname||student.name.split(' ')[0])+' →';
  btn.onclick=()=>completeLogin(student);
}

async function completeLogin(student){
  g.user = {name:student.name, sid:student.student_id, nick:student.nickname||'', cohort:student.cohort||getActiveCohort().id};
  save();
  cacheStudentRecord(g.user);

  const [dbProgress, dbFails] = await Promise.all([
    dbLoadMyProgress(student.student_id),
    dbLoadMyFails(student.student_id)
  ]);

  if(dbProgress && dbProgress.length>0){
    dbProgress.forEach(p=>{
      g.done[p.level_key] = p.completed;
      g.dfails[p.level_key] = p.wrong||0;
    });
  }

  if(dbFails && dbFails.length>0){
    g.fails=[];
    dbFails.forEach(f=>{
      g.fails.push({w:f.word_kr, e:f.word_en, t:f.word_type||'명사'});
    });
  }

  if(dbProgress){
    const maxStreak=Math.max(0,...dbProgress.map(p=>p.best_streak||0));
    if(maxStreak>g.best) g.best=maxStreak;
  }

  save();
  dbUpdateLastSeen(student.student_id);
  initHome();
  show('home');
}

// ── HOME (With Phase 2 "Study 30 Words" & "Start Quiz" options) ──
function initHome(){
  load();
  populateCohortSelects();
  const disp=g.user.nick||g.user.name.split(' ')[0]||'';
  const cohortObj = getCohorts().find(c=>c.id===g.user.cohort);
  const cohortName = cohortObj ? cohortObj.name.replace(' (Current)','') : (g.user.cohort || '2026 Spring');
  const isCurrent = cohortObj ? cohortObj.active : true;
  document.getElementById('welcome-strip').innerHTML=disp
    ? `<span>👋 안녕하세요, <strong>${disp}</strong>!</span> <span class="cohort-badge ${isCurrent?'current':'alumni'}">${cohortName}</span>`
    : '';

  const totalDone=Object.values(g.done).filter(Boolean).length;
  document.getElementById('sL').textContent=totalDone;
  document.getElementById('sF').textContent=g.fails.length;
  document.getElementById('sS').textContent=g.best;
  document.getElementById('fcnt').textContent=g.fails.length;
  document.getElementById('fail-btn').style.display=g.fails.length>0?'flex':'none';

  const list=document.getElementById('days-list');
  list.innerHTML='';

  for(let pd=1;pd<=5;pd++){
    const grp=document.createElement('div');
    grp.className='day-group';
    const lbl=DAY_LABELS[pd];
    const bdObjs=VOCAB[pd];

    const done=bdObjs.filter(bd=>g.done[levelKey(pd,bd.bd)]).length;
    const hasFail=bdObjs.some(bd=>g.dfails[levelKey(pd,bd.bd)]>0);

    grp.innerHTML=`
      <div class="day-header" onclick="toggleDay(this)">
        <div class="dh-left">
          <div class="dh-num">${pd}</div>
          <div>
            <div class="dh-title">${lbl.title}</div>
            <div class="dh-sub">${done}/${bdObjs.length} levels done · ${lbl.sub}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${done===bdObjs.length?'<span style="font-size:11px;font-weight:700;color:var(--green)">✓ Done</span>':hasFail?'<span style="font-size:11px;font-weight:700;color:var(--red)">Has fails</span>':''}
          <div class="dh-arrow">▼</div>
        </div>
      </div>
      <div class="sub-levels" id="sub-${pd}"></div>`;
    list.appendChild(grp);

    const subContainer=grp.querySelector(`#sub-${pd}`);
    bdObjs.forEach(bdObj=>{
      const k=levelKey(pd,bdObj.bd);
      const isDone=!!g.done[k];
      const fails=g.dfails[k]||0;
      const wCount=bdObj.words.length;
      const btn=document.createElement('div');
      btn.className='sub-btn'+(isDone?' done':fails>0?' hasfail':'');
      btn.innerHTML=`
        <div class="sb-left" title="Study ${BOOK_LABELS[bdObj.bd]||'Day '+bdObj.bd}">
          <div class="sb-dot"></div>
          <div>
            <div class="sb-name">${BOOK_LABELS[bdObj.bd]||'Day '+bdObj.bd} ${isDone?'<span style="color:var(--green);font-size:11px">✓</span>':''}</div>
            <div class="sb-words">${wCount} words${fails>0?' · '+fails+' fails':''}</div>
          </div>
        </div>
        <div class="sb-actions">
          <button type="button" class="sb-act-btn sb-study-btn">📖 Study ${wCount} Words</button>
          <button type="button" class="sb-act-btn sb-quiz-btn">✍️ Start Quiz</button>
        </div>`;
      const leftEl = btn.querySelector('.sb-left');
      const studyBtn = btn.querySelector('.sb-study-btn');
      const quizBtn = btn.querySelector('.sb-quiz-btn');
      leftEl.addEventListener('click',()=>startStudyLevel(pd,bdObj.bd,bdObj.words));
      studyBtn.addEventListener('click',(e)=>{e.stopPropagation();startStudyLevel(pd,bdObj.bd,bdObj.words);});
      quizBtn.addEventListener('click',(e)=>{e.stopPropagation();startLevel(pd,bdObj.bd,bdObj.words);});
      subContainer.appendChild(btn);
    });
  }
}

function toggleDay(header){
  const grp=header.parentElement;
  const wasOpen=grp.classList.contains('open');
  document.querySelectorAll('.day-group').forEach(g2=>g2.classList.remove('open','active-day'));
  if(!wasOpen){grp.classList.add('open','active-day');}
}

// ═══════════════════════════════════════════════════
// PHASE 2: STUDY MODE ("Study 30 Words" before Quiz)
// ═══════════════════════════════════════════════════
function startStudyLevel(progDay, bookDay, wordsArr){
  g.progDay = progDay;
  g.bookDay = bookDay;
  g.words = wordsArr;
  g.studyIdx = 0;
  g.mode = 'study';
  document.getElementById('nxtbtn').onclick = null;
  show('game');
  renderStudyCard();
}

function renderStudyCard(){
  if(!g.words || g.words.length === 0) return;
  if(g.studyIdx < 0) g.studyIdx = 0;
  if(g.studyIdx >= g.words.length) g.studyIdx = g.words.length - 1;

  const word = g.words[g.studyIdx];
  const s = getSentence(word.w);
  const total = g.words.length;

  document.getElementById('glbl').textContent = `Day ${g.progDay} · ${BOOK_LABELS[g.bookDay]||'Book Day '+g.bookDay} (Study)`;
  document.getElementById('pfill').style.width = (((g.studyIdx + 1) / total) * 100) + '%';
  document.getElementById('ptxt').textContent = (g.studyIdx + 1) + '/' + total;
  document.getElementById('strk').textContent = '📖 Study';
  document.getElementById('qchip').textContent = `📖 Study Mode · Card ${g.studyIdx + 1} of ${total}`;

  const bd = document.getElementById('tbadge');
  bd.textContent = word.t || '';
  bd.style.display = word.t ? 'inline-block' : 'none';

  const dw = document.getElementById('dword');
  dw.className = 'dkr';
  dw.style.fontSize = '';
  dw.textContent = word.w;
  document.getElementById('dinstr').textContent = word.e;

  const ttsWordBtn = document.getElementById('tts-word-btn');
  if(ttsWordBtn){
    ttsWordBtn.style.display = 'inline-flex';
    ttsWordBtn.onclick = ()=>speakKR(word.w, ttsWordBtn);
  }

  // Hide quiz options and typing box
  document.getElementById('opts').style.display = 'none';
  document.getElementById('opts').innerHTML = '';
  document.getElementById('twrap').style.display = 'none';
  const kbdHint = document.getElementById('kbd-hint');
  if(kbdHint) kbdHint.textContent = '💡 Keys: ←/→ or Enter/Space to navigate cards · R for audio';

  // Configure feedback card to show example sentence if available
  const fbcard = document.getElementById('fbcard');
  const sp = document.getElementById('sent-panel');
  const tcp = document.getElementById('tc-panel');
  const nxtbtn = document.getElementById('nxtbtn');

  if(s){
    fbcard.className = 'fbcard show';
    document.getElementById('fbv').textContent = '';
    document.getElementById('fba').textContent = word.w + ' = ' + word.e;
    document.getElementById('fbtp').textContent = word.t || '';
    const ttsFbBtn = document.getElementById('tts-fb-btn');
    if(ttsFbBtn){
      ttsFbBtn.style.display = 'inline-flex';
      ttsFbBtn.onclick = ()=>speakKR(word.w, ttsFbBtn);
    }
    sp.style.display = 'flex';
    document.getElementById('sent-kr').textContent = s[0];
    document.getElementById('sent-en').textContent = s[1];
    const ttsSentBtn = document.getElementById('tts-sent-btn');
    if(ttsSentBtn){
      ttsSentBtn.style.display = 'inline-flex';
      ttsSentBtn.onclick = ()=>speakKR(s[0], ttsSentBtn);
    }
    if(tcp && s[2]){
      tcp.style.display = 'flex';
      document.getElementById('tc-txt').textContent = s[2];
      const tcAns = document.getElementById('tc-ans');
      const tcRev = document.getElementById('tc-rev');
      const ttsTcBtn = document.getElementById('tts-tc-btn');
      tcAns.textContent = s[3] || '';
      tcAns.style.display = 'none';
      if(ttsTcBtn){
        ttsTcBtn.style.display = 'none';
        ttsTcBtn.onclick = ()=>speakKR(s[3], ttsTcBtn);
      }
      tcRev.style.display = 'inline-block';
      tcRev.textContent = 'Reveal Korean 👁';
      tcRev.disabled = false;
      tcRev.onclick = ()=>{
        tcAns.style.display = 'block';
        tcRev.textContent = '✓ Revealed';
        tcRev.disabled = true;
        if(ttsTcBtn && s[3]) ttsTcBtn.style.display = 'inline-flex';
      };
    }else if(tcp){
      tcp.style.display = 'none';
    }
    nxtbtn.style.display = 'none';
  }else{
    fbcard.className = 'fbcard';
    sp.style.display = 'none';
    if(tcp) tcp.style.display = 'none';
  }

  // Show Study Mode Navigation controls
  const studyNav = document.getElementById('study-nav');
  if(studyNav){
    studyNav.style.display = 'flex';
    const prevBtn = document.getElementById('study-prev-btn');
    const nextBtn = document.getElementById('study-next-btn');
    const quizBtn = document.getElementById('study-quiz-btn');

    prevBtn.disabled = g.studyIdx === 0;
    prevBtn.onclick = ()=>{
      if(g.studyIdx > 0){ g.studyIdx--; renderStudyCard(); }
    };

    if(g.studyIdx < total - 1){
      nextBtn.textContent = 'Next Word →';
      nextBtn.onclick = ()=>{ g.studyIdx++; renderStudyCard(); };
    }else{
      nextBtn.textContent = '✓ Finish & Start Quiz →';
      nextBtn.onclick = ()=>startLevel(g.progDay, g.bookDay, g.words);
    }

    quizBtn.textContent = `✍️ Start Quiz (${total} Words)`;
    quizBtn.onclick = ()=>startLevel(g.progDay, g.bookDay, g.words);
  }
}

// ═══════════════════════════════════════════════════
// PHASE 3: SEARCHABLE DICTIONARY (1,470 Words)
// ═══════════════════════════════════════════════════
let dictIndex = null;
let dictRenderLimit = 60;

function buildDictionaryIndex(){
  if(dictIndex) return dictIndex;
  const list = [];
  for(let pd=1; pd<=5; pd++){
    const bds = VOCAB[pd] || [];
    bds.forEach(bdObj=>{
      bdObj.words.forEach(wObj=>{
        list.push({
          w: wObj.w,
          wClean: cleanKR(wObj.w),
          e: wObj.e,
          eLower: (wObj.e||'').toLowerCase(),
          t: wObj.t || '명사',
          progDay: pd,
          bookDay: bdObj.bd,
          levelKey: levelKey(pd, bdObj.bd)
        });
      });
    });
  }
  dictIndex = list;
  return dictIndex;
}

function getWordStatus(item){
  const inFails = g.fails.some(f => cleanKR(f.w) === item.wClean && f.e === item.e);
  if(inFails) return 'review';
  if(g.done && g.done[item.levelKey]) return 'mastered';
  return 'new';
}

function openDictionary(){
  load();
  const idx = buildDictionaryIndex();
  const posSelect = document.getElementById('dict-pos');
  const daySelect = document.getElementById('dict-day');

  if(posSelect && posSelect.options.length <= 1){
    const posSet = Array.from(new Set(idx.map(x=>x.t))).filter(Boolean);
    posSet.forEach(pos=>{
      const opt = document.createElement('option');
      opt.value = pos;
      opt.textContent = pos;
      posSelect.appendChild(opt);
    });
  }

  if(daySelect && daySelect.options.length <= 1){
    for(let bd=1; bd<=49; bd++){
      const opt = document.createElement('option');
      opt.value = String(bd);
      opt.textContent = BOOK_LABELS[bd] || ('Book Day ' + bd);
      daySelect.appendChild(opt);
    }
  }

  dictRenderLimit = 60;
  renderDictionary();
  show('dictionary');
}

function renderDictionary(){
  const idx = buildDictionaryIndex();
  const qRaw = (document.getElementById('dict-search')?.value || '').trim().toLowerCase();
  const posFilter = document.getElementById('dict-pos')?.value || '';
  const dayFilter = document.getElementById('dict-day')?.value || '';
  const statusFilter = document.getElementById('dict-status')?.value || '';

  let masteredTotal = 0, reviewTotal = 0, newTotal = 0;

  const filtered = idx.filter(item=>{
    const st = getWordStatus(item);
    if(st === 'mastered') masteredTotal++;
    else if(st === 'review') reviewTotal++;
    else newTotal++;

    if(posFilter && item.t !== posFilter) return false;
    if(dayFilter && String(item.bookDay) !== dayFilter) return false;
    if(statusFilter && st !== statusFilter) return false;
    if(qRaw){
      const matchKR = item.w.toLowerCase().includes(qRaw) || item.wClean.toLowerCase().includes(qRaw);
      const matchEN = item.eLower.includes(qRaw);
      if(!matchKR && !matchEN) return false;
    }
    return true;
  });

  const countEl = document.getElementById('dict-count');
  const sumEl = document.getElementById('dict-summary');
  if(countEl) countEl.textContent = `Showing ${filtered.length} of ${idx.length} words`;
  if(sumEl) sumEl.textContent = `✓ ${masteredTotal} Mastered · ⚠ ${reviewTotal} Review · • ${newTotal} New`;

  const listEl = document.getElementById('dict-list');
  if(!listEl) return;
  listEl.innerHTML = '';

  if(filtered.length === 0){
    listEl.innerHTML = '<div class="lb-empty">No matching words found. Try clearing some filters! 🔍</div>';
    return;
  }

  const slice = filtered.slice(0, dictRenderLimit);
  const frag = document.createDocumentFragment();

  slice.forEach(item=>{
    const st = getWordStatus(item);
    const stLabel = st === 'mastered' ? '✓ Mastered' : st === 'review' ? '⚠ Needs Review' : '• New';
    const stClass = st === 'mastered' ? 'status-mastered' : st === 'review' ? 'status-review' : 'status-new';
    const sent = getSentence(item.w);

    const card = document.createElement('div');
    card.className = 'dict-card';
    card.innerHTML = `
      <div class="dict-card-top">
        <div class="dict-word-group">
          <span class="dict-kr">${item.w}</span>
          <button type="button" class="tts-btn tts-sm dict-tts" title="Listen to ${item.wClean}">🔊</button>
          <span class="dict-en">${item.e}</span>
        </div>
        <div class="dict-badges">
          <span class="dict-pos">${item.t}</span>
          <span class="dict-day">Day ${item.progDay} · BD ${item.bookDay}</span>
          <span class="status-badge ${stClass}">${stLabel}</span>
        </div>
      </div>
      ${sent ? `<div class="dict-sent"><strong>${sent[0]}</strong><span>${sent[1]}</span></div>` : ''}
    `;
    const ttsBtn = card.querySelector('.dict-tts');
    if(ttsBtn){
      ttsBtn.addEventListener('click', ()=>speakKR(item.w, ttsBtn));
    }
    frag.appendChild(card);
  });

  listEl.appendChild(frag);

  if(filtered.length > dictRenderLimit){
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'dict-more-btn';
    moreBtn.textContent = `Show More Words (${filtered.length - dictRenderLimit} remaining) ↓`;
    moreBtn.onclick = ()=>{
      dictRenderLimit += 100;
      renderDictionary();
    };
    listEl.appendChild(moreBtn);
  }
}

// ── LEADERBOARD WITH COHORT FILTERING ──
let cachedLBData = [];

async function renderLB(){
  load();
  populateCohortSelects();
  const top3 = document.getElementById('lb-top3');
  const rest = document.getElementById('lb-list');
  if(top3) top3.innerHTML='<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.4);padding:20px">Loading... ⏳</div>';
  if(rest) rest.innerHTML='';

  const [lbRaw, progRaw, cachedStuds] = await Promise.all([
    dbLoadLeaderboard(),
    sbFetch('/rest/v1/progress?select=student_id,correct&limit=2000'),
    Promise.resolve(getCachedStudents())
  ]);

  const cohortMap = {};
  cachedStuds.forEach(s => { if(s.sid) cohortMap[s.sid] = s.cohort; });

  const wordMap = {};
  (progRaw || []).forEach(r => {
    wordMap[r.student_id] = (wordMap[r.student_id] || 0) + (r.correct || 0);
  });

  let combined = [...(lbRaw || [])];
  if(g.user.name && g.user.sid && !combined.some(r => r.student_id === g.user.sid)){
    const totalDone = Object.values(g.done).filter(Boolean).length;
    combined.push({
      student_id: g.user.sid,
      name: g.user.name,
      nickname: g.user.nick,
      cohort: g.user.cohort || getActiveCohort().id,
      levels_done: totalDone
    });
    wordMap[g.user.sid] = wordMap[g.user.sid] || (totalDone * 24);
  }

  const activeCohortId = getActiveCohort().id;

  cachedLBData = combined.map(r => {
    const studentCohort = r.cohort || cohortMap[r.student_id] || (r.student_id === g.user.sid ? g.user.cohort : activeCohortId);
    return {
      name: r.name,
      sid: r.student_id,
      nick: r.nickname || '',
      cohort: studentCohort,
      words: wordMap[r.student_id] || (r.levels_done ? r.levels_done * 24 : 0),
      levels: r.levels_done || 0
    };
  }).sort((a,b) => b.words - a.words);

  const filterSelect = document.getElementById('lb-cohort-filter');
  const selectedCohort = filterSelect ? filterSelect.value : 'all';
  displayLBList(selectedCohort);
}

function filterLBByCohort(cohortId){
  displayLBList(cohortId);
}

function displayLBList(cohortId){
  const top3 = document.getElementById('lb-top3');
  const rest = document.getElementById('lb-list');
  if(!top3 || !rest) return;

  const cohorts = getCohorts();
  const filtered = (!cohortId || cohortId === 'all')
    ? cachedLBData
    : cachedLBData.filter(item => item.cohort === cohortId);

  if(filtered.length === 0){
    top3.innerHTML = '';
    rest.innerHTML = '<div class="lb-empty">No students found in this cohort.<br>Complete vocabulary levels to appear on the board! 🏆</div>';
    return;
  }

  const podiumOrder = [filtered[1], filtered[0], filtered[2]].filter(Boolean);
  const podiumMedals = ['🥈', '🥇', '🥉'];
  top3.innerHTML = podiumOrder.map((e, i) => {
    const cObj = cohorts.find(c => c.id === e.cohort);
    const cName = cObj ? cObj.name.replace(' (Current)', '') : (e.cohort || '2026 Spring');
    const isCur = cObj ? cObj.active : true;
    return `
      <div class="lb-podium${podiumMedals[i] === '🥇' ? ' p1' : ''}">
        <div class="lb-medal">${podiumMedals[i]}</div>
        <div class="lb-pname">${e.nick || e.name.split(' ')[0]}</div>
        <div class="lb-pscore">${e.words}</div>
        <div class="lb-psub">words mastered</div>
        <div style="margin-top:6px"><span class="cohort-badge ${isCur ? 'current' : 'alumni'}" style="font-size:10px;padding:2px 8px">${cName}</span></div>
      </div>`;
  }).join('');

  rest.innerHTML = filtered.slice(3).map((e, i) => {
    const cObj = cohorts.find(c => c.id === e.cohort);
    const cName = cObj ? cObj.name.replace(' (Current)', '') : (e.cohort || '2026 Spring');
    const isCur = cObj ? cObj.active : true;
    return `
      <div class="lb-row">
        <div class="lb-rank">${i + 4}</div>
        <div class="lb-info">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="lb-name">${e.nick || e.name.split(' ')[0]}</span>
            <span class="cohort-badge ${isCur ? 'current' : 'alumni'}" style="font-size:10px;padding:1px 6px">${cName}</span>
          </div>
          <div class="lb-meta">${e.name} · ${e.sid || 'Guest'}</div>
        </div>
        <div class="lb-score">${e.words} words</div>
      </div>`;
  }).join('') || '';
}

// ── GAME (QUIZ MODE) ──
const QT=['mc-kr-en','mc-kr-en','mc-en-kr','mc-kr-en','type-kr-en','mc-en-kr','mc-kr-en','type-en-kr'];

function startLevel(progDay,bookDay,wordsArr){
  g.progDay=progDay; g.bookDay=bookDay;
  g.words=wordsArr;
  g.queue=shuffle([...wordsArr]);
  g.sfails=[]; g.ok=g.bad=g.idx=g.streak=0; g.answered=false;
  g.mode='level';
  document.getElementById('nxtbtn').onclick = null;
  document.getElementById('nxtbtn').style.display = 'block';
  const studyNav = document.getElementById('study-nav');
  if(studyNav) studyNav.style.display = 'none';
  document.getElementById('glbl').textContent=`Day ${progDay} · ${BOOK_LABELS[bookDay]||'Book Day '+bookDay}`;
  show('game'); renderQ();
}

// ============================================================
// FAIL REVIEW SYSTEM — Batch of 10 · Study → Test → Results
// ============================================================
const FR_BATCH = 10;

function startFailReview(words){
  const pool = words || g.fails;
  if(!pool || pool.length===0) return;
  g.fr = {
    pool:         [...pool],
    batch:        pool.slice(0, FR_BATCH),
    batchNum:     1,
    totalBatches: Math.ceil(pool.length / FR_BATCH),
    studyIdx:     0,
    testIdx:      0,
    mastered:     [],
    struggling:   [],
    revealShown:  false
  };
  g.mode = 'fr';
  const studyNav = document.getElementById('study-nav');
  if(studyNav) studyNav.style.display = 'none';
  document.getElementById('nxtbtn').style.display = 'block';
  frStudyStart();
}

function frStudyStart(){
  g.fr.studyIdx = 0;
  frStudyCard();
}

function frStudyCard(){
  const fr = g.fr;
  if(fr.studyIdx >= fr.batch.length){
    frTestStart();
    return;
  }
  const word = fr.batch[fr.studyIdx];
  const s = getSentence(word.w);

  document.getElementById('glbl').textContent =
    `📚 Study ${fr.batchNum}/${fr.totalBatches} · Word ${fr.studyIdx+1}/${fr.batch.length}`;
  document.getElementById('pfill').style.width =
    ((fr.studyIdx / fr.batch.length)*100)+'%';
  document.getElementById('ptxt').textContent =
    (fr.studyIdx+1)+'/'+fr.batch.length;
  document.getElementById('strk').textContent = '📖 Study';
  document.getElementById('qchip').textContent = '📖 Stage 1 — Study This Word';
  document.getElementById('tbadge').textContent = word.t||'';
  document.getElementById('tbadge').style.display = word.t?'inline-block':'none';
  document.getElementById('dword').className = 'dkr';
  document.getElementById('dword').style.fontSize = '';
  document.getElementById('dword').textContent = word.w;
  document.getElementById('dinstr').textContent = word.e;

  const ttsWordBtn = document.getElementById('tts-word-btn');
  if(ttsWordBtn){
    ttsWordBtn.style.display = 'inline-flex';
    ttsWordBtn.onclick = ()=>speakKR(word.w, ttsWordBtn);
  }
  const ttsFbBtn = document.getElementById('tts-fb-btn');
  if(ttsFbBtn) ttsFbBtn.style.display = 'none';

  document.getElementById('opts').style.display = 'none';
  document.getElementById('opts').innerHTML = '';
  document.getElementById('twrap').style.display = 'none';
  document.getElementById('tc-panel').style.display = 'none';

  if(s){
    document.getElementById('sent-panel').style.display = 'flex';
    document.getElementById('sent-kr').textContent = s[0];
    document.getElementById('sent-en').textContent = s[1];
    const ttsSentBtn = document.getElementById('tts-sent-btn');
    if(ttsSentBtn){
      ttsSentBtn.style.display = 'inline-flex';
      ttsSentBtn.onclick = ()=>speakKR(s[0], ttsSentBtn);
    }
  }else{
    document.getElementById('sent-panel').style.display = 'none';
  }

  const tcPanel = document.getElementById('tc-panel');
  const tcTxt   = document.getElementById('tc-txt');
  const tcAns   = document.getElementById('tc-ans');
  const tcRev   = document.getElementById('tc-rev');
  const ttsTcBtn = document.getElementById('tts-tc-btn');
  if(s && s[2]){
    tcPanel.style.display = 'flex';
    tcTxt.textContent = s[2];
    tcAns.textContent = s[3]||'';
    tcAns.style.display = 'none';
    if(ttsTcBtn){
      ttsTcBtn.style.display = 'none';
      ttsTcBtn.onclick = ()=>speakKR(s[3], ttsTcBtn);
    }
    tcRev.style.display = 'inline-block';
    tcRev.textContent = 'Reveal Korean 👁';
    tcRev.onclick = ()=>{
      tcAns.style.display = 'block';
      tcRev.textContent = '✓ Revealed';
      tcRev.disabled = true;
      if(ttsTcBtn && s[3]) ttsTcBtn.style.display = 'inline-flex';
    };
    tcRev.disabled = false;
  }else{
    tcPanel.style.display = 'none';
  }

  document.getElementById('fbv').textContent = '';
  document.getElementById('fba').textContent = '';
  document.getElementById('fbtp').textContent = '';
  document.getElementById('fbv').className = 'fbv';
  document.getElementById('fbcard').className = 'fbcard show';

  const nxtbtn = document.getElementById('nxtbtn');
  nxtbtn.style.display = 'block';
  nxtbtn.textContent = fr.studyIdx < fr.batch.length-1 ? 'Next Word →' : 'Start Test ✓';
  nxtbtn.onclick = ()=>{
    fr.studyIdx++;
    frStudyCard();
  };

  show('game');
}

function frTestStart(){
  g.fr.testIdx = 0;
  g.fr.mastered = [];
  g.fr.struggling = [];
  frTestCard();
}

function frTestCard(){
  const fr = g.fr;
  if(fr.testIdx >= fr.batch.length){
    frShowResults();
    return;
  }
  const word = fr.batch[fr.testIdx];

  document.getElementById('glbl').textContent =
    `✍️ Test ${fr.batchNum}/${fr.totalBatches} · Word ${fr.testIdx+1}/${fr.batch.length}`;
  document.getElementById('pfill').style.width =
    ((fr.testIdx / fr.batch.length)*100)+'%';
  document.getElementById('ptxt').textContent =
    (fr.testIdx+1)+'/'+fr.batch.length;
  document.getElementById('strk').textContent = '✍️ Test';
  document.getElementById('qchip').textContent = '✍️ Stage 2 — Type the English meaning';
  document.getElementById('tbadge').textContent = word.t||'';
  document.getElementById('tbadge').style.display = word.t?'inline-block':'none';
  document.getElementById('dword').className = 'dkr';
  document.getElementById('dword').style.fontSize = '';
  document.getElementById('dword').textContent = word.w;
  document.getElementById('dinstr').textContent = 'Type the English meaning — no hints!';

  const ttsWordBtn = document.getElementById('tts-word-btn');
  if(ttsWordBtn){
    ttsWordBtn.style.display = 'inline-flex';
    ttsWordBtn.onclick = ()=>speakKR(word.w, ttsWordBtn);
  }

  document.getElementById('opts').style.display = 'none';
  document.getElementById('opts').innerHTML = '';
  document.getElementById('twrap').style.display = 'flex';
  document.getElementById('tfield').value = '';
  document.getElementById('tfield').className = 'tfield';
  document.getElementById('tfield').placeholder = 'Type English meaning...';
  document.getElementById('sent-panel').style.display = 'none';
  document.getElementById('tc-panel').style.display = 'none';
  document.getElementById('fbcard').className = 'fbcard';

  document.getElementById('chkbtn').disabled = false;
  document.getElementById('chkbtn').onclick = ()=>frCheckAnswer();

  setTimeout(()=>document.getElementById('tfield').focus(), 100);
  show('game');
}

function frCheckAnswer(){
  const fr = g.fr;
  const word = fr.batch[fr.testIdx];
  const typed = document.getElementById('tfield').value.trim().toLowerCase();
  const correct = word.e.toLowerCase();

  const ok = typed.length > 0 && (
    typed === correct
    || (correct.includes(typed) && typed.length >= 3)
    || (typed.includes(correct.split('/')[0].trim()) && correct.split('/')[0].trim().length > 0)
    || correct.split('/').some(p => typed.includes(p.trim().toLowerCase()) && p.trim().length >= 3)
  );

  const fb  = document.getElementById('fbcard');
  const fbv = document.getElementById('fbv');
  const fba = document.getElementById('fba');

  const ttsFbBtn = document.getElementById('tts-fb-btn');
  if(ttsFbBtn){
    ttsFbBtn.style.display = 'inline-flex';
    ttsFbBtn.onclick = ()=>speakKR(word.w, ttsFbBtn);
  }

  if(ok){
    fb.className  = 'fbcard show sc';
    fbv.className = 'fbv c';
    fbv.textContent = '✓ Correct! Mastered! 🎉';
    fba.textContent = word.w + ' = ' + word.e;
    fr.mastered.push(word);
  }else{
    fb.className  = 'fbcard show sw';
    fbv.className = 'fbv w';
    fbv.textContent = '✗ Wrong — needs more study';
    fba.textContent = 'Answer: ' + word.e;
    fr.struggling.push(word);
    const s = getSentence(word.w);
    if(s){
      document.getElementById('sent-panel').style.display='flex';
      document.getElementById('sent-kr').textContent=s[0];
      document.getElementById('sent-en').textContent=s[1];
      const ttsSentBtn = document.getElementById('tts-sent-btn');
      if(ttsSentBtn){
        ttsSentBtn.style.display = 'inline-flex';
        ttsSentBtn.onclick = ()=>speakKR(s[0], ttsSentBtn);
      }
    }
  }

  document.getElementById('chkbtn').disabled = true;
  const nxtbtn = document.getElementById('nxtbtn');
  nxtbtn.style.display = 'block';
  nxtbtn.textContent = fr.testIdx < fr.batch.length-1 ? 'Next Word →' : 'See Results →';
  nxtbtn.onclick = ()=>{
    fr.testIdx++;
    frTestCard();
  };
}

function frShowResults(){
  const fr = g.fr;
  const masteredCount   = fr.mastered.length;
  const strugglingCount = fr.struggling.length;

  const masteredSet = new Set(fr.mastered.map(w=>w.w));
  g.fails = g.fails.filter(f=>!masteredSet.has(f.w));
  if(g.user.sid && fr.mastered.length>0){
    dbClearMasteredWords(g.user.sid, fr.mastered)
      .then(()=>console.log('Mastered words cleared from DB'));
  }
  save();

  const pct = Math.round((masteredCount / fr.batch.length)*100);
  document.getElementById('rpct').textContent = pct+'%';
  document.getElementById('sring').style.setProperty('--pct', pct+'%');
  document.getElementById('rc').textContent = masteredCount;
  document.getElementById('rw').textContent = strugglingCount;
  document.getElementById('rt').textContent = fr.batch.length;
  document.getElementById('rbadge').textContent =
    `⚡ Batch ${fr.batchNum}/${fr.totalBatches} Complete`;
  document.getElementById('rtitle').textContent =
    masteredCount===fr.batch.length ? '🎉 Perfect Batch!' :
    masteredCount>0 ? '📈 Good Progress!' : '📚 Keep Studying!';
  document.getElementById('rsub').textContent =
    masteredCount===fr.batch.length
      ? `All ${masteredCount} words mastered! ✨`
      : `${masteredCount} mastered · ${strugglingCount} still need work`;
  const ru = document.getElementById('r-user');
  ru.textContent = g.user.name ? (g.user.nick||g.user.name.split(' ')[0]) : '';

  const fpanel = document.getElementById('fpanel');
  const flist  = document.getElementById('flist');
  if(strugglingCount>0){
    fpanel.style.display = 'block';
    const fptitleEl = document.getElementById('fptitle');
    if(fptitleEl) fptitleEl.textContent = '📚 Still Struggling';
    flist.innerHTML = fr.struggling.map(f=>
      `<div class="frow"><span class="fkr">${f.w}</span><span class="fen">${f.e}</span></div>`
    ).join('');
  }else{
    fpanel.style.display = 'none';
  }

  const retryBtn = document.getElementById('r-retry');
  const nextBtn  = document.getElementById('r-next');
  const homeBtn  = document.getElementById('r-home');

  if(strugglingCount>0){
    retryBtn.style.display = 'block';
    retryBtn.textContent = `📚 Re-study ${strugglingCount} Struggling Word${strugglingCount>1?'s':''}`;
    retryBtn.onclick = ()=>{
      g.fr = {
        pool:         g.fails,
        batch:        fr.struggling,
        batchNum:     fr.batchNum,
        totalBatches: fr.totalBatches,
        studyIdx:     0,
        testIdx:      0,
        mastered:     [],
        struggling:   [],
        revealShown:  false
      };
      g.mode='fr';
      frStudyStart();
    };
  }else{
    retryBtn.style.display = 'none';
  }

  const remainingFails = g.fails.length;
  const hasNextBatch = remainingFails > 0 && fr.batchNum < fr.totalBatches;

  if(hasNextBatch){
    nextBtn.textContent = `Next Batch →  (${remainingFails} words left)`;
    nextBtn.onclick = ()=>{
      const nextPool = g.fails;
      g.fr = {
        pool:         nextPool,
        batch:        nextPool.slice(0, FR_BATCH),
        batchNum:     fr.batchNum+1,
        totalBatches: Math.ceil(nextPool.length/FR_BATCH),
        studyIdx:     0,
        testIdx:      0,
        mastered:     [],
        struggling:   [],
        revealShown:  false
      };
      g.mode='fr';
      frStudyStart();
    };
  }else if(strugglingCount>0){
    nextBtn.textContent = '💾 Save for Later';
    nextBtn.onclick = ()=>{ g.mode=''; initHome(); show('home'); };
  }else{
    nextBtn.textContent = '🏠 All Done! Go Home';
    nextBtn.onclick = ()=>{ g.mode=''; initHome(); show('home'); };
  }

  homeBtn.onclick = ()=>{ g.mode=''; initHome(); show('home'); };

  show('results');
}

// ── QUIZ RENDER & ANSWER HANDLERS ──
function renderQ(){
  stopSpeech();
  const q=g.queue[g.idx]; if(!q){showResults();return;}
  g.answered=false;
  const pct=(g.idx/g.queue.length)*100;
  document.getElementById('pfill').style.width=pct+'%';
  document.getElementById('ptxt').textContent=(g.idx+1)+'/'+g.queue.length;
  document.getElementById('strk').textContent='🔥 '+g.streak;
  document.getElementById('fbcard').className='fbcard';
  document.getElementById('opts').innerHTML='';
  document.getElementById('opts').style.display='grid';
  document.getElementById('twrap').style.display='none';
  document.getElementById('sent-panel').style.display='none';
  document.getElementById('tc-panel').style.display='none';
  const studyNav = document.getElementById('study-nav');
  if(studyNav) studyNav.style.display = 'none';
  const nxtbtn = document.getElementById('nxtbtn');
  nxtbtn.onclick = null;
  nxtbtn.style.display = 'block';
  nxtbtn.textContent = g.idx < g.queue.length - 1 ? 'Next →' : 'See Results →';

  const tf=document.getElementById('tfield'); tf.value=''; tf.className='tfield';
  document.getElementById('chkbtn').disabled=false;
  document.getElementById('chkbtn').onclick=null;
  const wc=document.getElementById('wcard');
  wc.classList.remove('fi'); void wc.offsetWidth; wc.classList.add('fi');

  const qt=QT[g.idx%QT.length];
  const all=allWords();
  const kbdHint = document.getElementById('kbd-hint');
  if(kbdHint) kbdHint.textContent = '💡 Keys: 1–4 select answer · Enter/Space next · R audio';

  const ttsWordBtn = document.getElementById('tts-word-btn');
  const bd = document.getElementById('tbadge');
  bd.textContent = q.t || '';
  bd.style.display = q.t ? 'inline-block' : 'none';
  document.getElementById('dword').style.fontSize = '';

  if(qt==='mc-kr-en'){
    document.getElementById('qchip').textContent='🇰🇷 → 🇬🇧 Choose English Meaning';
    document.getElementById('dword').className='dkr'; document.getElementById('dword').textContent=q.w;
    document.getElementById('dinstr').textContent='What does this word mean in English?';
    if(ttsWordBtn){ ttsWordBtn.style.display='inline-flex'; ttsWordBtn.onclick=()=>speakKR(q.w, ttsWordBtn); }
    const others = pickDistractors(q, all, 3);
    renderMC(shuffle([q,...others]),o=>o.e===q.e,'e',q);
  }else if(qt==='mc-en-kr'){
    document.getElementById('qchip').textContent='🇬🇧 → 🇰🇷 Choose Korean Word';
    document.getElementById('dword').className='den'; document.getElementById('dword').textContent=q.e;
    document.getElementById('dinstr').textContent='Which Korean word matches this meaning?';
    if(ttsWordBtn){ ttsWordBtn.style.display='none'; }
    const others = pickDistractors(q, all, 3);
    renderMC(shuffle([q,...others]),o=>cleanKR(o.w)===cleanKR(q.w),'w',q);
  }else if(qt==='type-kr-en'){
    document.getElementById('qchip').textContent='🇰🇷 → ✍️ Type the English';
    document.getElementById('dword').className='dkr'; document.getElementById('dword').textContent=q.w;
    document.getElementById('dinstr').textContent='Type the English meaning';
    if(ttsWordBtn){ ttsWordBtn.style.display='inline-flex'; ttsWordBtn.onclick=()=>speakKR(q.w, ttsWordBtn); }
    document.getElementById('opts').style.display='none';
    document.getElementById('twrap').style.display='flex';
    document.getElementById('tfield').placeholder='Type English...';
    setTimeout(()=>document.getElementById('tfield').focus(),100);
  }else{
    document.getElementById('qchip').textContent='🇬🇧 → ✍️ Type the Korean';
    document.getElementById('dword').className='den'; document.getElementById('dword').textContent=q.e;
    document.getElementById('dinstr').textContent='Type the Korean word';
    if(ttsWordBtn){ ttsWordBtn.style.display='none'; }
    document.getElementById('opts').style.display='none';
    document.getElementById('twrap').style.display='flex';
    document.getElementById('tfield').placeholder='한국어로 입력하세요...';
    setTimeout(()=>document.getElementById('tfield').focus(),100);
  }
}

function renderMC(opts,isOk,field,q){
  const c=document.getElementById('opts');
  opts.forEach((opt, idx)=>{
    const b=document.createElement('button'); b.className='opt';
    b.dataset.val = opt[field];
    if(field==='w'){b.style.fontFamily="'Noto Sans KR',sans-serif";b.style.fontSize='17px';}
    const keySpan = document.createElement('span');
    keySpan.className = 'opt-key';
    keySpan.textContent = String(idx + 1);
    const txtSpan = document.createElement('span');
    txtSpan.textContent = opt[field];
    b.appendChild(keySpan);
    b.appendChild(txtSpan);
    b.addEventListener('click',()=>{
      if(g.answered)return; g.answered=true;
      document.querySelectorAll('.opt').forEach(x=>x.disabled=true);
      const ok=isOk(opt);
      if(ok){b.classList.add('correct');g.ok++;g.streak++;if(g.streak>g.best)g.best=g.streak;}
      else{b.classList.add('wrong');g.bad++;g.streak=0;g.sfails.push(q);
        document.querySelectorAll('.opt').forEach(x=>{
          if(field==='e'&&x.dataset.val===q.e)x.classList.add('reveal');
          if(field==='w'&&cleanKR(x.dataset.val)===cleanKR(q.w))x.classList.add('reveal');
        });
      }
      document.getElementById('strk').textContent='🔥 '+g.streak;
      showFB(ok,q);
    });
    c.appendChild(b);
  });
}

function doType(){
  if(g.answered)return;
  const q=g.queue[g.idx];
  const chip=document.getElementById('qchip').textContent;
  const tf=document.getElementById('tfield');
  const val=tf.value.trim().toLowerCase();
  g.answered=true;
  let ok=false;
  if(chip.includes('Korean')){
    ok = val === q.w.toLowerCase() || val === cleanKR(q.w).toLowerCase();
  }else{
    const parts=q.e.toLowerCase().split('/').map(p=>p.trim());
    ok=parts.some(p=>val===p)||(val.length>2&&parts.some(p=>p.includes(val)));
  }
  if(ok){tf.classList.add('correct');g.ok++;g.streak++;if(g.streak>g.best)g.best=g.streak;}
  else{tf.classList.add('wrong');g.bad++;g.streak=0;g.sfails.push(q);}
  document.getElementById('chkbtn').disabled=true;
  document.getElementById('strk').textContent='🔥 '+g.streak;
  showFB(ok,q);
}

function showFB(ok,q){
  const fb=document.getElementById('fbcard');
  const v=document.getElementById('fbv');
  fb.className='fbcard show '+(ok?'sc':'sw');
  v.className='fbv '+(ok?'c':'w');
  v.textContent=ok?'✓ 맞아요! Correct! 🎉':'✗ 틀렸어요! Wrong!';
  document.getElementById('fba').textContent=q.w+' = '+q.e;
  document.getElementById('fbtp').textContent=q.t;

  const ttsFbBtn = document.getElementById('tts-fb-btn');
  if(ttsFbBtn){
    ttsFbBtn.style.display = 'inline-flex';
    ttsFbBtn.onclick = ()=>speakKR(q.w, ttsFbBtn);
  }

  const sp=document.getElementById('sent-panel');
  const tcp=document.getElementById('tc-panel');
  const tcrev=document.getElementById('tc-rev');
  const tcans=document.getElementById('tc-ans');
  const ttsSentBtn = document.getElementById('tts-sent-btn');
  const ttsTcBtn = document.getElementById('tts-tc-btn');
  const s = getSentence(q.w);

  if(!ok && s){
    sp.style.display='flex';
    document.getElementById('sent-kr').textContent=s[0];
    document.getElementById('sent-en').textContent=s[1];
    if(ttsSentBtn){
      ttsSentBtn.style.display = 'inline-flex';
      ttsSentBtn.onclick = ()=>speakKR(s[0], ttsSentBtn);
    }
    if(tcp && s[2]){
      tcp.style.display='flex';
      document.getElementById('tc-txt').textContent=s[2];
      tcans.style.display='none';
      tcans.textContent='→ '+s[3];
      if(ttsTcBtn){
        ttsTcBtn.style.display = 'none';
        ttsTcBtn.onclick = ()=>speakKR(s[3], ttsTcBtn);
      }
      tcrev.style.display='inline-block';
      tcrev.disabled = false;
      tcrev.textContent = 'Show Answer 👁';
      tcrev.onclick=()=>{
        tcans.style.display='block';
        tcrev.style.display='none';
        if(ttsTcBtn && s[3]) ttsTcBtn.style.display='inline-flex';
      };
    }
  } else {
    sp.style.display='none';
    if(tcp) tcp.style.display='none';
  }
}

function showResults(){
  const k=levelKey(g.progDay,g.bookDay);
  if(g.mode==='fail'){
    const passed=new Set(g.queue.filter(w=>!g.sfails.find(f=>f.w===w.w)).map(w=>w.w));
    g.fails=g.fails.filter(f=>!passed.has(f.w));
  }else{
    g.sfails.forEach(f=>{if(!g.fails.find(x=>x.w===f.w))g.fails.push(f);});
    g.done[k]=g.ok>=24;
    g.dfails[k]=g.sfails.length;
  }
  save();

  if(g.user.sid && g.mode==='level'){
    const pct2=(g.ok+g.bad)>0?Math.round(g.ok/(g.ok+g.bad)*100):0;
    dbSaveProgress(g.user.sid, g.progDay, g.bookDay, g.ok, g.bad, pct2, g.best)
      .then(()=>console.log('Progress saved to DB'));
    if(g.sfails.length>0){
      dbSaveFailWords(g.user.sid, g.sfails, g.progDay, g.bookDay)
        .then(()=>console.log('Fail words saved'));
    }
    const mastered=g.queue.filter(w=>!g.sfails.find(f=>f.w===w.w));
    if(mastered.length>0){
      dbClearMasteredWords(g.user.sid, mastered)
        .then(()=>console.log('Mastered words cleared'));
    }
  }

  if(g.user.name){
    try{
      const lb=JSON.parse(localStorage.getItem('topik_lb')||'[]');
      const totalDone=Object.values(g.done).filter(Boolean).length;
      const idx=lb.findIndex(e=>e.sid===g.user.sid);
      const entry={name:g.user.name,sid:g.user.sid,nick:g.user.nick,levels:totalDone,best:g.best};
      if(idx>=0)lb[idx]=entry; else lb.push(entry);
      localStorage.setItem('topik_lb',JSON.stringify(lb));
    }catch(e){}
  }

  const total=g.ok+g.bad;
  const pct=total>0?Math.round(g.ok/total*100):0;
  document.getElementById('rpct').textContent=pct+'%';
  document.getElementById('sring').style.setProperty('--pct',pct+'%');
  document.getElementById('rc').textContent=g.ok;
  document.getElementById('rw').textContent=g.bad;
  document.getElementById('rt').textContent=total;
  document.getElementById('rbadge').textContent=g.mode==='fail'?'⚡ Review Complete!':`Day ${g.progDay} · ${BOOK_LABELS[g.bookDay]} Done!`;

  const ru=document.getElementById('r-user');
  ru.textContent=g.user.name?(g.user.nick||g.user.name.split(' ')[0]):'';

  let ti,su;
  if(pct===100){ti='완벽해요! 🎉';su='Perfect score! Amazing!';}
  else if(pct>=80){ti='잘했어요! 👏';su='Great job! Keep going!';}
  else if(pct>=60){ti='괜찮아요 💪';su='Good effort! Review your fails.';}
  else{ti='다시 해봐요 📚';su="Don't give up! Smart review helps.";}
  document.getElementById('rtitle').textContent=ti;
  document.getElementById('rsub').textContent=su;

  const fp=document.getElementById('fpanel');
  const fl=document.getElementById('flist');
  if(g.sfails.length>0){
    fp.style.display='block';
    const fptitleEl = document.getElementById('fptitle');
    if(fptitleEl) fptitleEl.textContent = '❌ Words to Memorize';
    fl.innerHTML=g.sfails.map(f=>`<div class="frow"><span class="fkr">${f.w}</span><span class="fen">${f.e}</span></div>`).join('');
  }else fp.style.display='none';

  document.getElementById('r-retry').style.display=g.sfails.length>0?'block':'none';
  document.getElementById('r-retry').onclick=()=>startFailReview([...g.sfails]);

  const rn=document.getElementById('r-next');
  if(g.mode==='fail'){rn.textContent='🏠 Go Home';rn.onclick=()=>{initHome();show('home');};}
  else{
    const curVOCAB=VOCAB[g.progDay];
    const curIdx=curVOCAB.findIndex(bd=>bd.bd===g.bookDay);
    if(curIdx>=0&&curIdx<curVOCAB.length-1){
      const next=curVOCAB[curIdx+1];
      rn.textContent=`Next: ${BOOK_LABELS[next.bd]} →`;
      rn.onclick=()=>startLevel(g.progDay,next.bd,next.words);
    }else if(g.progDay<5){
      const nextPD=g.progDay+1;
      const firstBD=VOCAB[nextPD][0];
      rn.textContent=`Next: Program Day ${nextPD} →`;
      rn.onclick=()=>startLevel(nextPD,firstBD.bd,firstBD.words);
    }else{
      rn.textContent='🏆 All Levels Complete!';
      rn.onclick=()=>{initHome();show('home');};
    }
  }
  show('results');
}

// ═══════════════════════════════════════════════════
// FINAL EXAM ENGINE — TOPIK I Vocabulary
// 30 questions · 5 types · 80% to pass
// ═══════════════════════════════════════════════════
const EXAM_TOTAL = 30;
const PASS_PCT = 80;
const ADV_PCT = 95;

let examQ=[], examIdx=0, examCorrect=0, examWrong=[], examAnswered=false;

function allWordsList(){
  return Object.values(VOCAB).flat().map(bd=>bd.words).flat();
}

function buildExamQuestions(){
  const all = allWordsList();
  const selected = shuffle(all).slice(0,EXAM_TOTAL);
  return selected.map((word,i)=>{
    const others = pickDistractors(word, all, 3);
    const type = i%5;
    if(type===0){
      const opts=shuffle([word,...others]);
      return {type:'meaning-kr',word,
        question:'다음 단어의 뜻으로 알맞은 것을 고르세요.',
        sub:'Choose the correct English meaning:',
        prompt:word.w, promptClass:'dkr', badge:word.t,
        opts:opts.map(o=>o.e), ans:opts.findIndex(o=>o.w===word.w)};
    } else if(type===1){
      const opts=shuffle([word,...others]);
      return {type:'meaning-en',word,
        question:'다음 뜻에 알맞은 단어를 고르세요.',
        sub:'Choose the Korean word that matches:',
        prompt:word.e, promptClass:'den', badge:word.t,
        opts:opts.map(o=>o.w), ans:opts.findIndex(o=>o.w===word.w),
        isKoreanOpts:true};
    } else if(type===2){
      const s = getSentence(word.w);
      const rawSent = word.kr || (s ? s[0] : '');
      const cleanW = cleanKR(word.w);
      const blank = (rawSent && rawSent.includes(cleanW))
        ? rawSent.replace(new RegExp(cleanW.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'___')
        : `___ 은/는 "${word.e}"을/를 의미합니다.`;
      const opts=shuffle([word,...others]);
      return {type:'fill-blank',word,
        question:'빈칸에 알맞은 말을 고르세요.',
        sub:'Choose the word that fits the blank:',
        prompt:blank, promptClass:'den', badge:null,
        opts:opts.map(o=>o.w), ans:opts.findIndex(o=>o.w===word.w),
        isKoreanOpts:true, smallPrompt:true};
    } else if(type===3){
      const syn = SYNONYMS[word.w] || SYNONYMS[cleanKR(word.w)];
      if(syn){
        const wrongOpts=others.filter(o=>cleanKR(o.w)!==syn).map(o=>o.w);
        while(wrongOpts.length<3){
          const extra = all.find(x=>cleanKR(x.w)!==cleanKR(word.w) && cleanKR(x.w)!==syn && !wrongOpts.includes(x.w));
          if(extra) wrongOpts.push(extra.w); else break;
        }
        const opts=shuffle([syn,...wrongOpts.slice(0,3)]);
        return {type:'synonym',word,
          question:'다음 단어와 의미가 비슷한 것을 고르세요.',
          sub:'Choose the word closest in meaning:',
          prompt:word.w, promptClass:'dkr', badge:word.t,
          opts:opts, ans:opts.indexOf(syn), isKoreanOpts:true};
      }
      const opts=shuffle([word,...others]);
      return {type:'meaning-kr',word,
        question:'다음 단어의 뜻으로 알맞은 것을 고르세요.',
        sub:'Choose the correct English meaning:',
        prompt:word.w, promptClass:'dkr', badge:word.t,
        opts:opts.map(o=>o.e), ans:opts.findIndex(o=>o.w===word.w)};
    } else {
      const opts=shuffle([word,...others]);
      return {type:'context',word,
        question:'설명에 맞는 단어를 고르세요.',
        sub:'Which Korean word matches this?',
        prompt:`"${word.e}"`, promptClass:'den', badge:word.t,
        opts:opts.map(o=>o.w), ans:opts.findIndex(o=>o.w===word.w),
        isKoreanOpts:true};
    }
  });
}

function startFinalExam(){
  examQ=buildExamQuestions(); examIdx=0; examCorrect=0; examWrong=[]; examAnswered=false;
  g.mode='exam';
  document.getElementById('nxtbtn').onclick = null;
  document.getElementById('nxtbtn').style.display = 'block';
  const studyNav = document.getElementById('study-nav');
  if(studyNav) studyNav.style.display = 'none';
  document.getElementById('glbl').textContent='TOPIK I 최종 시험';
  document.getElementById('strk').textContent='✓ 0';
  show('game'); renderExamQ();
}

function renderExamQ(){
  stopSpeech();
  if(examIdx>=examQ.length){finishExam();return;}
  const q=examQ[examIdx]; examAnswered=false;
  document.getElementById('pfill').style.width=((examIdx/EXAM_TOTAL)*100)+'%';
  document.getElementById('ptxt').textContent=(examIdx+1)+'/'+EXAM_TOTAL;
  document.getElementById('strk').textContent='✓ '+examCorrect;
  document.getElementById('twrap').style.display='none';
  document.getElementById('opts').style.display='grid';
  document.getElementById('opts').innerHTML='';
  document.getElementById('fbcard').className='fbcard';
  document.getElementById('sent-panel').style.display='none';
  document.getElementById('tc-panel').style.display='none';
  const wc=document.getElementById('wcard');
  wc.classList.remove('fi'); void wc.offsetWidth; wc.classList.add('fi');
  const typeLabels={'meaning-kr':'📖 단어 의미 고르기','meaning-en':'🇰🇷 한국어 단어 고르기',
    'fill-blank':'✍️ 빈칸 채우기','synonym':'🔗 비슷한 말 고르기','context':'💬 알맞은 단어 고르기'};
  document.getElementById('qchip').textContent=typeLabels[q.type]||'문제';
  const bd=document.getElementById('tbadge');
  bd.textContent=q.badge||''; bd.style.display=q.badge?'inline-block':'none';
  const dw=document.getElementById('dword');
  dw.className=q.promptClass;
  dw.style.fontSize=q.smallPrompt?'clamp(13px,3.5vw,16px)':'';
  dw.textContent=q.prompt;
  document.getElementById('dinstr').textContent=q.sub;

  const ttsWordBtn = document.getElementById('tts-word-btn');
  if(ttsWordBtn){
    if(q.promptClass==='dkr'){
      ttsWordBtn.style.display='inline-flex';
      ttsWordBtn.onclick=()=>speakKR(q.word.w, ttsWordBtn);
    }else{
      ttsWordBtn.style.display='none';
    }
  }

  const c=document.getElementById('opts');
  q.opts.forEach((opt,i)=>{
    const b=document.createElement('button'); b.className='opt';
    if(q.isKoreanOpts){b.style.fontFamily="'Noto Sans KR',sans-serif";b.style.fontSize='16px';}
    else{b.style.fontSize='13px';}
    const keySpan = document.createElement('span');
    keySpan.className = 'opt-key';
    keySpan.textContent = String(i + 1);
    const txtSpan = document.createElement('span');
    txtSpan.textContent = opt;
    b.appendChild(keySpan);
    b.appendChild(txtSpan);
    b.addEventListener('click',()=>{
      if(examAnswered)return; examAnswered=true;
      document.querySelectorAll('.opt').forEach(x=>x.disabled=true);
      const ok=i===q.ans;
      if(ok){b.classList.add('correct');examCorrect++;}
      else{b.classList.add('wrong');examWrong.push(q.word);
        const allOpts = document.querySelectorAll('.opt');
        if(allOpts[q.ans]) allOpts[q.ans].classList.add('reveal');}
      document.getElementById('strk').textContent='✓ '+examCorrect;
      const fb=document.getElementById('fbcard');
      fb.className='fbcard show '+(ok?'sc':'sw');
      document.getElementById('fbv').className='fbv '+(ok?'c':'w');
      document.getElementById('fbv').textContent=ok?'✓ 정답! Correct! 🎉':'✗ 오답! Wrong!';
      document.getElementById('fba').textContent=q.word.w+' = '+q.word.e;
      document.getElementById('fbtp').textContent=q.word.t||'';
      const ttsFbBtn = document.getElementById('tts-fb-btn');
      if(ttsFbBtn){
        ttsFbBtn.style.display = 'inline-flex';
        ttsFbBtn.onclick = ()=>speakKR(q.word.w, ttsFbBtn);
      }
      document.getElementById('nxtbtn').textContent=examIdx<EXAM_TOTAL-1?'Next Question →':'See Results →';
    });
    c.appendChild(b);
  });
}

function finishExam(){
  const pct=Math.round(examCorrect/EXAM_TOTAL*100);
  const passed=pct>=PASS_PCT; const advanced=pct>=ADV_PCT;
  if(g.user.sid){
    sbFetch('/rest/v1/progress','POST',{
      student_id:g.user.sid,prog_day:0,book_day:0,level_key:'final_exam',
      completed:passed,correct:examCorrect,wrong:EXAM_TOTAL-examCorrect,
      score_pct:pct,best_streak:examCorrect,attempts:1,
      updated_at:new Date().toISOString()
    });
  }
  if(passed){showCertificate(pct,advanced);}
  else{
    document.getElementById('fail-score-display').textContent=pct+'%';
    document.getElementById('fail-correct-display').textContent=examCorrect+' / '+EXAM_TOTAL+' correct';
    document.getElementById('exam-fail-words').innerHTML=examWrong.slice(0,10).map(w=>
      `<div class="frow"><span class="fkr">${w.w}</span><span class="fen">${w.e}</span></div>`
    ).join('')+(examWrong.length>10?`<div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:center;padding:6px">+${examWrong.length-10} more</div>`:'');
    show('exam-failed');
  }
}

// ── CERTIFICATE ──
function showCertificate(pct,advanced,customStudent){
  document.getElementById('cert-level-badge').textContent=advanced?'🏅 ADVANCED LEVEL 2 CERTIFICATE':'📜 TOPIK I CERTIFICATE';
  document.getElementById('cert-sub').textContent=`Score: ${pct}% · ${advanced?'Advanced':'Standard'} · Korean Language Program`;
  const name=customStudent?.name || g.user.name || 'STUDENT';
  const sid=customStudent?.sid || g.user.sid || '';
  const cohortId=customStudent?.cohort || g.user.cohort || getActiveCohort().id;
  const cohortObj=getCohorts().find(c=>c.id===cohortId);
  const cohortName=cohortObj ? cohortObj.name.replace(' (Current)','') : (cohortId || '2026 Spring');
  const dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  document.getElementById('cert-preview').innerHTML=buildCertHTML(name,sid,pct,advanced,dateStr,cohortName);
  show('cert-screen');
}

function buildCertHTML(name,sid,pct,advanced,dateStr,cohortName){
  const bc=advanced?'#D4A017':'#1B4F8A';
  const ac=advanced?'#F5C518':'#2E86DE';
  const lt=advanced?'Advanced — TOPIK I Ready for Level 2':'TOPIK I Vocabulary Completion';
  const logo=`data:image/jpeg;base64,${KDU_LOGO_B64}`;
  const cohortDisplay = cohortName || '2026 Spring Semester';
  return `<div id="cert-content" style="font-family:Georgia,serif;background:#FEFEFE;padding:32px 28px;border:6px solid ${bc};box-shadow:inset 0 0 0 3px ${ac};">
    <div style="text-align:center;margin-bottom:16px">
      <img src="${logo}" style="width:72px;height:auto;margin-bottom:8px;object-fit:contain" alt="KDU Crest">
      <div style="font-size:12px;font-weight:700;color:#1B4F8A;letter-spacing:3px;text-transform:uppercase">KyungDong University Global</div>
      <div style="font-size:10px;font-weight:600;color:#D4A017;letter-spacing:2px;text-transform:uppercase;margin-top:2px">Korean Language Program · 쏙쏙 어휘왕 (Vocab-King)</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,${bc})"></div>
      <div style="color:${ac};font-size:14px">✦</div>
      <div style="flex:1;height:1px;background:linear-gradient(to left,transparent,${bc})"></div>
    </div>
    <div style="text-align:center;margin-bottom:12px">
      <div style="font-size:9px;letter-spacing:4px;color:#888;text-transform:uppercase;margin-bottom:4px">Official Certificate of Academic Achievement</div>
      <div style="font-size:19px;font-weight:700;color:#1a1a2e">${lt}</div>
    </div>
    <div style="text-align:center;font-size:11px;color:#777;margin-bottom:4px;font-style:italic">This is proudly awarded to</div>
    <div style="text-align:center;font-size:23px;font-weight:700;color:#1a1a2e;margin-bottom:4px;letter-spacing:0.5px">${name}</div>
    <div style="text-align:center;font-size:11px;color:#666;margin-bottom:12px">
      <span>Student ID: <strong>${sid}</strong></span> · <span>Semester Cohort: <strong>${cohortDisplay}</strong></span>
    </div>
    <div style="text-align:center;font-size:11.5px;color:#444;line-height:1.65;margin-bottom:14px;padding:0 8px">
      has successfully completed the intensive <strong>쏙쏙 어휘왕 TOPIK I</strong> Vocabulary Curriculum,
      demonstrating certified mastery of <strong>1,470 Korean vocabulary words</strong> across 5 program days,
      and fulfilling academic course evaluation criteria with a final examination score of:
    </div>
    <div style="text-align:center;margin-bottom:14px">
      <div style="display:inline-block;background:linear-gradient(135deg,${bc},${ac});color:#fff;font-size:26px;font-weight:900;padding:10px 28px;border-radius:10px;box-shadow:0 4px 12px rgba(27,79,138,0.25)">${pct}%</div>
      <div style="font-size:11px;font-weight:600;color:${bc};margin-top:5px">${advanced?'🏅 Advanced Level 2 Recommendation — Highest Honors':'✓ Standard Level TOPIK I Pass'}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,${bc})"></div>
      <div style="color:${ac};font-size:14px">✦</div>
      <div style="flex:1;height:1px;background:linear-gradient(to left,transparent,${bc})"></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end">
      <div style="text-align:center">
        <div style="font-size:20px;font-family:'Brush Script MT',cursive;color:#1a1a2e;margin-bottom:2px">Hyejoon Yoon</div>
        <div style="width:125px;height:1px;background:#aaa;margin-bottom:4px"></div>
        <div style="font-size:10px;font-weight:700;color:#222">Prof. Hyejoon Yoon</div>
        <div style="font-size:8.5px;color:#666">Academic Supervisor &amp; Course Evaluator</div>
        <div style="font-size:8px;color:#888">Korean Language Program</div>
      </div>
      <div style="text-align:center">
        <div style="width:50px;height:50px;border-radius:50%;border:2px solid ${bc};display:flex;align-items:center;justify-content:center;margin:0 auto 4px;background:#fafafa">
          <span style="font-size:20px">🇰🇷</span>
        </div>
        <div style="font-size:9px;font-weight:700;color:#666">Official Seal</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:12px;font-weight:700;color:#1a1a2e;margin-bottom:4px">${dateStr}</div>
        <div style="width:125px;height:1px;background:#aaa;margin-bottom:4px"></div>
        <div style="font-size:10px;font-weight:700;color:#222">Date of Issue</div>
        <div style="font-size:8.5px;color:#666">Goseong Global Campus</div>
        <div style="font-size:8px;color:#888">KyungDong University, South Korea</div>
      </div>
    </div>
    <div style="margin-top:14px;padding:9px 12px;background:#f8f9fa;border-radius:6px;border:1px solid #e2e8f0;text-align:center;font-size:9px;color:#475569;line-height:1.45">
      <div><strong>Project Initiated &amp; Developed by:</strong> ALINGILYA CRISPIN NJEWA (Lead Developer / Student Founder)</div>
      <div><strong>Academic Exactitude &amp; Course Evaluation:</strong> Prof. Hyejoon Yoon (Faculty Supervisor, Korean Language Program)</div>
      <div style="margin-top:2px;font-size:8px;color:#94a3b8">KYUNGDONG UNIVERSITY GLOBAL · 쏙쏙 어휘왕 TOPIK I CERTIFICATION</div>
    </div>
  </div>`;
}

async function downloadCert(){
  const btn=document.querySelector('.btn-download');
  btn.textContent='⏳ Preparing PDF...'; btn.disabled=true;
  if(!window.html2pdf){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
  }
  const pct=parseInt(document.getElementById('cert-sub').textContent.match(/\d+/)[0]);
  const adv=pct>=ADV_PCT;
  const fname=`KDU_VocabKing_${adv?'Advanced':'TOPIK1'}_${(g.user.name||'Student').replace(/ /g,'_')}.pdf`;
  html2pdf().set({
    margin:10, filename:fname,
    image:{type:'jpeg',quality:0.98},
    html2canvas:{scale:2,useCORS:true},
    jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}
  }).from(document.getElementById('cert-content')).save()
  .then(()=>{btn.textContent='✅ Downloaded!';btn.disabled=false;setTimeout(()=>{btn.textContent='⬇️ Download Certificate (PDF)';},3000);})
  .catch(()=>{btn.textContent='⬇️ Download Certificate (PDF)';btn.disabled=false;});
}

// ── EVENTS & KEYBOARD NAVIGATION (Phase 1) ──
document.getElementById('intro-btn').addEventListener('click',()=>{load();if(!g.user.name && !localStorage.getItem('topik_skip')){show('register');}else{initHome();show('home');}});
document.getElementById('back-btn').addEventListener('click',()=>{stopSpeech();g.mode='';save();initHome();show('home');});
document.getElementById('chkbtn').addEventListener('click',()=>{if(g.mode==='fr')frCheckAnswer();else doType();});
document.getElementById('r-home').addEventListener('click',()=>{initHome();show('home');});
document.getElementById('fail-btn').addEventListener('click',()=>startFailReview());

document.getElementById('tfield').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    e.stopPropagation();
    if(g.mode==='fr'){
      if(!document.getElementById('chkbtn').disabled) frCheckAnswer();
      else document.getElementById('nxtbtn').click();
    }else{
      if(!g.answered) doType();
      else document.getElementById('nxtbtn').click();
    }
  }
});

// Dictionary search & filter listeners
['dict-search','dict-pos','dict-day','dict-status'].forEach(id=>{
  const el = document.getElementById(id);
  if(el){
    el.addEventListener(id==='dict-search'?'input':'change', ()=>{
      dictRenderLimit = 60;
      renderDictionary();
    });
  }
});

// nxtbtn: handle game and exam modes
document.getElementById('nxtbtn').addEventListener('click',()=>{
  try{
    if(g.mode==='fr' || g.mode==='study') return;
    if(g.mode==='exam'){
      examIdx++;
      if(examIdx >= EXAM_TOTAL){ finishExam(); }
      else{ renderExamQ(); }
    } else {
      g.idx++;
      if(g.idx >= g.queue.length){ showResults(); }
      else{ renderQ(); }
    }
  }catch(err){
    console.error('nxtbtn error:', err);
    try{
      if(g.mode==='exam'){ finishExam(); }
      else if(g.mode!=='fr'){ show('results'); }
    }catch(e2){ show('home'); }
  }
});

// Global Keyboard Navigation (1-4 for MC options, Enter/Space for Next, R for Audio, Arrows for Study Mode)
document.addEventListener('keydown', e=>{
  if(e.ctrlKey || e.altKey || e.metaKey) return;
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if(activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;

  const gameScreen = document.getElementById('game');
  if(!gameScreen || !gameScreen.classList.contains('active')) return;

  // 'r' or 'R' replays visible Korean word pronunciation
  if(e.key === 'r' || e.key === 'R'){
    const ttsWord = document.getElementById('tts-word-btn');
    const ttsFb = document.getElementById('tts-fb-btn');
    const fbcard = document.getElementById('fbcard');
    if(fbcard && fbcard.classList.contains('show') && ttsFb && ttsFb.style.display !== 'none'){
      e.preventDefault();
      ttsFb.click();
    }else if(ttsWord && ttsWord.style.display !== 'none'){
      e.preventDefault();
      ttsWord.click();
    }
    return;
  }

  // Study Mode keyboard navigation
  if(g.mode === 'study'){
    if(e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      const nextBtn = document.getElementById('study-next-btn');
      if(nextBtn) nextBtn.click();
    }else if(e.key === 'ArrowLeft'){
      e.preventDefault();
      const prevBtn = document.getElementById('study-prev-btn');
      if(prevBtn && !prevBtn.disabled) prevBtn.click();
    }
    return;
  }

  // Multiple-choice keys 1-4
  if(['1','2','3','4'].includes(e.key)){
    const idx = parseInt(e.key, 10) - 1;
    const optsWrap = document.getElementById('opts');
    if(optsWrap && optsWrap.style.display !== 'none'){
      const btns = optsWrap.querySelectorAll('.opt');
      if(btns[idx] && !btns[idx].disabled){
        e.preventDefault();
        btns[idx].click();
      }
    }
    return;
  }

  // Enter or Space advances when feedback card is shown
  if(e.key === 'Enter' || e.key === ' '){
    const fbcard = document.getElementById('fbcard');
    const nxtbtn = document.getElementById('nxtbtn');
    if(fbcard && fbcard.classList.contains('show') && nxtbtn && nxtbtn.style.display !== 'none'){
      e.preventDefault();
      nxtbtn.click();
    }
  }
});

// ═══════════════════════════════════════════════════
// ADMIN DASHBOARD — Faculty Portal
// KDU Korean Program · Protected by passcode
// ═══════════════════════════════════════════════════
const ADMIN_PASSCODES = ['kdu2026', 'admin1234', 'KDU2026'];
let adminAuthenticated = false;
let adminCachedStudents = [];

function openAdmin(){
  adminAuthenticated = false;
  show('admin');
  const authCard = document.getElementById('admin-auth-card');
  const dashCard = document.getElementById('admin-dashboard');
  if(authCard) authCard.style.display = 'block';
  if(dashCard) dashCard.style.display = 'none';
  const passInput = document.getElementById('admin-passcode');
  if(passInput){ passInput.value = ''; setTimeout(()=>passInput.focus(), 200); }
  const err = document.getElementById('admin-auth-err');
  if(err) err.style.display = 'none';
}

function doAdminAuth(){
  const passEl = document.getElementById('admin-passcode');
  const errEl = document.getElementById('admin-auth-err');
  const pass = (passEl ? passEl.value : '').trim();
  if(ADMIN_PASSCODES.includes(pass)){
    adminAuthenticated = true;
    const authCard = document.getElementById('admin-auth-card');
    const dashCard = document.getElementById('admin-dashboard');
    if(authCard) authCard.style.display = 'none';
    if(dashCard) dashCard.style.display = 'block';
    populateCohortSelects();
    renderAdminDashboard();
  } else {
    if(errEl){ errEl.style.display='block'; errEl.textContent='Incorrect passcode. Ask Prof. Hyejoon Yoon for access.'; }
    if(passEl){ passEl.value=''; passEl.focus(); }
  }
}

function adminLock(){
  adminAuthenticated = false;
  show('home');
}

function switchAdminTab(tab){
  ['overview','students','cohorts','certs'].forEach(t=>{
    const panel = document.getElementById('apanel-'+t);
    const btn = document.getElementById('atab-'+t);
    if(panel) panel.style.display = t===tab ? 'block' : 'none';
    if(btn){
      if(t===tab){
        btn.style.background='var(--gold)'; btn.style.color='var(--navy)'; btn.style.fontWeight='700';
      } else {
        btn.style.background='transparent'; btn.style.color='rgba(255,255,255,0.55)'; btn.style.fontWeight='500';
      }
    }
  });
  if(tab==='overview') renderAdminOverview();
  else if(tab==='students') renderAdminStudents();
  else if(tab==='cohorts') renderAdminCohorts();
  else if(tab==='certs') renderAdminCerts();
}

async function renderAdminDashboard(){
  if(!adminAuthenticated) return;
  const [studentsRaw, progRaw, failRaw] = await Promise.all([
    sbFetch('/rest/v1/students?select=*&limit=500'),
    sbFetch('/rest/v1/progress?select=*&limit=3000'),
    sbFetch('/rest/v1/fail_words?select=*&limit=3000')
  ]);

  const localStudents = getCachedStudents();
  const merged = {};
  localStudents.forEach(s=>{ merged[s.sid] = {...s}; });
  (studentsRaw||[]).forEach(s=>{
    const key = s.student_id;
    merged[key] = {
      sid: key,
      name: s.name||'',
      nick: s.nickname||'',
      cohort: s.cohort || merged[key]?.cohort || getActiveCohort().id,
      lastSeen: s.last_seen||'',
      words: merged[key]?.words||0,
      levels: merged[key]?.levels||0,
      examPassed: merged[key]?.examPassed||false,
      examScore: merged[key]?.examScore||0
    };
  });

  const progressMap = {};
  (progRaw||[]).forEach(p=>{
    if(!progressMap[p.student_id]) progressMap[p.student_id] = {words:0,levels:0,examPassed:false,examScore:0};
    if(p.level_key==='final_exam'){
      if(p.completed) progressMap[p.student_id].examPassed = true;
      if((p.score_pct||0) > progressMap[p.student_id].examScore) progressMap[p.student_id].examScore = p.score_pct;
    } else {
      progressMap[p.student_id].words += (p.correct||0);
      if(p.completed) progressMap[p.student_id].levels++;
    }
  });
  Object.keys(merged).forEach(sid=>{
    if(progressMap[sid]){
      merged[sid].words = progressMap[sid].words;
      merged[sid].levels = progressMap[sid].levels;
      merged[sid].examPassed = progressMap[sid].examPassed;
      merged[sid].examScore = progressMap[sid].examScore;
    }
  });

  adminCachedStudents = Object.values(merged);

  const failWordMap = {};
  (failRaw||[]).forEach(f=>{ failWordMap[f.word_kr] = (failWordMap[f.word_kr]||0)+1; });

  const cohorts = getCohorts();
  const activeCohort = getActiveCohort();
  const totalStudents = adminCachedStudents.length;
  const certified = adminCachedStudents.filter(s=>s.examPassed).length;
  const totalWords = adminCachedStudents.reduce((a,s)=>a+(s.words||0),0);

  const statTotal = document.getElementById('adm-stat-total');
  const statActiveCohort = document.getElementById('adm-stat-active-cohort');
  const statWords = document.getElementById('adm-stat-words');
  const statPassed = document.getElementById('adm-stat-passed');
  if(statTotal) statTotal.textContent = totalStudents;
  if(statActiveCohort) statActiveCohort.textContent = activeCohort.name.replace(' (Current)','');
  if(statWords) statWords.textContent = totalWords.toLocaleString();
  if(statPassed) statPassed.textContent = certified;

  const cohortListEl = document.getElementById('adm-cohort-list');
  const cohortCountEl = document.getElementById('adm-cohort-count');
  if(cohortListEl){
    cohortListEl.innerHTML = cohorts.map(c=>{
      const count = adminCachedStudents.filter(s=>s.cohort===c.id).length;
      const pct = totalStudents > 0 ? Math.round(count/totalStudents*100) : 0;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div>
          <span class="cohort-badge ${c.active?'current':'alumni'}">${c.name.replace(' (Current)','')}</span>
          ${c.active ? '<span style="font-size:9px;color:var(--gold);margin-left:4px">★ Current</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="background:rgba(255,255,255,0.05);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;color:#fff">${count} students</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4)">${pct}%</div>
        </div>
      </div>`;
    }).join('');
  }
  if(cohortCountEl) cohortCountEl.textContent = totalStudents + ' students total';

  const weakWordsEl = document.getElementById('adm-weak-words');
  if(weakWordsEl){
    const sorted = Object.entries(failWordMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
    if(sorted.length===0){
      weakWordsEl.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.4);text-align:center;padding:12px">No fail data yet</div>';
    } else {
      weakWordsEl.innerHTML = sorted.map(([w,cnt],i)=>{
        const wObj = allWords().find(x=>cleanKR(x.w)===cleanKR(w)||x.w===w);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:rgba(255,255,255,0.3);width:16px;text-align:right">${i+1}</span>
            <span style="font-family:'Noto Sans KR',sans-serif;font-size:13px;color:#fff;font-weight:600">${w}</span>
            ${wObj ? `<span style="font-size:11px;color:rgba(255,255,255,0.45)">${wObj.e}</span>` : ''}
          </div>
          <span style="font-size:11px;font-weight:700;color:#ef4444;background:rgba(239,68,68,0.12);padding:1px 7px;border-radius:10px">${cnt} fails</span>
        </div>`;
      }).join('');
    }
  }

  switchAdminTab('overview');
}

function renderAdminOverview(){
  const panel = document.getElementById('apanel-overview');
  if(panel) panel.style.display='block';
}

function renderAdminStudents(){
  const tbody = document.getElementById('adm-student-tbody');
  if(!adminCachedStudents.length){
    if(tbody) tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,0.4);padding:24px">No student data. Open Overview first to load data.</td></tr>';
    return;
  }
  const search = (document.getElementById('adm-student-search')?.value||'').trim().toLowerCase();
  const cohortFilter = document.getElementById('adm-student-cohort')?.value||'all';
  const cohorts = getCohorts();
  const cohortMap = {};
  cohorts.forEach(c=>cohortMap[c.id]=c);

  const filtered = adminCachedStudents.filter(s=>{
    if(cohortFilter!=='all' && s.cohort!==cohortFilter) return false;
    if(search){ const h=[s.name,s.nick,s.sid].join(' ').toLowerCase(); if(!h.includes(search)) return false; }
    return true;
  }).sort((a,b)=>(b.words||0)-(a.words||0));

  if(!tbody) return;
  if(filtered.length===0){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,0.4);padding:24px">No students match your filter.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(s=>{
    const cObj = cohortMap[s.cohort];
    const cName = cObj ? cObj.name.replace(' (Current)','') : (s.cohort||'—');
    const isCur = cObj ? cObj.active : false;
    const examCell = s.examPassed
      ? `<span style="color:#22c55e;font-weight:700">✓ ${s.examScore}%</span>`
      : (s.examScore>0 ? `<span style="color:#f59e0b">Fail ${s.examScore}%</span>` : '<span style="color:rgba(255,255,255,0.3)">—</span>');
    return `<tr>
      <td style="font-family:monospace;font-size:11px">${s.sid||'—'}</td>
      <td><div>${s.name||'—'}</div>${s.nick?`<div style="font-size:10px;color:rgba(255,255,255,0.4)">${s.nick}</div>`:''}</td>
      <td><span class="cohort-badge ${isCur?'current':'alumni'}" style="font-size:10px">${cName}</span></td>
      <td style="text-align:center;font-weight:700;color:var(--sky)">${(s.words||0).toLocaleString()}</td>
      <td style="text-align:center">${s.levels||0}</td>
      <td>${examCell}</td>
      <td>${s.examPassed?`<button class="btn-rg" style="padding:4px 10px;font-size:10px;border-radius:14px" onclick="viewStudentCert('${s.sid}')">📜 Cert</button>`:'—'}</td>
    </tr>`;
  }).join('');
}

function renderAdminCohorts(){
  const cohorts = getCohorts();
  const listEl = document.getElementById('adm-all-cohorts-list');
  if(!listEl) return;
  listEl.innerHTML = cohorts.map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,${c.active?'0.18':'0.06'});margin-bottom:6px">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span class="cohort-badge ${c.active?'current':'alumni'}">${c.name.replace(' (Current)','')}</span>
          ${c.active ? '<span style="font-size:10px;color:var(--gold)">★ Active</span>' : ''}
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4)">Code: <strong>${c.id}</strong> · ${c.semester} ${c.year}</div>
      </div>
      <button class="btn-rg" style="padding:5px 12px;font-size:10px;border-radius:14px;background:${c.active?'rgba(239,68,68,0.15)':'rgba(34,197,94,0.15)'};color:${c.active?'#ef4444':'#22c55e'};border:1px solid currentColor" onclick="toggleCohortActive('${c.id}')">
        ${c.active ? 'Deactivate' : 'Set Active'}
      </button>
    </div>`).join('');
}

function renderAdminCerts(){
  const certified = adminCachedStudents.filter(s=>s.examPassed).sort((a,b)=>(b.examScore||0)-(a.examScore||0));
  const cohorts = getCohorts();
  const cohortMap = {};
  cohorts.forEach(c=>cohortMap[c.id]=c);
  const tbody = document.getElementById('adm-cert-tbody');
  if(!tbody) return;
  if(certified.length===0){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:rgba(255,255,255,0.4);padding:24px">No certified students yet.</td></tr>';
    return;
  }
  tbody.innerHTML = certified.map(s=>{
    const cObj = cohortMap[s.cohort];
    const cName = cObj ? cObj.name.replace(' (Current)','') : (s.cohort||'—');
    const isCur = cObj ? cObj.active : false;
    const isAdv = (s.examScore||0) >= 95;
    return `<tr>
      <td style="font-family:monospace;font-size:11px">${s.sid||'—'}</td>
      <td><strong>${s.name||'—'}</strong>${s.nick?` <span style="font-size:10px;color:rgba(255,255,255,0.4)">(${s.nick})</span>`:''}</td>
      <td><span class="cohort-badge ${isCur?'current':'alumni'}" style="font-size:10px">${cName}</span></td>
      <td style="text-align:center;font-weight:700;color:${isAdv?'#D4A017':'#22c55e'}">${s.examScore||0}%</td>
      <td>${isAdv ? '🏅 Advanced' : '✓ Standard'}</td>
      <td style="font-size:10px;color:rgba(255,255,255,0.5)">Prof. Hyejoon Yoon</td>
      <td><button class="btn-rg" style="padding:4px 10px;font-size:10px;border-radius:14px" onclick="viewStudentCert('${s.sid}')">📜 Preview</button></td>
    </tr>`;
  }).join('');
}

function addNewCohort(){
  const name = (document.getElementById('new-cohort-name')?.value||'').trim();
  const id   = (document.getElementById('new-cohort-id')?.value||'').trim();
  const year = parseInt(document.getElementById('new-cohort-year')?.value||'2026',10);
  const setActive = document.getElementById('new-cohort-active')?.checked ?? true;
  if(!name || !id){ alert('Please fill in Semester Title and Cohort Code.'); return; }
  const cohorts = getCohorts();
  if(cohorts.find(c=>c.id===id)){ alert(`Code "${id}" already exists.`); return; }
  if(setActive){ cohorts.forEach(c=>{ c.active=false; c.name=c.name.replace(' (Current)',''); }); }
  const semester = id.endsWith('-1')?'Spring':id.endsWith('-2')?'Fall':name;
  cohorts.unshift({ id, name: name+(setActive?' (Current)':''), semester, year, active:setActive });
  saveCohorts(cohorts);
  populateCohortSelects();
  renderAdminCohorts();
  if(document.getElementById('new-cohort-name')) document.getElementById('new-cohort-name').value='';
  if(document.getElementById('new-cohort-id'))   document.getElementById('new-cohort-id').value='';
  const statActiveCohort = document.getElementById('adm-stat-active-cohort');
  if(statActiveCohort && setActive) statActiveCohort.textContent = name;
  const msg = document.createElement('div');
  msg.style.cssText='position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;font-weight:700;font-size:13px;padding:10px 22px;border-radius:30px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
  msg.textContent = `✓ Cohort "${name}" created!`;
  document.body.appendChild(msg);
  setTimeout(()=>msg.remove(), 2500);
}

function toggleCohortActive(id){
  const cohorts = getCohorts();
  const target = cohorts.find(c=>c.id===id);
  if(!target) return;
  if(!target.active){
    cohorts.forEach(c=>{ c.active=(c.id===id); c.name=c.name.replace(' (Current)',''); });
    target.name += ' (Current)';
  } else {
    target.active = false;
    target.name = target.name.replace(' (Current)','');
  }
  saveCohorts(cohorts);
  populateCohortSelects();
  renderAdminCohorts();
  const statActiveCohort = document.getElementById('adm-stat-active-cohort');
  if(statActiveCohort) statActiveCohort.textContent = getActiveCohort().name.replace(' (Current)','');
}

function viewStudentCert(sid){
  const s = adminCachedStudents.find(x=>x.sid===sid);
  if(!s || !s.examPassed) return;
  const advanced = (s.examScore||0) >= 95;
  const dateStr = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const cohortObj = getCohorts().find(c=>c.id===s.cohort);
  const cohortName = cohortObj ? cohortObj.name.replace(' (Current)','') : (s.cohort||'2026 Spring');
  document.getElementById('cert-level-badge').textContent = advanced ? '🏅 ADVANCED LEVEL 2 CERTIFICATE' : '📜 TOPIK I CERTIFICATE';
  document.getElementById('cert-sub').textContent = `Score: ${s.examScore||0}% · ${advanced?'Advanced':'Standard'} · Korean Language Program`;
  document.getElementById('cert-preview').innerHTML = buildCertHTML(s.name||'STUDENT', s.sid||'', s.examScore||0, advanced, dateStr, cohortName);
  show('cert-screen');
}

function exportStudentsCSV(){
  if(!adminCachedStudents.length){ alert('No data to export. Open Overview first.'); return; }
  const cohorts = getCohorts();
  const cohortMap = {};
  cohorts.forEach(c=>cohortMap[c.id]=c);
  const headers = ['Student ID','Name','Nickname','Cohort','Semester','Words Mastered','Levels Done','Exam Passed','Exam Score %','Last Seen'];
  const rows = adminCachedStudents.map(s=>{
    const cObj = cohortMap[s.cohort];
    const cName = cObj ? cObj.name.replace(' (Current)','') : (s.cohort||'');
    return [
      s.sid||'', `"${(s.name||'').replace(/"/g,'""')}"`, `"${(s.nick||'').replace(/"/g,'""')}"`,
      `"${cName.replace(/"/g,'""')}"`, cObj ? `${cObj.semester} ${cObj.year}` : '',
      s.words||0, s.levels||0, s.examPassed?'YES':'NO', s.examScore||0,
      s.lastSeen ? new Date(s.lastSeen).toLocaleDateString() : ''
    ].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`KDU_VocabKing_Roster_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── PWA SERVICE WORKER REGISTRATION (Phase 6) ──
if(typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined' && location.protocol.startsWith('http')){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

// ── INIT ──
load();
async function initApp(){
  if(g.user.sid){
    dbUpdateLastSeen(g.user.sid);
    const dbFails = await dbLoadMyFails(g.user.sid);
    if(dbFails && dbFails.length > 0){
      dbFails.forEach(f=>{
        if(!g.fails.find(x=>x.w===f.word_kr)){
          g.fails.push({w:f.word_kr, e:f.word_en, t:f.word_type||'명사'});
        }
      });
      save();
    }
  }
  initHome();
  if(!g.user.name && !localStorage.getItem('topik_skip')){show('intro');}
  else{show('home');}
}
initApp();
