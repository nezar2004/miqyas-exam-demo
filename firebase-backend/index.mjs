import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, randomInt } from 'node:crypto';
import { promisify } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const db=getFirestore();
const accounts=db.collection('accounts');
const sessions=db.collection('sessions');
const questions=db.collection('questions');
const exams=db.collection('exams');
const attempts=db.collection('attempts');
const logs=db.collection('audit');
const adminEmail=defineSecret('ADMIN_EMAIL');
const adminPassword=defineSecret('ADMIN_PASSWORD');
const now=Date.now;
const derive=promisify(scrypt);
const digest=value=>createHash('sha256').update(value).digest('hex');
const audit=(label, transaction) => {
  const ref=logs.doc();
  const event={label,at:now()};
  return transaction ? transaction.create(ref,event) : ref.create(event);
};
const publicAccount=({id,name,email,role,enabled})=>({id,name,email,role,enabled});
const cookie=token=>`__session=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${token?43200:0}`;
const list=async query=>(await query.get()).docs.map(doc=>doc.data());
const read=async ref=>(await ref.get()).data();
function requireValue(condition, message, status=400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
const textField = (value, max) => typeof value==='string' && value.trim().length<=max ? value.trim() : '';
const integer = (value,min,max) => Number.isInteger(value) && value>=min && value<=max;
async function createAccount(body,role) {
  const name = textField(body.name,100);
  const email = textField(body.email,254).toLowerCase();
  requireValue(name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'أدخل اسمًا وبريدًا إلكترونيًا صالحًا.');
  requireValue(typeof body.password==='string' && body.password.length>=12 && body.password.length<=128,'كلمة المرور لازم تكون بين 12 و128 حرفًا.');
  if (role!=='admin') requireValue(email!==adminEmail.value().trim().toLowerCase(),'هذا البريد مخصص للإدارة.',409);
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(body.password,salt,64)).toString('hex');
  const person={id:digest(email),name,email,role,hash:salt+':'+hash,enabled:true};
  return db.runTransaction(async tx=>{
    const ref=accounts.doc(person.id);
    const existing=(await tx.get(ref)).data();
    if (existing && role==='admin' && existing.role==='admin') return existing;
    requireValue(!existing,'البريد الإلكتروني مسجّل مسبقًا.',409);
    tx.create(ref,person);
    audit('تم إنشاء حساب '+name,tx);
    return person;
  });
}

async function grade(tx, ref, attempt, exam) {
  const docs=await tx.getAll(...attempt.order.map(id=>questions.doc(id)));
  const details=docs.map(doc=>doc.data()).map(q=>({
    prompt:q.prompt,selected:q.options[attempt.answers[q.id]] ?? null,
    correct:q.options[q.correct],points:q.points,earned:attempt.answers[q.id]===q.correct?q.points:0
  }));
  const earned=details.reduce((sum,q)=>sum+q.earned,0);
  const total=details.reduce((sum,q)=>sum+q.points,0);
  const result={id:exam.id,student:attempt.student,studentName:attempt.studentName,title:exam.title,details,earned,total,percent:Math.round(1000*earned/total)/10,passed:earned*100>=exam.pass*total,at:Math.min(now(),attempt.deadline)};
  tx.update(ref,{result});
  audit('تم تسليم امتحان '+exam.title,tx);
  return {...attempt,result};
}
async function expire(attempt) {
  return db.runTransaction(async tx=>{
    const ref=attempts.doc(attempt.id);
    const current=(await tx.get(ref)).data();
    if (current.result || current.deadline>now()) return current;
    return grade(tx,ref,current,(await tx.get(exams.doc(current.examId))).data());
  });
}
async function state(account) {
  const result={questions:[],exams:[],people:[],attempts:{},results:[],log:[]};
  if (account.role==='admin') {
    result.people=(await list(accounts.orderBy('name'))).map(publicAccount);
    result.log=await list(logs.orderBy('at','desc').limit(200));
  }
  if (account.role==='teacher') {
    const [bank,papers,rows]=await Promise.all([
      list(questions.where('owner','==',account.id)),
      list(exams.where('owner','==',account.id)),
      list(attempts.where('owner','==',account.id))
    ]);
    result.questions=bank;
    result.exams=papers;
    result.results=(await Promise.all(rows.map(row=>!row.result && row.deadline<=now()?expire(row):row))).flatMap(row=>row.result?[row.result]:[]);
  }
  if (account.role==='student') {
    const [papers,rows]=await Promise.all([list(exams),list(attempts.where('student','==',account.id))]);
    result.exams=papers;
    const visible=new Set();
    for (const row of rows) {
      const current=!row.result && row.deadline<=now()?await expire(row):row;
      if (current.result) {
        const {details,...summary}=current.result;
        result.results.push({...summary,details:details.map(({correct,...detail})=>detail)});
      } else {
        const {examId,order,answers,review,deadline}=current;
        result.attempts[examId]={examId,order,answers,review,deadline};
        order.forEach(id=>visible.add(id));
      }
    }
    if (visible.size) {
      const docs=await db.getAll(...Array.from(visible,id=>questions.doc(id)));
      result.questions=docs.map(doc=>doc.data()).map(({correct,owner,...question})=>question);
    }
  }
  return {account:publicAccount(account),db:result};
}

const limits = new Map();
function throttle(req) {
  const ip = req.ip || req.socket.remoteAddress;
  const entry = limits.get(ip);
  if (!entry || entry.until<now()) limits.set(ip,{until:now()+60000,count:1});
  else requireValue(++entry.count<=30,'حاول مرة أخرى بعد دقيقة.',429);
}
setInterval(()=>{for (const [ip,item] of limits) if (item.until<now()) limits.delete(ip);},60000).unref();
function readBody(req) {
  requireValue(req.is('application/json'),'صيغة الطلب غير صالحة.',415);
  requireValue(req.rawBody.length<=32768,'الطلب أكبر من الحد المسموح.',413);
  requireValue(req.body && typeof req.body==='object' && !Array.isArray(req.body),'صيغة الطلب غير صالحة.');
  return req.body;
}
async function currentAccount(token) {
  if (!token) return null;
  const session=await read(sessions.doc(digest(token)));
  if (!session || session.expires.toMillis()<=now()) return null;
  const account=await read(accounts.doc(session.account));
  return account?.enabled && (account.generation??0)===session.generation ? account : null;
}

async function api(req,res,path) {
  const token=req.headers.cookie?.match(/(?:^|;\s*)__session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const account=await currentAccount(token);
  if (req.method==='GET' && path==='/api/state') return account ? state(account) : {account:null};
  requireValue(req.method==='POST','الصفحة غير موجودة.',404);
  if (req.headers.origin) {
    const origin=new URL(req.headers.origin);
    const allowed=new Set(['miqyas-exams.web.app','miqyas-exams.firebaseapp.com']);
    requireValue(origin.protocol==='https:' && (allowed.has(origin.host) || origin.host===req.headers.host),'مصدر الطلب غير صالح.',403);
  }
  const body=readBody(req);
  if (path==='/api/register') {
    throttle(req);
    await createAccount(body,'student');
    return {};
  }
  if (path==='/api/login') {
    throttle(req);
    const email=textField(body.email,254).toLowerCase();
    let person=await read(accounts.doc(digest(email)));
    const password=typeof body.password==='string' && body.password.length<=128 ? body.password : '';
    if (!person && body.portal==='admin' && email===adminEmail.value().trim().toLowerCase()) {
      const expected=adminPassword.value();
      requireValue(timingSafeEqual(Buffer.from(digest(password),'hex'),Buffer.from(digest(expected),'hex')),'تحقّق من البريد وكلمة المرور والبوابة.',401);
      person=await createAccount({name:'مدير النظام',email,password},'admin');
    }
    const [salt,hash]=person?.hash.split(':') || ['00000000000000000000000000000000','0'.repeat(128)];
    const valid=timingSafeEqual(await derive(password,salt,64),Buffer.from(hash,'hex'));
    requireValue(valid && person?.enabled && person.role===body.portal,'تحقّق من البريد وكلمة المرور والبوابة.',401);
    const next=randomBytes(32).toString('hex');
    const batch=db.batch();
    if (token) batch.delete(sessions.doc(digest(token)));
    batch.create(sessions.doc(digest(next)),{account:person.id,generation:person.generation??0,expires:Timestamp.fromMillis(now()+43200000)});
    await batch.commit();
    res.setHeader('Set-Cookie',cookie(next));
    await audit('سجّل دخول '+person.name);
    return state(person);
  }
  if (path==='/api/logout') {
    if (token) await sessions.doc(digest(token)).delete();
    res.setHeader('Set-Cookie',cookie(''));
    return {};
  }
  requireValue(account,'سجّل الدخول من جديد.',401);
  const role=required=>requireValue(account.role===required,'ما عندك صلاحية لهذا الإجراء.',403);
  if (path==='/api/teachers') {
    role('admin');
    await createAccount(body,'teacher');
  } else if (path==='/api/accounts/toggle') {
    role('admin');
    requireValue(/^[a-f0-9]{64}$/.test(body.id),'الحساب غير قابل للتعديل.',404);
    const ref=accounts.doc(body.id);
    await db.runTransaction(async tx=>{
      const target=(await tx.get(ref)).data();
      requireValue(target && target.role!=='admin','الحساب غير قابل للتعديل.',404);
      tx.update(ref,{enabled:!target.enabled,generation:(target.generation??0)+1});
      audit('تم تغيير حالة حساب '+target.name,tx);
    });
  } else if (path==='/api/questions') {
    role('teacher');
    const prompt = textField(body.prompt,400);
    const options = Array.isArray(body.options) ? body.options.map(x=>textField(x,200)) : [];
    requireValue(prompt && options.length>=2 && options.length<=10 && options.every(Boolean) && integer(body.correct,0,options.length-1) && integer(body.points,1,100),'تحقّق من السؤال والخيارات والعلامة.');
    const question = {id:randomUUID(),owner:account.id,prompt,options,correct:body.correct,points:body.points};
    await questions.doc(question.id).create(question);
    await audit('أضاف سؤالًا '+account.name);
  } else if (path==='/api/exams') {
    role('teacher');
    const title = textField(body.title,100);
    const owned = new Set((await list(questions.where('owner','==',account.id))).map(row=>row.id));
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
    const start = body.start ? Date.parse(body.start) : null;
    requireValue(title && ids.length>0 && ids.length<=100 && ids.every(id=>owned.has(id)) && integer(body.duration,1,180) && integer(body.pass,0,100) && (start===null || Number.isFinite(start)),'تحقّق من بيانات الامتحان والأسئلة.');
    const exam = {id:randomUUID(),owner:account.id,title,ids,duration:body.duration,pass:body.pass,start:start===null?'':new Date(start).toISOString(),shuffle:body.shuffle===true};
    await exams.doc(exam.id).create(exam);
    await audit('تم نشر امتحان '+title);
  } else if (['/api/attempt/start','/api/attempt/answer','/api/attempt/review','/api/attempt/finish'].includes(path)) {
    role('student');
    const id=String(body.id);
    requireValue(/^[a-f0-9-]{36}$/.test(id),'الامتحان غير موجود.',404);
    const ref=attempts.doc(id+'_'+account.id);
    await db.runTransaction(async tx=>{
      const [paper,saved]=await tx.getAll(exams.doc(id),ref);
      const exam=paper.data();
      const current=saved.data();
      requireValue(exam,'الامتحان غير موجود.',404);
      if (current?.result) return;
      if (current && (current.deadline<=now() || path.endsWith('/finish'))) {
        await grade(tx,ref,current,exam);
      } else if (path.endsWith('/start')) {
        requireValue(!exam.start || Date.parse(exam.start)<=now(),'الامتحان لم يبدأ بعد.',409);
        if (!current) {
          const order=[...exam.ids];
          if (exam.shuffle) for (let i=order.length-1;i>0;i--) {
            const j=randomInt(i+1);
            [order[i],order[j]]=[order[j],order[i]];
          }
          tx.create(ref,{id:ref.id,examId:id,owner:exam.owner,student:account.id,studentName:account.name,deadline:now()+exam.duration*60000,order,answers:{},review:{},result:null});
        }
      } else {
        requireValue(current,'ابدأ الامتحان أولًا.',409);
        requireValue(current.order.includes(body.question),'السؤال غير موجود في المحاولة.');
        if (path.endsWith('/answer')) {
          const q=(await tx.get(questions.doc(body.question))).data();
          requireValue(integer(body.answer,0,q.options.length-1),'الخيار غير صالح.');
          tx.update(ref,{['answers.'+body.question]:body.answer});
        } else {
          tx.update(ref,{['review.'+body.question]:body.review===true});
        }
      }
    });
  } else {
    requireValue(false,'الصفحة غير موجودة.',404);
  }
  return state(account);
}

export const miqyasApi=onRequest({region:'us-central1',secrets:[adminEmail,adminPassword],maxInstances:5},async (req,res)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Cache-Control','private, no-store');
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    res.json(await api(req,res,path));
  } catch (error) {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({error:error.status ? error.message : 'تعذّر إكمال الطلب.'});
  }
});
