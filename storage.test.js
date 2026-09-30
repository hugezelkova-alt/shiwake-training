import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {StudyStore} from '../storage.js';
const memory=new Map();
globalThis.indexedDB=indexedDB;
globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
test('IndexedDB：設定・下書き・採点履歴の永続化、再接続、同一回答の重複防止',async()=>{
  const store=new StudyStore('/test/');await store.open();
  const setting={level:'zeirishi_boki',mode:'30'},session={id:'session',feedback:{correct:true}};
  const attempt={id:'attempt-1',at:1000,questionId:'Z012',correct:true};
  await store.set('settings',setting);await store.record(attempt,session);await store.record(attempt,session);
  store.db.close();const reopened=new StudyStore('/test/');await reopened.open();const state=await reopened.read();
  assert.deepEqual(state.settings,setting);assert.deepEqual(state.session,session);assert.equal(state.attempts.length,1);assert.equal(state.attempts[0].correct,true);
  await reopened.mergeBackup({settings:{level:'both'},attempts:[attempt,{id:'attempt-2',at:2000,correct:false}]});
  const merged=await reopened.read();assert.equal(merged.attempts.length,2);assert.equal(merged.session,null);assert.equal(merged.settings.level,'both');
  const other=new StudyStore('/other/');await other.open();assert.equal((await other.read()).attempts.length,0);other.db.close();reopened.db.close();
});
test('IndexedDBが利用不可の環境はlocalStorage。再起動で同じ保存先を継続',async()=>{
  const normal=globalThis.indexedDB;globalThis.indexedDB={open:()=>{throw new Error('denied');}};
  const store=new StudyStore('/fallback/');await store.open();assert.equal(store.fallback,true);
  await store.set('settings',{level:'both'});await store.record({id:'1',at:1000},{id:'s'});await store.record({id:'1',at:1000},{id:'s'});
  globalThis.indexedDB=normal;
  const reopened=new StudyStore('/fallback/');await reopened.open();const data=await reopened.read();assert.equal(reopened.fallback,true);assert.equal(data.attempts.length,1);assert.equal(data.settings.level,'both');
});
test('トランザクション失敗時は採点履歴と下書きを両方ロールバック',async()=>{
  const store=new StudyStore('/failure/');await store.open();await store.set('session',{original:true});
  await assert.rejects(store.record({/* keyPath idを欠落させる */at:1},{original:false}));
  const data=await store.read();assert.equal(data.attempts.length,0);assert.deepEqual(data.session,{original:true});store.db.close();
});
