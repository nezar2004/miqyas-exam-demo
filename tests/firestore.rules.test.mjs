import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-miqyas-rules';
const teacher = 'instructor';
const student = 'student';
const sections = ['Section0000000000001', 'Section0000000000002', 'Section0000000000003'];
const email = uid => uid + '@ses.yu.edu.jo';
const timestamp = minutes => Timestamp.fromMillis(Date.now() + minutes * 60000);
const attemptPath = (uid, id) => 'studentProfiles/' + uid + '/attempts/' + id;
const blankAttempt = () => ({startedAt:serverTimestamp(), answers:{}, review:{}, submittedAt:null});
const content = {questions:[{id:'q',prompt:'Sample question',options:['A','B'],points:2}],shuffle:false};
const key = {answers:{q:{correct:0,points:2}}};
let env;

function as(uid, claims = {}) {
  return env.authenticatedContext(uid,{email:email(uid),email_verified:true,...claims}).firestore();
}
function exam(start, classIds = [sections[0]], owner = teacher) {
  return {owner,title:'Sample exam',section:'Sample section',classIds,start:timestamp(start),
    duration:5,pass:50,questionCount:1,publishedAt:serverTimestamp(),ready:true};
}
async function seed(entries) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path,data] of entries) batch.set(doc(db,path),data);
    await batch.commit();
  });
}

before(async () => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
    throw new Error('Run npm run test:rules to start the local Firestore emulator.');
  }
  env = await initializeTestEnvironment({projectId,firestore:{
    rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')
  }});
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed([
    ['teacherRoles/'+teacher,{name:'Instructor',email:'teacher@example.test'}],
    ['studentProfiles/'+student,{name:'Student',email:email(student),createdAt:timestamp(-60)}],
    ...sections.map(id => ['classes/'+id,{owner:teacher,name:id===sections[0]?'Sample section':id,subject:'Sample'}]),
    ['classes/'+sections[0]+'/members/'+student,{name:'Student'}]
  ]);
});

test('submitted student can read the key only after their extended deadline', async () => {
  await seed([-1,-6,-12].flatMap((start,index) => {
    const id = 'key'+index;
    return [['publishedExams/'+id,exam(start)],['examKeys/'+id,key],
      ['publishedExams/'+id+'/extensions/'+student,{minutes:5}],
      [attemptPath(student,id),{...blankAttempt(),startedAt:timestamp(start),submittedAt:timestamp(start+0.5)}]];
  }));
  const db = as(student);
  await assertFails(getDocFromServer(doc(db,'examKeys/key0')));
  await assertFails(getDocFromServer(doc(db,'examKeys/key1')));
  assert.deepEqual((await assertSucceeds(getDocFromServer(doc(db,'examKeys/key2')))).data(),key);
});

test('questions are unavailable before opening and after closing without submission', async () => {
  await seed([['publishedExams/future',exam(10)],['examContent/future',content],
    ['publishedExams/past',exam(-10)],['examContent/past',content]]);
  const db = as(student);
  await assertFails(getDocFromServer(doc(db,'examContent/future')));
  await assertFails(getDocFromServer(doc(db,'examContent/past')));
});

test('student outside the target section cannot read or start an exam', async () => {
  await seed([['publishedExams/other',exam(-1,[sections[1]])],['examContent/other',content]]);
  const db = as(student);
  await assertFails(getDocFromServer(doc(db,'publishedExams/other')));
  await assertFails(getDocFromServer(doc(db,'examContent/other')));
  await assertFails(setDoc(doc(db,attemptPath(student,'other')),blankAttempt()));
});

test('profile creation requires a verified university email', async () => {
  for (const [uid,address,verified] of [['external','outside@example.test',true],['unverified',email('unverified'),false]]) {
    const db = as(uid,{email:address,email_verified:verified});
    await assertFails(setDoc(doc(db,'studentProfiles/'+uid),{name:'Student',email:address,createdAt:serverTimestamp()}));
  }
  await assertSucceeds(setDoc(doc(as('verified'),'studentProfiles/verified'),
    {name:'Student',email:email('verified'),createdAt:serverTimestamp()}));
});

test('student cannot write audit entries, change marks, or edit protected profile fields', async () => {
  const path = attemptPath(student,'active');
  await seed([['publishedExams/active',exam(-1)],[path,{...blankAttempt(),startedAt:timestamp(-0.5)}]]);
  const db = as(student);
  await assertFails(setDoc(doc(db,'auditLog/student-event'),{actor:student,at:serverTimestamp(),action:'publish',target:'active'}));
  await assertFails(updateDoc(doc(db,path),{grade:100}));
  await assertFails(updateDoc(doc(db,'studentProfiles/'+student),{email:email('changed')}));
  await assertSucceeds(updateDoc(doc(db,'studentProfiles/'+student),{name:'Updated Name'}));
});

test('instructor cannot edit or delete another instructor’s exam or section', async () => {
  const uid = 'other-instructor';
  await seed([['teacherRoles/'+uid,{name:'Other Instructor',email:'other@example.test'}],
    ['publishedExams/owned',exam(10)]]);
  const db = as(uid);
  for (const [path,patch] of [['publishedExams/owned',{title:'Changed exam'}],['classes/'+sections[0],{name:'Changed section'}]]) {
    await assertFails(updateDoc(doc(db,path),patch));
    await assertFails(deleteDoc(doc(db,path)));
  }
});

test('student in the third section can read questions during extra time', async () => {
  await env.withSecurityRulesDisabled(context =>
    deleteDoc(doc(context.firestore(),'classes/'+sections[0]+'/members/'+student)));
  await seed([['classes/'+sections[2]+'/members/'+student,{name:'Student'}],
    ['publishedExams/extended',exam(-6,sections)],['examContent/extended',content],
    ['publishedExams/extended/extensions/'+student,{minutes:10}]]);
  const db = as(student);
  assert.equal((await assertSucceeds(getDocFromServer(doc(db,'examContent/extended')))).data().questions.length,1);
});

test('disabled student and instructor lose exam and question bank access', async () => {
  await seed([['publishedExams/active',exam(-1)],['examContent/active',content],
    ['studentProfiles/'+student,{name:'Student',email:email(student),disabled:true}],
    ['teacherRoles/'+teacher,{name:'Instructor',email:'teacher@example.test',disabled:true}],
    ['teacherBanks/'+teacher+'/questions/q',{prompt:'Sample',options:['A','B'],correct:0,points:2}]]);
  await assertFails(getDocFromServer(doc(as(student),'examContent/active')));
  await assertFails(setDoc(doc(as(student),attemptPath(student,'active')),blankAttempt()));
  await assertFails(getDocFromServer(doc(as(teacher),'teacherBanks/'+teacher+'/questions/q')));
});

test('only a current invite permits joining, and memberships are removed together', async () => {
  const section=sections[1];
  const member='classes/'+section+'/members/'+student;
  const membership='studentProfiles/'+student+'/classes/'+section;
  const code='Invite00000000000001';
  const invite='classes/'+section+'/invites/'+code;
  const db=as(student);
  const staff=as(teacher);
  const join=()=>{
    const batch=writeBatch(db);
    batch.set(doc(db,member),{name:'Student',code});
    batch.set(doc(db,membership),{});
    return batch.commit();
  };
  await seed([[invite,{expiresAt:timestamp(-1)}]]);
  await assertFails(join());
  await assertSucceeds(deleteDoc(doc(staff,invite)));
  await assertFails(join());
  await assertSucceeds(setDoc(doc(staff,invite),{expiresAt:timestamp(10)}));
  await assertSucceeds(join());
  await assertFails(deleteDoc(doc(db,membership)));
  const leave=writeBatch(db);
  leave.delete(doc(db,membership));
  leave.delete(doc(db,member));
  await assertSucceeds(leave.commit());
  await assertSucceeds(join());
  const removal=writeBatch(staff);
  removal.delete(doc(staff,member));
  removal.delete(doc(staff,membership));
  await assertSucceeds(removal.commit());
  await assertSucceeds(updateDoc(doc(staff,'classes/'+section),{archived:true}));
  await assertFails(join());
});

test('tab exits use one immutable document per minute', async () => {
  const path=attemptPath(student,'active');
  await seed([['publishedExams/active',exam(-1)],[path,{...blankAttempt(),startedAt:timestamp(-0.5)}]]);
  const db=as(student);
  await assertFails(setDoc(doc(db,path+'/tabEvents/arbitrary'),{at:serverTimestamp()}));
  const event=doc(db,path+'/tabEvents/'+Math.floor(Date.now()/60000));
  await assertSucceeds(setDoc(event,{at:serverTimestamp()}));
  await assertFails(setDoc(event,{at:serverTimestamp()}));
});

test('essay grades are bounded and readable by the student only after results open', async () => {
  const path=attemptPath(student,'essay');
  const markPath=path+'/manualGrades/q';
  await seed([['publishedExams/essay',exam(-1)],['examKeys/essay',{answers:{q:{essay:true,points:3,rubric:'Explain'}}}],
    [path,{startedAt:timestamp(-0.5),submittedAt:timestamp(-0.1),answers:{q:'Response'},review:{}}]]);
  const staff=as(teacher);
  const learner=as(student);
  const mark={number:1,points:2,comment:'Good explanation'};
  await assertFails(setDoc(doc(learner,markPath),mark));
  await assertFails(setDoc(doc(staff,markPath),{...mark,points:4}));
  await assertSucceeds(setDoc(doc(staff,markPath),mark));
  await assertFails(getDocFromServer(doc(learner,markPath)));
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'publishedExams/essay'),{start:timestamp(-10)}));
  assert.deepEqual((await assertSucceeds(getDocFromServer(doc(learner,markPath)))).data(),mark);
});

test('instructor publishes, student starts and submits, and score inputs unlock after closing', async () => {
  const staff = as(teacher);
  const batch = writeBatch(staff);
  batch.set(doc(staff,'publishedExams/workflow'),{...exam(-1),examClosesAt:timestamp(10),maxAttempts:2,resultMode:'manual'});
  batch.set(doc(staff,'teacherBanks/'+teacher+'/papers/workflow'),{ids:['q'],shuffle:false});
  batch.set(doc(staff,'examContent/workflow'),content);
  batch.set(doc(staff,'examKeys/workflow'),key);
  batch.set(doc(staff,'classes/'+sections[0]+'/exams/workflow'),{});
  await assertSucceeds(batch.commit());

  const db = as(student);
  await assertFails(getDocFromServer(doc(db,'examContent/workflow')));
  const attempt = doc(db,attemptPath(student,'workflow'));
  const start = writeBatch(db);
  start.set(attempt,blankAttempt());
  start.set(doc(db,'publishedExams/workflow/participants/'+student),{name:'Student'});
  await assertSucceeds(start.commit());
  await assertSucceeds(getDocFromServer(doc(db,'examContent/workflow')));
  await assertSucceeds(updateDoc(attempt,{'answers.q':0}));
  await assertSucceeds(updateDoc(attempt,{submittedAt:serverTimestamp()}));
  const answerKey = doc(db,'examKeys/workflow');
  await assertFails(getDocFromServer(answerKey));
  const retry=doc(staff,'publishedExams/workflow/retries/'+student);
  await assertSucceeds(setDoc(retry,{number:2}));
  const restart=writeBatch(db);
  restart.set(doc(attempt,'history','1'),(await getDocFromServer(attempt)).data());
  restart.set(attempt,{...blankAttempt(),number:2});
  await assertSucceeds(restart.commit());
  await assertSucceeds(updateDoc(attempt,{'answers.q':0}));
  await assertSucceeds(updateDoc(attempt,{submittedAt:serverTimestamp()}));
  await assertFails(setDoc(retry,{number:3}));

  // Move only the fixture's start time so the test does not wait five minutes.
  await env.withSecurityRulesDisabled(context =>
    updateDoc(doc(context.firestore(),'publishedExams/workflow'),{start:timestamp(-10),examClosesAt:timestamp(-1)}));
  await assertFails(getDocFromServer(answerKey));
  await assertSucceeds(updateDoc(doc(staff,'publishedExams/workflow'),{resultsReleased:true}));
  const answers = (await assertSucceeds(getDocFromServer(attempt))).data().answers;
  const expected = (await assertSucceeds(getDocFromServer(answerKey))).data().answers;
  assert.equal(answers.q === expected.q.correct ? expected.q.points : 0,2);
});
