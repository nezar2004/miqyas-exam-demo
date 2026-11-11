const params = new URLSearchParams(location.search);
const portal = params.get('portal');
const pagesHost = location.hostname==='nezar2004.github.io';
const firebasePortal = pagesHost && ['student','teacher','admin'].includes(portal);
const staticPreview = pagesHost && !firebasePortal;
let firebase;
let registration = portal==='student' && params.has('register');
const passwordReset = firebasePortal && params.has('reset') && !registration;
let account, role, db;
let busy=false;
const previousPages=[];
let page = role==='admin'?'people':'exams';
let active = '';
let position = 0;
const roleNames = {student:'طالب', teacher:'مدرّس', admin:'مدير النظام'};
const portals = {
  student:{title:'بوابة الطالب', code:'01', icon:'cap', detail:'قدّم امتحاناتك وتابع نتائجك في مكان واحد.'},
  teacher:{title:'بوابة المدرّس', code:'02', icon:'paper', detail:'أنشئ التقييمات، وجدول الامتحانات، وتابع أداء طلابك.'},
  admin:{title:'بوابة الإدارة', code:'03', icon:'shield', detail:'أدر الحسابات وراجع سجل النشاط في المنصة.'}
};
const paths = {
  cap:'<path d="m2 10 10-5 10 5-10 5-10-5Zm4 2v5c4 3 8 3 12 0v-5m4-2v6"/>',
  paper:'<path d="M6 3h9l4 4v14H6V3Zm8 0v5h5M9 12h7m-7 4h7"/>',
  shield:'<path d="M12 3l8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Zm-3 9 2 2 4-4"/>',
  arrow:'<path d="M19 12H5m6-6-6 6 6 6"/>',
  grid:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16m-10 0v10"/>',
  chart:'<path d="M4 4v16h16M9 15v-4m5 4V7m5 8v-6"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const menus = {
  student:{exams:'الامتحانات', results:'نتائجي'},
  teacher:{exams:'إدارة الامتحانات', bank:'بنك الأسئلة', create:'إنشاء امتحان', analytics:'تحليل النتائج'},
  admin:{people:'حسابات المستخدمين', addTeacher:'إضافة مدرّس', log:'سجل النشاط'}
};
const view = document.querySelector('#view');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const button = (label, action, id = '', primary = false) => `<button type="button" class="${primary ? 'primary' : ''}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const hero = (tag, title, description) => `<section class="hero"><div class="eyebrow">${tag}</div><h1>${title}</h1><p>${description}</p></section>`;
const metric = (label, value) => `<div class="card metric-card"><span class="metric-icon">${icon('chart')}</span><span class="muted">${label}</span><strong class="metric">${value}</strong></div>`;
const table = (headers, rows) => `<div class="table"><table><thead><tr>${headers.map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const fmt = value => new Date(value).toLocaleString('ar-JO', {dateStyle:'medium', timeStyle:'short'});
const completed = (id, student = account?.id) => db.results.find(result=>result.id===id && result.student===student);
const studentName = r => r.studentName || r.student;
const question = id => db.questions.find(item=>item.id===id);
const attemptKey = id => id;
async function api(path, body) {
  const response = await fetch('./api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const payload = await response.json().catch(()=>{throw new Error('خادم المنصة غير متاح.');});
  if (!response.ok) {
    if (response.status===401 && account) {account=undefined; role=undefined; render();}
    throw new Error(payload.error);
  }
  return payload;
}
function update(payload) {
  account=payload.account?.role===portal?payload.account:undefined;
  role=account?.role;
  db=payload.db;
}
async function perform(work) {
  if (busy) return;
  busy=true;
  view.setAttribute('aria-busy','true');
  try {await work();}
  catch(error) {toast(error.message);}
  finally {busy=false; view.removeAttribute('aria-busy');}
}
function navigate(next) {
  if (next!==page) previousPages.push(page);
  page=next;
  render();
}
function toast(message) { notice.textContent = message; }
async function loadFirebaseAccount(next) {
  const data=next?.name ? await (portal==='admin'?firebase.loadPeople():firebase.loadExams(portal)) : null;
  account=next;
  role=next?.role;
  db=data;
  if (!role || !menus[role][page]) page=role==='admin'?'people':'exams';
}
function render() {
  if (firebasePortal && account && !account.name) {
    document.body.classList.add('signed-out');
    view.innerHTML=publicHeader()+`<section class="card"><a class="back-link" href="index.html">العودة إلى البوابات</a>
      <h1>أكمل ملفك الشخصي</h1>
      <p dir="ltr">${esc(account.email)}</p>
      <form id="profile-form"><label>الاسم الكامل<input name="name" maxlength="100" autocomplete="name" required></label><div><button class="primary">حفظ الملف الشخصي</button></div></form>
      <button type="button" data-action="student-logout">تسجيل الخروج</button></section>`;
    return;
  }
  document.body.classList.toggle('signed-out', !account);
  if (!account) {
    const entry = Object.hasOwn(portals,portal) ? portals[portal] : null;
    document.title = entry ? entry.title+' | مقياس' : 'مقياس | منصة التقييم الرقمي';
    view.innerHTML = passwordReset ? resetPassword() : entry ? login(entry) : gateway();
    return;
  }
  document.title = portals[role].title+' | مقياس';
  document.querySelector('#account-name').textContent = account.name;
  document.querySelector('#account-role').textContent = roleNames[role];
  const navIcons = {exams:'grid',results:'chart',bank:'paper',create:'paper',analytics:'chart',people:'shield',addTeacher:'cap',log:'clock'};
  nav.innerHTML = Object.entries(menus[role]).filter(([id])=>firebasePortal?!['results','analytics','log'].includes(id):id!=='addTeacher').map(([id, title])=>`<button type="button" data-action="page" data-id="${id}" ${id===page?'aria-current="page"':''}>${icon(navIcons[id])}${title}</button>`).join('');
  document.querySelector('#section').textContent = menus[role][page] || 'تقديم الامتحان';
  const screens = {exams, results, bank, create, analytics, people, addTeacher, log, attempt};
  view.innerHTML = screens[page]();
  tick();
}
function publicHeader() {
  return `<header class="public-head"><a class="brand" href="index.html"><span class="logo">${icon('grid')}</span><span>مقياس<small dir="ltr">MIQYAS</small></span></a><span class="public-label">منصة التقييم الرقمي</span></header>`;
}
function illustration() {
  return `<div class="art" aria-hidden="true"><div class="art-orbit"></div><div class="art-sheet"><div class="art-top"><i></i><i></i><i></i></div><div class="art-content"><div class="art-line"></div><div class="art-line short"></div><div class="art-chart"><i></i><i></i><i></i><i></i><i></i></div></div></div><div class="art-check">${icon('shield')}</div></div>`;
}
function gateway() {
  return publicHeader()+`<section class="gateway-hero"><div><span class="kicker">MIQYAS / ASSESSMENT PLATFORM</span><h1>منصة واحدة.<br><em>لكل مرحلة من التقييم.</em></h1><p>أنشئ امتحاناتك، قدّمها، وتابع نتائجها من بوابة مخصصة لكل دور.</p></div>${illustration()}</section>
    <section class="portal-section"><div class="row"><h2>اختر بوابتك</h2><span class="muted">٣ مساحات عمل</span></div><div class="portal-grid">${Object.entries(portals).map(([id,item])=>`<a class="portal-card" href="?portal=${id}"><span class="row"><span class="portal-icon ${id}">${icon(item.icon)}</span><small dir="ltr">${item.code}</small></span><h3>${item.title}</h3><p>${item.detail}</p><span class="portal-link">الانتقال إلى البوابة ${icon('arrow')}</span></a>`).join('')}</div></section>
    <footer class="public-footer"><span>مقياس · منصة التقييم الرقمي</span><span>منصة الامتحانات</span></footer>`;
}
function fields(includeName) {
  return `${includeName?'<label>الاسم الكامل<input name="name" maxlength="100" autocomplete="name" required></label>':''}
    <label>البريد الإلكتروني<input name="email" type="email" maxlength="254" required autocomplete="username" dir="ltr"></label>
    <label>كلمة المرور<input name="password" type="password" maxlength="128" ${includeName?'minlength="12"':''} required autocomplete="${includeName?'new-password':'current-password'}" dir="ltr">${includeName?'<small>12 حرفًا على الأقل</small>':''}</label>`;
}
function login(entry) {
  const links=portal!=='student'?'':registration
    ? '<a class="back-link" href="?portal=student">رجوع إلى تسجيل الدخول</a>'
    : '<a class="back-link" href="?portal=student&amp;register=1">إنشاء حساب طالب</a>';
  return publicHeader()+`<div class="login-layout"><section class="login-panel"><a class="back-link" href="index.html">العودة إلى البوابات ${icon('arrow')}</a><span class="portal-icon ${portal}">${icon(entry.icon)}</span><h1>${registration?'إنشاء حساب طالب':entry.title}</h1><p class="muted">${entry.detail}</p>
    <form id="${registration?'register-form':'login-form'}">
      ${staticPreview?'<p class="badge warn" role="status">إنشاء الحساب وتسجيل الدخول رح يتفعّلوا بعد نشر خادم مقياس.</p>':''}
      <fieldset ${staticPreview?'disabled':''}>${fields(registration)}</fieldset>
      <button class="primary" ${staticPreview?'disabled':''}>${registration?'إنشاء الحساب':'تسجيل الدخول'}</button>
    </form>${firebasePortal && !registration?`<a class="back-link" href="?portal=${portal}&amp;reset=1">نسيت كلمة المرور؟</a>`:''}${links}</section>
    <aside class="login-story"><span class="kicker">MIQYAS / ${entry.code}</span><h2>${entry.title}</h2><p>${entry.detail}</p>${illustration()}<span class="story-foot">مساحة العمل المخصصة · مقياس</span></aside></div>`;
}
function resetPassword() {
  return publicHeader()+`<div class="login-layout"><section class="login-panel">
    <a class="back-link" href="?portal=${portal}">الرجوع لتسجيل الدخول</a>
    <h1>إعادة تعيين كلمة المرور</h1>
    <p class="muted">أدخل البريد الإلكتروني المسجّل في مقياس.</p>
    <form id="reset-password-form">
      <label>البريد الإلكتروني<input name="email" type="email" maxlength="254" required autocomplete="email" dir="ltr"></label>
      <button class="primary">إرسال رابط إعادة التعيين</button>
      <p role="status" id="reset-status" hidden></p>
    </form>
  </section></div>`;
}
let nextExamBoundary=Infinity;
function exams() {
  const student = role === 'student';
  if (firebasePortal) {
    const now=Date.now();
    const upcoming=db.exams.filter(exam=>Date.parse(exam.start)>now).length;
    nextExamBoundary=student?Math.min(Infinity,...db.exams.filter(exam=>exam.ready)
      .flatMap(exam=>[Date.parse(exam.start),Date.parse(exam.start)+exam.duration*60000])
      .filter(time=>time>now)):Infinity;
    return hero('لوحة '+roleNames[role],student?'أهلاً، '+esc(account.name):'إدارة الامتحانات',
      student?'تابع مواعيد الامتحانات المنشورة وشعبها.':'أنشئ الأسئلة وانشر الامتحانات مع مواعيدها.')+
      `<div class="grid">${metric('الامتحانات المنشورة',db.exams.length)}${metric('المواعيد القادمة',upcoming)}${student?'':metric('أسئلة في البنك',db.questions.length)}</div>
      <div class="row"><h2>${student?'جدول الامتحانات':'الامتحانات المنشورة'}</h2><div class="actions">${button('تحديث القائمة','refresh-exams')}${student?'':button('إنشاء امتحان','page','create',true)}</div></div>
      ${db.exams.length?db.exams.map(exam=>`<section class="card"><span class="badge">${esc(exam.section)}</span><h3>${esc(exam.title)}</h3><p>البداية ${fmt(exam.start)}${exam.ready?' · النهاية '+fmt(Date.parse(exam.start)+exam.duration*60000):''}</p><p class="muted">${exam.questionCount} أسئلة · ${exam.duration} دقيقة · النجاح ${exam.pass}%</p>
        ${student?studentExamAction(exam):exam.ready?'':`<form class="enable-exam-form" data-id="${esc(exam.id)}"><label>وقت البداية الجديد<input type="datetime-local" name="start" required></label><div><button class="primary">تفعيل تقديم الامتحان</button></div></form>`}</section>`).join(''):'<p class="card">ما في امتحانات منشورة حاليًا.</p>'}`;
  }
  const resultCount = student ? db.results.filter(r=>r.student===account.id).length : db.results.length;
  return hero('لوحة '+roleNames[role], student?'أهلاً، '+esc(account.name):'إدارة الامتحانات',
    student?'قدّم الامتحانات المتاحة وراجع نتائجك بعد التسليم.':'أضف أسئلة لبنك الأسئلة، وجدول امتحانًا، وتابع نتائج الطلاب.') +
    `<div class="grid">${metric('الامتحانات',db.exams.length)}${metric('الامتحانات المقدّمة',resultCount)}${metric(student?'بانتظار التقديم':'أسئلة في البنك',student?db.exams.length-resultCount:db.questions.length)}</div>
    <div class="row"><h2>${student?'امتحاناتك':'قائمة الامتحانات'}</h2>${student?'':button('إنشاء امتحان','page','create',true)}</div>`+
    db.exams.map(exam=>{
      const done = completed(exam.id);
      const scheduled = exam.start && Date.parse(exam.start)>Date.now();
      return `<section class="card"><div class="row"><div><span class="badge ${done?'ok':''}">${done?'تم التسليم':scheduled?'مجدول':'متاح'}</span><h3>${esc(exam.title)}</h3><p class="muted">${exam.ids.length} أسئلة · ${exam.duration} دقيقة · النجاح ${exam.pass}%${exam.start?' · '+fmt(exam.start):''}</p></div>
      ${student ? done ? button('عرض النتيجة','page','results') : scheduled ? '' : button(db.attempts[attemptKey(exam.id)]?'متابعة الامتحان':'ابدأ الامتحان','start',exam.id,true) : ''}</div></section>`;
    }).join('');
}
function studentExamAction(exam) {
  const start=Date.parse(exam.start);
  const saved=db.submissions[exam.id];
  if (!exam.ready) return '<p class="muted">بانتظار تفعيل التقديم من المدرّس.</p>';
  if (saved?.submittedAt) return '<span class="badge ok">تم التسليم</span>';
  if (Date.now()<start) return '<span class="badge">لم يبدأ بعد</span>';
  if (Date.now()>=start+exam.duration*60000) {
    return `<span class="badge warn">${saved?'انتهى الوقت · الإجابات المحفوظة مغلقة':'انتهى وقت التقديم'}</span>`;
  }
  return button(saved?'متابعة الامتحان':'ابدأ الامتحان','start',exam.id,true);
}
function answerOption(index, fixedAnswer) {
  const number=index+1;
  const label=fixedAnswer || 'الخيار '+number;
  return `<div class="answer-option" ${!fixedAnswer && index>=4?'hidden':''}>
    ${fixedAnswer?`<span>${label}</span>`:`<label>${label}<input name="option" maxlength="200" required ${index>=4?'disabled':''}></label>`}
    <label class="correct-option"><input type="radio" name="${fixedAnswer?'correctBoolean':'correct'}" value="${index}" aria-label="تحديد ${label} كإجابة صحيحة" required ${!fixedAnswer && index>=4?'disabled':''}><span>صحيحة</span></label>
  </div>`;
}
function questionFromForm(form) {
  const boolean=form.get('type')==='boolean';
  const options=boolean?['صح','خطأ']:form.getAll('option').map(value=>value.trim());
  const selection=form.get(boolean?'correctBoolean':'correct');
  const correct=selection===null?-1:Number(selection);
  const prompt=form.get('prompt').trim();
  if (!prompt || ![2,4,6].includes(options.length) || options.some(value=>!value) || !options[correct]) {
    throw new Error('اكتب السؤال وكل الخيارات، وحدّد إجابة صحيحة واحدة.');
  }
  return {prompt,options,correct,points:Number(form.get('points'))};
}
function bank() {
  return hero('أدوات المدرّس','بنك الأسئلة','أضف أسئلة اختيار من متعدد أو صح وخطأ لاستخدامها في امتحاناتك.') +
    `<section class="card"><h2>إضافة سؤال</h2><form id="question-form">
    <label>نوع السؤال<select id="question-type" name="type"><option value="multiple">اختيار من متعدد</option><option value="boolean">صح أو خطأ</option></select></label>
    <label>نص السؤال<textarea name="prompt" required maxlength="400"></textarea></label>
    <fieldset id="multiple-options" class="answer-options"><legend>خيارات الإجابة</legend>
    <label>عدد الخيارات<select id="option-count"><option value="2">٢</option><option value="4" selected>٤</option><option value="6">٦</option></select></label>
    <p class="muted">حدّد مربع الإجابة الصحيحة.</p>
    ${Array.from({length:6},(_,index)=>answerOption(index)).join('')}</fieldset>
    <fieldset id="boolean-options" class="answer-options" hidden disabled><legend>الإجابة الصحيحة</legend>
    ${['صح','خطأ'].map((answer,index)=>answerOption(index,answer)).join('')}</fieldset>
    <label>العلامة<input name="points" type="number" min="1" max="100" value="1" required></label>
    <div><button class="primary">حفظ السؤال</button></div></form></section>
    <section class="card"><h2>الأسئلة المحفوظة</h2>${table(['السؤال','الإجابة الصحيحة','العلامة'], db.questions.map(q=>[esc(q.prompt),esc(q.options[q.correct]),q.points]))}</section>`;
}
function create() {
  if (firebasePortal && !db.questions.length) return hero('أدوات المدرّس','إنشاء امتحان','أضف سؤالًا واحدًا على الأقل لبنك الأسئلة حتى تقدر تنشر امتحان.')+`<div class="card">${button('الانتقال إلى بنك الأسئلة','page','bank',true)}</div>`;
  return hero('أدوات المدرّس','إنشاء امتحان','حدّد قواعد الامتحان واختر الأسئلة من البنك.') +
    `<section class="card"><form id="exam-form"><label>اسم الامتحان<input name="title" required maxlength="100"></label>
    ${firebasePortal?'<label>اسم الشعبة<input name="section" required maxlength="80"></label>':''}
    <div class="grid"><label>المدة بالدقائق<input type="number" name="duration" value="5" min="1" max="180" required></label>
    <label>علامة النجاح (%)<input type="number" name="pass" value="60" min="0" max="100" required></label>
    <label>وقت البداية${firebasePortal?'':' (اختياري)'}<input type="datetime-local" name="start" ${firebasePortal?'required':''}></label></div>
    <label class="choice"><input type="checkbox" name="shuffle"> ترتيب الأسئلة عشوائيًا لكل محاولة</label>
    <fieldset><legend>أسئلة الامتحان</legend>${db.questions.map(q=>`<label class="choice"><input type="checkbox" name="questions" value="${q.id}">${esc(q.prompt)} · ${q.points} علامة</label>`).join('')}</fieldset>
    <div><button class="primary">${firebasePortal?'نشر الامتحان':'حفظ الامتحان'}</button></div></form></section>`;
}
async function start(id) {
  if (firebasePortal) {
    const exam=db.exams.find(item=>item.id===id);
    const {questions,attempt}=await firebase.beginAttempt(exam);
    db.submissions[id]=attempt;
    if (attempt.submittedAt) {
      render();
      return;
    }
    db.questions=questions;
    db.attempts[id]=attempt;
  } else update(await api('attempt/start',{id}));
  active=id;
  position=0;
  navigate(db.attempts[id]?'attempt':'results');
}
function attempt() {
  const current = db.attempts[active];
  const q = question(current.order[position]);
  const count = Object.keys(current.answers).length;
  const exam = db.exams.find(item=>item.id===current.examId);
  return hero('امتحان قيد التقديم',esc(exam.title),'إجاباتك تُحفظ تلقائيًا عند اختيارها. يتم التسليم عند انتهاء الوقت.')+
    `<section class="card"><div class="row"><strong>${count} من ${current.order.length} مُجابة</strong><span class="badge warn">الوقت المتبقي <b id="timer" dir="ltr"></b></span></div>
    <progress aria-label="الأسئلة المجابة" value="${count}" max="${current.order.length}"></progress>
    <div class="palette">${current.order.map((id,index)=>`<button data-action="jump" data-id="${index}" class="${current.review[id]?'review':id in current.answers?'answered':''}" aria-label="السؤال ${index+1}${id in current.answers?'، تمت إجابته':''}${current.review[id]?'، للمراجعة':''}" ${index===position?'aria-current="step"':''}>${index+1}</button>`).join('')}</div>
    <small class="muted">أخضر = مُجاب · برتقالي = للمراجعة</small></section>
    <section class="card"><fieldset><legend>السؤال ${position+1} · ${q.points} علامة</legend><h2>${esc(q.prompt)}</h2>
    ${q.options.map((choice,index)=>`<label class="choice"><input type="radio" name="answer" value="${index}" ${current.answers[q.id]===index?'checked':''}>${esc(choice)}</label>`).join('')}</fieldset>
    <div class="row"><div class="actions">${position>0?button('السابق','jump',position-1):''}${position+1<current.order.length?button('التالي','jump',position+1,true):''}${button(current.review[q.id]?'إزالة علامة المراجعة':'علّم للمراجعة','review')}</div>${button('تسليم الامتحان','finish')}</div></section>`;
}
async function finishAttempt() {
  if (firebasePortal) {
    await firebase.submitAttempt(active);
    db.submissions[active].submittedAt=true;
    delete db.attempts[active];
    previousPages.length=0;
    page='exams';
    render();
    toast('تم تسليم الامتحان.');
    return;
  }
  update(await api('attempt/finish',{id:active}));
  page='results';
  render();
  toast('تم تسليم الامتحان.');
}
let nextExpiryCheck=0;
function tick() {
  if (firebasePortal && role==='student' && page==='exams' && !busy && Date.now()>=nextExamBoundary) {
    render();
    return;
  }
  const timer=document.querySelector('#timer');
  if (!timer || !db?.attempts[active]) return;
  const seconds=Math.max(0,Math.ceil((db.attempts[active].deadline-Date.now())/1000));
  timer.textContent=[Math.floor(seconds/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  if (!seconds && !busy && Date.now()>=nextExpiryCheck) {
    nextExpiryCheck=Date.now()+5000;
    perform(finishAttempt);
  }
}
function results() {
  const own = db.results.filter(result=>result.student===account.id);
  return hero('لوحة الطالب','نتائج الامتحانات','راجع علامتك والإجابات التي سلّمتها.')+
    (own.length ? own.map(r=>`<section class="card"><div class="row"><h2>${esc(r.title)}</h2><span class="badge ${r.passed?'ok':'warn'}">${r.passed?'ناجح':'لم ينجح'} · ${r.earned}/${r.total} · ${r.percent}%</span></div>
    ${table(['السؤال','إجابتك','العلامة'],r.details.map(q=>[esc(q.prompt),esc(q.selected || 'بدون إجابة'),q.earned+'/'+q.points]))}</section>`).join('') : '<p class="card">ما في نتائج بعد. قدّم امتحانًا لتظهر نتيجتك هون.</p>');
}
function analytics() {
  const r = db.results;
  const average = r.length ? Math.round(r.reduce((sum,item)=>sum+item.percent,0)/r.length)+'%' : '—';
  const pass = r.length ? Math.round(r.filter(item=>item.passed).length*100/r.length)+'%' : '—';
  return hero('لوحة المدرّس','تحليل النتائج','اطّلع على متوسط الدرجات ونسبة النجاح وتوزيع العلامات في امتحاناتك.')+
    `<div class="grid">${metric('عدد التسليمات',r.length)}${metric('متوسط العلامات',average)}${metric('نسبة النجاح',pass)}</div>
    <section class="card"><h2>توزيع الدرجات</h2>${[[0,49],[50,74],[75,100]].map(([min,max])=>{
      const count = r.filter(item=>item.percent>=min && item.percent<(max===100?101:max+1)).length;
      return `<div class="row"><span dir="ltr">${min}–${max}%</span><strong>${count}</strong></div><progress aria-label="عدد العلامات من ${min} إلى ${max}" max="${r.length||1}" value="${count}"></progress>`;
    }).join('')}</section>
    <section class="card"><div class="row"><h2>سجل التسليمات</h2>${r.length?button('تصدير CSV','export'):''}</div>${r.length?table(['الطالب','الامتحان','العلامة','النتيجة','وقت التسليم'],r.map(x=>[esc(studentName(x)),esc(x.title),x.percent+'%',x.passed?'ناجح':'لم ينجح',fmt(x.at)])):'<p>لا يوجد تسليمات بعد.</p>'}</section>`;
}
function people() {
  if (firebasePortal) {
    const directory=(title,entries,manage=false)=>`<section class="card"><h2>${title}</h2>
      ${entries.length?table(manage?['الاسم','البريد','الإجراء']:['الاسم','البريد'],entries.map(person=>[
        esc(person.name || '—'),esc(person.email || '—'),
        ...(manage?[button('إلغاء صلاحية المدرّس','remove-teacher',person.id)]:[])
      ])):'<p class="muted">ما في حسابات بهالقائمة حاليًا.</p>'}</section>`;
    return hero('لوحة الإدارة','الحسابات والصلاحيات','راجع الطلاب والمدرّسين والمديرين وأدر صلاحية التدريس.')+
      `<div class="grid">${metric('الطلاب',db.students.length)}${metric('المدرّسون',db.teachers.length)}${metric('المديرون',db.admins.length)}</div>
      <div class="actions">${button('إضافة مدرّس','page','addTeacher',true)}${button('تحديث القوائم','refresh-exams')}</div>
      <br>${directory('المدرّسون',db.teachers,true)}${directory('الطلاب',db.students)}${directory('المديرون',db.admins)}`;
  }
  return hero('لوحة الإدارة','حسابات المستخدمين','أضف المدرّسين وأدر حالة الحسابات.')+
    `<section class="card"><h2>إضافة مدرّس</h2><form id="teacher-form">${fields(true)}<div><button class="primary">حفظ حساب المدرّس</button></div></form></section>
    <section class="card">${table(['الاسم','البريد','الدور','الحالة','الإجراء'],db.people.map(p=>[esc(p.name),esc(p.email),roleNames[p.role],p.enabled?'مفعّل':'موقوف',p.role==='admin'?'—':button(p.enabled?'إيقاف':'تفعيل','toggle',p.id)]))}</section>`;
}
function addTeacher() {
  return hero('لوحة الإدارة','إضافة مدرّس','أنشئ حسابًا جديدًا للمدرّس حتى يدخل من بوابته مباشرة.')+
    `<section class="card"><form id="create-teacher-form">${fields(true)}
      <div class="actions"><button class="primary">إنشاء حساب المدرّس</button>${button('رجوع للحسابات','page','people')}</div>
    </form></section>`;
}
function log() {
  return hero('لوحة الإدارة','سجل النشاط','راجع عمليات الدخول وتغييرات الحسابات والامتحانات.')+
    `<section class="card">${db.log.length?table(['الحدث','الوقت'],db.log.map(item=>[esc(item.label),fmt(item.at)])):'<p>لا توجد أحداث بعد.</p>'}</section>`;
}
function download() {
  const cell = value => {
    const str = String(value);
    return '"'+(/^[=+\-@\t\r\n]/.test(str.trimStart())?"'":"")+str.replaceAll('"','""')+'"';
  };
  const rows = [['الطالب','الامتحان','النسبة','النتيجة','وقت التسليم'],...db.results.map(r=>[studentName(r),r.title,r.percent,r.passed?'ناجح':'لم ينجح',new Date(r.at).toISOString()])];
  const url = URL.createObjectURL(new Blob(['\ufeff',rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link = Object.assign(document.createElement('a'),{href:url,download:'exam-results.csv'});
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.querySelector('#logout').addEventListener('click',()=>perform(async()=>{
  if (firebasePortal) await firebase.logout();
  else await api('logout',{});
  account=undefined;
  role=undefined;
  active='';
  previousPages.length=0;
  toast('');
  render();
}));
document.querySelector('#back').addEventListener('click',()=>{
  if (busy) return;
  if (!previousPages.length) {location.assign('index.html');return;}
  page=previousPages.pop();
  if (page==='attempt' && !db.attempts[active]) page='exams';
  toast('');
  render();
});
document.addEventListener('click',event=>{
  const target=event.target.closest('button[data-action]');
  if (firebasePortal && target?.dataset.action==='student-logout') {
    perform(async()=>{await firebase.logout();account=undefined;toast('');render();});
    return;
  }
  if (!target || !account || busy) return;
  const {action,id}=target.dataset;
  toast('');
  if (action==='refresh-exams') perform(async()=>{await loadFirebaseAccount(account);render();});
  if (action==='remove-teacher' && firebasePortal && role==='admin') {
    const person=db.teachers.find(item=>item.id===id);
    if (person && confirm('إلغاء صلاحية المدرّس عن '+person.name+'؟')) {
      perform(async()=>{
        await firebase.removeTeacher(person.id);
        await loadFirebaseAccount(account);
        render();
        toast('تم إلغاء صلاحية المدرّس.');
      });
    }
  }
  if (action==='page') navigate(id);
  if (action==='start') perform(()=>start(id));
  if (action==='jump') {position=Number(id);render();}
  if (action==='review') perform(async()=>{
    const current=db.attempts[active];
    const question=current.order[position];
    const review=!current.review[question];
    if (firebasePortal) {
      await firebase.saveAttemptField(active,'review',question,review);
      current.review[question]=review;
    } else update(await api('attempt/review',{id:active,question,review}));
    if (!db.attempts[active]) page='results';
    render();
  });
  if (action==='finish' && confirm('تأكيد تسليم الامتحان؟')) perform(finishAttempt);
  if (action==='export') download();
  if (action==='toggle') perform(async()=>{update(await api('accounts/toggle',{id}));render();});
});
document.addEventListener('change',event=>{
  const field=event.target;
  if (field.id==='question-type') {
    const boolean=field.value==='boolean';
    const multipleOptions=document.querySelector('#multiple-options');
    const booleanOptions=document.querySelector('#boolean-options');
    multipleOptions.hidden=multipleOptions.disabled=boolean;
    booleanOptions.hidden=booleanOptions.disabled=!boolean;
  }
  if (field.id==='option-count') {
    const count=Number(field.value);
    document.querySelectorAll('#multiple-options .answer-option').forEach((row,index)=>{
      row.hidden=index>=count;
      row.querySelectorAll('input').forEach(input=>{
        input.disabled=row.hidden;
        if (row.hidden && input.type==='radio') input.checked=false;
      });
    });
  }
  if (field.name==='answer' && page==='attempt') {
    if (busy) {render();return;}
    perform(async()=>{
      const current=db.attempts[active];
      try {
        const questionId=current.order[position];
        const answer=Number(field.value);
        if (firebasePortal) {
          await firebase.saveAttemptField(active,'answers',questionId,answer);
          current.answers[questionId]=answer;
        } else update(await api('attempt/answer',{id:active,question:questionId,answer}));
        if (!db.attempts[active]) page='results';
      } finally {render();}
      view.querySelector('input[name="answer"]:checked')?.focus();
      toast(page==='attempt'?'تم حفظ الإجابة.':'تم تسليم الامتحان.');
    });
  }
});
document.addEventListener('submit',event=>{
  event.preventDefault();
  if (busy || staticPreview) return;
  const form=new FormData(event.target);
  const submitButton=event.target.querySelector('button');
  submitButton.disabled=true;
  toast('');
  perform(async()=>{
    try {
      const values=Object.fromEntries(form);
      if (firebasePortal) {
        firebase ??= await import('./firebase-student.js?v=7');
        if (event.target.classList.contains('enable-exam-form') && role==='teacher') {
          await firebase.enableExam(event.target.dataset.id,new Date(values.start).toISOString(),db.questions);
          await loadFirebaseAccount(account);
          render();
          toast('تم تفعيل تقديم الامتحان.');
          return;
        }
        if (event.target.id==='reset-password-form') {
          const status=event.target.querySelector('#reset-status');
          status.hidden=true;
          try {
            await firebase.requestPasswordReset(values.email);
            status.textContent='إذا كان البريد مسجّلًا، رح يوصلك رابط إعادة التعيين. افحص البريد الوارد والرسائل غير المرغوب فيها.';
          } catch (error) {
            status.textContent=error.code==='auth/too-many-requests'
              ? 'حاول مرة ثانية بعد فترة.'
              : 'تعذّر طلب الرابط. تأكّد من البريد واتصالك بالإنترنت وحاول مرة ثانية.';
          }
          status.hidden=false;
          return;
        }
        if (event.target.id==='create-teacher-form' && role==='admin') {
          try {await firebase.createTeacher(values);}
          catch (error) {
            if (error.code==='auth/email-already-in-use') throw new Error('هذا البريد مستخدم بالفعل. استخدم بريدًا جديدًا للمدرّس.');
            if (error.code==='permission-denied') throw new Error('تعذّر تفعيل هذا الحساب كمدرّس. إذا كان مسجّلًا كطالب أو مدير، استخدم بريدًا جديدًا.');
            throw error;
          }
          await loadFirebaseAccount(account);
          navigate('people');
          toast('تمت إضافة المدرّس.');
          return;
        }
        if (event.target.id==='question-form') {
          await firebase.addQuestion(questionFromForm(form));
          await loadFirebaseAccount(account);
          render();
          toast('تم حفظ السؤال.');
          return;
        }
        if (event.target.id==='exam-form') {
          const ids=form.getAll('questions');
          const title=values.title.trim();
          const section=values.section.trim();
          if (!title || !section || !ids.length || ids.length>100) throw new Error('أدخل الاسم والشعبة واختر من سؤال واحد إلى 100 سؤال.');
          await firebase.publishExam({title,section,ids,start:new Date(values.start).toISOString(),duration:Number(values.duration),pass:Number(values.pass),shuffle:form.has('shuffle')},db.questions);
          await loadFirebaseAccount(account);
          navigate('exams');
          toast('تم نشر الامتحان.');
          return;
        }
        const action={'register-form':'register','login-form':'login','profile-form':'saveProfile'}[event.target.id];
        if (!action) return;
        try {
          await loadFirebaseAccount(await firebase[action](action==='saveProfile'?values.name:values,portal));
          render();
          if (action==='register') {
            registration=false;
            history.replaceState(null,'','?portal=student');
          }
          if (action!=='login') toast('تم حفظ حسابك في مقياس.');
        } catch (error) {
          const messages={
            'auth/email-already-in-use':'هذا البريد مسجّل. ارجع إلى تسجيل الدخول.',
            'auth/invalid-credential':'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
            'auth/network-request-failed':'تعذّر الاتصال. جرّب مرة ثانية.',
            'auth/too-many-requests':'حاول مرة ثانية بعد فترة.',
            'permission-denied':'تعذّر حفظ ملف الطالب في قاعدة البيانات.'
          };
          const partial=await firebase.profile(portal).catch(()=>null);
          if (partial && !partial.name) {await loadFirebaseAccount(partial);render();}
          throw new Error(messages[error.code] || error.message);
        }
        return;
      }
      switch (event.target.id) {
        case 'register-form':
          await api('register',values);
          location.assign('?portal=student&created=1');
          break;
        case 'login-form':
          update(await api('login',{...values,portal}));
          page=Object.keys(menus[role])[0];
          previousPages.length=0;
          render();
          break;
        case 'teacher-form':
          update(await api('teachers',values));
          render();
          toast('تم إنشاء حساب المدرّس.');
          break;
        case 'question-form': {
          update(await api('questions',questionFromForm(form)));
          render();
          toast('تم حفظ السؤال.');
          break;
        }
        case 'exam-form':
          update(await api('exams',{title:values.title,ids:form.getAll('questions'),start:values.start?new Date(values.start).toISOString():'',duration:Number(values.duration),pass:Number(values.pass),shuffle:form.has('shuffle')}));
          page='exams';
          render();
          toast('تم نشر الامتحان.');
          break;
      }
    } finally {submitButton.disabled=false;}
  });
});
render();
perform(async()=>{
  if (firebasePortal) {
    firebase=await import('./firebase-student.js?v=7');
    await loadFirebaseAccount(await firebase.profile(portal));
    render();
    return;
  }
  if (staticPreview || !Object.hasOwn(portals,portal)) return;
  update(await api('state'));
  if (account) page=Object.keys(menus[role])[0];
  render();
  if (!account && params.has('created')) toast('تم إنشاء الحساب. سجّل دخولك بالبريد وكلمة المرور.');
});
setInterval(tick,250);
