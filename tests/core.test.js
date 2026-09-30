import test from 'node:test';
import assert from 'node:assert/strict';
import {QUESTIONS,LEVELS,GROUPS,CATEGORY_GROUPS} from '../questions.js';
import {validateBank,gradeAnswer,validateAnswer,normalizeSide,evaluateExpression,appendKey,filterLevel,filterGroup,shuffle,questionStats,reviewPool,periodStats,streak,validateBackup} from '../core.js';

test('437問（2級70・簿記論367）・ID一意・全正答の貸借一致・計算問題の収録',()=>{
  assert.equal(QUESTIONS.length,437);assert.equal(validateBank(QUESTIONS),true);
  assert.equal(filterLevel(QUESTIONS,'bookkeeping2').length,70);assert.equal(filterLevel(QUESTIONS,'zeirishi_boki').length,367);
  assert.ok(filterLevel(QUESTIONS,'zeirishi_boki').filter(q=>q.requiresCalculation).length>=140);
  assert.ok(new Set(QUESTIONS.map(q=>q.category)).size>=50);
  // 正答の科目を誤答候補（distractors）に含めない。
  for(const q of QUESTIONS)for(const l of [...q.debit,...q.credit])assert.ok(!q.distractors.includes(l.account),`${q.id} ${l.account}`);
});
test('4分野：全論点がいずれかの分野に属し、各分野に簿記論の問題がある',()=>{
  for(const q of QUESTIONS)assert.ok(Object.hasOwn(GROUPS,q.group),`${q.id} ${q.category}`);
  for(const category of Object.keys(CATEGORY_GROUPS))assert.ok(Object.hasOwn(GROUPS,CATEGORY_GROUPS[category]),category);
  const boki=filterLevel(QUESTIONS,'zeirishi_boki');let total=0;
  for(const group of Object.keys(GROUPS)){const n=filterGroup(boki,group).length;assert.ok(n>=40,`${group}: ${n}`);total+=n;}
  assert.equal(total,boki.length);assert.equal(filterGroup(boki,'all').length,boki.length);
  assert.ok(filterGroup(QUESTIONS,'liabilities').every(q=>q.group==='liabilities'));
});
test('全437問：複合仕訳の並べ替えを許容し、片側金額の誤りを不正解にする',()=>{
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
  assert.equal(source.length,437);assert.equal(out.length,437);assert.equal(new Set(out.slice(0,30).map(q=>q.id)).size,30);assert.equal(source[0].id,'B001');
});
test('バックアップ：通常・スキップの空行・不要な空行・不正入力の検証',()=>{
  const a=row('B001',true,1000);a.answer=structuredClone(a.answer);a.answer.debit.push({account:'',amount:''});
  const skipped={...row('Z012',false,2000),skipped:true,answer:{debit:[{account:'現金',amount:''}],credit:[{account:'',amount:''}]}};
  const data={app:'shiwake-training',version:1,settings:{level:'both',mode:'30'},attempts:[a,skipped]};
  assert.equal(validateBackup(data,QUESTIONS).attempts.length,2);
  assert.equal(validateBackup(data,QUESTIONS).settings.level,'both');
  assert.equal(validateBackup(data,QUESTIONS).settings.group,'all');
  for(const mode of ['3','5'])assert.equal(validateBackup({...data,settings:{...data.settings,mode}},QUESTIONS).settings.mode,mode);
  assert.equal(validateBackup({...data,settings:{...data.settings,group:'structure'}},QUESTIONS).settings.group,'structure');
  assert.equal(validateBackup({...data,settings:{...data.settings,group:'unknown'}},QUESTIONS).settings.group,'all');
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
    ['Z050','debit','工事損失引当金繰入',560000-500000],
    // 追加分（2026-09-30.2）
    ['B053','debit','支払手数料',100000*.03],
    ['B059','debit','仕入',200*100+800*110],
    ['B060','credit','為替差損益',800*110-800*105],
    ['B063','debit','固定資産売却損',(600000-360000-60000)-150000],
    ['Z051','debit','リース資産',Math.min(470000,450000)],
    ['Z052','debit','支払利息',400000*.05],
    ['Z052','debit','リース債務',100000-400000*.05],
    ['Z054','debit','売上原価',120000-30000],
    ['Z057','credit','圧縮積立金',300000*(1-.3)],
    ['Z059','debit','ソフトウェア償却',Math.max(900000*1200/3000,900000/3)],
    ['Z061','debit','固定資産売却損',(1000000-600000)-300000],
    ['Z063','debit','減価償却費',2000000*.9*12000/100000],
    ['Z065','debit','減価償却費',216000*.4<1000000*.108?216000*.5:216000*.4],
    ['Z066','debit','減損損失',750000<800000?800000-Math.max(600000,550000):0],
    ['Z067','credit','建物',300000*600000/1000000],
    ['Z070','debit','貸倒引当金繰入',(1000000-400000)*.5],
    ['Z071','debit','貸倒引当金繰入',1000000-Math.round(20000/1.05+1020000/1.05**2)],
    ['Z073','debit','満期保有目的債券',950000*.04-20000],
    ['Z077','debit','関連会社株式評価損',600000-800000*.3],
    ['Z079','credit','有価証券売却益',200*1300-200*(100*1000+300*1200)/400],
    ['Z082','debit','繰延ヘッジ損益',40000*(1-.3)],
    ['Z084','debit','前払費用',(145-142)*1000],
    ['Z085','debit','その他有価証券',5200*115-5000*110],
    ['Z086','credit','売上',1000*120+2000*125],
    ['Z090','credit','利益準備金',Math.min(1000000/10,10000000/4-(1500000+800000))],
    ['Z095','debit','株式報酬費用',2000*500/2],
    ['Z097','debit','法人税等調整額',200000*(.30-.28)],
    ['Z106','credit','売上',450000+100000*450000/900000],
    ['Z107','debit','契約資産',1000000*560000/800000-300000],
    ['Z121','debit','非支配株主持分',20000*.2],
    ['Z124','credit','評価差額',(400000-300000)*(1-.3)],
    ['Z125','credit','負ののれん発生益',(700000-100000)-500000],
    ['Z126','debit','のれん',700000-(1000000-400000)],
    // 追加分（2026-09-30.3）
    ['Z131','debit','当座預金',83000-38000],
    ['Z132','debit','不渡手形',200000+1000+500],
    ['Z138','credit','受取利息',1000000*.03*6/12],
    ['Z140','debit','商品評価損',250000*(720000/(900000+100000-200000))-250000*(720000/(900000+100000))],
    ['Z150','debit','機械装置',500000-300000],
    ['Z156','debit','前払利息',500000-480000],
    ['Z161','debit','創立費償却',600000/60*6],
    ['Z166','debit','貸倒引当金繰入',2000000*((1.2+1.5+1.8)/3/100)-10000],
    ['Z167','debit','満期保有目的債券',(2000000-1940000)/5*9/12],
    ['Z168','credit','有価証券売却益',1000000*99/100-985000],
    ['Z172','debit','支払利息',30000-5000],
    ['Z175','debit','貸付金',(1000000-970000)/3],
    ['Z177','debit','為替差損益',220000-2000*108],
    ['Z178','credit','有価証券利息',100*112],
    ['Z178','credit','為替差損益',9800*115-(1067000+100*112)],
    ['Z180','debit','為替予約',(143-140)*1000],
    ['Z182','debit','為替差損益',3000*2/3],
    ['Z183','debit','社債利息',(1000000-970000)/5],
    ['Z184','credit','社債償還益',392000-400000*97/100],
    ['Z185','debit','社債利息',1000000*.02*6/12],
    ['Z189','credit','その他資本剰余金',1000000*.4-350000],
    ['Z190','credit','その他資本剰余金',270000+30000-250000],
    ['Z192','debit','株式報酬費用',1000*400-1000*500/2],
    ['Z196','debit','繰延税金資産',300000*.3],
    ['Z199','debit','普通預金',10000-Math.floor(10000*.15315)],
    ['Z203','debit','売掛金',60000+40000],
    ['Z205','credit','契約負債',360000-360000/3],
    ['Z207','credit','売上',1000*400/800-300],
    ['Z222','debit','資本剰余金',120000-1000000*.1],
    ['Z224','debit','売上高',10000*.3],
    ['Z228','credit','移転損益',350000-(400000-100000)],
    ['Z229','debit','子会社株式',400000-100000],
    // 追加分（2026-09-30.4）
    ['Z231','credit','非支配株主持分',11000*.2],
    ['Z232','debit','のれん償却',10*105],
    ['Z233','debit','のれん',90*110-(100*100-10*105)],
    ['Z234','debit','受取配当金',100*108*.8],
    ['Z235','debit','子会社株式評価損',10000*100-4000*110],
    ['Z236','credit','その他有価証券評価差額金',(1050-1000)*110],
    ['Z236','credit','為替差損益',1000*(110-100)],
    ['Z238','debit','投資有価証券',40000*.3],
    ['Z239','credit','退職給付に係る調整額',5000*(1-.3)],
    ['Z240','debit','非支配株主持分',20000*(1-.3)*.2],
    ['Z241','credit','繰延税金負債',2000*.3],
    ['Z242','credit','減価償却費',50000/5],
    ['Z243','debit','利益剰余金',20000-20000*.3],
    ['Z244','credit','完成工事高',1000000*540000/900000-300000],
    ['Z245','debit','工事損失引当金繰入',(1100000-1000000)-(660000-600000)],
    ['Z248','credit','完成工事高',(1000000+100000)*.3],
    ['Z251','debit','退職給付費用',(15000-10000)/10],
    ['Z252','debit','繰延税金資産',400000*.3],
    ['Z253','debit','その他有価証券評価差額金',(200000-150000)*(1-.3)],
    ['Z256','credit','長期前受収益',1000000-(1200000-400000)],
    ['Z257','debit','繰延税金負債',210000/(1-.3)/10*.3],
    // 追加分（2026-09-30.5）
    ['Z259','credit','抱合せ株式消滅差益',(800000-300000)-400000],
    ['Z263','credit','建物',150000-100000],
    ['Z266','credit','自己新株予約権消却益',30000-25000],
    ['Z267','debit','仕入',500000-100000],
    ['Z268','debit','売上原価',10*1000+5*1100],
    ['Z269','debit','売上原価',20*(10*1000+30*1200)/40],
    ['Z270','debit','のれん',480000-(400000+200000+100000)*.6],
    ['Z270','credit','非支配株主持分',(400000+200000+100000)*.4],
    ['Z271','credit','負ののれん発生益',(400000+200000)-500000],
    ['Z272','debit','非支配株主持分',50000*.3],
    ['Z274','debit','売上原価',240000*.25],
    ['Z277','debit','持分法による投資損益',80000*.25],
    ['Z280','credit','特別償却準備金',100000*(1-.3)],
    ['Z281','debit','繰延税金資産',(400000-300000)*.3],
    ['Z283','credit','契約負債',Math.round(20000*2000/22000)],
    ['Z286','credit','売上',90000*(50000+30000)/100000],
    ['Z287','credit','返金負債',300000*.04],
    ['Z288','debit','割賦売掛金',220000*.1],
    ['Z290','debit','社債利息',961000*.03],
    ['Z291','credit','満期保有目的債券',20000-1020000*.01],
    ['Z293','debit','仮払法人税等',Math.floor(100000*.15315)],
    ['Z294','debit','満期保有目的債券',(1000000-976000)/4*4/12],
    ['Z298','credit','買掛金',1500*125],
    ['Z300','debit','減価償却費',900000/6*9/12],
    ['Z301','debit','減価償却費',(1000000-250000)*.25],
    ['Z302','credit','固定資産売却益',250000-(800000-600000)],
    ['Z303','debit','減損損失',1500000-Math.max(1000000,1050000)],
    ['Z304','credit','普通預金',200000],
    ['Z304','debit','リース債務',200000-800000*.04],
    ['Z305','credit','利益準備金',Math.min(600000/10,8000000/4-(1600000+350000))],
    ['Z307','credit','その他資本剰余金',150*650-150*(100*500+100*700)/200],
    // 追加分（2026-09-30.6）
    ['Z309','debit','繰越商品',400000*1200000/1600000],
    ['Z310','debit','商品評価損',190*(500-450)],
    ['Z311','debit','商品',70000+30000],
    ['Z314','debit','売掛金',300000-30000-6000],
    ['Z317','debit','減価償却費',600000*.9/8],
    ['Z319','debit','前払リース料',120000*9/12],
    ['Z320','debit','ソフトウェア償却',480000/60*7],
    ['Z321','debit','のれん償却',240000/20*6/12],
    ['Z322','debit','固定資産除却損',600000-400000-50000],
    ['Z323','debit','建物',500000*(8-5)/8],
    ['Z324','debit','満期保有目的債券',945000*.05-30000],
    ['Z326','debit','売買目的有価証券',(230000-200000)+(130000-150000)],
    ['Z330','credit','先物損益',22000-15000],
    ['Z331','credit','繰延ヘッジ損益',50000*(1-.3)],
    ['Z333','debit','為替差損益',1500*115-165000],
    ['Z334','debit','売掛金',2000*134-260000],
    ['Z335','credit','売掛金',(130-126)*1000],
    ['Z336','credit','為替予約',(143-140)*1000],
    ['Z337','debit','外貨預金',5000*112-550000],
    ['Z338','debit','社債償還損',500000*99/100-494000],
    ['Z341','credit','利益準備金',700000/10],
    ['Z341','credit','資本準備金',300000/10],
    ['Z344','debit','株式交付費償却',36000/36*9],
    ['Z347','credit','未払法人税等',500000-(200000+15315)],
    ['Z350','debit','繰延税金負債',100000*(.30-.28)],
    ['Z352','credit','売上',240000*9/12],
    ['Z353','debit','契約負債',Math.round(1818*500/2000)],
    ['Z356','debit','売上原価',(200-10)*1200],
    ['Z358','debit','のれん',700000-(500000+300000)*.7],
    ['Z361','debit','売上原価',144000*20/120],
    ['Z363','debit','利益剰余金',30000*.8],
    ['Z364','debit','投資有価証券',300000*.35]
  ];
  for(const [id,side,account,expected]of checks)assert.equal(QUESTIONS.find(q=>q.id===id)[side].find(r=>r.account===account).amount,Math.round(expected*1e6)/1e6,id);
});
