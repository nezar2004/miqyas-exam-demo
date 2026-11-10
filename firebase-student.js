import {deleteApp, initializeApp} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js';
import {
  browserSessionPersistence, createUserWithEmailAndPassword, getAuth, initializeAuth, inMemoryPersistence, setPersistence,
  signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import {addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, query, runTransaction, serverTimestamp, setDoc, Timestamp, where, writeBatch} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';

const app=initializeApp({
  apiKey:'AIzaSyDi06jtrahqfRYpdRG523x3aJpqkullLsc',
  authDomain:'miqyas-exams.firebaseapp.com',
  projectId:'miqyas-exams',
  appId:'1:130457048809:web:61a59657e3adceec294278'
});
const auth=getAuth(app);
const db=getFirestore(app);
await setPersistence(auth,browserSessionPersistence);
await auth.authStateReady();

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
  const ref=doc(db,'studentProfiles',user.uid);
  const saved=await getDoc(ref);
  return {id:user.uid,email:user.email,name:saved.data()?.name,role:'student'};
}

export async function saveProfile(name) {
  const user=auth.currentUser;
  const cleanName=name.trim();
  if (!user || !cleanName || cleanName.length>100) throw new Error('أدخل اسمًا من 1 إلى 100 حرف.');
  const ref=doc(db,'studentProfiles',user.uid);
  const savedName=await runTransaction(db,async tx=>{
    const saved=await tx.get(ref);
    if (saved.exists()) return saved.data().name;
    tx.set(ref,{name:cleanName,email:user.email,createdAt:serverTimestamp()});
    return cleanName;
  });
  return {id:user.uid,email:user.email,name:savedName,role:'student'};
}

export async function register({name,email,password}) {
  if (!name.trim() || name.trim().length>100 || password.length<12) throw new Error('أدخل اسمك وكلمة مرور من 12 حرفًا على الأقل.');
  await createUserWithEmailAndPassword(auth,email.trim(),password);
  return saveProfile(name);
}

export async function login({email,password},portal) {
  await signInWithEmailAndPassword(auth,email.trim(),password);
  const account=await profile(portal);
  if (!account) {
    await signOut(auth);
    throw new Error({
      admin:'هذا الحساب يحتاج تفعيل صلاحية المدير أولًا.',
      teacher:'هذا الحساب يحتاج تفعيل صلاحية المدرّس أولًا.',
      student:'استخدم بوابة المدرّس أو المدير للدخول بهذا الحساب.'
    }[portal]);
  }
  return account;
}

export function logout() { return signOut(auth); }

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
  return {students:students.sort(byName),teachers:teacherAccounts.sort(byName),admins:adminAccounts.sort(byName)};
}

export async function createTeacher({name,email,password}) {
  const cleanName=name.trim();
  const cleanEmail=email.trim();
  if (!cleanName || cleanName.length>100 || password.length<12 || password.length>128) {
    throw new Error('أدخل اسم المدرّس وكلمة مرور بين 12 و128 حرفًا.');
  }
  const secondary=initializeApp(app.options,'teacher-provisioning');
  try {
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
export async function loadExams(portal) {
  const papers=collection(db,'publishedExams');
  const source=portal==='teacher'?query(papers,where('owner','==',auth.currentUser.uid),limit(100)):query(papers,limit(100));
  const [exams,questions]=await Promise.all([getDocs(source),portal==='teacher'?getDocs(bank()):null]);
  return {
    exams:exams.docs.map(item=>({...item.data(),id:item.id,start:item.data().start.toDate().toISOString()}))
      .sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),
    questions:questions?.docs.map(item=>({...item.data(),id:item.id})) || [],
    results:[],attempts:{}
  };
}
export async function addQuestion(question) {
  await addDoc(bank(),question);
}
export async function publishExam({ids,shuffle,start,...metadata}) {
  const owner=auth.currentUser.uid;
  const exam=doc(collection(db,'publishedExams'));
  const batch=writeBatch(db);
  batch.set(exam,{...metadata,owner,questionCount:ids.length,start:Timestamp.fromDate(new Date(start)),publishedAt:serverTimestamp()});
  batch.set(doc(db,'teacherBanks',owner,'papers',exam.id),{ids,shuffle});
  await batch.commit();
}
