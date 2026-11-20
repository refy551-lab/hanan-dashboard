/* طبقة الربط مع Supabase — تحاكي واجهة قاعدة بيانات Claude اللي كانت تستخدمها اللوحة */
(function(){
  const CFG=window.HANAN_CONFIG||{};
  const ready=!!(CFG.SUPABASE_URL&&CFG.SUPABASE_ANON_KEY&&!/ضعي|PASTE/.test(CFG.SUPABASE_URL+CFG.SUPABASE_ANON_KEY));
  const sb=ready&&window.supabase?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}}):null;
  const BUCKET='dreams';

  /* ---------- مخزن البيانات ---------- */
  const cache={},subs={};
  let loadP=null;
  const mapOf=c=>cache[c]||(cache[c]=new Map());
  const snap=c=>{const docs=[...mapOf(c)].map(([id,d])=>({id,data:()=>d,exists:true}));return{docs,empty:!docs.length,size:docs.length,metadata:{fromCache:false}}};
  const emit=c=>(subs[c]||[]).forEach(cb=>{try{cb(snap(c))}catch(e){console.error(e)}});
  const emitAll=()=>Object.keys(subs).forEach(emit);
  async function loadAll(){
    const step=1000;let from=0;const fresh={};
    for(;;){const{data,error}=await sb.from('docs').select('col,id,data').range(from,from+step-1);if(error)throw error;
      for(const r of data)(fresh[r.col]||(fresh[r.col]=new Map())).set(r.id,r.data||{});
      if(data.length<step)break;from+=step}
    for(const k of Object.keys(cache))if(!fresh[k])cache[k]=new Map();
    Object.assign(cache,fresh);
  }
  function startRealtime(){
    sb.channel('docs-live').on('postgres_changes',{event:'*',schema:'public',table:'docs'},p=>{
      if(p.eventType==='DELETE'){const o=p.old||{};if(o.col){mapOf(o.col).delete(o.id);emit(o.col)}}
      else{const n=p.new||{};if(n.col){mapOf(n.col).set(n.id,n.data||{});emit(n.col)}}
    }).subscribe();
    // لما يرجع الآيباد من السكون أو الخلفية نحدّث كل شيء
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadAll().then(emitAll).catch(()=>{})});
    window.addEventListener('online',()=>loadAll().then(emitAll).catch(()=>{}));
  }
  const ensure=()=>loadP||(loadP=loadAll().then(startRealtime));
  const wrapErr=e=>{const err=new Error(e&&e.message||'error');err.code=e&&e.code;return err};

  function docRef(c,id){return{
    id,
    async get(){await ensure();const d=mapOf(c).get(id);return{id,exists:!!d,data:()=>d}},
    async set(data){const clean=JSON.parse(JSON.stringify(data??{}));
      const{error}=await sb.from('docs').upsert({col:c,id,data:clean,updated_at:new Date().toISOString()});
      if(error)throw wrapErr(error);mapOf(c).set(id,clean);emit(c)},
    async update(patch){await ensure();const cur=mapOf(c).get(id)||{};return this.set({...cur,...patch})},
    async delete(){const{error}=await sb.from('docs').delete().eq('col',c).eq('id',id);if(error)throw wrapErr(error);mapOf(c).delete(id);emit(c)},
  }}
  function colRef(c){return{
    doc:id=>docRef(c,id),
    async add(data){const id=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));await docRef(c,id).set(data);return docRef(c,id)},
    async get(){await ensure();return snap(c)},
    onSnapshot(cb,onErr){(subs[c]||(subs[c]=[])).push(cb);ensure().then(()=>cb(snap(c))).catch(e=>{console.error(e);onErr&&onErr(e)});return()=>{subs[c]=subs[c].filter(x=>x!==cb)}},
  }}
  const db={doc:()=>({collection:colRef})};

  /* ---------- الصور ---------- */
  const assets={async upload(file){
    if(!file||!/^image\//.test(file.type||'image/jpeg'))throw{code:'unsupported_type'};
    const ext=(file.type||'image/jpeg').split('/')[1].replace('jpeg','jpg').replace(/[^a-z0-9]/g,'')||'jpg';
    const path=`${new Date().getFullYear()}/${crypto.randomUUID?crypto.randomUUID():Date.now()}.${ext}`;
    const{error}=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type||'image/jpeg',upsert:false});
    if(error)throw wrapErr(error);
    return{id:sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl};
  }};

  /* ---------- التنزيل ---------- */
  const downloads={async save({filename,data}){
    const blob=data instanceof Blob?data:new Blob([data],{type:/\.json$/.test(filename)?'application/json':/\.xlsx$/.test(filename)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/octet-stream'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  }};

  /* ---------- الدخول ---------- */
  let session=null;
  const user={
    async canEdit(){if(!session)return false;const{data,error}=await sb.rpc('is_team');return !error&&data===true},
    async isOwner(){return false},
    async id(){return session&&session.user.id},
    email(){return session&&session.user.email},
  };

  function loginScreen(msg){
    const g=document.getElementById('gate');g.hidden=false;document.getElementById('view').hidden=true;
    g.innerHTML=`<div class="login">
      <span class="mark big">ح</span>
      <h2>لوحة إدارة أعمال حنان المالكي</h2>
      <p>خاصة بفريق الإدارة. سجّلي دخولك للمتابعة.</p>
      ${msg?`<p class="lerr">${msg}</p>`:''}
      <button type="button" class="gbtn" id="gLogin"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>الدخول بحساب Google</button>
      <div class="or"><span>أو بالإيميل وكلمة المرور</span></div>
      <form id="pwForm" class="pwf">
        <input type="email" id="pwEmail" placeholder="الإيميل" autocomplete="email" inputmode="email" required dir="ltr">
        <input type="password" id="pwPass" placeholder="كلمة المرور (٦ أحرف أو أكثر)" autocomplete="current-password" minlength="6" required dir="ltr">
        <button type="submit" class="sbtn" id="pwIn">دخول</button>
        <button type="button" class="lnk2" id="pwUp">أول مرة؟ أنشئي حساب بهذا الإيميل</button>
      </form>
    </div>`;
    document.getElementById('gLogin').onclick=async()=>{
      const{error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:'select_account'}}});
      if(error)loginScreen('تعذّر الدخول بـ Google. جربي الدخول برمز الإيميل.');
    };
    const vals=()=>({email:document.getElementById('pwEmail').value.trim().toLowerCase(),password:document.getElementById('pwPass').value});
    const busy=(b)=>{document.getElementById('pwIn').disabled=b;document.getElementById('pwUp').disabled=b};
    document.getElementById('pwForm').onsubmit=async e=>{e.preventDefault();busy(true);
      const{error}=await sb.auth.signInWithPassword(vals());busy(false);
      if(error)return alert(/confirm/i.test(error.message)?'لازم تأكيد الإيميل أول. افتحي رسالة التأكيد في بريدك ثم ارجعي سجلي دخول.':'الإيميل أو كلمة المرور غير صحيحة. إذا هذي أول مرة، اضغطي «أنشئي حساب».');
      location.reload()};
    document.getElementById('pwUp').onclick=async()=>{const v=vals();
      if(!v.email||v.password.length<6)return alert('اكتبي الإيميل وكلمة مرور من ٦ أحرف أو أكثر.');
      busy(true);const{data,error}=await sb.auth.signUp(v);busy(false);
      if(error)return alert(/registered|exists/i.test(error.message)?'هذا الإيميل عنده حساب. اضغطي «دخول».':'ما قدرنا ننشئ الحساب: '+error.message);
      if(data.session)return location.reload();
      alert('تم إنشاء الحساب. افتحي رسالة التأكيد في بريدك، ثم ارجعي هنا واضغطي «دخول».')};
  }

  window.hananSignOut=async()=>{await sb.auth.signOut();location.reload()};

  /* ---------- نقطة البداية: تحاكي window.claude.use ---------- */
  window.HANAN_BOOT=(async()=>{
    if(!ready){const g=document.getElementById('gate');g.innerHTML='<div><h2>الموقع يحتاج إعداد</h2><p>أضيفي رابط Supabase والمفتاح في ملف config.js.</p></div>';return false}
    const{data}=await sb.auth.getSession();session=data.session;
    if(location.search.includes('code=')||location.hash.includes('access_token'))history.replaceState(null,'',location.pathname+(location.hash.includes('access_token')?'':location.hash));
    if(!session){loginScreen();return false}
    sb.auth.onAuthStateChange((ev,s)=>{session=s;if(ev==='SIGNED_OUT')location.reload()});
    if(!(await user.canEdit())){
      loginScreen(`الإيميل <b dir="ltr">${(session.user.email||'').replace(/[<>&"]/g,'')}</b> ما عنده صلاحية على اللوحة. <button type="button" class="lnk" onclick="hananSignOut()">جربي إيميل ثاني</button>`);
      return false;
    }
    window.claude={use:async k=>({user,db,assets,downloads}[k]??null)};
    return true;
  })();
})();
