import {deleteApp, initializeApp} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js';
import {
  browserSessionPersistence, createUserWithEmailAndPassword, EmailAuthProvider, getAuth, initializeAuth, inMemoryPersistence, reauthenticateWithCredential, setPersistence, updatePassword,
  reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import {addDoc, collection, deleteDoc, doc, documentId, getAggregateFromServer, getCountFromServer, getDoc, getDocs, getFirestore, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, startAfter, sum, Timestamp, updateDoc, where, writeBatch} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';

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
    if (!assigned.exists() || assigned.data().disabled) return null;
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
  if (saved.data()?.disabled) throw new Error('حسابك موقوف. تواصل مع إدارة مقياس.');
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

const adminCollections={students:'studentProfiles',teachers:'teacherRoles',admins:'adminRoles',log:'auditLog',exams:'publishedExams'};
const records=snap=>snap.docs.map(item=>({...item.data(),id:item.id}));
export async function loadAdminPage(type,cursor) {
  const ordering=type==='log'?orderBy('at','desc'):orderBy(documentId());
  const source=collection(db,adminCollections[type]);
  const snap=await getDocs(query(source,ordering,...(cursor?[startAfter(cursor)]:[]),limit(50)));
  const items=records(snap).filter(item=>type!=='exams' || !item.cancelled);
  return {items,next:snap.size===50?snap.docs.at(-1):null};
}
export async function loadPeople() {
  const types=Object.keys(adminCollections);
  const [classes,subjects,...pages]=await Promise.all([loadClasses('admin'),getDocs(collection(db,'subjects')),
    ...types.map(type=>loadAdminPage(type))]);
  return {classes,subjects:records(subjects),...Object.fromEntries(types.map((type,i)=>[type,pages[i].items])),
    cursors:Object.fromEntries(types.map((type,i)=>[type,pages[i].next]))};
}
export async function platformStats() {
  const [students,teachers,exams,results]=await Promise.all([
    ...['studentProfiles','teacherRoles','publishedExams'].map(path=>getCountFromServer(collection(db,path))),
    getAggregateFromServer(collection(db,'resultSummaries'),{passed:sum('passed'),total:sum('total')})
  ]);
  return {students:students.data().count,teachers:teachers.data().count,exams:exams.data().count,...results.data()};
}
export function saveResultSummary(id,entries) {
  const grades=entries.filter(entry=>entry.grade && entry.finalized);
  return setDoc(doc(db,'resultSummaries',id),{passed:grades.filter(entry=>entry.grade.passed).length,total:grades.length});
}

function audit(batch,action,target) {
  batch.set(doc(collection(db,'auditLog')),{actor:auth.currentUser.uid,at:serverTimestamp(),action,target});
}
export async function updateAccount(role,id,fields) {
  const batch=writeBatch(db);
  batch.update(doc(db,role==='teacher'?'teacherRoles':'studentProfiles',id),fields);
  audit(batch,'account',id);
  await batch.commit();
}
export async function saveSubject(id,fields) {
  const batch=writeBatch(db);
  const ref=id?doc(db,'subjects',id):doc(collection(db,'subjects'));
  batch.set(ref,fields);
  audit(batch,'subject',ref.id);
  await batch.commit();
}

export async function createTeacher({name,email,password},role='teacher') {
  const cleanName=name.trim();
  const cleanEmail=email.trim();
  if (role==='student' && !universityEmail(cleanEmail)) throw new Error('استخدم البريد الجامعي للطالب.');
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
    const ref=doc(db,role==='student'?'studentProfiles':'teacherRoles',credential.user.uid);
    if ((await getDoc(ref)).exists()) throw new Error('هذا الحساب مضاف بالفعل.');
    if (role==='student' && !credential.user.emailVerified) await sendEmailVerification(credential.user);
    const batch=writeBatch(db);
    batch.set(ref,{name:cleanName,email:credential.user.email,...(role==='student'?{createdAt:serverTimestamp()}: {})});
    audit(batch,'account',ref.id);
    await batch.commit();
  } finally {
    await deleteApp(secondary);
  }
}
export function removeTeacher(id) {return updateAccount('teacher',id,{disabled:true});}

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
    return {...item.data(),id:item.id,invites:invites.docs.map(invite=>({id:invite.id,...invite.data()})),
      members:members.docs.map(member=>({id:member.id,name:member.data().name}))};
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
export function createClassInvite(id,expiresAt) {
  return addDoc(collection(db,'classes',id,'invites'),expiresAt?{expiresAt:Timestamp.fromDate(expiresAt)}:{});
}
export function revokeClassInvite(id,code) {
  return deleteDoc(doc(db,'classes',id,'invites',code));
}
export function archiveClass(id) {
  return updateDoc(doc(db,'classes',id),{archived:true});
}
export function removeClassMember(id,uid=auth.currentUser.uid) {
  const batch=writeBatch(db);
  batch.delete(doc(db,'classes',id,'members',uid));
  batch.delete(doc(db,'studentProfiles',uid,'classes',id));
  return batch.commit();
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
  const extensions=teacher?[]:await Promise.all(attempts.docs.map(item=>getDoc(extensionRef(item.id,uid))));
  const retries=teacher?[]:await Promise.all(exams.filter(item=>item.data().examClosesAt && item.data().maxAttempts>1)
    .map(item=>getDoc(retryRef(item.id,uid))));
  return {
    classes,
    exams:exams.map(item=>({...item.data(),id:item.id,start:item.data().start.toDate().toISOString(),
      closesAt:item.data().examClosesAt?.toMillis(),
      retry:retries.find(retry=>retry.ref.parent.parent.id===item.id)?.data()?.number,
      extra:extensions.find(extension=>extension.ref.parent.parent.id===item.id)?.data()?.minutes || 0}))
      .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),
    questions:questions?.docs.map(item=>({...item.data(),id:item.id})) || [],
    results:[],attempts:{},
    submissions:Object.fromEntries(attempts?.docs.map(item=>[item.id,item.data()]) || [])
  };
}
function linkExamToClasses(batch,id,classIds) {
  for (const classId of classIds) batch.set(doc(db,'classes',classId,'exams',id),{});
}

export async function assignLegacyExam(id,classIds,section) {
  const batch=writeBatch(db);
  batch.update(doc(db,'publishedExams',id),{classIds,section});
  linkExamToClasses(batch,id,classIds);
  await batch.commit();
}
export async function addQuestion(question) {
  await addDoc(bank(),question);
}
export async function importQuestions(questions) {
  const batch=writeBatch(db);
  for (const question of questions) batch.set(doc(bank()),question);
  await batch.commit();
}
export function removeQuestion(id) {return deleteDoc(doc(bank(),id));}
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
    const written=item.type==='blank' || item.type==='essay';
    return {id,prompt:item.prompt,options:written?[]:item.options,points:item.points,
      ...(written?{type:item.type}:{})};
  });
}
function answerKey(ids,bankQuestions,original=false) {
  return Object.fromEntries(ids.map(id=>{
    const question=bankQuestions.find(item=>item.id===id);
    if (!question) throw new Error('بعض أسئلة الامتحان غير موجودة في البنك.');
    const correct=original?(question.originalCorrect ?? question.correct):question.correct;
    const points=original?(question.originalPoints ?? question.points):question.points;
    return [id,question.type==='blank'?{accepted:question.options,points}:
      question.type==='essay'?{essay:true,rubric:question.options[0],points}:{correct,points}];
  }));
}
export async function publishExam({ids,shuffle,start,closesAt,...metadata},bankQuestions) {
  const owner=auth.currentUser.uid;
  const exam=doc(collection(db,'publishedExams'));
  const batch=writeBatch(db);
  batch.set(exam,{...metadata,owner,questionCount:ids.length,start:Timestamp.fromDate(new Date(start)),examClosesAt:Timestamp.fromDate(closesAt),publishedAt:serverTimestamp(),ready:true});
  linkExamToClasses(batch,exam.id,metadata.classIds);
  batch.set(doc(db,'teacherBanks',owner,'papers',exam.id),{ids,shuffle});
  batch.set(doc(db,'examContent',exam.id),{questions:examQuestions(ids,bankQuestions),shuffle});
  batch.set(doc(db,'examKeys',exam.id),{answers:answerKey(ids,bankQuestions)});
  audit(batch,'publish',exam.id);
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
  const batch=writeBatch(db);
  batch.update(doc(db,'publishedExams',id),{start:Timestamp.fromDate(start),rescheduledAt:serverTimestamp()});
  audit(batch,'schedule',id);
  return batch.commit();
}
export function editExam(exam,fields) {
  const batch=writeBatch(db);
  batch.update(doc(db,'publishedExams',exam.id),fields);
  if (fields.cancelled) for (const id of exam.classIds || []) batch.delete(doc(db,'classes',id,'exams',exam.id));
  audit(batch,fields.cancelled?'cancel':'exam',exam.id);
  return batch.commit();
}
function extensionRef(id,uid) {return doc(db,'publishedExams',id,'extensions',uid);}
function retryRef(id,uid) {return doc(db,'publishedExams',id,'retries',uid);}
function deadlineFor(exam,attempt,extra) {
  const start=exam.closesAt?attempt?.startedAt?.toMillis() ?? Date.parse(exam.start):Date.parse(exam.start);
  return Math.min(exam.closesAt ?? Infinity,start+(exam.duration+extra)*60000);
}
export async function attemptDeadline(exam,attempt) {
  const extension=await getDoc(extensionRef(exam.id,auth.currentUser.uid));
  return deadlineFor(exam,attempt,extension.data()?.minutes || 0);
}
export function releaseResults(id) {
  return updateDoc(doc(db,'publishedExams',id),{resultsReleased:true});
}
export function grantRetry(id,uid,number) {
  const batch=writeBatch(db);
  batch.set(retryRef(id,uid),{number});
  audit(batch,'retry',id+'/'+uid);
  return batch.commit();
}
export function grantExtraTime(id,uid,minutes) {return setDoc(extensionRef(id,uid),{minutes});}
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
  const ref=submissionRef(exam.id);
  const participant=participantRef(exam.id);
  await runTransaction(db,async transaction=>{
    const [snapshot,entry]=await Promise.all([transaction.get(ref),transaction.get(participant)]);
    const previous=snapshot.data();
    if (!entry.exists()) transaction.set(participant,{name});
    const retry=previous?.submittedAt && exam.retry===(previous.number ?? 1)+1 && Date.now()<exam.closesAt;
    if (previous && !retry) return;
    const initial={startedAt:serverTimestamp(),answers:{},review:{},submittedAt:null};
    if (retry) transaction.set(doc(ref,'history',String(previous.number ?? 1)),previous);
    transaction.set(ref,retry?{...initial,number:exam.retry}:initial);
  });
  const attempt=(await getDoc(ref)).data();
  if (attempt.submittedAt) return {questions:[],attempt};
  const deadline=await attemptDeadline(exam,attempt);
  const content=await getDoc(doc(db,'examContent',exam.id));
  if (!content.exists()) throw new Error('أسئلة الامتحان غير متاحة.');
  const {questions,shuffle}=content.data();
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
  return {questions,attempt:{...attempt,order,examId:exam.id,deadline}};
}
export function saveAttemptField(id,field,question,value) {
  return updateDoc(submissionRef(id),{[field+'.'+question]:value});
}
export function recordTabExit(id) {
  const minute=String(Math.floor(Date.now()/60000));
  return setDoc(doc(submissionRef(id),'tabEvents',minute),{at:serverTimestamp()});
}
export function submitAttempt(id) {
  const ref=submissionRef(id);
  return runTransaction(db,async transaction=>{
    const saved=await transaction.get(ref);
    if (!saved.exists()) throw new Error('المحاولة غير موجودة.');
    if (!saved.data().submittedAt) transaction.update(ref,{submittedAt:serverTimestamp()});
  });
}

function matchesAnswer(key,value) {
  if (key.accepted) return typeof value==='string' && key.accepted.some(answer=>
    answer.normalize('NFKC').trim().toLowerCase()===value.normalize('NFKC').trim().toLowerCase());
  return Number.isInteger(value) && value===key.correct;
}
async function manualMarks(ref,key,attempt) {
  const ids=Object.keys(key).filter(id=>key[id].essay);
  const marks=await Promise.all(ids.map(id=>getDoc(doc(ref,'manualGrades',id))));
  return Object.fromEntries(marks.flatMap((mark,i)=>mark.data()?.number===(attempt.number ?? 1)?[[ids[i],mark.data()]]:[]));
}
export function gradeEssay(examId,uid,question,mark) {
  return setDoc(doc(db,'studentProfiles',uid,'attempts',examId,'manualGrades',question),mark);
}
export function calculateGrade(key,answers,pass,marks={}) {
  let total=0;
  let earned=0;
  for (const [id,item] of Object.entries(key)) {
    total+=item.points;
    if (item.essay) {
      if (!marks[id]) return null;
      earned+=marks[id].points;
    } else if (Object.hasOwn(answers,id) && matchesAnswer(item,answers[id])) earned+=item.points;
  }
  const percent=total?Math.round(10000*earned/total)/100:0;
  return {earned,total,percent,passed:total>0 && earned*100>=pass*total};
}
export async function studentGrade(exam,includeDetails=false) {
  if (exam.resultMode==='manual' && !exam.resultsReleased) return null;
  if (Date.now()<(exam.closesAt ?? await attemptDeadline(exam))) return null;
  const attempt=await getDoc(submissionRef(exam.id));
  if (!attempt.data()?.submittedAt) return null;
  const key=await getDoc(doc(db,'examKeys',exam.id));
  if (!key.exists()) return null;
  const answers=attempt.data().answers;
  const correct=key.data().answers;
  const marks=await manualMarks(attempt.ref,correct,attempt.data());
  const grade=calculateGrade(correct,answers,exam.pass,marks);
  if (!grade || !includeDetails) return grade;
  const content=await getDoc(doc(db,'examContent',exam.id));
  return {...grade,details:content.data()?.questions.map(question=>({
    prompt:question.prompt,
    selected:question.type?answers[question.id]:question.options[answers[question.id]],
    correct:correct[question.id]?.accepted?.join(' / ') ?? question.options[correct[question.id]?.correct],
    points:correct[question.id]?.points ?? question.points,
    earned:marks[question.id]?.points ?? (correct[question.id] && matchesAnswer(correct[question.id],answers[question.id])?correct[question.id].points:0),
    comment:marks[question.id]?.comment
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
  const [entries,content,extensions,retries]=await Promise.all([
    getDocs(collection(db,'publishedExams',exam.id,'participants')),
    getDoc(doc(db,'examContent',exam.id)),getDocs(collection(db,'publishedExams',exam.id,'extensions')),
    getDocs(collection(db,'publishedExams',exam.id,'retries'))
  ]);
  const extra=new Map(extensions.docs.map(item=>[item.id,item.data().minutes]));
  const retry=new Map(retries.docs.map(item=>[item.id,item.data().number]));
  const prompts=new Map((content.data()?.questions || []).map(question=>[question.id,question.prompt]));
  const roster=await Promise.all(entries.docs.map(async entry=>{
    const ref=doc(db,'studentProfiles',entry.id,'attempts',exam.id);
    const [snapshot,tabEvents]=await Promise.all([getDoc(ref),getDocs(collection(ref,'tabEvents'))]);
    const attempt=snapshot.data();
    const minutes=extra.get(entry.id) || 0;
    const closed=Date.now()>=deadlineFor(exam,attempt,minutes);
    const submitted=Boolean(attempt?.submittedAt || (attempt && (closed || attempt.startedAt.toMillis()<Date.parse(exam.start))));
    const marks=attempt?.submittedAt?await manualMarks(ref,answers,attempt):{};
    const essays=attempt?.submittedAt?Object.entries(answers).filter(([,key])=>key.essay).map(([id,key])=>({
      id,prompt:prompts.get(id),response:attempt.answers[id],rubric:key.rubric,max:key.points,mark:marks[id],number:attempt.number ?? 1
    })):[];
    return {id:entry.id,name:entry.data().name,minutes,submitted,finalized:!!attempt?.submittedAt,canExtend:!!attempt && !attempt.submittedAt,grade:submitted?calculateGrade(answers,attempt.answers,exam.pass,marks):null,essays,
      nextAttempt:(attempt?.number ?? 1)+1,retry:retry.get(entry.id),canRetry:!!attempt?.submittedAt,
      responses:submitted?attempt.answers:null,
      tabExits:tabEvents.size,lastTabExit:Math.max(0,...tabEvents.docs.map(event=>event.data().at.toMillis()))};
  }));
  const submitted=roster.filter(entry=>entry.responses);
  return {entries:roster,questions:Object.entries(answers).filter(([,key])=>!key.essay).map(([id,key],index)=>({
    prompt:prompts.get(id) || 'السؤال '+(index+1),
    correct:submitted.filter(entry=>matchesAnswer(key,entry.responses[id])).length,
    total:submitted.length
  }))};
}
