import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, randomInt } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const production = process.env.NODE_ENV === 'production';
const webRoot = existsSync(resolve(import.meta.dirname,'dist','index.html')) ? resolve(import.meta.dirname,'dist') : import.meta.dirname;
const databasePath = process.env.DATABASE_PATH || './data/miqyas.sqlite';
if (production && !process.env.DATABASE_PATH) throw new Error('Set DATABASE_PATH to a persistent volume.');
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL, hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS exams(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attempts(exam TEXT NOT NULL REFERENCES exams(id), student TEXT NOT NULL REFERENCES accounts(id), deadline INTEGER NOT NULL, data TEXT NOT NULL, result TEXT, PRIMARY KEY(exam,student));
  CREATE INDEX IF NOT EXISTS attempts_deadline ON attempts(deadline) WHERE result IS NULL;
  CREATE TABLE IF NOT EXISTS audit(label TEXT NOT NULL, at INTEGER NOT NULL);
`);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const json = JSON.stringify;
const parse = JSON.parse;
const now = Date.now;
const derive = promisify(scrypt);
const digest = token => createHash('sha256').update(token).digest('hex');
const audit = label => run('INSERT INTO audit VALUES (?,?)', label, now());
const publicAccount = ({id,name,email,role,enabled}) => ({id,name,email,role,enabled:Boolean(enabled)});
const examById = id => parse(get('SELECT data FROM exams WHERE id=?',id).data);
const questionById = id => parse(get('SELECT data FROM questions WHERE id=?',id).data);
const cookie = token => `miqyas=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?43200:0}${production?'; Secure':''}`;
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
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(body.password,salt,64)).toString('hex');
  const inserted = run('INSERT INTO accounts(id,name,email,role,hash) VALUES (?,?,?,?,?) ON CONFLICT(email) DO NOTHING',randomUUID(),name,email,role,salt+':'+hash);
  requireValue(inserted.changes,'البريد الإلكتروني مسجّل مسبقًا.',409);
  audit('تم إنشاء حساب '+name);
}
if (!get("SELECT id FROM accounts WHERE role='admin'")) {
  const {ADMIN_EMAIL, ADMIN_PASSWORD} = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first administrator.');
  await createAccount({name:'مدير النظام',email:ADMIN_EMAIL,password:ADMIN_PASSWORD},'admin');
}

function finish(row) {
  if (row.result) return;
  const exam = examById(row.exam);
  const {order,answers} = parse(row.data);
  const details = order.map(questionById).map(q=>({
    prompt:q.prompt, selected:q.options[answers[q.id]], correct:q.options[q.correct],
    points:q.points, earned:answers[q.id]===q.correct?q.points:0
  }));
  const earned = details.reduce((sum,q)=>sum+q.earned,0);
  const total = details.reduce((sum,q)=>sum+q.points,0);
  const result = {id:row.exam,student:row.student,title:exam.title,details,earned,total,percent:Math.round(1000*earned/total)/10,passed:earned*100>=exam.pass*total,at:Math.min(now(),row.deadline)};
  if (run('UPDATE attempts SET result=? WHERE exam=? AND student=? AND result IS NULL',json(result),row.exam,row.student).changes) audit('تم تسليم امتحان '+exam.title);
}
function finishExpired() {
  for (const row of all('SELECT * FROM attempts WHERE deadline<=? AND result IS NULL LIMIT 500',now())) finish(row);
}
setInterval(()=>{
  try {
    finishExpired();
    run('DELETE FROM sessions WHERE expires<=?',now());
  } catch (error) { console.error(error); }
},5000).unref();

function state(account) {
  finishExpired();
  const result = {questions:[],exams:[],people:[],attempts:{},results:[],log:[]};
  if (account.role==='admin') {
    result.people = all('SELECT id,name,email,role,enabled FROM accounts ORDER BY name').map(publicAccount);
    result.log = all('SELECT label,at FROM audit ORDER BY rowid DESC LIMIT 200');
  }
  if (account.role==='teacher') {
    result.questions = all('SELECT data FROM questions WHERE owner=?',account.id).map(row=>parse(row.data));
    result.exams = all('SELECT data FROM exams WHERE owner=?',account.id).map(row=>parse(row.data));
    result.results = all('SELECT a.result, u.name FROM attempts a JOIN exams e ON e.id=a.exam JOIN accounts u ON u.id=a.student WHERE e.owner=? AND a.result IS NOT NULL',account.id).map(row=>({...parse(row.result),studentName:row.name}));
  }
  if (account.role==='student') {
    result.exams = all('SELECT data FROM exams').map(row=>parse(row.data));
    for (const row of all('SELECT * FROM attempts WHERE student=?',account.id)) {
      if (row.result) {
        const {details,...summary} = parse(row.result);
        result.results.push({...summary,details:details.map(({correct,...detail})=>detail)});
      } else {
        const attempt = parse(row.data);
        result.attempts[row.exam] = {...attempt,examId:row.exam,deadline:row.deadline};
        for (const id of attempt.order) {
          const {correct,...question} = questionById(id);
          result.questions.push(question);
        }
      }
    }
  }
  return {account:publicAccount(account), db:result};
}

const limits = new Map();
function throttle(req) {
  const ip = req.socket.remoteAddress;
  const entry = limits.get(ip);
  if (!entry || entry.until<now()) limits.set(ip,{until:now()+60000,count:1});
  else requireValue(++entry.count<=30,'حاول مرة أخرى بعد دقيقة.',429);
}
setInterval(()=>{for (const [ip,item] of limits) if (item.until<now()) limits.delete(ip);},60000).unref();
async function readBody(req) {
  requireValue(req.headers['content-type']==='application/json','صيغة الطلب غير صالحة.',415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size<=32768,'الطلب أكبر من الحد المسموح.',413);
    chunks.push(chunk);
  }
  let body;
  try { body=parse(Buffer.concat(chunks)); } catch { requireValue(false,'صيغة الطلب غير صالحة.'); }
  requireValue(body && typeof body==='object' && !Array.isArray(body),'صيغة الطلب غير صالحة.');
  return body;
}

async function api(req,res,path) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)miqyas=([a-f0-9]{64})(?:;|$)/)?.[1];
  const account = token && get('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.token=? AND s.expires>? AND a.enabled=1',digest(token),now());
  if (req.method==='GET' && path==='/api/state') return account ? state(account) : {account:null};
  requireValue(req.method==='POST','الصفحة غير موجودة.',404);
  requireValue(!req.headers.origin || new URL(req.headers.origin).host===req.headers.host,'مصدر الطلب غير صالح.',403);
  const body = await readBody(req);
  if (path==='/api/register') {
    throttle(req);
    await createAccount(body,'student');
    return {};
  }
  if (path==='/api/login') {
    throttle(req);
    const person = get('SELECT * FROM accounts WHERE email=?',textField(body.email,254).toLowerCase());
    const [salt,hash] = person?.hash.split(':') || ['00000000000000000000000000000000','0'.repeat(128)];
    const password = typeof body.password==='string' && body.password.length<=128 ? body.password : '';
    const valid = timingSafeEqual(await derive(password,salt,64),Buffer.from(hash,'hex'));
    requireValue(valid && person?.enabled && person.role===body.portal,'تحقّق من البريد وكلمة المرور والبوابة.',401);
    if (token) run('DELETE FROM sessions WHERE token=?',digest(token));
    const next = randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES (?,?,?)',digest(next),person.id,now()+43200000);
    res.setHeader('Set-Cookie',cookie(next));
    audit('سجّل دخول '+person.name);
    return state(person);
  }
  if (path==='/api/logout') {
    if (token) run('DELETE FROM sessions WHERE token=?',digest(token));
    res.setHeader('Set-Cookie',cookie(''));
    return {};
  }
  requireValue(account,'سجّل الدخول من جديد.',401);
  const role = required => requireValue(account.role===required,'ما عندك صلاحية لهذا الإجراء.',403);
  if (path==='/api/teachers') {
    role('admin');
    await createAccount(body,'teacher');
  } else if (path==='/api/accounts/toggle') {
    role('admin');
    const target = get("SELECT * FROM accounts WHERE id=? AND role<>'admin'",String(body.id));
    requireValue(target,'الحساب غير قابل للتعديل.',404);
    run('UPDATE accounts SET enabled=? WHERE id=?',1-target.enabled,target.id);
    run('DELETE FROM sessions WHERE account=?',target.id);
    audit('تم تغيير حالة حساب '+target.name);
  } else if (path==='/api/questions') {
    role('teacher');
    const prompt = textField(body.prompt,400);
    const options = Array.isArray(body.options) ? body.options.map(x=>textField(x,200)) : [];
    requireValue(prompt && options.length>=2 && options.length<=10 && options.every(Boolean) && integer(body.correct,0,options.length-1) && integer(body.points,1,100),'تحقّق من السؤال والخيارات والعلامة.');
    const question = {id:randomUUID(),prompt,options,correct:body.correct,points:body.points};
    run('INSERT INTO questions VALUES (?,?,?)',question.id,account.id,json(question));
    audit('أضاف سؤالًا '+account.name);
  } else if (path==='/api/exams') {
    role('teacher');
    const title = textField(body.title,100);
    const owned = new Set(all('SELECT id FROM questions WHERE owner=?',account.id).map(row=>row.id));
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
    const start = body.start ? Date.parse(body.start) : null;
    requireValue(title && ids.length>0 && ids.length<=100 && ids.every(id=>owned.has(id)) && integer(body.duration,1,180) && integer(body.pass,0,100) && (start===null || Number.isFinite(start)),'تحقّق من بيانات الامتحان والأسئلة.');
    const exam = {id:randomUUID(),title,ids,duration:body.duration,pass:body.pass,start:start===null?'':new Date(start).toISOString(),shuffle:body.shuffle===true};
    run('INSERT INTO exams VALUES (?,?,?)',exam.id,account.id,json(exam));
    audit('تم نشر امتحان '+title);
  } else if (['/api/attempt/start','/api/attempt/answer','/api/attempt/review','/api/attempt/finish'].includes(path)) {
    role('student');
    const id = String(body.id);
    const exam = get('SELECT data FROM exams WHERE id=?',id);
    requireValue(exam,'الامتحان غير موجود.',404);
    const current = get('SELECT * FROM attempts WHERE exam=? AND student=?',id,account.id);
    if (current?.result) return state(account);
    if (current && (current.deadline<=now() || path.endsWith('/finish'))) {
      finish(current);
    } else if (path.endsWith('/start')) {
      const {ids,start,duration,shuffle} = parse(exam.data);
      requireValue(!start || Date.parse(start)<=now(),'الامتحان لم يبدأ بعد.',409);
      if (!current) {
        if (shuffle) for (let i=ids.length-1;i>0;i--) {
          const j=randomInt(i+1);
          [ids[i],ids[j]]=[ids[j],ids[i]];
        }
        run('INSERT INTO attempts(exam,student,deadline,data) VALUES (?,?,?,?)',id,account.id,now()+duration*60000,json({order:ids,answers:{},review:{}}));
      }
    } else {
      requireValue(current,'ابدأ الامتحان أولًا.',409);
      const data = parse(current.data);
      requireValue(data.order.includes(body.question),'السؤال غير موجود في المحاولة.');
      if (path.endsWith('/answer')) {
        const q = questionById(body.question);
        requireValue(integer(body.answer,0,q.options.length-1),'الخيار غير صالح.');
        data.answers[body.question]=body.answer;
      } else {
        data.review[body.question]=body.review===true;
      }
      run('UPDATE attempts SET data=? WHERE exam=? AND student=?',json(data),id,account.id);
    }
  } else {
    requireValue(false,'الصفحة غير موجودة.',404);
  }
  return state(account);
}

const assets = new Map([
  ['/',['index.html','text/html; charset=utf-8']],
  ['/index.html',['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/style.css',['style.css','text/css; charset=utf-8']]
]);
const server = createServer(async (req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path==='/health' && req.method==='GET') return res.end('ok');
    if (path.startsWith('/api/')) {
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(json(await api(req,res,path)));
    }
    const asset = assets.get(path);
    requireValue(asset && req.method==='GET','الصفحة غير موجودة.',404);
    res.setHeader('Content-Type',asset[1]);
    res.end(readFileSync(resolve(webRoot,asset[0])));
  } catch (error) {
    if (!error.status) console.error(error);
    res.writeHead(error.status || 500,{'Content-Type':'application/json; charset=utf-8'});
    res.end(json({error:error.status ? error.message : 'تعذّر إكمال الطلب.'}));
  }
});
server.listen(Number(process.env.PORT || 3000),process.env.HOST || (production?'0.0.0.0':'127.0.0.1'),()=>console.log('Miqyas is listening on '+server.address().port));
