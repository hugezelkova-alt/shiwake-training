// JSDOMでの画面ロジック結合テスト。実ブラウザ / iPhone の描画テストではない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile}from'node:fs/promises';
import {JSDOM}from'jsdom';
import {indexedDB}from'fake-indexeddb';
import {StudyStore}from'../storage.js';

const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI state timeout');};
test('画面結合：10問、電卓転記、複合仕訳、誤答比較、復習、記録、レベル切替、途中再開',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://unit.example/repo/',pretendToBeVisual:true});
  for(const key of ['window','document','navigator','location','localStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true});
  globalThis.indexedDB=indexedDB;
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);
  dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const timers=[];const nativeInterval=globalThis.setInterval;globalThis.setInterval=(fn,t)=>{const id=nativeInterval(fn,t);timers.push(id);id.unref();return id;};
  const realRandom=Math.random;Math.random=()=>0.9999;
  const observer=new StudyStore('/repo/');await observer.open();
  const $=s=>dom.window.document.querySelector(s);
  const click=s=>{const b=$(s);assert.ok(b,`exists: ${s}`);assert.equal(b.disabled,false,`enabled: ${s}`);b.click();};
  const key=k=>click(`[data-key="${k}"]`);
  const fill=async(side,index,account,keys)=>{
    click(`[data-action="account"][data-side="${side}"][data-index="${index}"]`);
    assert.ok($('#account-dialog[open]'));
    // 科目選択中も問題文が表示されている。
    assert.equal($('#account-question').textContent,$('.question-text').textContent);
    const option=[...document.querySelectorAll('[data-account]')].find(b=>b.dataset.account===account);assert.ok(option,account);option.click();
    // 金額入力（電卓表示）中も問題文を固定表示するクラスが付く。
    assert.ok(document.body.classList.contains('answering'));assert.ok(document.body.classList.contains('calc-open'));
    for(const k of keys)key(k);
    click('[data-action="apply-amount"]');
    await wait(()=>$( `[data-row="${side}-${index}"] .amount-button`).textContent!=='金額');
  };
  try{
    await import('../app.js');await wait(()=>!!$('[data-action="start"]'));
    assert.match($('#app').textContent,/仕訳を、反射に/);
    click('[data-action="start"]');await wait(()=>!!$('#answer-editor'));
    assert.match($('.question-text').textContent,/商品100,000円を掛け/);
    click('[data-action="submit"]');await wait(()=>$('#answer-error').textContent.length>0);
    await fill('debit',0,'仕入',['1','00','000']);
    await fill('credit',0,'買掛金',['1','00','000']);
    click('[data-action="submit"]');await wait(()=>!!$('.feedback.correct'));
    assert.equal((await observer.read()).attempts.length,1);
    click('[data-action="next"]');await wait(()=>!!$('#answer-editor'));
    assert.match($('.question-text').textContent,/商品300,000円/);
    // 正答と逆の行順で入力し、複合仕訳が順序非依存であることを実画面ロジックでも確認。
    await fill('debit',0,'売掛金',['2','00','000']);
    click('[data-action="add-row"][data-side="debit"]');
    await fill('debit',1,'現金',['1','00','000']);
    await fill('credit',0,'売上',['3','00','000']);
    click('[data-action="submit"]');await wait(()=>!!$('.feedback.correct'));
    const saved=await observer.read();assert.equal(saved.attempts.length,2);assert.equal(saved.attempts[1].correct,true);
    click('[data-action="next"]');await wait(()=>!!$('#answer-editor'));
    await fill('debit',0,'仕入',['1','2','000','0','*','0','.','7','=']);
    assert.match($('#calc-result').textContent,/84,000/);
    // ＝の後の演算は直前の計算結果を引き継ぐ。
    key('+');key('1');key('000');key('=');assert.match($('#calc-result').textContent,/85,000/);
    click('[data-action="apply-amount"]');
    await fill('credit',0,'買掛金',['8','5','000']);
    click('[data-action="submit"]');await wait(()=>!!$('.feedback.incorrect'));
    assert.ok(!document.body.classList.contains('answering'));
    assert.match($('.feedback').textContent,/あなたの回答/);assert.match($('.feedback').textContent,/正しい仕訳/);
    // 残り7問を「わからない」として記録し、10問で確実に終了する。
    for(let i=3;i<10;i++){click('[data-action="next"]');await wait(()=>!!$('#answer-editor'));click('[data-action="skip"]');await wait(()=>!!$('.feedback.incorrect'));}
    click('[data-action="next"]');await wait(()=>!!$('.summary-card'));
    assert.match($('.big-score').textContent,/2\s*\/\s*10/);
    click('[data-action="finish-review"]');await wait(()=>!!$('[data-mode="mistakes"]'));
    assert.equal(document.querySelectorAll('.question-detail').length,8);
    dom.window.location.hash='stats';await wait(()=>!!$('.stats-table'));assert.match($('.stats-table').textContent,/10/);
    dom.window.location.hash='home';await wait(()=>!!$('[data-action="level"][data-level="zeirishi_boki"]'));
    click('[data-action="level"][data-level="zeirishi_boki"]');await wait(async()=> (await observer.read()).settings.level==='zeirishi_boki');
    click('[data-action="start"]');await wait(()=>!!$('#answer-editor'));assert.match($('.question-text').textContent,/販売委託/);
    click('[data-action="pause"]');await wait(()=>!!$('[data-action="resume"]'));
    click('[data-action="resume"]');await wait(()=>!!$('#answer-editor'));assert.match($('.question-text').textContent,/販売委託/);
    assert.equal((await observer.read()).attempts.length,10);
    // 分野を「構造論点・その他」に絞ると、その分野の問題だけが出題される。
    click('[data-action="pause"]');await wait(()=>!!$('#group'));
    const group=$('#group');group.value='structure';group.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    await wait(async()=> (await observer.read()).settings.group==='structure');
    assert.match($('#app').textContent,/構造論点・その他/);
    click('[data-action="start"]');await wait(()=>$('#confirm-dialog').hasAttribute('open'));click('#confirm-ok');
    await wait(()=>!!$('#answer-editor'));assert.match($('.question-meta').textContent,/構造論点・その他/);
    assert.match($('.question-text').textContent,/将来減算一時差異/);
  }finally{Math.random=realRandom;for(const id of timers)clearInterval(id);globalThis.setInterval=nativeInterval;observer.db.close();dom.window.close();}
});
