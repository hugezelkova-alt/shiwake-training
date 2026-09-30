import { QUESTIONS, LEVELS, ALL_ACCOUNTS, COMMON_ACCOUNTS, BANK_VERSION } from './questions.js';
import { gradeAnswer, validateAnswer, validateBank, filterLevel, shuffle, localDateKey, summarize, streak, periodStats, groupStats, questionStats, reviewPool, evaluateExpression, appendKey, validateBackup } from './core.js';
import { StudyStore } from './storage.js';

const $ = selector => document.querySelector(selector);
const app=$('#app'), dock=$('#training-dock');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number(n).toLocaleString('ja-JP');
const rate=s=>s.rate===null?'—':`${Math.round(s.rate*100)}%`;
const seconds=n=>n===null?'—':`${Math.round(n*10)/10}秒`;
const levelName=level=>level==='both'?'両方から出題':LEVELS[level]||level;
const modeNames={'10':'ランダム10問','30':'ランダム30問',endless:'エンドレス',mistakes:'間違えた問題だけ',weak:'苦手論点だけ'};
const bank=new Map(QUESTIONS.map(q=>[q.id,q]));
const scope=new URL('.',location.href).pathname;
const store=new StudyStore(scope);
const draftKey=`shiwake-draft:${scope}`;
let settings={level:'bookkeeping2',mode:'10'}, attempts=[], session=null, route='home', ready=false;
let runningSince=0, persistChain=Promise.resolve(), busy=false, saveFailed=false;
let calc={expression:'',target:null,rounding:'exact',open:false,justEvaluated:false};
let accountTarget=null,showAllAccounts=false,swRegistration=null,offlineReady=false;

function toast(message) { const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.hidden=true,3300); }
function saveError(error) {
  console.error(error);saveFailed=true;
  const el=$('#storage-warning');el.textContent='端末に保存できませんでした。空き容量・ブラウザ設定を確認し、再試行してください。';el.hidden=false;
}
function queued(work) {
  const result=persistChain.then(work);
  persistChain=result.catch(()=>{});
  return result;
}
const copy=value=>JSON.parse(JSON.stringify(value));
function snapshotSession() { return session?copy(session):null; }
function stashDraft() {
  try { if(session)localStorage.setItem(draftKey,JSON.stringify(session));else localStorage.removeItem(draftKey); } catch { /* IndexedDBでの保存を継続 */ }
}
function saveSession() {
  if(!ready)return Promise.resolve();
  if(session)session.savedAt=Date.now();
  stashDraft(); const snapshot=snapshotSession();
  return queued(()=>store.set('session',snapshot));
}
function saveSettings() {const value=copy(settings);return queued(()=>store.set('settings',value));}
function current() { return session?bank.get(session.queue[session.index]):null; }
function isAnswering() {return route==='train'&&session&&!session.feedback&&!busy;}
function tick() {
  if(!runningSince)return;
  const now=Date.now();
  session.elapsedMs+=Math.max(0,Math.min(now-runningSince,60000));runningSince=now;
}
function pauseTimer() {tick();runningSince=0;}
function startTimer() {if(isAnswering()&&!document.hidden)runningSince=Date.now();}
function timerValue() {return Math.floor(((session?.elapsedMs||0)+(runningSince?Math.max(0,Date.now()-runningSince):0))/1000);}
function drawTimer(){const el=$('#question-timer');if(el)el.textContent=`${timerValue()}秒`;}
function navigate(to){if(location.hash===`#${to}`)renderRoute();else location.hash=to;}
function confirmAction(title,body,label='続ける') {
  return new Promise(resolve=>{
    const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-body').textContent=body;$('#confirm-ok').textContent=label;
    const finish=value=>{dialog.close();$('#confirm-ok').onclick=null;$('#confirm-cancel').onclick=null;dialog.oncancel=null;resolve(value);};
    $('#confirm-ok').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();
  });
}
function levelsMarkup(selected) {return [...Object.keys(LEVELS),'both'].map(l=>`<option value="${esc(l)}" ${l===selected?'selected':''}>${esc(levelName(l))}</option>`).join('');}
function levelPicker(){return `<div class="level-tabs" role="group" aria-label="出題レベル">${[...Object.keys(LEVELS),'both'].map(l=>`<button data-action="level" data-level="${esc(l)}" aria-pressed="${settings.level===l}">${l==='both'?'両方':esc(levelName(l))}</button>`).join('')}</div>`;}
function header(kicker,title,description='') {return `<div class="page-heading"><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1>${description?`<p class="muted">${esc(description)}</p>`:''}</div>`;}
function metric(label,value,unit=''){return `<div class="metric"><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`;}
function home() {
  const stats=periodStats(attempts), selected=filterLevel(QUESTIONS,settings.level);
  app.innerHTML=header('DAILY PRACTICE','仕訳を、反射に。','1問ずつ。考えて、打って、身につける。')+
    `<section class="card training-start"><div class="section-title"><h2>今日のトレーニング</h2><span class="pill">全${QUESTIONS.length}問</span></div>
    <label class="small muted">現在の出題レベル</label>${levelPicker()}
    <div class="mode-row"><label for="mode">出題モード</label><select id="mode">${Object.entries(modeNames).map(([v,n])=>`<option value="${v}" ${settings.mode===v?'selected':''}>${n}</option>`).join('')}</select></div>
    <button class="primary start-button" data-action="start">トレーニング開始 <span aria-hidden="true">→</span></button>
    ${session?`<button class="secondary full" data-action="resume">前回の続きから再開 <small>(${session.results.length}問回答済み)</small></button>`:''}
    <p class="small muted center">${esc(levelName(settings.level))} · ${selected.length}問収録 · 電卓付き</p></section>
    <section class="today-block"><div class="section-title"><h2>今日の積み上げ</h2><span class="small muted">${new Date().toLocaleDateString('ja-JP',{month:'long',day:'numeric'})}</span></div>
    <div class="metrics today-metrics">${metric('回答数',num(stats.today.count),'問')}${metric('正答率',rate(stats.today))}${metric('連続正解',num(streak(attempts)),'問')}</div></section>
    <div class="link-grid"><button class="link-card" data-action="review"><span class="link-symbol">↻</span><strong>間違えた問題</strong><small>今の弱点を、次の得点に</small><span class="arrow">→</span></button><button class="link-card" data-action="stats"><span class="link-symbol">▤</span><strong>学習記録</strong><small>正答率と解答スピード</small><span class="arrow">→</span></button></div>
    <div class="lifetime"><span>累計 <strong>${num(stats.all.count)}</strong> 問</span><span>累計正答率 <strong>${rate(stats.all)}</strong></span></div>
    <p class="small muted center">集計は両レベル合計。連続正解は直近の回答から計算。</p>
    <button class="text-button full" data-action="help">使い方・オフライン準備・バックアップ</button>`;
}
function review() {
  const selected=filterLevel(QUESTIONS,settings.level), stats=questionStats(attempts);
  const mistakes=reviewPool(selected,attempts,'mistakes'), weak=reviewPool(selected,attempts,'weak');
  const ids=new Set(selected.map(q=>q.id));
  const cats=groupStats(attempts.filter(a=>ids.has(a.questionId)),'category');
  app.innerHTML=header('REVIEW','弱点を、ひとつずつ。')+levelPicker()+
    `<div class="review-cards"><section class="card"><div class="section-title"><h2>間違えた問題</h2><span class="pill">${mistakes.length}問</span></div><p class="muted small">直近の回答が不正解の問題。正解すると外れます。</p><button class="primary full" data-action="start-mode" data-mode="mistakes" ${mistakes.length?'':'disabled'}>間違えた問題だけ</button></section>
    <section class="card"><div class="section-title"><h2>苦手論点</h2><span class="pill">${weak.length}問</span></div><p class="muted small">正答率・直近の誤答・回答時間から自動抽出。</p><button class="secondary full" data-action="start-mode" data-mode="weak" ${weak.length?'':'disabled'}>苦手論点だけ</button></section></div>
    <section class="card"><h2>論点別の状態</h2>${cats.length?cats.map(c=>`<div class="category-row"><div><strong>${esc(c.name)}</strong><small>${c.count}問 · 平均${seconds(c.average)}</small></div><span class="${c.rate<.8?'low-rate':''}">${rate(c)}</span>${weak.some(q=>q.category===c.name)?`<button class="text-button" data-action="weak-category" data-category="${esc(c.name)}">練習</button>`:'<span class="small muted">良好</span>'}</div>`).join(''):'<p class="empty">まずは10問。回答すると、苦手論点が見えてきます。</p>'}</section>
    ${mistakes.length?`<section class="card"><h2>復習リスト</h2>${mistakes.map(q=>{const s=stats.get(q.id);return `<details class="question-detail"><summary><span>${esc(q.category)} <small>${q.id}</small></span><small>${s.correct}/${s.count}正解 · 平均${seconds(s.average)}</small></summary><p>${esc(q.prompt)}</p></details>`;}).join('')}</section>`:''}
    <details class="rules"><summary>苦手判定の基準</summary><p>同じレベル範囲の論点正答率80％未満、または論点の平均30秒超を対象にします。さらに、直近で誤答した問題、2回答以上で正答率80％未満の問題、平均30秒超（計算問題45秒超）の問題も含みます。論点が苦手なら、その論点の未回答問題も出題します。</p></details>`;
}
function statsScreen() {
  const ps=periodStats(attempts), groups=groupStats(attempts,'category');
  const perQuestion=questionStats(attempts);
  app.innerHTML=header('YOUR RECORD','積み重ねを、見える化。','端末内に保存されている全回答の記録。')+
    `<section class="card"><table class="stats-table"><caption class="sr-only">期間別学習記録</caption><thead><tr><th>期間</th><th>回答数</th><th>正答率</th><th>平均時間</th></tr></thead><tbody>${[['今日',ps.today],['直近7日',ps.week],['累計',ps.all]].map(([name,s])=>`<tr><th>${name}</th><td>${num(s.count)}</td><td>${rate(s)}</td><td>${seconds(s.average)}</td></tr>`).join('')}</tbody></table><p class="small muted">直近7日は今日を含む7日間。日付は端末の現地時間です。</p></section>
    <section class="card"><h2>レベル別</h2>${Object.entries(LEVELS).map(([key,name])=>{const s=summarize(attempts.filter(a=>a.level===key));return `<div class="category-row"><div><strong>${name}</strong><small>${num(s.count)}問 · 平均${seconds(s.average)}</small></div><strong>${rate(s)}</strong></div>`;}).join('')}</section>
    <section class="card"><h2>カテゴリー別 <small class="muted">正答率の低い順</small></h2>${groups.length?groups.map(g=>`<div class="category-row"><div><strong>${esc(g.name)}</strong><small>${g.count}問 · 平均${seconds(g.average)}</small></div><strong class="${g.rate<.8?'low-rate':''}">${rate(g)}</strong></div>`).join(''):'<p class="empty">まだ回答がありません。</p>'}</section>
    <section class="card"><details><summary>各問題の記録 <span class="muted">${perQuestion.size}問</span></summary>${[...perQuestion].map(([id,s])=>`<div class="question-record"><strong>${id} · ${esc(bank.get(id)?.category||'')}</strong><p>${s.count}回 / 正解${s.correct} / 不正解${s.wrong} / ${rate(s)}<br>平均${seconds(s.average)} · 連続正解${s.streak}<br>最終：${new Date(s.last.at).toLocaleString('ja-JP')}</p></div>`).join('')||'<p class="empty">まだ回答がありません。</p>'}</details></section>
    <button class="text-button full" data-action="help">学習データのバックアップ・復元</button>`;
}
function help() {
  app.innerHTML=header('GUIDE','使い方とデータ管理')+
    `<section class="card"><h2>1問ずつ、高速に</h2><ol class="steps"><li>レベルとモードを選び、開始。</li><li>借方・貸方の科目を候補から選択。</li><li>金額欄をタップし、下の電卓で入力。</li><li>「金額に反映」で転記し、「回答する」。</li><li>短い解説を確認して、次へ。</li></ol><p class="small muted">通常問題は10〜30秒が目安。計算問題は正確さを優先しましょう。アプリを離れている間は計測を止めます。</p></section>
    <section class="card"><h2>iPhoneでアプリにする</h2><ol class="steps"><li>公開URLをSafariで開く。</li><li>上部が「オフライン準備完了」になるのを待つ。</li><li>共有 → ホーム画面に追加 → 追加。表示される場合は「ウェブアプリとして開く」をオン。</li><li>ホーム画面のアイコンからオンラインで一度起動し、準備完了を確認。</li><li>機内モードにしてアプリを閉じ、アイコンから再起動。</li></ol><p class="small muted">保存領域がSafariとホーム画面アプリで分かれる場合があります。以後はホーム画面側に統一して学習してください。</p><p id="offline-detail" class="small">${offlineReady?'すべての学習ファイルを保存済みです。':'通信できる状態で、画面上部の準備完了を確認してください。'}</p><button class="secondary full" data-action="check-update">オフライン準備・更新を確認</button></section>
    <section class="card"><h2>学習データのバックアップ</h2><p>履歴はこの端末に保存されます。機種変更やSafariのデータ削除に備え、定期的に書き出してください。</p><button class="primary full" data-action="export">履歴をJSONで書き出す</button><label class="secondary full file-label">バックアップを読み込む<input id="import-file" type="file" accept=".json,application/json"></label><p class="small muted">読み込みは既存履歴に統合し、同じ回答は重複させません。選択レベルはバックアップの設定になり、回答途中の問題は終了します。バックアップは公開用リポジトリに入れないでください。</p></section>
    <section class="card"><h2>出題・採点の約束</h2><p>金額の単位は円。消費税は指定された問題だけで考慮します。指定された処理方法と科目で回答してください。</p><p>複合仕訳は行の順序を問いません。同じ側の同一科目は合算して採点します。借方と貸方の相殺はしません。</p><p>「わからない」は誤答として記録。「間違えた問題」は、その後に正解すると一覧から外れます。出題済み100問は試験範囲の一部です。</p><p class="small muted">問題データ ${BANK_VERSION} · アプリ 1.0.1<br>端末の容量不足・データ削除等による消失を完全には防げません。</p></section>`;
}
async function createSession(mode=settings.mode,category='',force=false) {
  const source=reviewPool(filterLevel(QUESTIONS,settings.level),attempts,mode,category);
  if(!source.length){toast('対象の問題がありません。まずはランダムで練習しましょう。');return;}
  if(session&&!force&&!await confirmAction('新しく始めますか？','回答済みの履歴は保存されています。今のトレーニングを終了して、新しい問題を開始します。','新しく始める'))return;
  pauseTimer();settings.mode=mode;
  let queue=shuffle(source.map(q=>q.id));if(mode==='10'||mode==='30')queue=queue.slice(0,Number(mode));
  session={id:crypto.randomUUID(),level:settings.level,mode,category,queue,index:0,results:[],draft:blankAnswer(),elapsedMs:0,feedback:null,savedAt:Date.now()};
  calc={expression:'',target:null,rounding:'exact',open:false,justEvaluated:false};
  await saveSettings();await saveSession();
  navigator.storage?.persist?.().catch(()=>{});
  navigate('train');
}
function blankAnswer(){return {debit:[{account:'',amount:''}],credit:[{account:'',amount:''}]};}
function rowsMarkup(side) {
  const label=side==='debit'?'借方':'貸方';
  return `<section class="journal-side"><div class="side-title"><h2>${label}</h2><button class="text-button" data-action="add-row" data-side="${side}">＋ 行を追加</button></div>${session.draft[side].map((line,index)=>`<div class="entry-row" data-row="${side}-${index}"><button class="account-button ${line.account?'':'placeholder'}" data-action="account" data-side="${side}" data-index="${index}" aria-label="${label}${index+1}行目の勘定科目">${esc(line.account||'科目を選択')}<span aria-hidden="true">⌄</span></button><button class="amount-button ${line.amount===''?'placeholder':''} ${calc.target?.side===side&&calc.target?.index===index?'active':''}" data-action="amount" data-side="${side}" data-index="${index}" aria-label="${label}${index+1}行目の金額">${line.amount===''?'金額':num(line.amount)}</button>${session.draft[side].length>1?`<button class="remove-row" data-action="remove-row" data-side="${side}" data-index="${index}" aria-label="${label}${index+1}行目を削除">×</button>`:'<span class="row-spacer"></span>'}</div>`).join('')}</section>`;
}
function train() {
  const q=current();if(!q){navigate('home');return;}
  const i=session.results.length+(session.feedback?0:1), total=session.mode==='endless'?'∞':session.queue.length;
  app.innerHTML=`<div class="training-toolbar"><button class="text-button" data-action="pause">‹ 中断</button><select id="train-level" aria-label="出題レベルを変更">${levelsMarkup(session.level)}</select><span class="small muted" id="question-timer">${timerValue()}秒</span></div>
    <div class="question-progress"><span>${esc(modeNames[session.mode])}</span><strong>${i} <span>/ ${total}</span></strong></div>
    <article class="question-card"><div class="question-meta"><span class="pill">${esc(q.category)}</span><span class="small muted">${LEVELS[q.level]} · ${q.requiresCalculation?'計算あり':'瞬発'} · ${'●'.repeat(q.difficulty)}${'○'.repeat(3-q.difficulty)}</span></div><h1 class="question-text">${esc(q.prompt)}</h1><div class="question-foot"><span>金額：円 / 指示のない消費税は考慮不要</span><span>${q.id}</span></div></article>
    ${session.feedback?feedbackMarkup(q):`<div id="answer-editor" class="answer-editor">${rowsMarkup('debit')}${rowsMarkup('credit')}</div><div class="balance"><span>借方合計 <b id="debit-total">${num(totalSide('debit'))}</b></span><span>貸方合計 <b id="credit-total">${num(totalSide('credit'))}</b></span></div><p class="entry-hint small muted">科目を選ぶ → 金額をタップ → 電卓で入力</p><button class="text-button skip-button" data-action="skip">わからない · 解答を見る</button><p id="answer-error" class="inline-error" role="alert"></p>`}`;
  renderDock();observeQuestion();startTimer();
}
function totalSide(side){return session.draft[side].reduce((s,r)=>s+(Number(r.amount)||0),0);}
function renderEditor(){const el=$('#answer-editor');if(el){el.innerHTML=rowsMarkup('debit')+rowsMarkup('credit');$('#debit-total').textContent=num(totalSide('debit'));$('#credit-total').textContent=num(totalSide('credit'));}}
function journalTable(answer) {
  return `<div class="journal-display">${['debit','credit'].map(side=>`<div><h4>${side==='debit'?'借方':'貸方'}</h4>${answer[side].filter(r=>r.account||r.amount).map(r=>`<div class="journal-line"><span>${esc(r.account||'未入力')}</span><b>${r.amount===''?'—':num(r.amount)}</b></div>`).join('')||'<p class="muted small">未入力</p>'}</div>`).join('')}</div>`;
}
function feedbackMarkup(q) {
  const f=session.feedback;
  return `<section class="feedback ${f.correct?'correct':'incorrect'}" aria-labelledby="feedback-title"><h2 id="feedback-title" tabindex="-1">${f.correct?'○ 正解':'× 不正解'}</h2><span class="small">${seconds(f.elapsedMs/1000)}${f.skipped?' · 解答を表示':''}</span>
    ${!f.correct?`<h3>あなたの回答</h3>${journalTable(f.answer)}`:''}<h3>正しい仕訳</h3>${journalTable(q)}
    <div class="explanation"><h3>ここを押さえる</h3><p>${esc(q.explanation)}</p>${q.trap?`<p class="trap"><strong>注意</strong> ${esc(q.trap)}</p>`:''}</div></section>`;
}
function targetLabel(){if(!calc.target)return '金額欄をタップして選択';const {side,index}=calc.target;const row=session?.draft[side]?.[index];return `${side==='debit'?'借方':'貸方'} ${index+1}行目${row?.account?` · ${row.account}`:''}`;}
function calcResult(){return evaluateExpression(calc.expression);}
function renderDock() {
  if(route!=='train'||!session){dock.hidden=true;document.body.classList.remove('training','answering','calc-open');return;}
  dock.hidden=false;document.body.classList.add('training');
  // 回答入力中は問題文を画面上部に固定し、電卓を開いている間はコンパクト表示にする。
  document.body.classList.toggle('answering',!session.feedback);
  document.body.classList.toggle('calc-open',!session.feedback&&calc.open);
  if(session.feedback){dock.innerHTML=`<button class="primary full next-button" data-action="next">${session.mode!=='endless'&&session.index===session.queue.length-1?'結果を見る':'次の問題'} <span aria-hidden="true">→</span></button>`;resizeDock();return;}
  dock.innerHTML=`<div class="calc-toolbar"><button class="text-button calc-toggle" data-action="toggle-calc">${calc.open?'⌄ 電卓を閉じる':'▦ 電卓を開く'}</button><span id="calc-target" class="small muted">${esc(targetLabel())}</span></div>
    <div id="calculator" ${calc.open?'':'hidden'}><div class="calc-screen"><div id="calc-expression" class="calc-expression"></div><div id="calc-result" class="calc-result" aria-live="polite"></div></div>
    <div class="calc-options"><label for="rounding">円未満</label><select id="rounding"><option value="exact" ${calc.rounding==='exact'?'selected':''}>整数をそのまま</option><option value="round" ${calc.rounding==='round'?'selected':''}>四捨五入</option><option value="floor" ${calc.rounding==='floor'?'selected':''}>切り捨て</option><option value="ceil" ${calc.rounding==='ceil'?'selected':''}>切り上げ</option></select><button class="apply-button" data-action="apply-amount">金額に反映 ↗</button></div>
    <div class="keypad" aria-label="電卓テンキー">${[['7','7'],['8','8'],['9','9'],['C','C'],['⌫','⌫'],['4','4'],['5','5'],['6','6'],['*','×'],['/','÷'],['1','1'],['2','2'],['3','3'],['+','＋'],['-','－'],['0','0'],['00','00'],['000','000'],['.','.'],['=','＝']].map(([key,label])=>`<button data-key="${key}" class="${/^[0-9.]/.test(key)?'':'operator'} ${key==='='?'equals':''}" ${key==='⌫'?'aria-label="1文字削除"':key==='C'?'aria-label="計算をクリア"':''}>${label}</button>`).join('')}</div></div>
    <button class="primary full submit-button" data-action="submit" ${busy?'disabled':''}>${busy?'保存中…':'回答する'} <span aria-hidden="true">→</span></button>`;
  refreshCalc();resizeDock();
}
function refreshCalc(){
  if(!$('#calc-expression'))return;
  const result=calcResult();
  $('#calc-expression').textContent=calc.expression.replace(/\*/g,' × ').replace(/\//g,' ÷ ').replace(/\+/g,' ＋ ').replace(/-/g,' − ')||'0';
  $('#calc-result').textContent=result.valid?`＝ ${result.display}`:result.error||'＝ 0';
  const output=result.valid?(calc.rounding==='exact'?result.exact:result[calc.rounding]):null;
  $('[data-action="apply-amount"]').disabled=!calc.target||output===null||output<=0;
}
function resizeDock(){requestAnimationFrame(()=>document.documentElement.style.setProperty('--dock-height',`${dock.hidden?0:dock.getBoundingClientRect().height}px`));}
new ResizeObserver(resizeDock).observe(dock);
// 固定表示した問題文の高さを記録し、入力行が問題文の裏に隠れないようにする。
const questionObserver=new ResizeObserver(entries=>{for(const e of entries)document.documentElement.style.setProperty('--question-height',`${Math.ceil(e.target.getBoundingClientRect().height)}px`);});
function observeQuestion(){questionObserver.disconnect();const card=$('.question-card');if(card)questionObserver.observe(card);}
function selectAmount(side,index){
  calc.target={side,index};calc.expression=String(session.draft[side][index].amount);calc.rounding='exact';calc.open=true;calc.justEvaluated=true;
  renderEditor();renderDock();
  // 電卓の高さが確定した後で、選んだ行を「固定表示の問題文」と「電卓」の間に収める。
  requestAnimationFrame(()=>requestAnimationFrame(()=>revealRow(side,index)));
}
function revealRow(side,index){
  const row=$(`[data-row="${side}-${index}"]`);if(!row)return;
  const card=$('.question-card'), r=row.getBoundingClientRect();
  const top=(card?card.getBoundingClientRect().bottom:0)+8, bottom=(dock.hidden?window.innerHeight:dock.getBoundingClientRect().top)-8;
  if(r.bottom>bottom)window.scrollBy({top:r.bottom-bottom,behavior:'smooth'});
  else if(r.top<top)window.scrollBy({top:r.top-top,behavior:'smooth'});
}
function keyInput(key){
  if(key==='='){
    const r=calcResult();if(!r.valid){toast(r.error||'式を入力してください。');return;}
    // 元の式を残し、結果は別欄で表示。次の数値入力だけ新規計算にする。
    calc.justEvaluated=true;
  } else {
    if(calc.justEvaluated&&/^[+*/-]$/.test(key)&&calcResult().valid)calc.expression=`(${calc.expression})`;
    if(calc.justEvaluated&&/^[\d.]$|^00$|^000$/.test(key))calc.expression='';
    calc.justEvaluated=false;calc.expression=appendKey(calc.expression,key);
  }
  refreshCalc();
}
async function applyAmount(){
  const r=calcResult();if(!r.valid||!calc.target)return;
  const amount=calc.rounding==='exact'?r.exact:r[calc.rounding];
  if(amount===null){toast('円未満の処理を選択してください。');return;}
  if(amount<=0){toast('1円以上の金額を入力してください。');return;}
  const {side,index}=calc.target;session.draft[side][index].amount=amount;calc.justEvaluated=true;
  renderEditor();await saveSession();toast(`${side==='debit'?'借方':'貸方'}に ${num(amount)} 円を入力`);
}
function openAccounts(side,index){
  accountTarget={side,index};showAllAccounts=false;$('#account-search').value='';
  $('#account-title').textContent=`${side==='debit'?'借方':'貸方'} ${index+1}行目の科目`;
  // 科目選択中も問題文を読めるよう、ダイアログ上部に同じ問題文を表示する。
  $('#account-question').textContent=current()?.prompt||'';renderAccounts();
  $('#account-dialog').showModal();$('#account-dialog .icon-button').focus();
}
function renderAccounts(){
  const q=current();if(!q)return;
  const search=$('#account-search').value.normalize('NFKC').replace(/\s/g,'');
  const pool=(showAllAccounts||search)?ALL_ACCOUNTS:[...new Set([...q.debit,...q.credit].map(l=>l.account).concat(q.distractors||[],COMMON_ACCOUNTS.slice(0,8)))].sort((a,b)=>a.localeCompare(b,'ja'));
  $('#account-options').innerHTML=pool.filter(a=>a.includes(search)).map(a=>`<button data-account="${esc(a)}">${esc(a)}</button>`).join('')||'<p class="muted">該当する科目がありません。</p>';
  $('#all-accounts').hidden=showAllAccounts||!!search;
}
async function submit(skipped=false){
  if(busy||!session||session.feedback)return;
  $('#answer-error').textContent='';
  if(!skipped){
    // 入力中の電卓値が未反映なら無言で失わない。
    const r=calcResult(), applied=calc.target?session.draft[calc.target.side][calc.target.index].amount:null;
    const result=r.valid?(calc.rounding==='exact'?r.exact:r[calc.rounding]):null;
    if(calc.open&&calc.expression&&calc.target&&result!==applied){$('#answer-error').textContent='電卓の結果を「金額に反映」してから回答してください。';toast('電卓の結果がまだ反映されていません。');return;}
    try{validateAnswer(session.draft);}catch(e){$('#answer-error').textContent=e.message;toast(e.message);return;}
  }
  pauseTimer();busy=true;renderDock();
  const q=current(), answer=copy(session.draft);
  // わからないの場合は未入力行を除き、部分入力は表示に残す。
  const record={id:`${session.id}:${session.results.length}`,questionId:q.id,level:q.level,category:q.category,at:Date.now(),elapsedMs:Math.min(Math.round(session.elapsedMs),86400000),correct:!skipped&&gradeAnswer(answer,q),answer,skipped};
  const next=copy(session);next.feedback=record;next.results.push(record.id);next.savedAt=Date.now();
  try{
    await queued(()=>store.record(record,next));
    session=next;
    const loaded=await store.read();attempts=loaded.attempts;
    saveFailed=false;$('#storage-warning').hidden=true;stashDraft();
    calc.open=false;busy=false;train();$('#feedback-title')?.focus({preventScroll:true});$('#feedback-title')?.scrollIntoView({block:'start',behavior:'smooth'});
  }catch(e){busy=false;saveError(e);renderDock();startTimer();toast('保存に失敗しました。もう一度「回答する」を押してください。');}
}
async function nextQuestion(){
  if(busy||!session?.feedback)return;
  if(session.index===session.queue.length-1&&session.mode!=='endless'){navigate('summary');return;}
  if(session.index===session.queue.length-1){
    const last=session.queue.at(-1);session.queue=shuffle(filterLevel(QUESTIONS,session.level).map(q=>q.id));
    if(session.queue[0]===last&&session.queue.length>1)[session.queue[0],session.queue[1]]=[session.queue[1],session.queue[0]];
    session.index=0;
  }else session.index++;
  session.feedback=null;session.draft=blankAnswer();session.elapsedMs=0;
  calc={expression:'',target:null,rounding:'exact',open:false,justEvaluated:false};
  await saveSession();train();window.scrollTo({top:0});
}
function summary(){
  if(!session){navigate('home');return;}
  const ids=new Set(session.results), rows=attempts.filter(a=>ids.has(a.id)), s=summarize(rows);
  app.innerHTML=header('SESSION COMPLETE','おつかれさまでした。','次の1問につながる、今日の積み上げ。')+
    `<section class="card summary-card"><span class="pill">${esc(levelName(session.level))} · ${esc(modeNames[session.mode])}</span><p class="big-score">${s.correct}<small> / ${s.count}</small></p><p class="muted">正解</p><div class="metrics">${metric('正答率',rate(s))}${metric('平均時間',seconds(s.average))}</div></section>
    <button class="primary full" data-action="restart">もう一度トレーニング</button><button class="secondary full" data-action="finish">ホームへ戻る</button>
    ${s.wrong?`<section class="card"><h2>今回つまずいた論点</h2>${[...new Set(rows.filter(a=>!a.correct).map(a=>a.category))].map(c=>`<span class="pill result-tag">${esc(c)}</span>`).join('')}<button class="text-button full" data-action="finish-review">間違えた問題を復習する →</button></section>`:''}`;
}
async function renderRoute(){
  if(!ready)return;
  pauseTimer();
  if(route==='train')await saveSession().catch(saveError);
  const next=location.hash.slice(1)||'home';route=['home','review','stats','help','train','summary'].includes(next)?next:'home';
  if(route==='train'&&!session)route='home';
  $('#main-nav').hidden=route==='train';
  document.querySelectorAll('[data-nav]').forEach(a=>{a.setAttribute('aria-current',a.dataset.nav===route?'page':'false');});
  dock.hidden=route!=='train';document.body.classList.toggle('training',route==='train');
  if(route!=='train')document.body.classList.remove('answering','calc-open');
  ({home,review,stats:statsScreen,help,train,summary})[route]();
  window.scrollTo({top:0});app.focus({preventScroll:true});
}
async function exportBackup(){
  const saved=await store.read();
  const data={app:'shiwake-training',version:1,bankVersion:BANK_VERSION,exportedAt:new Date().toISOString(),settings:saved.settings||settings,attempts:saved.attempts};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`shiwake-backup-${localDateKey()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast('書き出しました。ダウンロード／ファイルを確認してください。');
}
async function importBackup(file){
  if(!file)return;if(file.size>30*1024*1024)throw new Error('ファイルが大きすぎます（上限30MB）。');
  const data=validateBackup(JSON.parse(await file.text()),QUESTIONS);
  if(!await confirmAction('バックアップを読み込みますか？',`${data.attempts.length}件の履歴を既存データに統合します。重複した回答は増やしません。回答途中のトレーニングは終了します。`,'読み込む'))return;
  await queued(()=>store.mergeBackup(data));const saved=await store.read();attempts=saved.attempts;settings=saved.settings;session=null;stashDraft();
  toast('履歴を読み込みました。');navigate('stats');
}

async function handleAction(button){
  const action=button.dataset.action,side=button.dataset.side,index=Number(button.dataset.index);
  if(busy)return;
  if(action==='level'){settings.level=button.dataset.level;await saveSettings();({home,review})[route]?.();}
  if(action==='start')await createSession();
  if(action==='start-mode')await createSession(button.dataset.mode);
  if(action==='weak-category')await createSession('weak',button.dataset.category);
  if(action==='resume')navigate('train');
  if(['review','stats','help'].includes(action))navigate(action);
  if(action==='pause'){pauseTimer();await saveSession();navigate('home');}
  if(action==='account')openAccounts(side,index);
  if(action==='amount')selectAmount(side,index);
  if(action==='add-row'){
    if(session.draft[side].length>=12){toast('各側12行まで追加できます。');return;}
    session.draft[side].push({account:'',amount:''});renderEditor();await saveSession();
  }
  if(action==='remove-row'){
    session.draft[side].splice(index,1);calc.target=null;calc.expression='';renderEditor();renderDock();await saveSession();
  }
  if(action==='toggle-calc'){calc.open=!calc.open;renderDock();}
  if(action==='apply-amount')await applyAmount();
  if(action==='submit')await submit();
  if(action==='skip')await submit(true);
  if(action==='next')await nextQuestion();
  if(action==='restart'){const mode=session.mode;session=null;await createSession(mode,'',true);}
  if(action==='finish'||action==='finish-review'){session=null;await saveSession();navigate(action==='finish'?'home':'review');}
  if(action==='export')await exportBackup();
  if(action==='check-update'){await setupWorker();toast(offlineReady?'オフライン準備ができています。':'準備中です。通信状態を確認してください。');}
}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.close){document.getElementById(button.dataset.close).close();return;}
  if(button.hasAttribute('data-key')){keyInput(button.dataset.key);return;}
  if(button.dataset.account!==undefined){
    const {side,index}=accountTarget;session.draft[side][index].account=button.dataset.account;$('#account-dialog').close();
    selectAmount(side,index);saveSession().catch(saveError);return;
  }
  if(button.dataset.action)handleAction(button).catch(e=>{saveError(e);toast(e.message||'操作に失敗しました。');});
});
$('#account-search').addEventListener('input',renderAccounts);
$('#all-accounts').addEventListener('click',()=>{showAllAccounts=true;renderAccounts();});
document.addEventListener('change',async e=>{
  try{
    if(e.target.id==='mode'){settings.mode=e.target.value;await saveSettings();}
    if(e.target.id==='rounding'){calc.rounding=e.target.value;refreshCalc();}
    if(e.target.id==='train-level'){
      pauseTimer();const level=e.target.value;
      if(await confirmAction('レベルを切り替えますか？','回答済みの履歴を残し、選んだレベルで新しく10問を始めます。','切り替える')){settings.level=level;await createSession('10','',true);}else{e.target.value=session.level;startTimer();}
    }
    if(e.target.id==='import-file'){await importBackup(e.target.files[0]);e.target.value='';}
  }catch(error){toast(error.message||'操作できませんでした。');}
});
document.addEventListener('keydown',e=>{
  if(route!=='train'||session?.feedback||!calc.open||$('dialog[open]')||e.target.matches('input,select,textarea'))return;
  const key=e.key==='Backspace'?'⌫':e.key==='Escape'?'C':e.key==='Enter'?'=':e.key;
  if(/^[\d.+*/=-]$/.test(key)||['C','⌫'].includes(key)){e.preventDefault();keyInput(key);}
});
window.addEventListener('hashchange',renderRoute);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){pauseTimer();saveSession().catch(saveError);}else{startTimer();updateConnection();}
});
window.addEventListener('pagehide',()=>{pauseTimer();if(session){session.savedAt=Date.now();stashDraft();}saveSession().catch(()=>{});});
setInterval(()=>{drawTimer();if(runningSince){tick();saveSession().catch(saveError);}},1000);

function updateConnection(){
  const el=$('#connection');el.textContent=offlineReady?(navigator.onLine?'オフライン準備完了':'オフラインで使用中'):(navigator.onLine?'オフライン準備中':'未準備・接続が必要');
  el.classList.toggle('is-ready',offlineReady);
}
async function checkOfflineReady(){
  const worker=navigator.serviceWorker?.controller||swRegistration?.active;
  if(!worker){offlineReady=false;updateConnection();return;}
  offlineReady=await new Promise(resolve=>{
    const channel=new MessageChannel();const timeout=setTimeout(()=>{channel.port1.close();resolve(false);},4000);
    channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();resolve(e.data.ready===true);};
    worker.postMessage({type:'CHECK_READY'},[channel.port2]);
  });updateConnection();
}
async function setupWorker(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext){$('#connection').textContent='HTTPSで開いてください';return;}
  try{
    swRegistration=await navigator.serviceWorker.getRegistration('./') || await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});
    const showWaiting=()=>{$('#update-banner').hidden=!swRegistration.waiting;};showWaiting();
    swRegistration.addEventListener('updatefound',()=>{const w=swRegistration.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'){showWaiting();checkOfflineReady();}});});
    if(navigator.onLine)swRegistration.update().catch(()=>{});
    navigator.serviceWorker.ready.then(checkOfflineReady).catch(()=>{});
    await checkOfflineReady();
  }catch(e){console.warn('オフライン準備待ち:',e.message);await checkOfflineReady();}
}
let updateRequested=false;
$('#apply-update').addEventListener('click',async()=>{
  if(!swRegistration?.waiting)return;
  pauseTimer();await saveSession().catch(saveError);
  if(saveFailed){toast('保存が完了していないため、更新を保留しました。');startTimer();return;}
  updateRequested=true;swRegistration.waiting.postMessage({type:'SKIP_WAITING'});
});
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested)location.reload();else checkOfflineReady();});
window.addEventListener('online',()=>{updateConnection();setupWorker();});window.addEventListener('offline',updateConnection);

async function boot(){
  try{
    validateBank(QUESTIONS);await store.open();const saved=await store.read();
    attempts=saved.attempts;settings={...settings,...saved.settings};session=saved.session||null;
    try{
      const draft=JSON.parse(localStorage.getItem(draftKey)||'null');
      if(draft&&session&&draft.id===session.id&&draft.savedAt>session.savedAt){
        // 既に採点済みの問題を、古い未採点の下書きで巻き戻さない。
        if(draft.results.length>=session.results.length)session=draft;
      }
    }catch{/* 破損した下書きはIndexedDBの確定内容へフォールバック */}
    if(!['both',...Object.keys(LEVELS)].includes(settings.level))settings.level='bookkeeping2';
    if(session&&(!session.queue?.every(id=>bank.has(id))||session.index>=session.queue.length||!session.draft||!Array.isArray(session.results))){session=null;toast('問題データを更新しました。新しいトレーニングを始めてください。');}
    ready=true;await renderRoute();setupWorker();
  }catch(e){
    console.error(e);app.innerHTML=header('STORAGE','起動できませんでした。')+'<section class="card"><p>端末の空き容量とSafariの設定を確認し、通常のブラウズモードで再度開いてください。ファイルを直接開いている場合は、READMEのHTTPサーバーまたはGitHub Pagesを使用してください。</p><button class="primary full" id="reload">再読み込み</button></section>';$('#reload').onclick=()=>location.reload();
  }
}
boot();
