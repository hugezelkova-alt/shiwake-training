import test from 'node:test';
import assert from 'node:assert/strict';
import {QUESTIONS,LEVELS} from '../questions.js';
import {validateBank,gradeAnswer,validateAnswer,normalizeSide,evaluateExpression,appendKey,filterLevel,shuffle,questionStats,reviewPool,periodStats,streak,validateBackup} from '../core.js';

test('100問・各50問・ID一意・全正答の貸借一致・計算問題の収録',()=>{
  assert.equal(QUESTIONS.length,100);assert.equal(validateBank(QUESTIONS),true);
  for(const level of Object.keys(LEVELS))assert.equal(filterLevel(QUESTIONS,level).length,50);
  assert.ok(filterLevel(QUESTIONS,'zeirishi_boki').filter(q=>q.requiresCalculation).length>=30);
  assert.ok(new Set(QUESTIONS.map(q=>q.category)).size>=25);
});
test('全100問：複合仕訳の並べ替えを許容し、片側金額の誤りを不正解にする',()=>{
  for(const q of QUESTIONS){
    const answer={debit:[...q.debit].reverse(),credit:[...q.credit].reverse()};
    assert.equal(gradeAnswer(answer,q),true,q.id);
    const wrong=structuredClone(answer);wrong.debit[0].amount++;
    assert.equal(gradeAnswer(wrong,q),false,q.id);
    assert.equal(gradeAnswer({debit:q.credit,credit:q.debit},q),false,q.id);
  }
});
test('同じ側の同一科目は合算。空行を除外。貸借間の相殺は許容しない',()=>{
  const q=QUESTIONS[0];
  assert.equal(gradeAnswer({debit:[{account:'仕入',amount:40000},{account:'仕入',amount:60000},{account:'',amount:''}],credit:q.credit},q),true);
  const gross=QUESTIONS.find(q=>q.id==='B033');
  assert.equal(gradeAnswer({debit:[{account:'繰越商品',amount:10000}],credit:[{account:'仕入',amount:10000}]},gross),false);
  assert.throws(()=>normalizeSide([{account:'現金',amount:-1}]));
  assert.throws(()=>normalizeSide([{account:'現金',amount:0.5}]));
  assert.throws(()=>validateAnswer({debit:[{account:'現金',amount:''}],credit:[]}));
});
test('厳密な同義語。預金と現金、商品と仕入は同一視しない',()=>{
  const q=QUESTIONS.find(q=>q.id==='B032');
  assert.equal(gradeAnswer({debit:q.debit,credit:[{account:' 売上高 ',amount:60000}]},q),true);
  assert.equal(gradeAnswer({debit:[{account:'商品',amount:100000}],credit:QUESTIONS[0].credit},QUESTIONS[0]),false);
});
test('電卓：四則・優先順位・分数・小数・端数処理',()=>{
  for(const [expression,expected] of [['120000*0.7',84000],['(500000-350000)-120000',30000],['1000000*0.03*3/12',7500],['10000-826',9174],['150000*25/125',30000],['980000*0.03-20000',9400],['2+3*4',14],['(2+3)*4',20],['1000/3*3',1000],['0.1+0.2-0.3',0],['1/0.01',100]]){
    const r=evaluateExpression(expression);assert.equal(r.valid,true,expression);assert.equal(r.exact,expected,expression);
  }
  const p=evaluateExpression('10000*900/10900');assert.equal(p.round,826);assert.equal(p.floor,825);assert.equal(p.ceil,826);assert.equal(p.exact,null);
  assert.equal(evaluateExpression('1.5').round,2);assert.equal(evaluateExpression('1.49999').round,1);
});
test('電卓：ゼロ除算・未完成・不正文字列を拒否',()=>{
  for(const s of ['1/0','1+','1..2','alert(1)','2**3','999999999999*10','NaN'])assert.equal(evaluateExpression(s).valid,false,s);
  let s='';for(const k of ['1','2','000','0','*','0','.','7'])s=appendKey(s,k);
  assert.equal(evaluateExpression(s).exact,84000);
  assert.equal(appendKey('2+','*'),'2*');assert.equal(appendKey('2.4','.'),'2.4');assert.equal(appendKey('123','⌫'),'12');assert.equal(appendKey('123','C'),'');
});
const row=(questionId,correct,at,elapsedMs=15000)=>{
  const q=QUESTIONS.find(q=>q.id===questionId);return {id:`${questionId}:${at}`,questionId,level:q.level,category:q.category,correct,at,elapsedMs,answer:{debit:q.debit,credit:q.credit},skipped:false};
};
test('日付境界：当日と直近7暦日、平均時間、連続正解',()=>{
  const now=new Date(2026,8,30,12),today=new Date(2026,8,30,0).getTime(), first=new Date(2026,8,24,0).getTime();
  const a=[row('B001',false,first-1),row('B001',false,first,30000),row('Z012',true,today-1,6000),row('B002',true,today,10000)];
  const s=periodStats(a,now);assert.equal(s.today.count,1);assert.equal(s.week.count,3);assert.equal(s.all.count,4);assert.equal(s.week.average,46/3);assert.equal(streak(a),2);
});
test('誤答は直近の回答で解消。レベル・苦手論点・解答時間で絞り込む',()=>{
  const a=[row('B001',false,1000),row('B001',true,2000),row('Z012',false,3000),row('B017',true,4000,60000)];
  assert.deepEqual(reviewPool(QUESTIONS,a,'mistakes').map(q=>q.id),['Z012']);
  assert.deepEqual(reviewPool(filterLevel(QUESTIONS,'bookkeeping2'),a,'mistakes'),[]);
  assert.ok(reviewPool(QUESTIONS,a,'weak').some(q=>q.id==='B017'));
  assert.ok(reviewPool(QUESTIONS,a,'weak','ポイント制度').every(q=>q.category==='ポイント制度'));
  const q=questionStats(a).get('B001');assert.equal(q.count,2);assert.equal(q.correct,1);assert.equal(q.wrong,1);assert.equal(q.streak,1);
});
test('ランダム10/30の元データ重複なし、レベル混合・配列非破壊',()=>{
  const source=filterLevel(QUESTIONS,'both'), out=shuffle(source);
  assert.equal(source.length,100);assert.equal(out.length,100);assert.equal(new Set(out.slice(0,30).map(q=>q.id)).size,30);assert.equal(source[0].id,'B001');
});
test('バックアップ：通常・スキップの空行・不要な空行・不正入力の検証',()=>{
  const a=row('B001',true,1000);a.answer=structuredClone(a.answer);a.answer.debit.push({account:'',amount:''});
  const skipped={...row('Z012',false,2000),skipped:true,answer:{debit:[{account:'現金',amount:''}],credit:[{account:'',amount:''}]}};
  const data={app:'shiwake-training',version:1,settings:{level:'both',mode:'30'},attempts:[a,skipped]};
  assert.equal(validateBackup(data,QUESTIONS).attempts.length,2);
  assert.equal(validateBackup(data,QUESTIONS).settings.level,'both');
  assert.throws(()=>validateBackup({...data,attempts:[a,a]},QUESTIONS));
  assert.throws(()=>validateBackup({...data,attempts:[{...a,at:NaN}]},QUESTIONS));
  assert.throws(()=>validateBackup({...data,attempts:[{...a,questionId:'unknown'}]},QUESTIONS));
  assert.throws(()=>validateBackup({...data,version:9},QUESTIONS));
});

test('会計計算の独立検算：簿記論の正答金額と式の照合',()=>{
  const checks=[
    ['Z007','debit','契約資産',1000000*(240000/800000)],
    ['Z009','credit','売上',(100-5)*1000],
    ['Z010','debit','返品資産',5*600],
    ['Z012','credit','契約負債',Math.round(10000*900/10900)],
    ['Z013','credit','売上',826*450/900],
    ['Z016','credit','売上',120000*100000/150000],
    ['Z017','debit','繰越商品',200000*700000/1000000],
    ['Z019','debit','商品評価損',90*(1000-900)],
    ['Z023','debit','減損損失',1000000-Math.max(650000,700000)],
    ['Z028','credit','その他有価証券評価差額金',30000*(1-.3)],
    ['Z030','debit','退職給付費用',100000+20000-15000],
    ['Z036','credit','社債',980000*.03-20000],
    ['Z041','debit','のれん',900000-(600000+300000-200000)],
    ['Z043','debit','のれん',800000-(600000+200000)*.8],
    ['Z043','credit','非支配株主持分',(600000+200000)*.2],
    ['Z045','debit','売上原価',150000*25/125],
    ['Z046','credit','繰延内部利益',100000-100000/1.25],
    ['Z050','debit','工事損失引当金繰入',560000-500000]
  ];
  for(const [id,side,account,expected]of checks)assert.equal(QUESTIONS.find(q=>q.id===id)[side].find(r=>r.account===account).amount,expected,id);
});
