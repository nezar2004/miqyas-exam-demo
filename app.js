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
let selectedRoster;
let editingQuestionId;
let reschedulingExamId;
const grades=new Map();
let examTab='available';
let resultId;
let savingAnswer=false;
let pendingAnswer;
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
  student:{exams:'الامتحانات', classes:'شُعبي', results:'نتائجي', studentProfile:'ملفي الشخصي'},
  teacher:{exams:'إدارة الامتحانات', classes:'الشُعب', bank:'بنك الأسئلة', create:'إنشاء امتحان', analytics:'تحليل النتائج'},
  admin:{people:'حسابات المستخدمين', addTeacher:'إضافة مدرّس', classes:'إدارة الشُعب', log:'سجل النشاط'}
};
const view = document.querySelector('#view');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const button = (label, action, id = '', primary = false) => `<button type="button" class="${primary ? 'primary' : ''}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const hero = (tag, title, description) => `<section class="hero"><div class="eyebrow">${tag}</div><h1>${title}</h1><p>${description}</p></section>`;
const num = (value, arabic = false) => String(value).replace(/[0-9٠-٩]/g, digit => {
  const index = '٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
  return (arabic ? '٠١٢٣٤٥٦٧٨٩' : '0123456789')[index<0?Number(digit):index];
});
const metric = (label, value) => `<div class="card metric-card"><span class="metric-icon">${icon('chart')}</span><span class="muted">${label}</span><strong class="metric">${num(value)}</strong></div>`;
const table = (headers, rows, emailColumn = -1) => `<div class="table"><table><thead><tr>${headers.map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((x,index)=>`<td${index===emailColumn?' dir="ltr" class="email-cell"':''}>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const dateFormat = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{day:'numeric',month:'long',year:'numeric'});
const timeFormat = new Intl.DateTimeFormat('ar-JO-u-nu-latn',{hour:'numeric',minute:'2-digit',hour12:true});
function fmt(value) {
  const date = new Date(value);
  return Number.isFinite(+date)?num(dateFormat.format(date)+' - '+timeFormat.format(date),true):'—';
}
function quantity(count, singular, dual, plural) {
  if (count===1) return singular;
  if (count===2) return dual;
  const remainder=count%100;
  return num(count)+' '+(count===0 || (remainder>=3 && remainder<=10)?plural:singular);
}
function examDates(start, duration) {
  if (!start) return '';
  return `<div class="exam-dates"><div>البداية <bdi>${fmt(start)}</bdi></div>
    ${duration===undefined?'':`<div>النهاية <bdi>${fmt(Date.parse(start)+duration*60000)}</bdi></div>`}</div>`;
}
function classSubject(group) {
  const match=/^(.+) \(([A-Z0-9][A-Z0-9 -]{0,19})\)$/.exec(group?.subject || '');
  return match ? {name:match[1],code:match[2]} : {name:group?.subject || '',code:''};
}
function classTitle(group) {
  const subject=classSubject(group);
  return `${esc(subject.name)}${subject.code?` <bdi dir="ltr">(${esc(subject.code)})</bdi>`:''} <span>شعبة <bdi>${esc(group.name)}</bdi></span>`;
}
function examClassLabels(exam) {
  const classes=(exam.classIds || []).map(id=>db.classes.find(group=>group.id===id)).filter(Boolean);
  return classes.length?classes.map(group=>`<span class="badge">${classTitle(group)}</span>`).join(' '):`<span class="badge">${esc(exam.section)}</span>`;
}
function classChoices() {
  return `<fieldset><legend>الشُعب المستهدفة (من شعبة إلى 3)</legend>${db.classes.map(group=>
    `<label class="choice"><input type="checkbox" name="classIds" value="${esc(group.id)}"><span>${classTitle(group)}</span></label>`
  ).join('')}</fieldset>`;
}
function selectedClasses(form) {
  const ids=form.getAll('classIds');
  if (!ids.length || ids.length>3 || !ids.every(id=>db.classes.some(group=>group.id===id))) {
    throw new Error('اختر من شعبة إلى 3 شُعب.');
  }
  return ids;
}
function classes() {
  const student=role==='student';
  const classFields=group=>{
    const subject=classSubject(group);
    return `<div class="class-fields">
      <label>اسم المادة<input name="subjectName" value="${esc(subject.name)}" placeholder="أمن الشبكات" required maxlength="80"></label>
      <label>رمز المادة<input name="subjectCode" value="${esc(subject.code)}" dir="ltr" placeholder="CYS 334" ${group?'':'required'} maxlength="20" autocapitalize="characters"></label>
      <label>رقم الشعبة<input name="name" value="${esc(group?.name)}" dir="ltr" inputmode="numeric" placeholder="3" required maxlength="8"></label>
    </div>`;
  };
  const teacherOptions=role==='admin'?`<label>المدرّس<select name="owner" required><option value="">اختر المدرّس</option>${db.teachers.map(teacher=>
    `<option value="${esc(teacher.id)}">${esc(teacher.name)}</option>`).join('')}</select></label>`:'';
  return hero('الشُعب الدراسية',student?'شُعبي':'إدارة الشُعب',student?'أدخل الرمز اللي أعطاك إياه المدرّس لتظهر امتحانات الشعبة.':'أنشئ شعبة وشارك رمز الانضمام مع طلابها.')
    + (student?`<section class="card"><form id="join-class-form"><label>رمز الانضمام<input name="code" dir="ltr" required maxlength="41" autocomplete="off" spellcheck="false"></label>
      <div><button class="primary">انضم للشعبة</button></div></form></section>`:
      `<section class="card"><h2>إضافة شعبة</h2><form class="class-form">${classFields()}${teacherOptions}<div><button class="primary">إنشاء شعبة</button></div></form></section>`)
    + (db.classes.length?db.classes.map(group=>`<section class="card"><h2 class="class-title">${classTitle(group)}</h2>
      ${role==='admin'?`<p>المدرّس: ${esc(db.teachers.find(teacher=>teacher.id===group.owner)?.name || 'حساب غير متاح')}</p>`:''}
      ${student?'':`${group.invite?`<p>رمز الانضمام <code dir="ltr" style="overflow-wrap:anywhere">${esc(group.id+'-'+group.invite)}</code></p>`:button('إنشاء رمز انضمام','class-invite',group.id)}
      <details><summary>الطلاب المسجّلون (${num(group.members.length)})</summary>${group.members.length?
        `<ul>${group.members.map(name=>`<li>${esc(name)}</li>`).join('')}</ul>`:'<p>لسه ما انضم أي طالب.</p>'}</details>
      <details><summary>تعديل الشعبة</summary><form class="class-form" data-id="${esc(group.id)}">${classFields(group)}
      <div><button>حفظ التعديل</button></div></form></details>`}</section>`).join(''):'<p class="card">ما في شُعب حاليًا.</p>');
}
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
  if (next!=='bank') editingQuestionId=undefined;
  if (next!=='exams') reschedulingExamId=undefined;
  if (next!==page) previousPages.push(page);
  page=next;
  render();
}
function toast(message) { notice.textContent = message; }
async function loadFirebaseAccount(next) {
  const data=next?.name ? await (portal==='admin'?firebase.loadPeople():firebase.loadExams(portal)) : null;
  if (next?.role==='student' && data) {
    await Promise.allSettled(Object.keys(data.submissions).map(id=>firebase.syncParticipant(id,next.name)));
    const submitted=data.exams.filter(exam=>data.submissions[exam.id]?.submittedAt);
    await Promise.allSettled(submitted.map(async exam=>{
      if (grades.has(exam.id)) return;
      const grade=await firebase.studentGrade(exam);
      if (grade) grades.set(exam.id,grade);
    }));
  }
  account=next;
  role=next?.role;
  db=data;
  if (!role || !menus[role][page]) page=role==='admin'?'people':'exams';
}
function render() {
  if (firebasePortal && account?.verification) {
    document.body.classList.add('signed-out');
    view.innerHTML=publicHeader()+`<section class="card">
      <h1>تأكيد البريد الجامعي</h1>
      <p dir="ltr">${esc(account.email)}</p>
      <p>${account.verification==='domain'
        ?'الدخول للامتحانات يتطلب حسابًا ببريد ينتهي بـ ‎@ses.yu.edu.jo‎.'
        :'افتح رابط التأكيد في بريدك الجامعي، ثم ارجع واضغط «تأكدت من بريدي».'}</p>
      <div class="actions">
        ${account.verification==='pending'
          ?button('تأكدت من بريدي','verify-email','',true)+button('إعادة إرسال رسالة التأكيد','resend-verification')
          :''}
        ${button('تسجيل الخروج','student-logout')}
      </div></section>`;
    return;
  }
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
  const navIcons = {exams:'grid',classes:'cap',results:'chart',studentProfile:'cap',bank:'paper',create:'paper',analytics:'chart',people:'shield',addTeacher:'cap',log:'clock'};
  nav.innerHTML = Object.entries(menus[role]).filter(([id])=>firebasePortal?!['analytics','log'].includes(id):!['addTeacher','classes','studentProfile'].includes(id)).map(([id, title])=>`<button type="button" data-action="page" data-id="${id}" ${id===page?'aria-current="page"':''}>${icon(navIcons[id])}${title}</button>`).join('');
  document.querySelector('#workspace-role').textContent = portals[role].title;
  document.querySelector('#section').textContent = menus[role][page] || (page==='roster'?'كشف الأسماء':'تقديم الامتحان');
  const screens = {exams, classes, results, studentProfile, bank, create, analytics, people, addTeacher, log, attempt, roster};
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
    <section class="portal-section"><div class="row"><h2>اختر بوابتك</h2><span class="muted">${num(Object.keys(portals).length)} مساحات عمل</span></div><div class="portal-grid">${Object.entries(portals).map(([id,item])=>`<a class="portal-card" href="?portal=${id}"><span class="row"><span class="portal-icon ${id}">${icon(item.icon)}</span><small dir="ltr">${item.code}</small></span><h3>${item.title}</h3><p>${item.detail}</p><span class="portal-link">الانتقال إلى البوابة ${icon('arrow')}</span></a>`).join('')}</div></section>
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
      ${registration && firebasePortal?'<p class="muted">سجّل ببريد الجامعة المنتهي بـ ‎@ses.yu.edu.jo‎.</p>':''}
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
function studentDashboard() {
  const now=Date.now();
  const groups={available:[],upcoming:[],complete:[]};
  const boundaries=[];
  for (const exam of db.exams) {
    const start=Date.parse(exam.start);
    const end=start+exam.duration*60000;
    const saved=db.submissions[exam.id];
    if (exam.ready) boundaries.push(start,end);
    const status=saved?.submittedAt || (exam.ready && (end<=now || saved?.startedAt?.toMillis()<start))?'complete':
      !exam.ready || start>now?'upcoming':'available';
    groups[status].push(exam);
  }
  nextExamBoundary=Math.min(Infinity,...boundaries.filter(time=>time>now));
  const next=groups.upcoming.find(exam=>exam.ready);
  const marks=groups.complete.map(exam=>grades.get(exam.id)).filter(Boolean);
  const average=marks.length?Math.round(marks.reduce((sum,mark)=>sum+mark.percent,0)/marks.length)+'%':'—';
  const tabs={available:'متاحة',upcoming:'قادمة',complete:'مكتملة'};
  return hero('لوحة الطالب','أهلاً، '+esc(account.name),'تابع مواعيد امتحاناتك ونتائجك.')
    + `<div class="grid">${metric('متاح الآن',groups.available.length)}${metric('قادم',groups.upcoming.length)}
      ${metric('مكتمل',groups.complete.length)}${metric('المعدل العام',average)}</div>
      ${next?`<section class="card"><strong>الامتحان القادم · ${esc(next.title)}</strong>
      <p class="muted">يبدأ بعد <bdi id="exam-countdown" data-start="${Date.parse(next.start)}"></bdi></p></section>`:''}
      <div class="row"><div class="actions" role="group" aria-label="حالة الامتحانات">${Object.entries(tabs).map(([id,label])=>
        `<button type="button" data-action="exam-tab" data-id="${id}" aria-pressed="${examTab===id}" class="${examTab===id?'primary':''}">${label}</button>`).join('')}</div>
        ${button('تحديث القائمة','refresh-exams')}</div>
      ${groups[examTab].map(exam=>`<section class="card">${examClassLabels(exam)}<h3>${esc(exam.title)}</h3>
      ${examDates(exam.start,exam.ready?exam.duration:undefined)}<p class="muted">${quantity(exam.questionCount,'سؤال','سؤالان','أسئلة')} ·
      ${quantity(exam.duration,'دقيقة','دقيقتان','دقائق')} · النجاح <bdi dir="ltr">${num(exam.pass)}%</bdi></p>
      ${studentExamAction(exam)}</section>`).join('') || `<section class="card student-empty"><h3>ما في امتحانات ${tabs[examTab]} حاليًا</h3>
      ${!db.classes.length?button('انضم إلى شعبة','page','classes'):''}</section>`}`;
}
function exams() {
  const student = role === 'student';
  if (firebasePortal && student) return studentDashboard();
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
      ${db.exams.length?db.exams.map(exam=>`<section class="card">${examClassLabels(exam)}<h3>${esc(exam.title)}</h3>${examDates(exam.start,exam.ready?exam.duration:undefined)}<p class="muted">${quantity(exam.questionCount,'سؤال','سؤالان','أسئلة')} · ${quantity(exam.duration,'دقيقة','دقيقتان','دقائق')} · النجاح <bdi dir="ltr">${num(exam.pass)}%</bdi></p>
        ${student?studentExamAction(exam):teacherExamActions(exam)}</section>`).join(''):'<p class="card">ما في امتحانات منشورة حاليًا.</p>'}`;
  }
  const resultCount = student ? db.results.filter(r=>r.student===account.id).length : db.results.length;
  return hero('لوحة '+roleNames[role], student?'أهلاً، '+esc(account.name):'إدارة الامتحانات',
    student?'قدّم الامتحانات المتاحة وراجع نتائجك بعد التسليم.':'أضف أسئلة لبنك الأسئلة، وجدول امتحانًا، وتابع نتائج الطلاب.') +
    `<div class="grid">${metric('الامتحانات',db.exams.length)}${metric('الامتحانات المقدّمة',resultCount)}${metric(student?'بانتظار التقديم':'أسئلة في البنك',student?db.exams.length-resultCount:db.questions.length)}</div>
    <div class="row"><h2>${student?'امتحاناتك':'قائمة الامتحانات'}</h2>${student?'':button('إنشاء امتحان','page','create',true)}</div>`+
    db.exams.map(exam=>{
      const done = completed(exam.id);
      const scheduled = exam.start && Date.parse(exam.start)>Date.now();
      return `<section class="card"><div class="row"><div><span class="badge ${done?'ok':''}">${done?'تم التسليم':scheduled?'مجدول':'متاح'}</span><h3>${esc(exam.title)}</h3>${examDates(exam.start,exam.duration)}<p class="muted">${quantity(exam.ids.length,'سؤال','سؤالان','أسئلة')} · ${quantity(exam.duration,'دقيقة','دقيقتان','دقائق')} · النجاح <bdi dir="ltr">${num(exam.pass)}%</bdi></p></div>
      ${student ? done ? button('عرض النتيجة','page','results') : scheduled ? '' : button(db.attempts[attemptKey(exam.id)]?'متابعة الامتحان':'ابدأ الامتحان','start',exam.id,true) : ''}</div></section>`;
    }).join('');
}
function teacherExamActions(exam) {
  if (!exam.classIds?.length) return db.classes.length?
    `<details><summary>ربط الامتحان بالشُعب</summary><form class="assign-exam-form" data-id="${esc(exam.id)}">${classChoices()}
    <div><button class="primary">حفظ الشُعب</button></div></form></details>`:
    button('أنشئ شعبة لربط الامتحان','page','classes');
  const start=Date.parse(exam.start);
  const isRunning=Date.now()>=start && Date.now()<start+exam.duration*60000;
  const actions=exam.ready?`<div class="actions">${button('كشف الأسماء','roster',exam.id)}
    ${isRunning?'':button('تغيير الموعد','reschedule-exam',exam.id)}</div>`:'';
  if (exam.ready && reschedulingExamId!==exam.id) return actions;
  return actions+`<form class="${exam.ready?'reschedule-exam-form':'enable-exam-form'}" data-id="${esc(exam.id)}">
    <label>وقت البداية الجديد<input type="datetime-local" name="start" required></label>
    <div class="actions"><button class="primary">${exam.ready?'حفظ الموعد':'تفعيل تقديم الامتحان'}</button>
    ${exam.ready?button('إلغاء','cancel-reschedule'):''}</div></form>`;
}
function studentExamAction(exam) {
  const start=Date.parse(exam.start);
  const saved=db.submissions[exam.id];
  if (!exam.ready) return '<p class="muted">بانتظار تفعيل التقديم من المدرّس.</p>';
  if (saved?.submittedAt) {
    const grade=grades.get(exam.id);
    return grade?`<div class="actions"><span class="badge ${grade.passed?'ok':'warn'}"><bdi dir="ltr">${num(grade.earned)} / ${num(grade.total)}</bdi> · <bdi dir="ltr">${num(grade.percent)}%</bdi> · ${grade.passed?'ناجح':'دون علامة النجاح'}</span>${button('تفاصيل النتيجة','grade',exam.id)}</div>`
      :`<div class="actions"><span class="badge ok">تم التسليم</span>${button('عرض العلامة','grade',exam.id)}</div>`;
  }
  if (saved?.startedAt?.toMillis()<start) return button('عرض علامة المحاولة السابقة','grade',exam.id);
  if (Date.now()<start) return '<span class="badge">لم يبدأ بعد</span>';
  if (Date.now()>=start+exam.duration*60000) {
    return saved?button('عرض علامة الإجابات المحفوظة','grade',exam.id):'<span class="badge warn">انتهى وقت التقديم</span>';
  }
  return button(saved?'متابعة الامتحان':'ابدأ الامتحان','start',exam.id,true);
}
async function showGrade(id) {
  const exam=db.exams.find(item=>item.id===id);
  const saved=db.submissions[id];
  if (!saved.submittedAt) {
    await firebase.submitAttempt(id);
    saved.submittedAt=true;
  }
  await firebase.syncParticipant(id,account.name);
  const grade=await firebase.studentGrade(exam,true);
  if (grade) grades.set(id,grade);
  resultId=id;
  navigate('results');
  toast(grade?'':'العلامة بانتظار تجهيز مفتاح الامتحان. خلي المدرّس يفتح كشف الأسماء وبعدين جرّب مرة ثانية.');
}
function roster() {
  const {exam,entries}=selectedRoster;
  const graded=entries.filter(entry=>entry.grade);
  return hero('لوحة المدرّس','كشف الأسماء',esc(exam.title))+
    `<div class="grid">${metric('بدأوا الامتحان',entries.length)}${metric('المحاولات المصحّحة',graded.length)}</div>
    <section class="card"><div class="row"><h2>الطلاب والعلامات</h2>${button('تحديث الكشف','roster',exam.id)}</div>
    ${entries.length?table(['اسم الطالب','الحالة','العلامة'],entries.map(entry=>[
      esc(entry.name),entry.submitted?'انتهت المحاولة':'بدأ الامتحان',
      entry.grade?`<bdi dir="ltr">${num(entry.grade.earned)} / ${num(entry.grade.total)}</bdi> · <bdi dir="ltr">${num(entry.grade.percent)}%</bdi>`:'—'
    ])):'<p>لسه ما في محاولات مسجّلة بكشف هالامتحان.</p>'}</section>`;
}
function answerOption(index, fixedAnswer, count, existing) {
  const number=index+1;
  const label=fixedAnswer || 'الخيار '+num(number);
  const hidden=!fixedAnswer && index>=count;
  return `<div class="answer-option" ${hidden?'hidden':''}>
    ${fixedAnswer?`<span>${label}</span>`:`<label>${label}<input name="option" maxlength="200" value="${esc(existing?.options[index] ?? '')}" required ${hidden?'disabled':''}></label>`}
    <label class="correct-option"><input type="radio" name="${fixedAnswer?'correctBoolean':'correct'}" value="${index}" aria-label="تحديد ${label} كإجابة صحيحة" required ${hidden?'disabled':''} ${existing?.correct===index?'checked':''}><span>صحيحة</span></label>
  </div>`;
}
function questionFromForm(form, existing) {
  const boolean=form.get('type')==='boolean';
  const options=boolean?['صح','خطأ']:form.getAll('option').map(value=>value.trim());
  const selection=form.get(boolean?'correctBoolean':'correct');
  const correct=selection===null?-1:Number(selection);
  const prompt=form.get('prompt').trim();
  if (!prompt || ![2,4,6,existing?.options.length].includes(options.length) || options.some(value=>!value) || !options[correct]) {
    throw new Error('اكتب السؤال وكل الخيارات، وحدّد إجابة صحيحة واحدة.');
  }
  return {prompt,options,correct,points:Number(form.get('points'))};
}
function bank() {
  const existing=db.questions.find(item=>item.id===editingQuestionId);
  const count=existing?.options.length ?? 4;
  const boolean=existing?.options.length===2 && existing.options[0]==='صح' && existing.options[1]==='خطأ';
  const counts=[...new Set([2,4,6,count])].sort((a,b)=>a-b);
  return hero('أدوات المدرّس','بنك الأسئلة','أضف أسئلة اختيار من متعدد أو صح وخطأ لاستخدامها في امتحاناتك.') +
    `<section class="card"><h2>${existing?'تعديل سؤال':'إضافة سؤال'}</h2><form id="question-form" data-id="${esc(existing?.id ?? '')}">
    <label>نوع السؤال<select id="question-type" name="type"><option value="multiple">اختيار من متعدد</option><option value="boolean" ${boolean?'selected':''}>صح أو خطأ</option></select></label>
    <label>نص السؤال<textarea name="prompt" required maxlength="400">${esc(existing?.prompt ?? '')}</textarea></label>
    <fieldset id="multiple-options" class="answer-options" ${boolean?'hidden disabled':''}><legend>خيارات الإجابة</legend>
    <label>عدد الخيارات<select id="option-count">${counts.map(n=>`<option value="${n}" ${n===count?'selected':''}>${num(n)}</option>`).join('')}</select></label>
    <p class="muted">حدّد مربع الإجابة الصحيحة.</p>
    ${Array.from({length:Math.max(6,count)},(_,index)=>answerOption(index,null,count,existing)).join('')}</fieldset>
    <fieldset id="boolean-options" class="answer-options" ${boolean?'':'hidden disabled'}><legend>الإجابة الصحيحة</legend>
    ${['صح','خطأ'].map((answer,index)=>answerOption(index,answer,2,boolean?existing:null)).join('')}</fieldset>
    <label>العلامة<input name="points" type="number" min="1" max="100" value="${existing?.points ?? 1}" required></label>
    <div class="actions"><button class="primary">${existing?'حفظ التعديل':'حفظ السؤال'}</button>${existing?button('إلغاء التعديل','cancel-question-edit'):''}</div></form></section>
    <section class="card"><h2>الأسئلة المحفوظة</h2>${table(
      ['السؤال','الإجابة الصحيحة','العلامة',...(firebasePortal?['الإجراء']:[])],
      db.questions.map(q=>[esc(q.prompt),esc(q.options[q.correct]),num(q.points),...(firebasePortal?[button('تعديل','edit-question',q.id)]:[])])
    )}</section>`;
}
function create() {
  if (firebasePortal && !db.classes.length) return hero('أدوات المدرّس','إنشاء امتحان','أنشئ شعبة حتى تقدر تحدد مين يقدّم الامتحان.')+`<div class="card">${button('الانتقال إلى الشُعب','page','classes',true)}</div>`;
  if (firebasePortal && !db.questions.length) return hero('أدوات المدرّس','إنشاء امتحان','أضف سؤالًا واحدًا على الأقل لبنك الأسئلة حتى تقدر تنشر امتحان.')+`<div class="card">${button('الانتقال إلى بنك الأسئلة','page','bank',true)}</div>`;
  return hero('أدوات المدرّس','إنشاء امتحان','حدّد قواعد الامتحان واختر الأسئلة من البنك.') +
    `<section class="card"><form id="exam-form"><label>اسم الامتحان<input name="title" required minlength="3" maxlength="100"></label>
    ${firebasePortal?classChoices():''}
    <div class="grid"><label>المدة بالدقائق<input type="number" name="duration" value="5" min="1" max="180" required></label>
    <label>علامة النجاح (%)<input type="number" name="pass" value="60" min="0" max="100" required></label>
    <label>وقت البداية${firebasePortal?'':' (اختياري)'}<input type="datetime-local" name="start" ${firebasePortal?'required':''}></label></div>
    <label class="choice"><input type="checkbox" name="shuffle"> ترتيب الأسئلة عشوائيًا لكل محاولة</label>
    <fieldset><legend>أسئلة الامتحان</legend>${db.questions.map(q=>`<label class="choice"><input type="checkbox" name="questions" value="${esc(q.id)}">${esc(q.prompt)} · ${num(q.points)} علامة</label>`).join('')}</fieldset>
    <div><button class="primary">${firebasePortal?'نشر الامتحان':'حفظ الامتحان'}</button></div></form></section>`;
}
async function start(id) {
  if (firebasePortal) {
    const exam=db.exams.find(item=>item.id===id);
    const {questions,attempt}=await firebase.beginAttempt(exam,account.name);
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
    `<section class="card"><div class="row"><strong>${num(count)} من ${num(current.order.length)} مُجابة</strong><span class="badge warn">الوقت المتبقي <b id="timer" dir="ltr"></b></span></div>
    <progress aria-label="الأسئلة المجابة" value="${count}" max="${current.order.length}"></progress>
    <div class="palette">${current.order.map((id,index)=>`<button data-action="jump" data-id="${index}" class="${current.review[id]?'review':id in current.answers?'answered':''}" aria-label="السؤال ${num(index+1)}${id in current.answers?'، تمت إجابته':''}${current.review[id]?'، للمراجعة':''}" ${index===position?'aria-current="step"':''}>${num(index+1)}</button>`).join('')}</div>
    <small class="muted">أخضر = مُجاب · بدون لون = غير مُجاب · برتقالي = للمراجعة</small>
    <p id="attempt-save-status" role="status">${!navigator.onLine?'الاتصال مقطوع. اترك الصفحة مفتوحة حتى يرجع الاتصال.':savingAnswer?'جاري حفظ الإجابة…':pendingAnswer?'في إجابة بانتظار الحفظ.':'الإجابات الظاهرة محفوظة.'}</p>
    ${pendingAnswer&&!savingAnswer&&navigator.onLine?button('إعادة محاولة الحفظ','retry-answer'):''}</section>
    <section class="card"><fieldset><legend>السؤال ${num(position+1)} · ${num(q.points)} علامة</legend><h2>${esc(q.prompt)}</h2>
    ${q.options.map((choice,index)=>`<label class="choice"><input type="radio" name="answer" value="${index}" ${current.answers[q.id]===index?'checked':''}>${esc(choice)}</label>`).join('')}</fieldset>
    <div class="row"><div class="actions">${position>0?button('السابق','jump',position-1):''}${position+1<current.order.length?button('التالي','jump',position+1,true):''}${button(current.review[q.id]?'إزالة علامة المراجعة':'علّم للمراجعة','review')}</div>${button('تسليم الامتحان','finish')}</div></section>`;
}
async function finishAttempt() {
  if (firebasePortal) {
    if (pendingAnswer) throw new Error('في إجابة بانتظار الحفظ. أعد محاولة الحفظ قبل التسليم.');
    await firebase.submitAttempt(active);
    db.submissions[active].submittedAt=true;
    delete db.attempts[active];
    previousPages.length=0;
    page='exams';
    render();
    toast('تم تسليم الامتحان.');
    await showGrade(active);
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
  const countdown=document.querySelector('#exam-countdown');
  if (countdown) {
    const seconds=Math.max(0,Math.ceil((Number(countdown.dataset.start)-Date.now())/1000));
    const clock=[Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60].map(n=>num(n).padStart(2,'0')).join(':');
    countdown.textContent=seconds>=86400?num(Math.floor(seconds/86400))+' يوم · '+clock:clock;
  }
  const timer=document.querySelector('#timer');
  if (!timer || !db?.attempts[active]) return;
  const seconds=Math.max(0,Math.ceil((db.attempts[active].deadline-Date.now())/1000));
  timer.textContent=[Math.floor(seconds/60),seconds%60].map(n=>num(n).padStart(2,'0')).join(':');
  if (!seconds && !busy && Date.now()>=nextExpiryCheck) {
    nextExpiryCheck=Date.now()+5000;
    if (!firebasePortal || navigator.onLine) perform(async()=>{
      if (pendingAnswer) {
        pendingAnswer=undefined;
        await finishAttempt();
        toast('انتهى الوقت. تم تسليم الإجابات المحفوظة.');
      } else await finishAttempt();
    });
  }
}
function results() {
  if (firebasePortal) return studentResults();
  const own = db.results.filter(result=>result.student===account.id);
  return hero('لوحة الطالب','نتائج الامتحانات','راجع علامتك والإجابات التي سلّمتها.')+
    (own.length ? own.map(r=>`<section class="card"><div class="row"><h2>${esc(r.title)}</h2><span class="badge ${r.passed?'ok':'warn'}">${r.passed?'ناجح':'لم ينجح'} · <bdi dir="ltr">${num(r.earned)}/${num(r.total)}</bdi> · <bdi dir="ltr">${num(r.percent)}%</bdi></span></div>
    ${table(['السؤال','إجابتك','العلامة'],r.details.map(q=>[esc(q.prompt),esc(q.selected || 'بدون إجابة'),'<bdi dir="ltr">'+num(q.earned)+'/'+num(q.points)+'</bdi>']))}</section>`).join('') : '<p class="card">ما في نتائج بعد. قدّم امتحانًا لتظهر نتيجتك هون.</p>');
}
function studentResults() {
  const history=db.exams.filter(exam=>db.submissions[exam.id]?.submittedAt);
  if (resultId) {
    const exam=history.find(item=>item.id===resultId);
    const grade=grades.get(resultId);
    if (exam) return hero('نتائجي',esc(exam.title),grade?`العلامة ${num(grade.earned)} من ${num(grade.total)} · ${num(grade.percent)}% · ${grade.passed?'ناجح':'دون علامة النجاح'}`:'العلامة قيد التجهيز.')
      + `<div class="actions">${button('كل النتائج','all-results')}${button('تحديث التفاصيل','grade',exam.id)}</div>
      <section class="card">${grade?.details?.length?table(['السؤال','إجابتك','الإجابة الصحيحة','العلامة'],grade.details.map(item=>[
        esc(item.prompt),esc(item.selected ?? 'بدون إجابة'),esc(item.correct ?? 'غير متاحة'),`<bdi dir="ltr">${num(item.earned)}/${num(item.points)}</bdi>`
      ])):`<p>${Date.now()<Date.parse(exam.start)+exam.duration*60000?'تفاصيل الإجابات بتظهر بعد انتهاء وقت الامتحان للجميع.':'تفاصيل الإجابات غير متاحة حاليًا.'}</p>`}</section>`;
  }
  const marks=history.map(exam=>grades.get(exam.id)).filter(Boolean);
  const points=marks.map((mark,index)=>[marks.length===1?150:12+276*index/(marks.length-1),110-mark.percent]);
  return hero('لوحة الطالب','نتائجي','راجع علامات الامتحانات اللي سلّمتها.')
    + (marks.length?`<section class="card"><h2>تطوّر العلامات</h2><svg class="results-chart" viewBox="0 0 300 120" role="img" aria-label="تطور النسب من الأقدم للأحدث: ${marks.map(mark=>num(mark.percent)+'%').join('، ')}">
      <path d="M12 10V110H288" fill="none" stroke="var(--line)"/><polyline points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>
      ${points.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3" fill="currentColor"/>`).join('')}</svg></section>`:'')
    + `<section class="card">${history.length?table(['الامتحان','العلامة','النسبة','الحالة','التفاصيل'],history.map(exam=>{
      const grade=grades.get(exam.id);
      return [esc(exam.title),grade?`<bdi dir="ltr">${num(grade.earned)}/${num(grade.total)}</bdi>`:'—',
        grade?`<bdi dir="ltr">${num(grade.percent)}%</bdi>`:'—',grade?(grade.passed?'ناجح':'دون علامة النجاح'):'بانتظار العلامة',button('عرض النتيجة','grade',exam.id)];
    })):'<div class="student-empty"><h3>ما في نتائج بعد</h3><p>سلّم امتحانًا حتى تظهر علامتك هون.</p></div>'}</section>`;
}
function studentProfile() {
  return hero('لوحة الطالب','ملفي الشخصي','حدّث اسمك أو كلمة المرور.')
    + `<section class="card"><form id="student-name-form"><label>الاسم<input name="name" required maxlength="100" value="${esc(account.name)}"></label>
      <p>البريد الجامعي <bdi dir="ltr">${esc(account.email)}</bdi></p><div><button class="primary">حفظ الاسم</button></div></form></section>
      <section class="card"><h2>تغيير كلمة المرور</h2><form id="student-password-form">
        <label>كلمة المرور الحالية<input dir="ltr" name="current" type="password" autocomplete="current-password" required></label>
        <label>كلمة المرور الجديدة<input dir="ltr" name="password" type="password" autocomplete="new-password" required minlength="12"></label>
        <label>تأكيد كلمة المرور الجديدة<input dir="ltr" name="confirmation" type="password" autocomplete="new-password" required minlength="12"></label>
        <div><button class="primary">تغيير كلمة المرور</button></div></form></section>`;
}
function analytics() {
  const r = db.results;
  const average = r.length ? num(Math.round(r.reduce((sum,item)=>sum+item.percent,0)/r.length))+'%' : '—';
  const pass = r.length ? num(Math.round(r.filter(item=>item.passed).length*100/r.length))+'%' : '—';
  return hero('لوحة المدرّس','تحليل النتائج','اطّلع على متوسط الدرجات ونسبة النجاح وتوزيع العلامات في امتحاناتك.')+
    `<div class="grid">${metric('عدد التسليمات',r.length)}${metric('متوسط العلامات',average)}${metric('نسبة النجاح',pass)}</div>
    <section class="card"><h2>توزيع الدرجات</h2>${[[0,49],[50,74],[75,100]].map(([min,max])=>{
      const count = r.filter(item=>item.percent>=min && item.percent<(max===100?101:max+1)).length;
      return `<div class="row"><span dir="ltr">${num(min)}–${num(max)}%</span><strong>${num(count)}</strong></div><progress aria-label="عدد العلامات من ${num(min)} إلى ${num(max)}" max="${r.length||1}" value="${count}"></progress>`;
    }).join('')}</section>
    <section class="card"><div class="row"><h2>سجل التسليمات</h2>${r.length?button('تصدير CSV','export'):''}</div>${r.length?table(['الطالب','الامتحان','العلامة','النتيجة','وقت التسليم'],r.map(x=>[esc(studentName(x)),esc(x.title),'<bdi dir="ltr">'+num(x.percent)+'%</bdi>',x.passed?'ناجح':'لم ينجح',fmt(x.at)])):'<p>لا يوجد تسليمات بعد.</p>'}</section>`;
}
function people() {
  if (firebasePortal) {
    const directory=(title,entries,manage=false)=>`<section class="card"><h2>${title}</h2>
      ${entries.length?table(manage?['الاسم','البريد','الإجراء']:['الاسم','البريد'],entries.map(person=>[
        esc(person.name || '—'),esc(person.email || '—'),
        ...(manage?[button('إلغاء صلاحية المدرّس','remove-teacher',person.id)]:[])
      ]),1):'<p class="muted">ما في حسابات بهالقائمة حاليًا.</p>'}</section>`;
    return hero('لوحة الإدارة','الحسابات والصلاحيات','راجع الطلاب والمدرّسين والمديرين وأدر صلاحية التدريس.')+
      `<div class="grid">${metric('الطلاب',db.students.length)}${metric('المدرّسون',db.teachers.length)}${metric('المديرون',db.admins.length)}</div>
      <div class="actions">${button('إضافة مدرّس','page','addTeacher',true)}${button('تحديث القوائم','refresh-exams')}</div>
      <br>${directory('المدرّسون',db.teachers,true)}${directory('الطلاب',db.students)}${directory('المديرون',db.admins)}`;
  }
  return hero('لوحة الإدارة','حسابات المستخدمين','أضف المدرّسين وأدر حالة الحسابات.')+
    `<section class="card"><h2>إضافة مدرّس</h2><form id="teacher-form">${fields(true)}<div><button class="primary">حفظ حساب المدرّس</button></div></form></section>
    <section class="card">${table(['الاسم','البريد','الدور','الحالة','الإجراء'],db.people.map(p=>[esc(p.name),esc(p.email),roleNames[p.role],p.enabled?'مفعّل':'موقوف',p.role==='admin'?'—':button(p.enabled?'إيقاف':'تفعيل','toggle',p.id)]),1)}</section>`;
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
  grades.clear();
  resultId=undefined;
  examTab='available';
  pendingAnswer=undefined;
  selectedRoster=undefined;
  editingQuestionId=undefined;
  reschedulingExamId=undefined;
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
  if (firebasePortal && account?.verification && target?.dataset.action==='verify-email') {
    perform(async()=>{
      await loadFirebaseAccount(await firebase.refreshVerification());
      render();
      toast(account?.verification?'لسه البريد غير مؤكّد. افتح رابط التأكيد أولًا.':'تم تأكيد بريدك الجامعي.');
    });
    return;
  }
  if (firebasePortal && account?.verification==='pending' && target?.dataset.action==='resend-verification') {
    perform(async()=>{
      await firebase.resendVerification();
      toast('تم طلب رسالة تأكيد جديدة. افحص بريدك الجامعي.');
    });
    return;
  }
  if (!target || !account || busy) return;
  const {action,id}=target.dataset;
  toast('');
  if (action==='refresh-exams') perform(async()=>{await loadFirebaseAccount(account);render();});
  if (action==='class-invite' && firebasePortal && ['teacher','admin'].includes(role)) perform(async()=>{
    await firebase.createClassInvite(id);
    await loadFirebaseAccount(account);
    render();
    toast('تم إنشاء رمز الانضمام.');
  });
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
  if (action==='page') {
    if (id==='results') resultId=undefined;
    navigate(id);
  }
  if (action==='exam-tab' && ['available','upcoming','complete'].includes(id)) {examTab=id;render();view.querySelector('[aria-pressed="true"]')?.focus();}
  if (action==='all-results') {resultId=undefined;render();}
  if (action==='retry-answer') perform(flushAnswer);
  if (action==='edit-question' && role==='teacher') {
    editingQuestionId=id;
    render();
    view.querySelector('#question-form textarea').focus();
  }
  if (action==='cancel-question-edit') {
    editingQuestionId=undefined;
    render();
  }
  if (action==='reschedule-exam' && role==='teacher') {
    reschedulingExamId=id;
    render();
    view.querySelector('.reschedule-exam-form input').focus();
  }
  if (action==='cancel-reschedule') {
    reschedulingExamId=undefined;
    render();
  }
  if (action==='grade' && role==='student') perform(()=>showGrade(id));
  if (action==='roster' && role==='teacher') perform(async()=>{
    const exam=db.exams.find(item=>item.id===id);
    selectedRoster={exam,entries:await firebase.examRoster(exam,db.questions)};
    navigate('roster');
  });
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
async function flushAnswer() {
  if (!pendingAnswer || !navigator.onLine) {render();return;}
  const answer=pendingAnswer;
  savingAnswer=true;
  if (page==='attempt') render();
  try {
    await firebase.saveAttemptField(answer.id,'answers',answer.question,answer.value);
    db.attempts[answer.id].answers[answer.question]=answer.value;
    pendingAnswer=undefined;
    toast('تم حفظ الإجابة.');
  } catch (error) {
    if (error.code==='permission-denied' && Date.now()>=db.attempts[answer.id].deadline) {
      pendingAnswer=undefined;
      throw new Error('انتهى الوقت قبل حفظ آخر إجابة. رح تُسلّم الإجابات المحفوظة.');
    }
    throw new Error('تعذّر حفظ الإجابة. أعد المحاولة بعد رجوع الاتصال.');
  } finally {
    savingAnswer=false;
    if (page==='attempt') {
      render();
      view.querySelector('input[name="answer"]:checked')?.focus();
    }
  }
}
window.addEventListener('offline',()=>{
  const status=document.querySelector('#attempt-save-status');
  if (status) status.textContent='الاتصال مقطوع. اترك الصفحة مفتوحة حتى يرجع الاتصال.';
});
window.addEventListener('online',()=>{
  if (!firebasePortal || role!=='student') return;
  if (pendingAnswer && !busy) perform(flushAnswer);
  else if (page==='attempt' && !busy) render();
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
    if (firebasePortal) {
      if (pendingAnswer) {render();return;}
      pendingAnswer={id:active,question:db.attempts[active].order[position],value:Number(field.value)};
      perform(flushAnswer);
      return;
    }
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
        firebase ??= await import('./firebase-student.js?v=14');
        if (event.target.id==='student-name-form' && role==='student') {
          account.name=await firebase.changeStudentName(values.name);
          render();
          toast('تم حفظ الاسم.');
          return;
        }
        if (event.target.id==='student-password-form' && role==='student') {
          if (values.password!==values.confirmation) throw new Error('تأكيد كلمة المرور غير مطابق.');
          try {await firebase.changeStudentPassword(values.current,values.password);}
          catch (error) {
            if (['auth/invalid-credential','auth/wrong-password'].includes(error.code)) throw new Error('كلمة المرور الحالية غير صحيحة.');
            throw error;
          }
          event.target.reset();
          toast('تم تغيير كلمة المرور.');
          return;
        }
        if (event.target.id==='join-class-form' && role==='student') {
          await firebase.joinClass(values.code,account.name);
          await loadFirebaseAccount(account);
          navigate('exams');
          toast('تم الانضمام للشعبة.');
          return;
        }
        if (event.target.classList.contains('class-form') && ['teacher','admin'].includes(role)) {
          const name=num(values.name.trim());
          const subjectCode=values.subjectCode.trim().toUpperCase().replace(/\s+/g,' ');
          const subjectName=values.subjectName.trim();
          if (!/^\d{1,8}$/.test(name)) throw new Error('أدخل رقم الشعبة بالأرقام.');
          if (subjectCode && !/^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(subjectCode)) throw new Error('أدخل رمز المادة مثل CYS 334.');
          const subject=subjectCode?`${subjectName} (${subjectCode})`:subjectName;
          if (!subjectName || subject.length>80) throw new Error('أدخل اسم مادة ورمزًا بمجموع لا يتجاوز 80 حرفًا.');
          await firebase.saveClass(event.target.dataset.id,{name,subject,owner:values.owner});
          await loadFirebaseAccount(account);
          render();
          toast('تم حفظ الشعبة.');
          return;
        }
        if (event.target.classList.contains('assign-exam-form') && role==='teacher') {
          await firebase.assignLegacyExam(event.target.dataset.id,selectedClasses(form));
          await loadFirebaseAccount(account);
          render();
          toast('تم ربط الامتحان بالشُعب.');
          return;
        }
        if (event.target.classList.contains('reschedule-exam-form') && role==='teacher') {
          const start=new Date(values.start);
          if (!Number.isFinite(+start) || +start<=Date.now()) throw new Error('اختَر موعد بداية بالمستقبل.');
          await firebase.rescheduleExam(event.target.dataset.id,start);
          reschedulingExamId=undefined;
          await loadFirebaseAccount(account);
          render();
          toast('تم تغيير موعد الامتحان.');
          return;
        }
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
          const id=event.target.dataset.id;
          const existing=db.questions.find(item=>item.id===id);
          const values=questionFromForm(form,existing);
          if (id) await firebase.editQuestion(id,values);
          else await firebase.addQuestion(values);
          editingQuestionId=undefined;
          await loadFirebaseAccount(account);
          render();
          toast(id?'تم حفظ تعديل السؤال.':'تم حفظ السؤال.');
          return;
        }
        if (event.target.id==='exam-form') {
          const ids=form.getAll('questions');
          const title=values.title.trim();
          const classIds=selectedClasses(form);
          const section=db.classes.find(group=>group.id===classIds[0]).name;
          if (title.length<3) throw new Error('اسم الامتحان لازم يكون 3 أحرف على الأقل.');
          if (!ids.length || ids.length>100) throw new Error('اختر من سؤال واحد إلى 100 سؤال.');
          await firebase.publishExam({title,section,classIds,ids,start:new Date(values.start).toISOString(),duration:Number(values.duration),pass:Number(values.pass),shuffle:form.has('shuffle')},db.questions);
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
          if (action==='register') toast('تم إرسال رابط التأكيد إلى بريدك الجامعي.');
          if (action==='saveProfile') toast('تم حفظ حسابك في مقياس.');
        } catch (error) {
          const messages={
            'auth/email-already-in-use':'تعذّر إكمال التسجيل. جرّب تسجيل الدخول أو استعادة كلمة المرور.',
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
          if (values.title.trim().length<3) throw new Error('اسم الامتحان لازم يكون 3 أحرف على الأقل.');
          update(await api('exams',{title:values.title.trim(),ids:form.getAll('questions'),start:values.start?new Date(values.start).toISOString():'',duration:Number(values.duration),pass:Number(values.pass),shuffle:form.has('shuffle')}));
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
    firebase=await import('./firebase-student.js?v=14');
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
