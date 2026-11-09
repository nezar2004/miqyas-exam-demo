const key = 'miqyas-demo-v1';
const sample = {
  questions: [
    {id:'q1', prompt:'أي مخطط يوضّح علاقة النظام بالجهات الخارجية؟', options:['مخطط السياق','مخطط العلاقات','مخطط الفئات'], correct:0, points:2},
    {id:'q2', prompt:'الحفظ التلقائي يساعد الطالب على استعادة إجاباته.', options:['صح','خطأ'], correct:0, points:1},
    {id:'q3', prompt:'أي دور ينشئ الامتحان ويحدد علامته؟', options:['الطالب','المدرّس','الزائر'], correct:1, points:2}
  ],
  exams:[{id:'e1', title:'أساسيات تحليل النظم', duration:5, pass:60, start:'', shuffle:false, ids:['q1','q2','q3']}],
  people:[
    {id:'nour', name:'نور أحمد', role:'student', enabled:true},
    {id:'sara', name:'سارة محمود', role:'student', enabled:true},
    {id:'yousef', name:'يوسف سامر', role:'student', enabled:true},
    {id:'layan', name:'ليان خالد', role:'teacher', enabled:true},
    {id:'omar', name:'عمر علي', role:'admin', enabled:true}
  ],
  attempts:{}, results:[], log:[]
};
let db = JSON.parse(localStorage.getItem(key) || 'null') || sample;
if (!db.people[0].id) {
  const previous = db.people;
  db.people = sample.people.map(person=>({...person,enabled:previous.find(item=>item.name===person.name)?.enabled ?? true}));
  for (const [examId, attempt] of Object.entries(db.attempts)) {
    db.attempts['nour/'+examId] = {...attempt,examId,student:'nour'};
    delete db.attempts[examId];
  }
  db.results.forEach(result=>{result.student='nour';});
  localStorage.setItem(key,JSON.stringify(db));
}
let account = db.people.find(person=>person.enabled && person.id===sessionStorage.getItem('miqyas-account'));
let role = account?.role;
let page = role==='admin'?'people':'exams';
let active = '';
let position = 0;
const roleNames = {student:'طالب', teacher:'مدرّس', admin:'مدير النظام'};
const menus = {
  student:{exams:'الامتحانات', results:'نتائجي'},
  teacher:{exams:'إدارة الامتحانات', bank:'بنك الأسئلة', create:'إنشاء امتحان', analytics:'تحليل النتائج'},
  admin:{people:'الحسابات التجريبية', log:'سجل النشاط'}
};
const view = document.querySelector('#view');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const button = (label, action, id = '', primary = false) => `<button type="button" class="${primary ? 'primary' : ''}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const hero = (tag, title, description) => `<section class="hero"><div class="eyebrow">${tag}</div><h1>${title}</h1><p>${description}</p></section>`;
const metric = (label, value) => `<div class="card"><span class="muted">${label}</span><strong class="metric">${value}</strong></div>`;
const table = (headers, rows) => `<div class="table"><table><thead><tr>${headers.map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const fmt = value => new Date(value).toLocaleString('ar-JO', {dateStyle:'medium', timeStyle:'short'});
const completed = (id, student = account?.id) => db.results.find(result=>result.id===id && result.student===student);
const studentName = id => db.people.find(person=>person.id===id)?.name || id;
const attemptKey = id => account.id+'/'+id;
const question = id => db.questions.find(item=>item.id===id);
function save() { localStorage.setItem(key, JSON.stringify(db)); }
function record(label) { db.log.unshift({label, at:Date.now()}); save(); }
function toast(message) { notice.textContent = message; }
function render() {
  document.body.classList.toggle('signed-out', !account);
  if (!account) { view.innerHTML = login(); return; }
  document.querySelector('#account-name').textContent = account.name;
  document.querySelector('#account-role').textContent = roleNames[role];
  nav.innerHTML = Object.entries(menus[role]).map(([id, title])=>`<button type="button" data-action="page" data-id="${id}" ${id===page?'aria-current="page"':''}>${title}</button>`).join('');
  document.querySelector('#section').textContent = menus[role][page] || 'تقديم الامتحان';
  const screens = {exams, results, bank, create, analytics, people, log, attempt};
  view.innerHTML = screens[page]();
  tick();
}
function login() {
  return hero('مقياس · بوابة الامتحانات','تسجيل الدخول','ادخل بحساب تجريبي لإنشاء امتحان أو تقديمه أو متابعة نتائجه.')+
    `<div class="login-grid"><section class="card"><h2>دخول إلى المنصة</h2><form id="login-form">
    <label>اسم المستخدم<input name="username" required autocomplete="username" dir="ltr"></label>
    <label>كلمة المرور<input name="password" type="password" required autocomplete="current-password" dir="ltr"></label>
    <div><button class="primary">تسجيل الدخول</button></div></form></section>
    <section class="card"><h2>حسابات جاهزة للتجربة</h2><p class="muted">اختر حسابًا لتعبئة نموذج الدخول. كلمة المرور التجريبية للجميع <b dir="ltr">Demo1234</b>.</p>
    <div class="credentials">${db.people.map(p=>button(esc(p.name)+' · '+roleNames[p.role]+' ('+esc(p.id)+')','fill-login',p.id)).join('')}</div></section></div>`;
}
function exams() {
  const student = role === 'student';
  const resultCount = student ? db.results.filter(r=>r.student===account.id).length : db.results.length;
  return hero('لوحة '+roleNames[role], student?'أهلاً، '+esc(account.name):'إدارة الامتحانات',
    student?'ابدأ بالامتحان التجريبي وشوف نتيجتك فور التسليم.':'أضف أسئلة لبنك الأسئلة، وجدول امتحانًا، وتابع نتائج الطلاب.') +
    `<div class="grid">${metric('الامتحانات',db.exams.length)}${metric('الامتحانات المقدّمة',resultCount)}${metric(student?'بانتظار التقديم':'أسئلة في البنك',student?db.exams.length-resultCount:db.questions.length)}</div>
    <div class="row"><h2>${student?'امتحاناتك':'قائمة الامتحانات'}</h2>${student?'':button('إنشاء امتحان','page','create',true)}</div>`+
    db.exams.map(exam=>{
      const done = completed(exam.id);
      const scheduled = exam.start && Date.parse(exam.start)>Date.now();
      return `<section class="card"><div class="row"><div><span class="badge ${done?'ok':''}">${done?'تم التسليم':scheduled?'مجدول':'متاح'}</span><h3>${esc(exam.title)}</h3><p class="muted">${exam.ids.length} أسئلة · ${exam.duration} دقيقة · النجاح ${exam.pass}%${exam.start?' · '+fmt(exam.start):''}</p></div>
      ${student ? done ? button('عرض النتيجة','page','results') : scheduled ? '' : button(db.attempts[attemptKey(exam.id)]?'متابعة الامتحان':'ابدأ الامتحان','start',exam.id,true) : ''}</div></section>`;
    }).join('');
}
function bank() {
  return hero('أدوات المدرّس','بنك الأسئلة','أضف أسئلة اختيار من متعدد أو صح وخطأ لاستخدامها في امتحاناتك.') +
    `<section class="card"><h2>إضافة سؤال</h2><form id="question-form">
    <label>نوع السؤال<select id="question-type" name="type"><option value="multiple">اختيار من متعدد</option><option value="boolean">صح أو خطأ</option></select></label>
    <label>نص السؤال<textarea name="prompt" required maxlength="400"></textarea></label>
    <label id="options-label">الخيارات (كل خيار بسطر)<textarea name="options" required maxlength="700" rows="3"></textarea></label>
    <div class="grid"><label>رقم الإجابة الصحيحة<input name="correct" type="number" min="1" value="1" required></label><label>العلامة<input name="points" type="number" min="1" max="100" value="1" required></label></div>
    <div><button class="primary">حفظ السؤال</button></div></form></section>
    <section class="card"><h2>الأسئلة المحفوظة</h2>${table(['السؤال','الإجابة الصحيحة','العلامة'], db.questions.map(q=>[esc(q.prompt),esc(q.options[q.correct]),q.points]))}</section>`;
}
function create() {
  return hero('أدوات المدرّس','إنشاء امتحان','حدّد قواعد الامتحان واختر الأسئلة من البنك.') +
    `<section class="card"><form id="exam-form"><label>اسم الامتحان<input name="title" required maxlength="100"></label>
    <div class="grid"><label>المدة بالدقائق<input type="number" name="duration" value="5" min="1" max="180" required></label>
    <label>علامة النجاح (%)<input type="number" name="pass" value="60" min="0" max="100" required></label>
    <label>وقت البداية (اختياري)<input type="datetime-local" name="start"></label></div>
    <label class="choice"><input type="checkbox" name="shuffle"> ترتيب الأسئلة عشوائيًا لكل محاولة</label>
    <fieldset><legend>أسئلة الامتحان</legend>${db.questions.map(q=>`<label class="choice"><input type="checkbox" name="questions" value="${q.id}">${esc(q.prompt)} · ${q.points} علامة</label>`).join('')}</fieldset>
    <div><button class="primary">حفظ الامتحان</button></div></form></section>`;
}
function shuffled(ids) {
  const order = [...ids];
  for (let i=order.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [order[i],order[j]] = [order[j],order[i]];
  }
  return order;
}
function start(id) {
  if (role !== 'student') return;
  const exam = db.exams.find(item=>item.id===id);
  if (!exam || completed(id) || (exam.start && Date.parse(exam.start)>Date.now())) return;
  active = attemptKey(id);
  if (!db.attempts[active]) {
    db.attempts[active] = {examId:id, student:account.id, order:exam.shuffle?shuffled(exam.ids):exam.ids, answers:{}, review:{}, deadline:Date.now()+exam.duration*60000};
    record(account.name+' بدأ امتحان '+exam.title);
  }
  position = 0;
  page = 'attempt';
  render();
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
function submit(id, expired) {
  const current = db.attempts[id];
  if (!current || completed(current.examId,current.student)) return;
  const exam = db.exams.find(item=>item.id===current.examId);
  const details = current.order.map(question).map(q=>({prompt:q.prompt, selected:q.options[current.answers[q.id]], correct:q.options[q.correct], points:q.points, earned:current.answers[q.id]===q.correct?q.points:0}));
  const earned = details.reduce((sum,q)=>sum+q.earned,0);
  const total = details.reduce((sum,q)=>sum+q.points,0);
  const percent = Math.round(1000*earned/total)/10;
  db.results.unshift({id:exam.id,student:current.student,title:exam.title,details,earned,total,percent,passed:100*earned/total>=exam.pass,at:Date.now()});
  delete db.attempts[id];
  record((expired?'انتهى وقت امتحان ':'سلّم الطالب امتحان ')+exam.title);
}
function tick() {
  const expired = Object.keys(db.attempts).filter(id=>db.attempts[id].deadline<=Date.now());
  expired.forEach(id=>submit(id,true));
  if (expired.includes(active) && page==='attempt') {
    page = 'results';
    render();
    toast('انتهى الوقت وتم تسليم الامتحان تلقائيًا.');
  }
  const timer = document.querySelector('#timer');
  if (timer && db.attempts[active]) {
    const seconds = Math.max(0, Math.ceil((db.attempts[active].deadline-Date.now())/1000));
    timer.textContent = [Math.floor(seconds/60), seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  }
}
function results() {
  const own = db.results.filter(result=>result.student===account.id);
  return hero('لوحة الطالب','نتائج الامتحانات','راجع علامتك والإجابة الصحيحة لكل سؤال بعد التسليم.')+
    (own.length ? own.map(r=>`<section class="card"><div class="row"><h2>${esc(r.title)}</h2><span class="badge ${r.passed?'ok':'warn'}">${r.passed?'ناجح':'لم ينجح'} · ${r.earned}/${r.total} · ${r.percent}%</span></div>
    ${table(['السؤال','إجابتك','الإجابة الصحيحة','العلامة'],r.details.map(q=>[esc(q.prompt),esc(q.selected || 'بدون إجابة'),esc(q.correct),q.earned+'/'+q.points]))}</section>`).join('') : '<p class="card">ما في نتائج بعد. قدّم امتحانًا لتظهر نتيجتك هون.</p>');
}
function analytics() {
  const r = db.results;
  const average = r.length ? Math.round(r.reduce((sum,item)=>sum+item.percent,0)/r.length)+'%' : '—';
  const pass = r.length ? Math.round(r.filter(item=>item.passed).length*100/r.length)+'%' : '—';
  return hero('لوحة المدرّس','تحليل النتائج','اطّلع على متوسط الدرجات ونسبة النجاح وتوزيع العلامات في المحاولات التجريبية.')+
    `<div class="grid">${metric('عدد التسليمات',r.length)}${metric('متوسط العلامات',average)}${metric('نسبة النجاح',pass)}</div>
    <section class="card"><h2>توزيع الدرجات</h2>${[[0,49],[50,74],[75,100]].map(([min,max])=>{
      const count = r.filter(item=>item.percent>=min && item.percent<(max===100?101:max+1)).length;
      return `<div class="row"><span dir="ltr">${min}–${max}%</span><strong>${count}</strong></div><progress aria-label="عدد العلامات من ${min} إلى ${max}" max="${r.length||1}" value="${count}"></progress>`;
    }).join('')}</section>
    <section class="card"><div class="row"><h2>سجل التسليمات</h2>${r.length?button('تصدير CSV','export'):''}</div>${r.length?table(['الطالب','الامتحان','العلامة','النتيجة','وقت التسليم'],r.map(x=>[esc(studentName(x.student)),esc(x.title),x.percent+'%',x.passed?'ناجح':'لم ينجح',fmt(x.at)])):'<p>لا يوجد تسليمات بعد.</p>'}</section>`;
}
function people() {
  return hero('لوحة الإدارة','حسابات العرض','اطّلع على الأدوار وسجّل تغييرات حالة الحسابات التجريبية.')+
    `<section class="card">${table(['الاسم','الدور','الحالة','الإجراء'],db.people.map((p,index)=>[esc(p.name),roleNames[p.role],p.enabled?'مفعّل':'موقوف',button(p.enabled?'إيقاف':'تفعيل','toggle',index)]))}</section>`;
}
function log() {
  return hero('لوحة الإدارة','سجل النشاط','تابع الأحداث التي نفذتها داخل هذه النسخة.')+
    `<section class="card">${db.log.length?table(['الحدث','الوقت'],db.log.map(item=>[esc(item.label),fmt(item.at)])):'<p>لا توجد أحداث بعد.</p>'}</section>`;
}
function download() {
  const cell = value => {
    const str = String(value);
    return '"'+(/^[=+\-@\t\r\n]/.test(str.trimStart())?"'":"")+str.replaceAll('"','""')+'"';
  };
  const rows = [['الطالب','الامتحان','النسبة','النتيجة','وقت التسليم'],...db.results.map(r=>[studentName(r.student),r.title,r.percent,r.passed?'ناجح':'لم ينجح',new Date(r.at).toISOString()])];
  const url = URL.createObjectURL(new Blob(['\ufeff',rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link = Object.assign(document.createElement('a'),{href:url,download:'exam-results.csv'});
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.querySelector('#logout').addEventListener('click',()=>{
  record('سجّل خروج '+account.name);
  sessionStorage.removeItem('miqyas-account');
  account = undefined;
  role = undefined;
  active = '';
  page = 'exams';
  toast('');
  render();
});
document.addEventListener('click',event=>{
  const target = event.target.closest('button[data-action]');
  if (!target) return;
  const {action,id} = target.dataset;
  toast('');
  if (!account) {
    if (action==='fill-login') {
      const form = document.querySelector('#login-form');
      form.elements.username.value = id;
      form.elements.password.value = 'Demo1234';
      form.querySelector('button').focus();
    }
    return;
  }
  if (action==='page') { page=id; render(); }
  if (action==='start') start(id);
  if (action==='jump') { position=Number(id); render(); }
  if (action==='review') {
    const current = db.attempts[active];
    const id = current.order[position];
    current.review[id] = !current.review[id];
    save();
    render();
  }
  if (action==='finish' && confirm('تأكيد تسليم الامتحان وعرض النتيجة؟')) {
    submit(active,Date.now()>=db.attempts[active].deadline);
    page='results';
    render();
    toast('تم تسليم الامتحان.');
  }
  if (action==='export') download();
  if (action==='toggle') {
    const person = db.people[Number(id)];
    if (person.id===account.id) return toast('حساب المدير الحالي لازم يظل مفعّلاً.');
    person.enabled = !person.enabled;
    record((person.enabled?'تم تفعيل حساب ':'تم إيقاف حساب ')+person.name);
    render();
  }
});
document.addEventListener('change',event=>{
  const field = event.target;
  if (field.id==='question-type') {
    const label = document.querySelector('#options-label');
    label.hidden = field.value==='boolean';
    label.querySelector('textarea').required = !label.hidden;
  }
  if (field.name==='answer' && page==='attempt') {
    const current = db.attempts[active];
    if (current.deadline<=Date.now()) { tick(); return; }
    current.answers[current.order[position]] = Number(field.value);
    save();
    render();
    if (page === 'attempt') {
      view.querySelector('input[name="answer"]:checked')?.focus();
      toast('تم حفظ الإجابة.');
    }
  }
});
document.addEventListener('submit',event=>{
  event.preventDefault();
  const form = new FormData(event.target);
  if (event.target.id==='login-form') {
    const person = db.people.find(p=>p.id===form.get('username').trim().toLowerCase());
    if (!person || form.get('password')!=='Demo1234') return toast('اسم المستخدم أو كلمة المرور غير صحيحة.');
    if (!person.enabled) return toast('هذا الحساب موقوف. تواصل مع مدير النظام.');
    account = person;
    role = person.role;
    page = Object.keys(menus[role])[0];
    sessionStorage.setItem('miqyas-account',person.id);
    record('سجّل دخول '+person.name);
    toast('');
    render();
    return;
  }
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  if (event.target.id==='question-form') {
    const options = form.get('type')==='boolean'?['صح','خطأ']:String(form.get('options')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const correct = Number(form.get('correct'))-1;
    const prompt = form.get('prompt').trim();
    if (!prompt || options.length<2 || !options[correct]) return toast('أدخل نص السؤال وخيارين على الأقل ورقم إجابة موجود.');
    db.questions.push({id,prompt,options,correct,points:Number(form.get('points'))});
    record('أضاف المدرّس سؤالاً إلى البنك');
    render();
    toast('تم حفظ السؤال.');
  }
  if (event.target.id==='exam-form') {
    const ids = form.getAll('questions');
    const title = form.get('title').trim();
    if (!title || !ids.length) return toast('أدخل اسم الامتحان واختر سؤالاً واحداً على الأقل.');
    const start = form.get('start');
    db.exams.push({id,title,ids,start:start?new Date(start).toISOString():'',duration:Number(form.get('duration')),pass:Number(form.get('pass')),shuffle:form.has('shuffle')});
    record('أنشأ المدرّس امتحان '+title);
    page='exams';
    render();
    toast('تم حفظ الامتحان. يمكنك تجربته بدور الطالب.');
  }
});
render();
setInterval(tick, 250);
