import {deleteApp, initializeApp} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js';
import {
  browserSessionPersistence, createUserWithEmailAndPassword, EmailAuthProvider, getAuth, initializeAuth, inMemoryPersistence, reauthenticateWithCredential, setPersistence, updatePassword,
  reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import {addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';

const app=initializeApp({
  apiKey:'AIzaSyDi06jtrahqfRYpdRG523x3aJpqkullLsc',
  authDomain:'miqyas-exams.firebaseapp.com',
  projectId:'miqyas-exams',
  appId:'1:130457048809:web:61a59657e3adceec294278'
});
const appCheckKey=document.querySelector('meta[name="firebase-app-check-site-key"]')?.content.trim();
async function enableAppCheck(firebaseApp) {
  if (!appCheckKey) return;
  const {initializeAppCheck,ReCaptchaEnterpriseProvider}=await import('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-check.js');
  initializeAppCheck(firebaseApp,{provider:new ReCaptchaEnterpriseProvider(appCheckKey),isTokenAutoRefreshEnabled:true});
}
await enableAppCheck(app);
const auth=getAuth(app);
const db=getFirestore(app);
await setPersistence(auth,browserSessionPersistence);
await auth.authStateReady();
const universityEmail=email=>/^[^@\s]+@ses\.yu\.edu\.jo$/i.test(email || '');
const loginLimitKey='miqyas-login-limit';
const loginWindow=5*60*1000;
let loginFailures=[];
function recentFailures() {
  try {loginFailures=JSON.parse(localStorage.getItem(loginLimitKey) || '[]');} catch {}
  if (!Array.isArray(loginFailures)) loginFailures=[];
  loginFailures=loginFailures.filter(time=>typeof time==='number' && time>Date.now()-loginWindow && time<=Date.now());
  return loginFailures;
}
function storeFailures(failures) {
  loginFailures=failures;
  try {localStorage.setItem(loginLimitKey,JSON.stringify(failures));} catch {}
}

export async function profile(portal='student') {
  const user=auth.currentUser;
  if (!user) return null;
  if (portal==='teacher' || portal==='admin') {
    const assigned=await getDoc(doc(db,portal==='teacher'?'teacherRoles':'adminRoles',user.uid));
    if (!assigned.exists()) return null;
    return {id:user.uid,email:user.email,name:assigned.data().name || user.email,role:portal};
  }
  const teacherRole=await getDoc(doc(db,'teacherRoles',user.uid));
  if (teacherRole.exists()) return null;
  const adminRole=await getDoc(doc(db,'adminRoles',user.uid));
  if (adminRole.exists()) return null;
  const eligible=universityEmail(user.email);
  if (!eligible || !user.emailVerified) return {
    id:user.uid,email:user.email,role:'student',verification:eligible?'pending':'domain'
  };
  const ref=doc(db,'studentProfiles',user.uid);
  const saved=await getDoc(ref);
  if (!saved.exists() && user.displayName) return saveProfile(user.displayName);
  return {id:user.uid,email:user.email,name:saved.data()?.name,role:'student'};
}

export async function saveProfile(name) {
  const user=auth.currentUser;
  const cleanName=name.trim();
  if (!user || !cleanName || cleanName.length>100) throw new Error('أدخل اسمًا من 1 إلى 100 حرف.');
  if (!universityEmail(user.email) || !user.emailVerified) throw new Error('أكّد بريدك الجامعي أولًا.');
  const ref=doc(db,'studentProfiles',user.uid);
  const savedName=await runTransaction(db,async tx=>{
    const saved=await tx.get(ref);
    if (saved.exists()) return saved.data().name;
    tx.set(ref,{name:cleanName,email:user.email,createdAt:serverTimestamp()});
    return cleanName;
  });
  return {id:user.uid,email:user.email,name:savedName,role:'student'};
}

export async function changeStudentName(name) {
  const cleanName=name.trim();
  if (!cleanName || cleanName.length>100) throw new Error('أدخل اسمًا من 1 إلى 100 حرف.');
  await updateDoc(doc(db,'studentProfiles',auth.currentUser.uid),{name:cleanName});
  return cleanName;
}

export async function changeStudentPassword(current,password) {
  if (password.length<12) throw new Error('كلمة المرور الجديدة لازم تكون 12 حرفًا على الأقل.');
  const user=auth.currentUser;
  await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,current));
  await updatePassword(user,password);
}

export async function register({name,email,password}) {
  if (!name.trim() || name.trim().length>100 || password.length<12) throw new Error('أدخل اسمك وكلمة مرور من 12 حرفًا على الأقل.');
  const address=email.trim().toLowerCase();
  if (!universityEmail(address)) throw new Error('استخدم بريد الجامعة المنتهي بـ @ses.yu.edu.jo.');
  const {user}=await createUserWithEmailAndPassword(auth,address,password);
  await updateProfile(user,{displayName:name.trim()});
  await sendEmailVerification(user);
  return profile();
}

export async function login({email,password},portal) {
  if (recentFailures().length>=5) throw new Error('محاولات دخول كثيرة. حاول مرة ثانية بعد 5 دقائق.');
  let account;
  try {
    await signInWithEmailAndPassword(auth,email.trim(),password);
    account=await profile(portal);
  } catch (error) {
    if (error.code==='auth/network-request-failed') throw error;
    if (!error.code?.startsWith('auth/')) throw error;
  }
  if (!account) {
    storeFailures([...recentFailures(),Date.now()]);
    if (auth.currentUser) await signOut(auth);
    throw new Error('تعذّر تسجيل الدخول. تأكّد من بياناتك والبوابة اللي اخترتها.');
  }
  storeFailures([]);
  return account;
}
export async function refreshVerification() {
  const user=auth.currentUser;
  if (!user) return null;
  await reload(user);
  await user.getIdToken(true);
  return profile();
}
export async function resendVerification() {
  const user=auth.currentUser;
  if (!user || !universityEmail(user.email)) throw new Error('سجّل الدخول ببريدك الجامعي أولًا.');
  await sendEmailVerification(user);
}

export function logout() { return signOut(auth); }

export async function requestPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth,email.trim());
  } catch (error) {
    if (error.code!=='auth/user-not-found') throw error;
  }
}

export async function loadPeople() {
  const [profiles,teachers,admins]=await Promise.all([
    getDocs(collection(db,'studentProfiles')),getDocs(collection(db,'teacherRoles')),
    getDocs(collection(db,'adminRoles'))
  ]);
  const registered=new Map(profiles.docs.map(item=>[item.id,{...item.data(),id:item.id}]));
  const roleAccounts=records=>records.docs.map(item=>({...registered.get(item.id),...item.data(),id:item.id}));
  const teacherAccounts=roleAccounts(teachers);
  const adminAccounts=roleAccounts(admins);
  const assigned=new Set([...teacherAccounts,...adminAccounts].map(person=>person.id));
  const students=[...registered.values()].filter(person=>!assigned.has(person.id));
  const byName=(a,b)=>(a.name || '').localeCompare(b.name || '','ar');
  return {students:students.sort(byName),teachers:teacherAccounts.sort(byName),admins:adminAccounts.sort(byName),classes:await loadClasses('admin')};
}

export async function createTeacher({name,email,password}) {
  const cleanName=name.trim();
  const cleanEmail=email.trim();
  if (!cleanName || cleanName.length>100 || password.length<12 || password.length>128) {
    throw new Error('أدخل اسم المدرّس وكلمة مرور بين 12 و128 حرفًا.');
  }
  const secondary=initializeApp(app.options,'teacher-provisioning');
  try {
    await enableAppCheck(secondary);
    const teacherAuth=initializeAuth(secondary,{persistence:inMemoryPersistence});
    let credential;
    try {
      credential=await createUserWithEmailAndPassword(teacherAuth,cleanEmail,password);
    } catch (error) {
      if (error.code!=='auth/email-already-in-use') throw error;
      try {
        // Allows retrying a partially completed creation with the same credentials.
        credential=await signInWithEmailAndPassword(teacherAuth,cleanEmail,password);
      } catch {
        throw error;
      }
    }
    const ref=doc(db,'teacherRoles',credential.user.uid);
    if ((await getDoc(ref)).exists()) throw new Error('هذا الحساب مضاف كمدرّس بالفعل.');
    await setDoc(ref,{name:cleanName,email:credential.user.email});
  } finally {
    await deleteApp(secondary);
  }
}
export function removeTeacher(id) {return deleteDoc(doc(db,'teacherRoles',id));}

function bank() {
  return collection(db,'teacherBanks',auth.currentUser.uid,'questions');
}
async function loadClasses(portal) {
  const uid=auth.currentUser.uid;
  const classes=collection(db,'classes');
  if (portal==='student') {
    const memberships=await getDocs(collection(db,'studentProfiles',uid,'classes'));
    return Promise.all(memberships.docs.map(async membership=>{
      const item=await getDoc(doc(classes,membership.id));
      return {...item.data(),id:item.id};
    }));
  }
  const snapshots=await getDocs(portal==='teacher'?query(classes,where('owner','==',uid)):classes);
  return Promise.all(snapshots.docs.map(async item=>{
    const [members,invites]=await Promise.all([getDocs(collection(item.ref,'members')),getDocs(collection(item.ref,'invites'))]);
    return {...item.data(),id:item.id,invite:invites.docs[0]?.id,members:members.docs.map(member=>member.data().name)};
  }));
}

export async function saveClass(id,{name,subject,owner}) {
  const fields={name:name.trim(),subject:subject.trim()};
  if (!fields.name || !fields.subject) throw new Error('أدخل اسم الشعبة والمادة.');
  if (id) await updateDoc(doc(db,'classes',id),fields);
  else {
    const group=doc(collection(db,'classes'));
    const batch=writeBatch(db);
    batch.set(group,{...fields,owner:owner || auth.currentUser.uid});
    batch.set(doc(collection(group,'invites')),{});
    await batch.commit();
  }
}
export function createClassInvite(id) {
  return addDoc(collection(db,'classes',id,'invites'),{});
}

export async function joinClass(code,name) {
  const cleaned=code.trim();
  if (!/^[A-Za-z0-9]{20}-[A-Za-z0-9]{20}$/.test(cleaned)) throw new Error('تأكّد من رمز الانضمام.');
  const [id,invite]=cleaned.split('-');
  const uid=auth.currentUser.uid;
  const membership=doc(db,'studentProfiles',uid,'classes',id);
  try {
    await runTransaction(db,async transaction=>{
      if ((await transaction.get(membership)).exists()) return;
      transaction.set(membership,{});
      transaction.set(doc(db,'classes',id,'members',uid),{name,code:invite});
    });
  } catch (error) {
    if (error.code==='permission-denied') throw new Error('تعذّر الانضمام. تأكّد من رمز الشعبة.');
    throw error;
  }
}

async function studentExams(classes,attempts) {
  const refs=await Promise.all(classes.map(group=>getDocs(collection(db,'classes',group.id,'exams'))));
  const ids=new Set([...refs.flatMap(list=>list.docs.map(item=>item.id)),...attempts.docs.map(item=>item.id)]);
  return (await Promise.all([...ids].map(id=>getDoc(doc(db,'publishedExams',id))))).filter(item=>item.exists());
}

export async function loadExams(portal) {
  const teacher=portal==='teacher';
  const uid=auth.currentUser.uid;
  const [classes,questions,attempts,ownedExams]=await Promise.all([
    loadClasses(portal),teacher?getDocs(bank()):null,
    teacher?null:getDocs(collection(db,'studentProfiles',uid,'attempts')),
    teacher?getDocs(query(collection(db,'publishedExams'),where('owner','==',uid))):null
  ]);
  const exams=teacher?ownedExams.docs:await studentExams(classes,attempts);
  return {
    classes,
    exams:exams.map(item=>({...item.data(),id:item.id,start:item.data().start.toDate().toISOString()}))
      .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),
    questions:questions?.docs.map(item=>({...item.data(),id:item.id})) || [],
    results:[],attempts:{},
    submissions:Object.fromEntries(attempts?.docs.map(item=>[item.id,item.data()]) || [])
  };
}
function linkExamToClasses(batch,id,classIds) {
  for (const classId of classIds) batch.set(doc(db,'classes',classId,'exams',id),{});
}

export async function assignLegacyExam(id,classIds) {
  const batch=writeBatch(db);
  batch.update(doc(db,'publishedExams',id),{classIds});
  linkExamToClasses(batch,id,classIds);
  await batch.commit();
}
export async function addQuestion(question) {
  await addDoc(bank(),question);
}
export async function editQuestion(id, question) {
  const ref=doc(bank(),id);
  await runTransaction(db,async tx=>{
    const snapshot=await tx.get(ref);
    if (!snapshot.exists()) throw new Error('السؤال غير موجود في بنك الأسئلة.');
    const saved=snapshot.data();
    tx.update(ref,{
      ...question,
      originalCorrect:saved.originalCorrect ?? saved.correct,
      originalPoints:saved.originalPoints ?? saved.points
    });
  });
}
function examQuestions(ids,bankQuestions) {
  return ids.map(id=>{
    const item=bankQuestions.find(question=>question.id===id);
    if (!item) throw new Error('بعض أسئلة الامتحان غير موجودة في البنك.');
    return {id,prompt:item.prompt,options:item.options,points:item.points};
  });
}
function answerKey(ids,bankQuestions,original=false) {
  return Object.fromEntries(ids.map(id=>{
    const question=bankQuestions.find(item=>item.id===id);
    if (!question) throw new Error('بعض أسئلة الامتحان غير موجودة في البنك.');
    const correct=original?(question.originalCorrect ?? question.correct):question.correct;
    const points=original?(question.originalPoints ?? question.points):question.points;
    return [id,{correct,points}];
  }));
}
export async function publishExam({ids,shuffle,start,...metadata},bankQuestions) {
  const owner=auth.currentUser.uid;
  const exam=doc(collection(db,'publishedExams'));
  const batch=writeBatch(db);
  batch.set(exam,{...metadata,owner,questionCount:ids.length,start:Timestamp.fromDate(new Date(start)),publishedAt:serverTimestamp(),ready:true});
  linkExamToClasses(batch,exam.id,metadata.classIds);
  batch.set(doc(db,'teacherBanks',owner,'papers',exam.id),{ids,shuffle});
  batch.set(doc(db,'examContent',exam.id),{questions:examQuestions(ids,bankQuestions),shuffle});
  batch.set(doc(db,'examKeys',exam.id),{answers:answerKey(ids,bankQuestions)});
  await batch.commit();
}

export async function enableExam(id,start,bankQuestions) {
  const owner=auth.currentUser.uid;
  const paper=await getDoc(doc(db,'teacherBanks',owner,'papers',id));
  if (!paper.exists()) throw new Error('تعذّر العثور على أسئلة الامتحان.');
  const {ids,shuffle}=paper.data();
  const batch=writeBatch(db);
  batch.update(doc(db,'publishedExams',id),{ready:true,start:Timestamp.fromDate(new Date(start))});
  batch.set(doc(db,'examContent',id),{questions:examQuestions(ids,bankQuestions),shuffle});
  batch.set(doc(db,'examKeys',id),{answers:answerKey(ids,bankQuestions)});
  await batch.commit();
}
export function rescheduleExam(id,start) {
  return updateDoc(doc(db,'publishedExams',id),{start:Timestamp.fromDate(start)});
}
export async function examDraft(exam) {
  const paper=await getDoc(doc(db,'teacherBanks',auth.currentUser.uid,'papers',exam.id));
  if (!paper.exists()) throw new Error('تعذّر العثور على أسئلة الامتحان.');
  return {...exam,...paper.data()};
}

function submissionRef(id) {
  return doc(db,'studentProfiles',auth.currentUser.uid,'attempts',id);
}
function participantRef(id) {
  return doc(db,'publishedExams',id,'participants',auth.currentUser.uid);
}
export async function syncParticipant(id,name) {
  const ref=participantRef(id);
  await runTransaction(db,async tx=>{
    if (!(await tx.get(ref)).exists()) tx.set(ref,{name});
  });
}
export async function beginAttempt(exam,name) {
  const content=await getDoc(doc(db,'examContent',exam.id));
  if (!content.exists()) throw new Error('أسئلة الامتحان غير متاحة.');
  const {questions,shuffle}=content.data();
  const ref=submissionRef(exam.id);
  const participant=participantRef(exam.id);
  const attempt=await runTransaction(db,async transaction=>{
    const [snapshot,entry]=await Promise.all([transaction.get(ref),transaction.get(participant)]);
    if (!entry.exists()) transaction.set(participant,{name});
    if (snapshot.exists()) return snapshot.data();
    const initial={startedAt:serverTimestamp(),answers:{},review:{},submittedAt:null};
    transaction.set(ref,initial);
    return initial;
  });
  if (attempt.startedAt?.toMillis?.()<Date.parse(exam.start)) {
    throw new Error('إجابات محاولتك السابقة محفوظة. ارجع للجدول لعرض العلامة.');
  }
  const order=questions.map(q=>q.id);
  if (shuffle) {
    // Keep the order stable if the student refreshes or resumes.
    const uid=auth.currentUser.uid;
    const orderKey=id=>Array.from(uid+id).reduce((hash,char)=>Math.imul(hash^char.charCodeAt(0),16777619),2166136261)>>>0;
    order.sort((a,b)=>orderKey(a)-orderKey(b) || a.localeCompare(b));
  }
  return {questions,attempt:{...attempt,order,examId:exam.id,deadline:Date.parse(exam.start)+exam.duration*60000}};
}
export function saveAttemptField(id,field,question,value) {
  return updateDoc(submissionRef(id),{[field+'.'+question]:value});
}
export function submitAttempt(id) {
  const ref=submissionRef(id);
  return runTransaction(db,async transaction=>{
    const saved=await transaction.get(ref);
    if (!saved.exists()) throw new Error('المحاولة غير موجودة.');
    if (!saved.data().submittedAt) transaction.update(ref,{submittedAt:serverTimestamp()});
  });
}

export function calculateGrade(key,answers,pass) {
  let total=0;
  let earned=0;
  for (const [id,item] of Object.entries(key)) {
    total+=item.points;
    if (Object.hasOwn(answers,id) && answers[id]===item.correct) earned+=item.points;
  }
  const percent=total?Math.round(10000*earned/total)/100:0;
  return {earned,total,percent,passed:total>0 && earned*100>=pass*total};
}
export async function studentGrade(exam,includeDetails=false) {
  const [key,attempt]=await Promise.all([
    getDoc(doc(db,'examKeys',exam.id)),getDoc(submissionRef(exam.id))
  ]);
  if (!key.exists() || !attempt.data()?.submittedAt) return null;
  const answers=attempt.data().answers;
  const correct=key.data().answers;
  const grade=calculateGrade(correct,answers,exam.pass);
  if (!includeDetails || Date.now()<Date.parse(exam.start)+exam.duration*60000) return grade;
  const content=await getDoc(doc(db,'examContent',exam.id));
  return {...grade,details:content.data()?.questions.map(question=>({
    prompt:question.prompt,
    selected:question.options[answers[question.id]],
    correct:question.options[correct[question.id]?.correct],
    points:correct[question.id]?.points ?? question.points,
    earned:answers[question.id]===correct[question.id]?.correct && correct[question.id]?correct[question.id].points:0
  }))};
}
export async function examRoster(exam,bankQuestions) {
  const keyRef=doc(db,'examKeys',exam.id);
  const key=await getDoc(keyRef);
  let answers=key.data()?.answers;
  if (!answers) {
    const paper=await getDoc(doc(db,'teacherBanks',auth.currentUser.uid,'papers',exam.id));
    if (!paper.exists()) throw new Error('تعذّر العثور على مفتاح الامتحان.');
    answers=answerKey(paper.data().ids,bankQuestions,true);
    await runTransaction(db,async tx=>{
      const existing=await tx.get(keyRef);
      if (!existing.exists()) tx.set(keyRef,{answers});
      else answers=existing.data().answers;
    });
  }
  const [entries,content]=await Promise.all([
    getDocs(collection(db,'publishedExams',exam.id,'participants')),
    getDoc(doc(db,'examContent',exam.id))
  ]);
  const closed=Date.now()>=Date.parse(exam.start)+exam.duration*60000;
  const roster=await Promise.all(entries.docs.map(async entry=>{
    const snapshot=await getDoc(doc(db,'studentProfiles',entry.id,'attempts',exam.id));
    const attempt=snapshot.data();
    const submitted=Boolean(attempt?.submittedAt || (attempt && (closed || attempt.startedAt.toMillis()<Date.parse(exam.start))));
    return {name:entry.data().name,submitted,grade:submitted?calculateGrade(answers,attempt.answers,exam.pass):null,
      responses:submitted?attempt.answers:null};
  }));
  const prompts=new Map((content.data()?.questions || []).map(question=>[question.id,question.prompt]));
  const submitted=roster.filter(entry=>entry.responses);
  return {entries:roster,questions:Object.entries(answers).map(([id,key],index)=>({
    prompt:prompts.get(id) || 'السؤال '+(index+1),
    correct:submitted.filter(entry=>entry.responses[id]===key.correct).length,
    total:submitted.length
  }))};
}
