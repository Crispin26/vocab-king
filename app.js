// ═══════════════════════════════════════════════════
// 쏙쏙 어휘왕 TOPIK I · Vocab King v3 — Application Logic
// Modularized & Upgraded: TTS, Keyboard Nav, Study Mode,
// Searchable Dictionary, POS-Matched Distractors
// ═══════════════════════════════════════════════════

// ── STATE ──
// All learning data lives in Supabase. This object is only the in-memory copy
// loaded after sign-in (guests keep it in memory only, nothing is saved).
let currentAdmin = null;   // admins row of the signed-in user, if any
function emptyUser(){ return {name:'',sid:'',nick:'',cohort:'',email:''}; }
let g = {
  progDay:1, bookDay:1, words:[],
  queue:[], fails:[], sfails:[],
  ok:0, bad:0, idx:0, streak:0, best:0, runBest:0, answered:false,
  done:{}, dfails:{},
  user:emptyUser(),
  exam:null,      // best final exam result: {best, passed, advanced, date}
  guest:false,
  mode:'level', // 'level', 'study', 'fr', 'exam'
  studyIdx:0
};

function resetProgressState(){
  g.fails=[]; g.done={}; g.dfails={}; g.best=0; g.exam=null;
}

// ═══════════════════════════════════════════════════
// SUPABASE CLIENT
// The anon key is public by design; Row Level Security (supabase/setup.sql)
// decides what each signed-in user may read or write.
// supabase-js keeps the sign-in session token in browser storage; no app data is stored there.
// ═══════════════════════════════════════════════════
const SB_URL = "https://rrcinkfoszcpoblgnkeb.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyY2lua2Zvc3pjcG9ibGdua2ViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Nzk3MjIsImV4cCI6MjA5ODA1NTcyMn0.4N0kdFCraOXCO3fpf_5XF7lN65X9pIXqAODFqyd5rqI";

// Read the auth redirect type (signup / recovery) before supabase-js clears the URL hash
const AUTH_REDIRECT = (()=>{
  const p = new URLSearchParams((location.hash||'').replace(/^#/,''));
  return { type: p.get('type'), error: p.get('error_description') };
})();

const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
});

let passwordRecovery = AUTH_REDIRECT.type === 'recovery';
sb.auth.onAuthStateChange(event=>{
  if(event === 'PASSWORD_RECOVERY'){
    passwordRecovery = true;
    show('register'); switchTab('newpass');
  }
});

function appUrl(){ return location.origin + location.pathname; }

function toast(msg, type='ok'){
  const el = document.createElement('div');
  el.className = 'vk-toast' + (type === 'error' ? ' error' : '');
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

function reportDbError(error, what){
  console.warn('DB error' + (what ? ' (' + what + ')' : '') + ':', error && error.message);
  toast(`⚠️ Couldn't save ${what || 'your progress'}. Check your connection.`, 'error');
}

// Fetch every row of a table, 1000 at a time (Supabase returns at most 1000 rows per request)
async function fetchAll(table, columns='*'){
  const rows = [];
  for(let from=0; ; from+=1000){
    const { data, error } = await sb.from(table).select(columns).range(from, from+999);
    if(error){ console.warn('DB error:', error.message); return rows; }
    rows.push(...data);
    if(data.length < 1000) return rows;
  }
}

// ── COHORTS & SETTINGS (loaded from the database at start-up) ──
let cohortsCache = [];
let certConfigCache = {};
let contactConfigCache = {};

function getCohorts(){ return cohortsCache; }
function getActiveCohort(){
  return cohortsCache.find(c => c.active) || cohortsCache[0] || { id:'', name:'', semester:'', year:'', active:false };
}

async function loadCohorts(){
  const { data, error } = await sb.from('cohorts').select('*').order('year', {ascending:false}).order('id', {ascending:false});
  if(error){ console.warn('DB error (cohorts):', error.message); return; }
  cohortsCache = data || [];
}

async function loadSettings(){
  const { data, error } = await sb.from('app_settings').select('key,value');
  if(error){ console.warn('DB error (settings):', error.message); return; }
  (data || []).forEach(r=>{
    if(r.key === 'cert_config') certConfigCache = r.value || {};
    if(r.key === 'contact_config') contactConfigCache = r.value || {};
  });
}

async function saveSetting(key, value){
  const { data:{ user } } = await sb.auth.getUser();
  const { error } = await sb.from('app_settings')
    .upsert({ key, value, updated_at:new Date().toISOString(), updated_by:user ? user.id : null });
  if(error) throw error;
}

function populateCohortSelects(){
  const cohorts = getCohorts();
  const regSel = document.getElementById('reg-cohort');
  if(regSel){
    const prev = regSel.value;
    regSel.innerHTML = cohorts.length ? cohorts.map(c => `
      <option value="${esc(c.id)}" ${(prev ? prev === c.id : c.active) ? 'selected' : ''}>
        ${esc(c.name)} ${c.active ? '★ (Current)' : ''}
      </option>`).join('')
      : '<option value="">Current semester</option>';
  }
  const lbSel = document.getElementById('lb-cohort-filter');
  if(lbSel){
    const prev = lbSel.value || 'all';
    lbSel.innerHTML = '<option value="all">All Semesters (전체 학기)</option>' +
      cohorts.map(c => `<option value="${esc(c.id)}" ${prev === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }
  const admSel = document.getElementById('adm-student-cohort');
  if(admSel){
    const prev = admSel.value || 'all';
    admSel.innerHTML = '<option value="all">All Cohorts (전체 학기)</option>' +
      cohorts.map(c => `<option value="${esc(c.id)}" ${prev === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }
}

function getExamRecord(){ return g.exam; }

// ── LOAD THE SIGNED-IN USER'S PROFILE & PROGRESS ──
async function loadMyData(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) return false;
  g.guest = false;
  resetProgressState();

  const [stuRes, admRes] = await Promise.all([
    sb.from('students').select('*').eq('user_id', user.id).maybeSingle(),
    sb.from('admins').select('*').eq('user_id', user.id).maybeSingle()
  ]);
  currentAdmin = admRes.data || null;
  const stu = stuRes.data;

  if(!stu){
    // Admin accounts have no student profile
    g.user = { ...emptyUser(), name: currentAdmin ? currentAdmin.name : '', nick: currentAdmin ? currentAdmin.name.split(' ')[0] : '', email:user.email };
    return true;
  }

  g.user = { name:stu.name, sid:stu.student_id, nick:stu.nickname || '', cohort:stu.cohort || getActiveCohort().id, email:user.email };
  const [progRes, failRes] = await Promise.all([
    sb.from('progress').select('*').eq('student_id', stu.student_id),
    sb.from('fail_words').select('word_kr,word_en,word_type').eq('student_id', stu.student_id)
  ]);
  (progRes.data || []).forEach(p=>{
    if(p.level_key === 'final_exam'){
      g.exam = { best:p.score_pct || 0, passed:!!p.completed, advanced:(p.score_pct || 0) >= ADV_PCT, date:p.updated_at };
      return;
    }
    g.done[p.level_key] = p.completed;
    g.dfails[p.level_key] = p.wrong || 0;
    g.best = Math.max(g.best, p.best_streak || 0);
  });
  g.fails = (failRes.data || []).map(f=>({ w:f.word_kr, e:f.word_en, t:f.word_type || '명사' }));
  sb.rpc('touch_last_seen').then(({error})=>{ if(error) console.warn('DB error (last seen):', error.message); });
  return true;
}

// ── SAVING RESULTS (database functions check the signed-in student on the server) ──
async function dbSaveProgress(sid, progDay, bookDay, correct, wrong, pct, streak){
  if(!sid) return;
  const { error } = await sb.rpc('record_level_result', {
    p_prog_day:progDay, p_book_day:bookDay, p_correct:correct, p_wrong:wrong, p_best_streak:Math.min(streak, 30)
  });
  if(error) reportDbError(error, 'your level result');
}

async function dbSaveFailWords(sid, fails, progDay, bookDay){
  if(!sid || !fails.length) return;
  const { error } = await sb.rpc('add_fail_words', {
    p_words: fails.map(f=>({ w:f.w, e:f.e, t:f.t || '' })), p_prog_day:progDay, p_book_day:bookDay
  });
  if(error) reportDbError(error, 'your review words');
}

async function dbClearMasteredWords(sid, words){
  if(!sid || !words.length) return;
  const { error } = await sb.rpc('clear_fail_words', { p_words: words.map(w=>w.w) });
  if(error) reportDbError(error, 'your review words');
}

// ═══════════════════════════════════════════════════
// ACCOUNTS: REGISTER · SIGN IN · VERIFY EMAIL · RESET PASSWORD
// ═══════════════════════════════════════════════════
let pendingVerifyEmail = '';

function setMsg(id, text){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
}

function setBusy(btnId, busy, busyText){
  const btn = document.getElementById(btnId);
  if(!btn) return;
  if(busy){ btn.dataset.label = btn.textContent; btn.textContent = busyText; btn.disabled = true; }
  else { if(btn.dataset.label) btn.textContent = btn.dataset.label; btn.disabled = false; }
}

function switchTab(tab){
  ['login','new','check','forgot','newpass'].forEach(t=>{
    const panel = document.getElementById('panel-' + t);
    if(panel) panel.style.display = (t === tab) ? 'flex' : 'none';
  });
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-new').classList.toggle('active', tab === 'new');
  document.getElementById('auth-tabs').style.display = (tab === 'newpass') ? 'none' : 'flex';
  document.getElementById('rskip').style.display = (tab === 'newpass') ? 'none' : 'block';
  ['reg-err','login-err','login-msg','forgot-err','forgot-msg','newpass-err'].forEach(id=>setMsg(id, ''));
  if(tab === 'new') populateCohortSelects();
}

// PGRST202 = database function missing, i.e. supabase/setup.sql has not been run yet
function serverErrorText(e){
  return (e && e.code === 'PGRST202')
    ? 'The database is not set up yet. An administrator needs to run supabase/setup.sql.'
    : 'Could not reach the server. Check your connection and try again.';
}

async function doRegister(){
  const val = id => (document.getElementById(id).value || '').trim();
  const name = val('reg-name').toUpperCase();
  const sid = val('reg-id').toUpperCase();
  const email = val('reg-email').toLowerCase();
  const nick = val('reg-nick');
  const cohort = document.getElementById('reg-cohort').value || getActiveCohort().id;
  const pass = document.getElementById('reg-pass').value;
  const pass2 = document.getElementById('reg-pass2').value;

  if(!name) return setMsg('reg-err', 'Please enter your full name.');
  if(!/^[A-Z0-9-]{3,20}$/.test(sid)) return setMsg('reg-err', 'Student ID must be 3–20 letters or numbers.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg('reg-err', 'Please enter a valid email address.');
  if(!nick) return setMsg('reg-err', 'Please choose a nickname for the leaderboard.');
  if(pass.length < 8) return setMsg('reg-err', 'Password must be at least 8 characters.');
  if(pass !== pass2) return setMsg('reg-err', 'The two passwords do not match.');
  setMsg('reg-err', '');
  setBusy('reg-btn', true, 'Creating account... ⏳');

  try{
    const { data:available, error:availErr } = await sb.rpc('is_student_id_available', { p_student_id:sid });
    if(availErr) throw availErr;
    if(available === false){
      return setMsg('reg-err', 'This Student ID is already registered. Sign in, or use "Forgot your password?".');
    }

    const { data, error } = await sb.auth.signUp({
      email, password:pass,
      options:{ emailRedirectTo:appUrl(), data:{ student_id:sid, name, nickname:nick, cohort } }
    });
    if(error){
      if(/already registered/i.test(error.message)) return setMsg('reg-err', 'An account with this email already exists. Please sign in.');
      if(/database error/i.test(error.message)) return setMsg('reg-err', 'This Student ID is already registered. Please sign in.');
      if(/rate limit/i.test(error.message)) return setMsg('reg-err', 'Too many sign-ups right now. Please try again in a few minutes.');
      return setMsg('reg-err', error.message);
    }
    // With email confirmation on, an existing email returns a user with no identities
    if(data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){
      return setMsg('reg-err', 'An account with this email already exists. Please sign in.');
    }
    if(data.session){ await afterSignIn(); return; }

    pendingVerifyEmail = email;
    document.getElementById('check-msg').innerHTML =
      `We sent a welcome email with a verification link to <strong>${esc(email)}</strong>.<br>` +
      `Click the link to activate your account, then sign in with your Student ID <strong>${esc(sid)}</strong> or your email.`;
    switchTab('check');
    document.getElementById('login-id').value = sid;
  }catch(e){
    setMsg('reg-err', serverErrorText(e));
    console.warn(e);
  }finally{
    setBusy('reg-btn', false);
  }
}

async function doLogin(){
  const identifier = (document.getElementById('login-id').value || '').trim();
  const pass = document.getElementById('login-pass').value;
  document.getElementById('resend-btn').style.display = 'none';
  setMsg('login-msg', '');
  if(!identifier || !pass) return setMsg('login-err', 'Please enter your Student ID or email, and your password.');
  setMsg('login-err', '');
  setBusy('login-btn', true, 'Signing in... ⏳');

  try{
    const { data:email, error:lookupErr } = await sb.rpc('login_email_for', { p_identifier:identifier });
    if(lookupErr) throw lookupErr;
    if(!email){
      return setMsg('login-err', 'No account found for that Student ID. Used the old app? Create a new account with the same Student ID and your progress will be kept.');
    }
    const { error } = await sb.auth.signInWithPassword({ email, password:pass });
    if(error){
      if(/not confirmed/i.test(error.message)){
        pendingVerifyEmail = email;
        document.getElementById('resend-btn').style.display = 'block';
        return setMsg('login-err', 'Please verify your email first. Check your inbox (and spam folder).');
      }
      return setMsg('login-err', 'Incorrect Student ID / email or password.');
    }
    document.getElementById('login-pass').value = '';
    await afterSignIn();
  }catch(e){
    setMsg('login-err', serverErrorText(e));
    console.warn(e);
  }finally{
    setBusy('login-btn', false);
  }
}

async function resendVerification(){
  if(!pendingVerifyEmail) return;
  const { error } = await sb.auth.resend({ type:'signup', email:pendingVerifyEmail, options:{ emailRedirectTo:appUrl() } });
  if(error) return setMsg('login-err', /rate limit/i.test(error.message) ? 'Please wait a minute before asking for another email.' : error.message);
  setMsg('login-err', '');
  setMsg('login-msg', '📧 Verification email sent again. Check your inbox.');
}

async function sendPasswordReset(){
  const email = (document.getElementById('forgot-email').value || '').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg('forgot-err', 'Please enter a valid email address.');
  setMsg('forgot-err', '');
  setBusy('forgot-btn', true, 'Sending... ⏳');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo:appUrl() });
  setBusy('forgot-btn', false);
  if(error) return setMsg('forgot-err', /rate limit/i.test(error.message) ? 'Please wait a minute before asking for another email.' : error.message);
  // Same message whether or not the account exists, so emails can't be probed
  setMsg('forgot-msg', '📧 If an account exists for this email, a reset link is on its way.');
}

async function saveNewPassword(){
  const p1 = document.getElementById('newpass-1').value;
  const p2 = document.getElementById('newpass-2').value;
  if(p1.length < 8) return setMsg('newpass-err', 'Password must be at least 8 characters.');
  if(p1 !== p2) return setMsg('newpass-err', 'The two passwords do not match.');
  setBusy('newpass-btn', true, 'Saving... ⏳');
  const { error } = await sb.auth.updateUser({ password:p1 });
  setBusy('newpass-btn', false);
  if(error) return setMsg('newpass-err', error.message);
  passwordRecovery = false;
  toast('✓ Password updated');
  await afterSignIn();
}

async function afterSignIn(){
  await loadMyData();
  if(location.hash) history.replaceState(null, '', appUrl());
  initHome();
  show('home');
}

async function doLogout(){
  if(!g.guest && !confirm('Sign out of Vocab-King?')) return;
  await sb.auth.signOut();
  currentAdmin = null;
  g.guest = false;
  g.user = emptyUser();
  resetProgressState();
  show('register'); switchTab('login');
}

function skipReg(){
  g.guest = true;
  g.user = { ...emptyUser(), cohort:getActiveCohort().id };
  resetProgressState();
  initHome(); show('home');
  toast('Guest mode: your progress will not be saved.');
}

function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
function allWords(){return Object.values(VOCAB).flat().map(bd=>bd.words).flat();}
function levelKey(progDay,bookDay){return `${progDay}_${bookDay}`;}
function cleanKR(str){return String(str||'').replace(/[¹²³]/g,'').trim();}
function getSentence(w){return SENTENCES[w] || SENTENCES[cleanKR(w)] || null;}

// Escape text before inserting it into innerHTML (names, nicknames, admin-edited config)
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Only allow http(s)/mailto/tel links from admin-edited config
function safeUrl(u){
  const s = String(u || '').trim();
  return /^(https?:|mailto:|tel:)/i.test(s) ? s : '#';
}

// ── TYPED ANSWER CHECKING ──
// Strips filler ("to be", "to", articles, parentheticals) so "close" matches "to be close / near",
// but a fragment like "to b" or "the" no longer matches unrelated answers.
function normalizeMeaning(str){
  let s = String(str||'').toLowerCase()
    .replace(/\([^)]*\)/g,' ')
    .replace(/[^a-z0-9\s'-]/g,' ')
    .replace(/\s+/g,' ').trim();
  let prev;
  do { prev = s; s = s.replace(/^(to be|to|a|an|the)\s+/,''); } while(s !== prev);
  return s;
}
function editDistance(a,b){
  const dp = Array.from({length:a.length+1},(_,i)=>[i]);
  for(let j=1;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    }
  }
  return dp[a.length][b.length];
}
function matchesMeaning(typed, answer){
  const t = normalizeMeaning(typed);
  if(!t) return false;
  const parts = [answer, ...String(answer||'').split(/[\/,;]/)].map(normalizeMeaning).filter(Boolean);
  if(normalizeMeaning(String(typed).replace(/[\/,;]/g,' ')) === normalizeMeaning(String(answer).replace(/[\/,;]/g,' '))) return true;
  return parts.some(p => p === t || (p.length >= 5 && editDistance(p, t) <= 1));
}
function matchesKorean(typed, word){
  const t = String(typed||'').replace(/\s+/g,'');
  return t.length > 0 && t === cleanKR(word).replace(/\s+/g,'');
}

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

// ── HOME (With Phase 2 "Study 30 Words" & "Start Quiz" options) ──
function initHome(){
  populateCohortSelects();
  const disp=g.user.nick||g.user.name.split(' ')[0]||'';
  const cohortObj = getCohorts().find(c=>c.id===g.user.cohort);
  const cohortName = cohortObj ? cohortObj.name.replace(' (Current)','') : (g.user.cohort || '2026 Spring');
  const isCurrent = cohortObj ? cohortObj.active : true;
  document.getElementById('welcome-strip').innerHTML=g.guest
    ? `<span>👀 Guest mode — progress is not saved.</span> <span class="auth-link" onclick="doLogout()">Sign in or register</span>`
    : disp
    ? `<span>👋 안녕하세요, <strong>${esc(disp)}</strong>!</span>${g.user.sid ? ` <span class="cohort-badge ${isCurrent?'current':'alumni'}">${esc(cohortName)}</span>` : ''}`
    : '';
  const logoutBtn=document.getElementById('logout-btn');
  if(logoutBtn) logoutBtn.title = g.guest ? 'Sign in' : 'Sign out';

  const totalDone=Object.values(g.done).filter(Boolean).length;
  document.getElementById('sL').textContent=totalDone;
  document.getElementById('sF').textContent=g.fails.length;
  document.getElementById('sS').textContent=g.best;
  document.getElementById('fcnt').textContent=g.fails.length;
  document.getElementById('fail-btn').style.display=g.fails.length>0?'flex':'none';
  const myCertBtn=document.getElementById('my-cert-btn');
  if(myCertBtn){
    const rec=getExamRecord();
    myCertBtn.style.display=(rec && rec.passed)?'block':'none';
    if(rec && rec.passed) myCertBtn.textContent=`📜  View My Certificate · 내 수료증 (${rec.best}%)`;
  }

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
  populateCohortSelects();
  const top3 = document.getElementById('lb-top3');
  const rest = document.getElementById('lb-list');
  if(top3) top3.innerHTML='<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.4);padding:20px">Loading... ⏳</div>';
  if(rest) rest.innerHTML='';

  const { data:{ session } } = await sb.auth.getSession();
  if(!session){
    cachedLBData = [];
    if(top3) top3.innerHTML = '';
    if(rest) rest.innerHTML = '<div class="lb-empty">Sign in to see the class leaderboard 🏆</div>';
    return;
  }

  const { data, error } = await sb.from('leaderboard').select('*')
    .order('words_mastered', {ascending:false}).order('levels_done', {ascending:false}).limit(500);
  if(error){
    if(top3) top3.innerHTML = '';
    if(rest) rest.innerHTML = '<div class="lb-empty">Could not load the leaderboard. Check your connection.</div>';
    return;
  }

  cachedLBData = (data || []).map(r => ({
    name: r.display_name || 'Student',
    nick: r.display_name || '',
    cohort: r.cohort,
    words: r.words_mastered || 0,
    levels: r.levels_done || 0,
    isMe: !!r.is_me
  }));

  const filterSelect = document.getElementById('lb-cohort-filter');
  displayLBList(filterSelect ? filterSelect.value : 'all');
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
        <div class="lb-pname">${esc(e.nick || String(e.name||'').split(' ')[0])}</div>
        <div class="lb-pscore">${e.words}</div>
        <div class="lb-psub">words mastered</div>
        <div style="margin-top:6px"><span class="cohort-badge ${isCur ? 'current' : 'alumni'}" style="font-size:10px;padding:2px 8px">${esc(cName)}</span></div>
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
            <span class="lb-name">${esc(e.nick || String(e.name||'').split(' ')[0])}</span>
            <span class="cohort-badge ${isCur ? 'current' : 'alumni'}" style="font-size:10px;padding:1px 6px">${esc(cName)}</span>
          </div>
          <div class="lb-meta">${e.levels} levels done${e.isMe ? ' · <strong style="color:var(--gold)">You</strong>' : ''}</div>
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
  g.sfails=[]; g.ok=g.bad=g.idx=g.streak=g.runBest=0; g.answered=false;
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
  const ok = matchesMeaning(document.getElementById('tfield').value, word.e);

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
      `<div class="frow"><span class="fkr">${esc(f.w)}</span><span class="fen">${esc(f.e)}</span></div>`
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
  g.qt=qt;
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
      if(ok){b.classList.add('correct');g.ok++;g.streak++;g.runBest=Math.max(g.runBest,g.streak);if(g.streak>g.best)g.best=g.streak;}
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
  const tf=document.getElementById('tfield');
  g.answered=true;
  const ok = g.qt==='type-en-kr' ? matchesKorean(tf.value, q.w) : matchesMeaning(tf.value, q.e);
  if(ok){tf.classList.add('correct');g.ok++;g.streak++;g.runBest=Math.max(g.runBest,g.streak);if(g.streak>g.best)g.best=g.streak;}
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
  const mastered=g.queue.filter(w=>!g.sfails.find(f=>f.w===w.w));
  // Same rules as the database: new fails are added, words answered correctly leave the review list,
  // and a completed level stays completed even after a weaker retry
  const masteredSet=new Set(mastered.map(w=>w.w));
  g.fails=g.fails.filter(f=>!masteredSet.has(f.w));
  g.sfails.forEach(f=>{if(!g.fails.find(x=>x.w===f.w))g.fails.push(f);});
  g.done[k]=!!g.done[k] || g.ok>=24;
  g.dfails[k]=g.sfails.length;

  if(g.user.sid && g.mode==='level'){
    const pct2=(g.ok+g.bad)>0?Math.round(g.ok/(g.ok+g.bad)*100):0;
    dbSaveProgress(g.user.sid, g.progDay, g.bookDay, g.ok, g.bad, pct2, g.runBest);
    dbSaveFailWords(g.user.sid, g.sfails, g.progDay, g.bookDay);
    dbClearMasteredWords(g.user.sid, mastered);
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
    fl.innerHTML=g.sfails.map(f=>`<div class="frow"><span class="fkr">${esc(f.w)}</span><span class="fen">${esc(f.e)}</span></div>`).join('');
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
      const synList = (typeof SYNONYMS !== 'undefined') ? (SYNONYMS[cleanKR(word.w)] || []) : [];
      if(synList.length){
        const syn = synList[Math.floor(Math.random()*synList.length)];
        // Exclude the word itself and every valid synonym so only one option is correct
        const blocked = new Set([cleanKR(word.w), ...synList]);
        const wrongOpts=others.filter(o=>!blocked.has(cleanKR(o.w))).map(o=>o.w);
        for(const x of shuffle(all.filter(x=>x.t===word.t))){
          if(wrongOpts.length>=3) break;
          if(!blocked.has(cleanKR(x.w)) && !wrongOpts.some(w=>cleanKR(w)===cleanKR(x.w))) wrongOpts.push(x.w);
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

  // Keep the best attempt; a later, lower score never replaces a pass (the database applies the same rule)
  const prev = getExamRecord();
  if(!prev || pct > (prev.best||0)){
    g.exam = { best:pct, passed:passed || !!(prev && prev.passed), advanced, date:new Date().toISOString() };
  }
  if(g.user.sid){
    sb.rpc('record_exam_result', { p_correct:examCorrect, p_total:EXAM_TOTAL }).then(({ data, error })=>{
      if(error) return reportDbError(error, 'your exam result');
      if(data) g.exam = { best:data.best, passed:data.passed, advanced:data.best >= ADV_PCT, date:data.date };
    });
  }
  if(passed){showCertificate(pct,advanced);}
  else{
    document.getElementById('fail-score-display').textContent=pct+'%';
    document.getElementById('fail-correct-display').textContent=examCorrect+' / '+EXAM_TOTAL+' correct';
    document.getElementById('exam-fail-words').innerHTML=examWrong.slice(0,10).map(w=>
      `<div class="frow"><span class="fkr">${esc(w.w)}</span><span class="fen">${esc(w.e)}</span></div>`
    ).join('')+(examWrong.length>10?`<div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:center;padding:6px">+${examWrong.length-10} more</div>`:'');
    show('exam-failed');
  }
}

// ── CERTIFICATE (Customizable by Faculty & Admin) ──
const DEFAULT_CERT_CONFIG = {
  institution: 'KyungDong University Global',
  department: 'Korean Language Program · 쏙쏙 어휘왕 (Vocab-King)',
  title: 'Official Certificate of Academic Achievement',
  body: 'has successfully completed the intensive 쏙쏙 어휘왕 TOPIK I Vocabulary Curriculum, demonstrating certified mastery of 1,470 Korean vocabulary words across 5 program days, and fulfilling academic course evaluation criteria with a final examination score of:',
  sigName: 'Prof. Hyejoon Yoon',
  sigTitle: 'Academic Supervisor & Course Evaluator',
  sigDept: 'Korean Language Program',
  location: 'Goseong Global Campus, KyungDong University, South Korea',
  credits: 'Project Initiated & Developed by ALINGILYA CRISPIN NJEWA (Lead Developer) · Course Evaluation by Prof. Hyejoon Yoon',
  passPct: 80,
  honorsPct: 95
};

function getCertConfig(){
  return { ...DEFAULT_CERT_CONFIG, ...certConfigCache };
}

async function saveCertConfig(){
  const cfg = {
    institution: document.getElementById('cert-cfg-inst')?.value.trim() || DEFAULT_CERT_CONFIG.institution,
    department: document.getElementById('cert-cfg-sub')?.value.trim() || DEFAULT_CERT_CONFIG.department,
    title: document.getElementById('cert-cfg-title')?.value.trim() || DEFAULT_CERT_CONFIG.title,
    sigName: document.getElementById('cert-cfg-sig-name')?.value.trim() || DEFAULT_CERT_CONFIG.sigName,
    sigTitle: document.getElementById('cert-cfg-sig-title')?.value.trim() || DEFAULT_CERT_CONFIG.sigTitle,
    location: document.getElementById('cert-cfg-location')?.value.trim() || DEFAULT_CERT_CONFIG.location,
    body: document.getElementById('cert-cfg-body')?.value.trim() || DEFAULT_CERT_CONFIG.body,
    credits: document.getElementById('cert-cfg-credits')?.value.trim() || DEFAULT_CERT_CONFIG.credits,
    passPct: DEFAULT_CERT_CONFIG.passPct,
    honorsPct: DEFAULT_CERT_CONFIG.honorsPct
  };
  try {
    await saveSetting('cert_config', cfg);
    certConfigCache = cfg;
    toast('✓ Certificate template saved for everyone');
  } catch(e){
    toast('Failed to save certificate template: ' + e.message, 'error');
  }
}

function populateCertConfigForm(){
  const cfg = getCertConfig();
  const setVal = (id, val)=>{ const el=document.getElementById(id); if(el) el.value = val; };
  setVal('cert-cfg-inst', cfg.institution);
  setVal('cert-cfg-sub', cfg.department);
  setVal('cert-cfg-title', cfg.title);
  setVal('cert-cfg-sig-name', cfg.sigName);
  setVal('cert-cfg-sig-title', cfg.sigTitle);
  setVal('cert-cfg-location', cfg.location);
  setVal('cert-cfg-body', cfg.body);
  setVal('cert-cfg-credits', cfg.credits);
}

function previewCustomCert(){
  const cfg = getCertConfig();
  const dateStr = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  showCertificate(98, true, {
    name: 'SAMPLE STUDENT (샘플 학생)',
    sid: 'KDU2026-PREVIEW',
    cohort: '2026-1'
  });
}

function openMyCertificate(){
  const rec = getExamRecord();
  if(!rec || !rec.passed) return;
  showCertificate(rec.best, rec.advanced, null, rec.date);
}

function showCertificate(pct,advanced,customStudent,issuedISO){
  document.getElementById('cert-level-badge').textContent=advanced?'🏅 ADVANCED LEVEL 2 CERTIFICATE':'📜 TOPIK I CERTIFICATE';
  document.getElementById('cert-sub').textContent=`Score: ${pct}% · ${advanced?'Advanced':'Standard'} · Korean Language Program`;
  const name=customStudent?.name || g.user.name || 'STUDENT';
  const sid=customStudent?.sid || g.user.sid || '';
  const cohortId=customStudent?.cohort || g.user.cohort || getActiveCohort().id;
  const cohortObj=getCohorts().find(c=>c.id===cohortId);
  const cohortName=cohortObj ? cohortObj.name.replace(' (Current)','') : (cohortId || '2026 Spring');
  const dateStr=(issuedISO ? new Date(issuedISO) : new Date()).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  document.getElementById('cert-preview').innerHTML=buildCertHTML(name,sid,pct,advanced,dateStr,cohortName);
  show('cert-screen');
}

function buildCertHTML(name,sid,pct,advanced,dateStr,cohortName){
  const cfg = getCertConfig();
  const bc=advanced?'#D97706':'#4F46E5';
  const ac=advanced?'#F59E0B':'#38BDF8';
  const lt=advanced?'Advanced Honors — TOPIK I Ready for Level 2':'TOPIK I Vocabulary Completion';
  const logo = (typeof VK_LOGO_B64 !== 'undefined' && VK_LOGO_B64)
    ? `data:image/jpeg;base64,${VK_LOGO_B64}`
    : 'vk_logo.jpg';
  const cohortDisplay = cohortName || '2026 Spring Semester';

  return `<div id="cert-content" style="font-family:Georgia,serif;background:#FEFEFE;padding:32px 28px;border:6px solid ${bc};box-shadow:inset 0 0 0 3px ${ac};">
    <div style="text-align:center;margin-bottom:14px">
      <img src="${logo}" style="width:72px;height:auto;margin-bottom:6px;object-fit:contain" alt="Vocab-King Logo">
      <div style="font-size:12px;font-weight:700;color:${bc};letter-spacing:3px;text-transform:uppercase">${esc(cfg.institution)}</div>
      <div style="font-size:10px;font-weight:600;color:#6B7280;letter-spacing:2px;text-transform:uppercase;margin-top:2px">${esc(cfg.department)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,${bc})"></div>
      <div style="color:${ac};font-size:14px">✦</div>
      <div style="flex:1;height:1px;background:linear-gradient(to left,transparent,${bc})"></div>
    </div>
    <div style="text-align:center;margin-bottom:12px">
      <div style="font-size:9px;letter-spacing:4px;color:#888;text-transform:uppercase;margin-bottom:4px">${esc(cfg.title)}</div>
      <div style="font-size:19px;font-weight:700;color:#1a1a2e">${lt}</div>
    </div>
    <div style="text-align:center;font-size:11px;color:#777;margin-bottom:4px;font-style:italic">This is proudly awarded to</div>
    <div style="text-align:center;font-size:23px;font-weight:700;color:#1a1a2e;margin-bottom:4px;letter-spacing:0.5px">${esc(name)}</div>
    <div style="text-align:center;font-size:11px;color:#666;margin-bottom:12px">
      <span>Student ID: <strong>${esc(sid)}</strong></span> · <span>Semester Cohort: <strong>${esc(cohortDisplay)}</strong></span>
    </div>
    <div style="text-align:center;font-size:11.5px;color:#444;line-height:1.65;margin-bottom:14px;padding:0 8px">
      ${esc(cfg.body)}
    </div>
    <div style="text-align:center;margin-bottom:14px">
      <div style="display:inline-block;background:linear-gradient(135deg,${bc},${ac});color:#fff;font-size:26px;font-weight:900;padding:10px 28px;border-radius:10px;box-shadow:0 4px 12px rgba(79,70,229,0.25)">${pct}%</div>
      <div style="font-size:11px;font-weight:600;color:${bc};margin-top:5px">${advanced?'🏅 Advanced Level 2 Recommendation — Highest Honors':'✓ Standard Level TOPIK I Pass'}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,${bc})"></div>
      <div style="color:${ac};font-size:14px">✦</div>
      <div style="flex:1;height:1px;background:linear-gradient(to left,transparent,${bc})"></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end">
      <div style="text-align:center">
        <div style="font-size:20px;font-family:'Brush Script MT',cursive;color:#1a1a2e;margin-bottom:2px">${esc(cfg.sigName.replace('Prof. ',''))}</div>
        <div style="width:125px;height:1px;background:#aaa;margin-bottom:4px"></div>
        <div style="font-size:10px;font-weight:700;color:#222">${esc(cfg.sigName)}</div>
        <div style="font-size:8.5px;color:#666">${esc(cfg.sigTitle)}</div>
        <div style="font-size:8px;color:#888">${esc(cfg.sigDept || 'Korean Language Program')}</div>
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
        <div style="font-size:8.5px;color:#666">${esc(cfg.location)}</div>
      </div>
    </div>
    <div style="margin-top:14px;padding:9px 12px;background:#f8f9fa;border-radius:6px;border:1px solid #e2e8f0;text-align:center;font-size:8.5px;color:#475569;line-height:1.45">
      <div>${esc(cfg.credits)}</div>
      <div style="margin-top:2px;font-size:8px;color:#94a3b8">${esc(cfg.institution.toUpperCase())} · 쏙쏙 어휘왕 VOCAB-KING CERTIFICATION</div>
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
document.getElementById('intro-btn').addEventListener('click',async ()=>{
  const { data:{ session } } = await sb.auth.getSession();
  if(session || g.guest){ initHome(); show('home'); }
  else { show('register'); switchTab('login'); }
});
document.getElementById('back-btn').addEventListener('click',()=>{
  const midQuiz = (g.mode==='level' && g.idx>0 && g.idx<g.queue.length) || (g.mode==='exam' && examIdx>0 && examIdx<examQ.length);
  if(midQuiz && !confirm('Leave now? This attempt will not be saved.')) return;
  stopSpeech();g.mode='';initHome();show('home');
});
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
// ADMIN MANAGEMENT & TWO-TIER FACULTY/DEVELOPER SYSTEM
// ═══════════════════════════════════════════════════
// Admin access comes from the `admins` table in the database (see supabase/setup.sql).
// Admins sign in with their Supabase account email + password like everyone else.
let adminCachedStudents = [];

function showAdminDashboard(){
  show('admin');
  document.getElementById('admin-auth-card').style.display = 'none';
  document.getElementById('admin-dashboard').style.display = 'block';
  updateAdminRoleUI();
  populateCohortSelects();
  switchAdminTab('overview');
  renderAdminDashboard();
}

function openAdminLogin(){
  if(currentAdmin){ showAdminDashboard(); return; }
  show('admin');
  document.getElementById('admin-auth-card').style.display = 'block';
  document.getElementById('admin-dashboard').style.display = 'none';
  setMsg('admin-auth-err', '');
  const userInput = document.getElementById('admin-user-input');
  const passInput = document.getElementById('admin-pass-input');
  userInput.value = g.user.email || '';
  passInput.value = '';
  setTimeout(()=>(userInput.value ? passInput : userInput).focus(), 150);
}

// Backward compatibility alias
function openAdmin(){
  openAdminLogin();
}

async function doAdminAuth(){
  const email = (document.getElementById('admin-user-input').value || '').trim().toLowerCase();
  const passEl = document.getElementById('admin-pass-input');
  if(!email || !passEl.value) return setMsg('admin-auth-err', 'Please enter both email and password.');

  const { error } = await sb.auth.signInWithPassword({ email, password:passEl.value });
  passEl.value = '';
  if(error){
    setMsg('admin-auth-err', /not confirmed/i.test(error.message) ? 'Please verify this email address first.' : 'Access restricted: invalid email or password.');
    passEl.focus();
    return;
  }
  await loadMyData();
  initHome();
  if(!currentAdmin){
    setMsg('admin-auth-err', 'You are signed in, but this account does not have admin access.');
    return;
  }
  showAdminDashboard();
}

function updateAdminRoleUI(){
  if(!currentAdmin) return;
  const roleNames = {
    super: 'Super Admin & Lead Developer',
    academic: 'Academic Admin (Faculty / Supervisor)',
    'co-admin': 'Co-Administrator'
  };
  document.getElementById('adm-cur-user').textContent = `${currentAdmin.name} (${roleNames[currentAdmin.role] || currentAdmin.role})`;
  // Only Super Admin can manage other administrators
  const adminTab = document.getElementById('atab-admins');
  if(adminTab) adminTab.style.display = (currentAdmin.role === 'super') ? 'inline-block' : 'none';
}

// "Lock" signs the admin out of this device
function adminLock(){
  doLogout();
}

function switchAdminTab(tab){
  ['overview','students','cohorts','certs','contact','admins'].forEach(t=>{
    const panel = document.getElementById('apanel-'+t);
    const btn = document.getElementById('atab-'+t);
    if(panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if(btn){
      if(t === tab){
        btn.style.background = 'var(--gold)';
        btn.style.color = 'var(--navy)';
        btn.style.fontWeight = '700';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = 'rgba(255,255,255,0.55)';
        btn.style.fontWeight = '500';
      }
    }
  });

  if(tab === 'overview') renderAdminOverview();
  else if(tab === 'students') renderAdminStudents();
  else if(tab === 'cohorts') renderAdminCohorts();
  else if(tab === 'certs'){
    populateCertConfigForm();
    renderAdminCerts();
  }
  else if(tab === 'contact') populateContactConfigForm();
  else if(tab === 'admins') renderAdminList();
}

// ── ADMIN ACCESS MANAGEMENT (Super Admin Only) ──
const ADMIN_ERRORS = {
  USER_NOT_FOUND: 'No account uses that email yet. Ask them to register in the app first, or add them in Supabase → Authentication → Users.',
  NOT_ALLOWED: 'Permission denied. Only a Super Admin can manage administrators.',
  CANNOT_REMOVE_SELF: 'You cannot remove your own admin access.',
  INVALID_ROLE: 'Please choose a valid role.'
};
function adminErrorText(error){
  const key = Object.keys(ADMIN_ERRORS).find(k => (error.message || '').includes(k));
  return key ? ADMIN_ERRORS[key] : error.message;
}

async function renderAdminList(){
  const listEl = document.getElementById('adm-all-admins-list');
  if(!listEl) return;
  const { data, error } = await sb.from('admins').select('*').order('created_at');
  if(error){ listEl.innerHTML = '<div style="font-size:11px;color:var(--red)">Could not load administrators.</div>'; return; }
  listEl.innerHTML = (data || []).map(a => {
    const isSuper = a.role === 'super';
    const canDelete = !isSuper && currentAdmin && currentAdmin.role === 'super' && a.user_id !== currentAdmin.user_id;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.08);margin-bottom:6px">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:700;color:#fff">${esc(a.name)}</span>
            <span class="cohort-badge ${isSuper ? 'current' : 'alumni'}" style="font-size:9px;text-transform:uppercase">${esc(a.role)}</span>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px">
            ${esc(a.email)} · Added: ${esc(String(a.created_at || '').slice(0, 10))}
          </div>
        </div>
        <div>
          ${canDelete ? `<button class="btn-ro" style="padding:4px 10px;font-size:10px;border-color:rgba(239,68,68,0.4);color:var(--red)" onclick="deleteAdmin(${esc(JSON.stringify(a.user_id))}, ${esc(JSON.stringify(a.name))})">Remove ✕</button>` : `<span style="font-size:10px;color:rgba(255,255,255,0.3)">Protected</span>`}
        </div>
      </div>`;
  }).join('');
}

async function addNewAdmin(){
  if(!currentAdmin || currentAdmin.role !== 'super') return toast(ADMIN_ERRORS.NOT_ALLOWED, 'error');
  const name = (document.getElementById('new-adm-name').value || '').trim();
  const email = (document.getElementById('new-adm-user').value || '').trim().toLowerCase();
  const role = document.getElementById('new-adm-role').value || 'academic';
  if(!name || !email) return toast('Please enter the name and account email.', 'error');

  const { error } = await sb.rpc('grant_admin', { p_email:email, p_name:name, p_role:role });
  if(error) return toast(adminErrorText(error), 'error');
  document.getElementById('new-adm-name').value = '';
  document.getElementById('new-adm-user').value = '';
  toast(`✓ ${name} now has admin access`);
  renderAdminList();
}

async function changeCurrentAdminPassword(){
  const input = document.getElementById('change-adm-newpass');
  const msg = document.getElementById('change-pass-msg');
  const newPass = input.value;
  const showMsg = (text, color)=>{ msg.style.display = 'block'; msg.style.color = color; msg.textContent = text; };
  if(newPass.length < 8) return showMsg('Password must be at least 8 characters long.', 'var(--red)');
  const { error } = await sb.auth.updateUser({ password:newPass });
  if(error) return showMsg(error.message, 'var(--red)');
  input.value = '';
  showMsg('✓ Password updated successfully!', 'var(--green)');
  setTimeout(()=>{ msg.style.display = 'none'; }, 4000);
}

async function deleteAdmin(userId, name){
  if(!currentAdmin || currentAdmin.role !== 'super') return;
  if(!confirm(`Remove admin access for "${name}"? Their account itself is not deleted.`)) return;
  const { error } = await sb.rpc('revoke_admin', { p_user_id:userId });
  if(error) return toast(adminErrorText(error), 'error');
  renderAdminList();
}

// ── CONTACT US CONFIGURATION & RENDERER ──
const DEFAULT_CONTACT_CONFIG = {
  email: 'korean@kduniv.ac.kr',
  phone: '+82-33-639-0114',
  office: 'KyungDong University Global Campus, Global Hall #304, Goseong-gun, Gangwon-do, South Korea',
  website: 'https://global.kduniv.ac.kr',
  instagram: '@kdu_global',
  youtube: 'https://youtube.com/@KDUGlobal',
  kakaotalk: 'KDU Korean Support Channel'
};

function getContactConfig(){
  return { ...DEFAULT_CONTACT_CONFIG, ...contactConfigCache };
}

async function saveContactConfig(){
  const cfg = {
    email: document.getElementById('cfg-contact-email')?.value.trim() || DEFAULT_CONTACT_CONFIG.email,
    phone: document.getElementById('cfg-contact-phone')?.value.trim() || DEFAULT_CONTACT_CONFIG.phone,
    office: document.getElementById('cfg-contact-office')?.value.trim() || DEFAULT_CONTACT_CONFIG.office,
    website: document.getElementById('cfg-contact-website')?.value.trim() || DEFAULT_CONTACT_CONFIG.website,
    instagram: document.getElementById('cfg-contact-instagram')?.value.trim() || DEFAULT_CONTACT_CONFIG.instagram,
    youtube: document.getElementById('cfg-contact-youtube')?.value.trim() || DEFAULT_CONTACT_CONFIG.youtube,
    kakaotalk: document.getElementById('cfg-contact-kakaotalk')?.value.trim() || DEFAULT_CONTACT_CONFIG.kakaotalk
  };
  try {
    await saveSetting('contact_config', cfg);
    contactConfigCache = cfg;
    toast('✓ Contact details updated for everyone');
    renderContactPage();
  } catch(e){
    toast('Failed to save contact settings: ' + e.message, 'error');
  }
}

function populateContactConfigForm(){
  const cfg = getContactConfig();
  const setVal = (id, val)=>{ const el = document.getElementById(id); if(el) el.value = val; };
  setVal('cfg-contact-email', cfg.email);
  setVal('cfg-contact-phone', cfg.phone);
  setVal('cfg-contact-office', cfg.office);
  setVal('cfg-contact-website', cfg.website);
  setVal('cfg-contact-instagram', cfg.instagram);
  setVal('cfg-contact-youtube', cfg.youtube);
  setVal('cfg-contact-kakaotalk', cfg.kakaotalk);
}

function renderContactPage(){
  const card = document.getElementById('contact-info-card');
  if(!card) return;
  const cfg = getContactConfig();

  card.innerHTML = `
    <div class="contact-item">
      <div class="contact-icon">✉️</div>
      <div>
        <div class="contact-label">Official Inquiries &amp; Support</div>
        <div class="contact-value"><a href="${esc(safeUrl('mailto:' + cfg.email))}">${esc(cfg.email)}</a></div>
      </div>
    </div>
    <div class="contact-item">
      <div class="contact-icon">📞</div>
      <div>
        <div class="contact-label">Telephone</div>
        <div class="contact-value"><a href="tel:${cfg.phone.replace(/[^0-9+]/g,'')}">${esc(cfg.phone)}</a></div>
      </div>
    </div>
    <div class="contact-item">
      <div class="contact-icon">🏫</div>
      <div>
        <div class="contact-label">Campus &amp; Department Location</div>
        <div class="contact-value">${esc(cfg.office)}</div>
      </div>
    </div>
    <div class="contact-item">
      <div class="contact-icon">🌐</div>
      <div>
        <div class="contact-label">Official Website</div>
        <div class="contact-value"><a href="${esc(safeUrl(cfg.website))}" target="_blank" rel="noopener noreferrer">${esc(cfg.website)}</a></div>
      </div>
    </div>
    <div class="contact-item">
      <div class="contact-icon">📸</div>
      <div>
        <div class="contact-label">Instagram</div>
        <div class="contact-value"><a href="${esc(safeUrl(cfg.instagram.startsWith('http') ? cfg.instagram : 'https://instagram.com/' + encodeURIComponent(cfg.instagram.replace('@',''))))}" target="_blank" rel="noopener noreferrer">${esc(cfg.instagram)}</a></div>
      </div>
    </div>
    <div class="contact-item">
      <div class="contact-icon">▶️</div>
      <div>
        <div class="contact-label">YouTube Channel</div>
        <div class="contact-value"><a href="${esc(safeUrl(cfg.youtube))}" target="_blank" rel="noopener noreferrer">${esc(cfg.youtube)}</a></div>
      </div>
    </div>
    <div class="contact-item">
      <div class="contact-icon">💬</div>
      <div>
        <div class="contact-label">KakaoTalk Community</div>
        <div class="contact-value">${esc(cfg.kakaotalk)}</div>
      </div>
    </div>
  `;
}

// ── ADMIN DASHBOARD DATA & ANALYTICS ──
async function renderAdminDashboard(){
  if(!currentAdmin) return;
  const [studentsRaw, progRaw, failRaw] = await Promise.all([
    fetchAll('students'),
    fetchAll('progress'),
    fetchAll('fail_words', 'word_kr')
  ]);

  const merged = {};
  studentsRaw.forEach(s=>{
    merged[s.student_id] = {
      sid: s.student_id,
      name: s.name||'',
      nick: s.nickname||'',
      email: s.email||'',
      registered: !!s.user_id,
      cohort: s.cohort || '',
      lastSeen: s.last_seen||'',
      words: 0, levels: 0, examPassed: false, examScore: 0, examDate: ''
    };
  });

  const progressMap = {};
  progRaw.forEach(p=>{
    if(!progressMap[p.student_id]) progressMap[p.student_id] = {words:0,levels:0,examPassed:false,examScore:0};
    if(p.level_key==='final_exam'){
      if(p.completed) progressMap[p.student_id].examPassed = true;
      if((p.score_pct||0) > progressMap[p.student_id].examScore){
        progressMap[p.student_id].examScore = p.score_pct;
        progressMap[p.student_id].examDate = p.updated_at;
      }
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
      merged[sid].examDate = progressMap[sid].examDate || '';
    }
  });

  adminCachedStudents = Object.values(merged);

  const failWordMap = {};
  failRaw.forEach(f=>{ failWordMap[f.word_kr] = (failWordMap[f.word_kr]||0)+1; });

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
          <span class="cohort-badge ${c.active?'current':'alumni'}">${esc(c.name.replace(' (Current)',''))}</span>
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
      weakWordsEl.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.4);text-align:center;padding:12px">No fail data recorded yet</div>';
    } else {
      weakWordsEl.innerHTML = sorted.map(([w,cnt],i)=>{
        const wObj = allWords().find(x=>cleanKR(x.w)===cleanKR(w)||x.w===w);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:rgba(255,255,255,0.3);width:16px;text-align:right">${i+1}</span>
            <span style="font-family:'Noto Sans KR',sans-serif;font-size:13px;color:#fff;font-weight:600">${esc(w)}</span>
            ${wObj ? `<span style="font-size:11px;color:rgba(255,255,255,0.45)">${wObj.e}</span>` : ''}
          </div>
          <span style="font-size:11px;font-weight:700;color:#ef4444;background:rgba(239,68,68,0.12);padding:1px 7px;border-radius:10px">${cnt} fails</span>
        </div>`;
      }).join('');
    }
  }

  renderAdminOverview();
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
      <td style="font-family:monospace;font-size:11px">${esc(s.sid||'—')}</td>
      <td><div>${esc(s.name||'—')}</div>${s.nick?`<div style="font-size:10px;color:rgba(255,255,255,0.4)">${esc(s.nick)}</div>`:''}</td>
      <td><span class="cohort-badge ${isCur?'current':'alumni'}" style="font-size:10px">${esc(cName)}</span></td>
      <td style="text-align:center;font-weight:700;color:var(--sky)">${(s.words||0).toLocaleString()}</td>
      <td style="text-align:center">${s.levels||0}</td>
      <td>${examCell}</td>
      <td>${s.examPassed?`<button class="btn-rg" style="padding:4px 10px;font-size:10px;border-radius:14px" onclick="viewStudentCert(${esc(JSON.stringify(s.sid))})">📜 Cert</button>`:'—'}</td>
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
          <span class="cohort-badge ${c.active?'current':'alumni'}">${esc(c.name.replace(' (Current)',''))}</span>
          ${c.active ? '<span style="font-size:10px;color:var(--gold)">★ Active</span>' : ''}
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.4)">Code: <strong>${esc(c.id)}</strong> · ${esc(c.semester)} ${esc(c.year)}</div>
      </div>
      <button class="btn-rg" style="padding:5px 12px;font-size:10px;border-radius:14px;background:${c.active?'rgba(239,68,68,0.15)':'rgba(34,197,94,0.15)'};color:${c.active?'#ef4444':'#22c55e'};border:1px solid currentColor" onclick="toggleCohortActive(${esc(JSON.stringify(c.id))})">
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
  const certCfg = getCertConfig();
  tbody.innerHTML = certified.map(s=>{
    const cObj = cohortMap[s.cohort];
    const cName = cObj ? cObj.name.replace(' (Current)','') : (s.cohort||'—');
    const isCur = cObj ? cObj.active : false;
    const isAdv = (s.examScore||0) >= (certCfg.honorsPct || 95);
    return `<tr>
      <td style="font-family:monospace;font-size:11px">${esc(s.sid||'—')}</td>
      <td><strong>${esc(s.name||'—')}</strong>${s.nick?` <span style="font-size:10px;color:rgba(255,255,255,0.4)">(${esc(s.nick)})</span>`:''}</td>
      <td><span class="cohort-badge ${isCur?'current':'alumni'}" style="font-size:10px">${esc(cName)}</span></td>
      <td style="text-align:center;font-weight:700;color:${isAdv?'#D4A017':'#22c55e'}">${s.examScore||0}%</td>
      <td>${isAdv ? '🏅 Advanced' : '✓ Standard'}</td>
      <td style="font-size:10px;color:rgba(255,255,255,0.5)">${esc(certCfg.sigName)}</td>
      <td><button class="btn-rg" style="padding:4px 10px;font-size:10px;border-radius:14px" onclick="viewStudentCert(${esc(JSON.stringify(s.sid))})">📜 Preview</button></td>
    </tr>`;
  }).join('');
}

async function addNewCohort(){
  const name = (document.getElementById('new-cohort-name')?.value||'').trim();
  const id   = (document.getElementById('new-cohort-id')?.value||'').trim();
  const year = parseInt(document.getElementById('new-cohort-year')?.value||'2026',10);
  const setActive = document.getElementById('new-cohort-active')?.checked ?? true;
  if(!name || !id){ toast('Please fill in Semester Title and Cohort Code.', 'error'); return; }
  if(getCohorts().find(c=>c.id===id)){ toast(`Code "${id}" already exists.`, 'error'); return; }
  const semester = id.endsWith('-1')?'Spring':id.endsWith('-2')?'Fall':name;
  const { error } = await sb.from('cohorts').insert({ id, name, semester, year, active:false });
  if(error){ toast('Could not create cohort: ' + error.message, 'error'); return; }
  if(setActive){
    const { error:actErr } = await sb.rpc('set_active_cohort', { p_id:id });
    if(actErr) toast('Cohort created, but could not make it active: ' + actErr.message, 'error');
  }
  await refreshCohortViews();
  document.getElementById('new-cohort-name').value='';
  document.getElementById('new-cohort-id').value='';
  toast(`✓ Cohort "${name}" created!`);
}

async function toggleCohortActive(id){
  const target = getCohorts().find(c=>c.id===id);
  if(!target) return;
  const { error } = await sb.rpc('set_active_cohort', { p_id: target.active ? null : id });
  if(error){ toast('Could not change the active cohort: ' + error.message, 'error'); return; }
  await refreshCohortViews();
}

async function refreshCohortViews(){
  await loadCohorts();
  populateCohortSelects();
  renderAdminCohorts();
  const statActiveCohort = document.getElementById('adm-stat-active-cohort');
  if(statActiveCohort) statActiveCohort.textContent = getActiveCohort().name || '—';
}

function viewStudentCert(sid){
  const s = adminCachedStudents.find(x=>x.sid===sid);
  if(!s || !s.examPassed) return;
  const cfg = getCertConfig();
  const advanced = (s.examScore||0) >= (cfg.honorsPct || 95);
  const dateStr = (s.examDate ? new Date(s.examDate) : new Date()).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const cohortObj = getCohorts().find(c=>c.id===s.cohort);
  const cohortName = cohortObj ? cohortObj.name.replace(' (Current)','') : (s.cohort||'2026 Spring');
  document.getElementById('cert-level-badge').textContent = advanced ? '🏅 ADVANCED LEVEL 2 CERTIFICATE' : '📜 TOPIK I CERTIFICATE';
  document.getElementById('cert-sub').textContent = `Score: ${s.examScore||0}% · ${advanced?'Advanced':'Standard'} · Korean Language Program`;
  document.getElementById('cert-preview').innerHTML = buildCertHTML(s.name||'STUDENT', s.sid||'', s.examScore||0, advanced, dateStr, cohortName);
  show('cert-screen');
}

function exportStudentsCSV(){
  if(!adminCachedStudents.length){ toast('No data to export yet. Open Overview first.', 'error'); return; }
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
async function initApp(){
  const pfill = document.getElementById('splash-pfill');
  const pstat = document.getElementById('splash-status');
  show('splash');
  if(pfill) pfill.style.width = '35%';

  // Shared data (cohorts, certificate & contact settings) + the current session, all from the database
  const [, , sessionRes] = await Promise.all([loadCohorts(), loadSettings(), sb.auth.getSession()]);
  if(pfill) pfill.style.width = '75%';
  if(pstat) pstat.textContent = 'Preparing TOPIK I Modules & Audio...';

  const session = sessionRes.data.session;
  if(session) await loadMyData();
  initHome();

  if(pfill) pfill.style.width = '100%';
  if(pstat) pstat.textContent = 'Welcome to Vocab-King! 👑';

  setTimeout(()=>{
    if(passwordRecovery){
      show('register'); switchTab('newpass');
    } else if(AUTH_REDIRECT.error){
      show('register'); switchTab('login');
      setMsg('login-err', AUTH_REDIRECT.error + ' — please try again or request a new link.');
      history.replaceState(null, '', appUrl());
    } else if(session){
      if(AUTH_REDIRECT.type === 'signup'){
        toast('✓ Email verified — welcome to Vocab-King!');
        history.replaceState(null, '', appUrl());
      }
      show('home');
    } else {
      show('intro');
    }
  }, 350);
}
initApp();
