// UIから独立した採点・集計・出題・電卓。外部ライブラリ不要。
import { ACCOUNT_ALIASES } from './questions.js';
export const MAX_AMOUNT = 999999999999;
export const normalizeAccount = value => {
  const s = String(value ?? '').normalize('NFKC').replace(/\s+/g,'');
  return ACCOUNT_ALIASES[s] || s;
};
export function normalizeSide(rows) {
  const result = new Map();
  for (const row of rows) {
    if (!row.account && (row.amount === '' || row.amount == null)) continue;
    const account = normalizeAccount(row.account), amount = Number(row.amount);
    if (!account || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new Error('科目と1円以上の整数を入力してください。');
    const sum = (result.get(account) || 0) + amount;
    if (!Number.isSafeInteger(sum)) throw new Error('金額が大きすぎます。');
    result.set(account, sum);
  }
  return [...result.entries()].sort(([a],[b]) => a.localeCompare(b,'ja'));
}
export function gradeAnswer(answer, question) {
  try {
    return ['debit','credit'].every(side => JSON.stringify(normalizeSide(answer[side])) === JSON.stringify(normalizeSide(question[side])));
  } catch { return false; }
}
export function validateAnswer(answer) {
  for (const side of ['debit','credit']) {
    const rows = normalizeSide(answer[side]);
    if (!rows.length) throw new Error(`${side === 'debit' ? '借方' : '貸方'}の科目と金額を入力してください。`);
  }
  // 貸借不一致も採点対象。正誤を送信前に漏らさない。
}
export function validateBank(questions) {
  const ids = new Set();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`重複ID: ${q.id}`);
    ids.add(q.id);
    if (!q.id || !q.level || !q.category || !q.group || !q.prompt || !q.explanation || ![1,2,3].includes(q.difficulty) || typeof q.requiresCalculation !== 'boolean') throw new Error(`問題属性の不足: ${q.id}`);
    const sum = side => normalizeSide(q[side]).reduce((s,[,v])=>s+v,0);
    if (!sum('debit') || sum('debit') !== sum('credit')) throw new Error(`貸借不一致: ${q.id}`);
  }
  return true;
}
export const filterLevel = (questions, level) => level === 'both' ? questions : questions.filter(q=>q.level === level);
export const filterGroup = (questions, group = 'all') => group === 'all' ? questions : questions.filter(q=>q.group === group);
export function shuffle(items, random = Math.random) {
  const out = [...items];
  for(let i=out.length-1; i>0; i--) { const j=Math.floor(random()*(i+1)); [out[i],out[j]]=[out[j],out[i]]; }
  return out;
}
export function localDateKey(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function summarize(attempts) {
  const count=attempts.length, correct=attempts.reduce((n,a)=>n+Number(a.correct),0);
  return { count, correct, wrong: count-correct, rate: count ? correct/count : null,
    average: count ? attempts.reduce((n,a)=>n+a.elapsedMs,0)/count/1000 : null };
}
export function streak(attempts) {
  let n=0;
  for(let i=attempts.length-1;i>=0&&attempts[i].correct;i--) n++;
  return n;
}
export function periodStats(attempts, now = new Date()) {
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6).getTime(), today=localDateKey(now);
  return { today: summarize(attempts.filter(a=>localDateKey(a.at)===today)), week: summarize(attempts.filter(a=>a.at>=start && a.at<=now.getTime())), all:summarize(attempts) };
}
export function groupStats(attempts, key) {
  const groups=new Map();
  for(const a of attempts) { const name=a[key]; if(!groups.has(name))groups.set(name,[]); groups.get(name).push(a); }
  return [...groups.entries()].map(([name,rows])=>({name,...summarize(rows)})).sort((a,b)=>a.rate-b.rate || b.count-a.count);
}
export function questionStats(attempts) {
  const grouped=new Map();
  for(const a of attempts) { if(!grouped.has(a.questionId))grouped.set(a.questionId,[]); grouped.get(a.questionId).push(a); }
  return new Map([...grouped].map(([id,rows])=>[id,{...summarize(rows),last:rows.at(-1),streak:streak(rows)}]));
}
export function reviewPool(questions, attempts, mode, category = '') {
  const qs=questionStats(attempts);
  if(mode==='mistakes') return questions.filter(q=>qs.get(q.id)?.last.correct===false);
  if(mode==='weak') {
    const allowed=new Set(questions.map(q=>q.id));
    const relevant=attempts.filter(a=>allowed.has(a.questionId));
    const cats=new Set(groupStats(relevant,'category').filter(s=>s.rate<0.8 || s.average>30).map(s=>s.name));
    return questions.filter(q=>{
      if(category && q.category!==category) return false;
      const s=qs.get(q.id);
      return cats.has(q.category) || (s && (!s.last.correct || (s.count>=2&&s.rate<0.8) || s.average>(q.requiresCalculation?45:30)));
    });
  }
  return questions;
}

// 四則演算は分数（BigInt）で評価。eval / Function は使用しない。
const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b];}return a||1n;};
const fraction=(n,d=1n)=>{if(d===0n)throw new Error('0では割れません');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};};
const operate=(a,b,op)=>{
  if(op==='+')return fraction(a.n*b.d+b.n*a.d,a.d*b.d);
  if(op==='-')return fraction(a.n*b.d-b.n*a.d,a.d*b.d);
  if(op==='*')return fraction(a.n*b.n,a.d*b.d);
  return fraction(a.n*b.d,a.d*b.n);
};
export function evaluateExpression(expression) {
  try {
    const source=String(expression).replace(/[,\s]/g,'').replace(/[×]/g,'*').replace(/[÷]/g,'/').replace(/[−－]/g,'-');
    if(!source) return { valid:false, error:'' };
    if(source.length>160 || !/^[\d.+*/()-]+$/.test(source))throw new Error('式を確認してください');
    const tokens=source.match(/\d+(?:\.\d*)?|\.\d+|[()+*/-]/g)||[];
    if(tokens.join('')!==source)throw new Error('式を確認してください');
    let index=0;
    const atom=()=>{
      const token=tokens[index++];
      if(token==='+'||token==='-'){const a=atom();return fraction(token==='-'?-a.n:a.n,a.d);}
      if(token==='('){const a=add();if(tokens[index++]!==')')throw new Error('括弧を閉じてください');return a;}
      if(!token||!/^\d*\.?\d*$/.test(token)||token==='.')throw new Error('式を入力中');
      const [whole,dec='']=token.split('.');
      if((whole+dec).length>30)throw new Error('桁数が多すぎます');
      return fraction(BigInt((whole||'0')+dec),10n**BigInt(dec.length));
    };
    const mul=()=>{let a=atom();while(tokens[index]==='*'||tokens[index]==='/'){const op=tokens[index++];a=operate(a,atom(),op);}return a;};
    const add=()=>{let a=mul();while(tokens[index]==='+'||tokens[index]==='-'){const op=tokens[index++];a=operate(a,mul(),op);}return a;};
    const a=add();
    if(index!==tokens.length)throw new Error('式を確認してください');
    const value=Number(a.n)/Number(a.d);
    if(!Number.isFinite(value)||Math.abs(value)>MAX_AMOUNT)throw new Error('金額の上限を超えています');
    const trunc=a.n/a.d, remainder=a.n%a.d;
    const floor=trunc+(remainder<0n?-1n:0n), ceil=trunc+(remainder>0n?1n:0n);
    const round=remainder<0n ? -((-a.n*2n+a.d)/(a.d*2n)) : (a.n*2n+a.d)/(a.d*2n);
    return {valid:true,value,isInteger:remainder===0n,exact:remainder===0n?Number(trunc):null,
      floor:Number(floor),ceil:Number(ceil),round:Number(round),display:value.toLocaleString('ja-JP',{maximumFractionDigits:8}),
      expression:source};
  } catch(e) { return { valid:false, error:e.message }; }
}
export function appendKey(expression,key) {
  let s=expression;
  if(key==='C')return '';
  if(key==='⌫')return s.slice(0,-1);
  if(s.length>=150)return s;
  if('+-*/'.includes(key)){
    if(!s)return key==='-'?'-':'';
    return /[+*/-]$/.test(s)?s.slice(0,-1)+key:s+key;
  }
  if(key==='.') {
    const tail=s.split(/[+*/-]/).at(-1);
    if(tail.includes('.'))return s;
    return s+(tail?'':'0')+'.';
  }
  if(!/^\d{1,3}$/.test(key))return s;
  const tail=s.split(/[+*/-]/).at(-1);
  if(tail==='0')s=s.slice(0,-1);
  return s+key;
}

export function validateBackup(data, questions) {
  if(!data || data.app!=='shiwake-training' || data.version!==1 || !Array.isArray(data.attempts) || data.attempts.length>100000)throw new Error('対応していないバックアップ形式です。');
  const ids=new Set(), bank=new Map(questions.map(q=>[q.id,q]));
  const attempts=data.attempts.map(a=>{
    if(!a || typeof a.id!=='string' || !a.id || a.id.length>100 || ids.has(a.id) || typeof a.questionId!=='string' || !bank.has(a.questionId) || typeof a.correct!=='boolean' || !Number.isFinite(a.at) || a.at<0 || a.at>8640000000000000 || !Number.isFinite(a.elapsedMs) || a.elapsedMs<0 || a.elapsedMs>86400000)throw new Error('履歴データの内容が不正です。');
    ids.add(a.id); const q=bank.get(a.questionId);
    const answer={};
    for(const side of ['debit','credit']) {
      if(!Array.isArray(a.answer?.[side]) || a.answer[side].length>12)throw new Error('回答データが不正です。');
      answer[side]=a.answer[side].map(r=>{
        if(typeof r.account!=='string'||r.account.length>80||(r.amount!==''&&(!Number.isSafeInteger(r.amount)||r.amount<=0||r.amount>MAX_AMOUNT)))throw new Error('回答データが不正です。');
        return {account:r.account,amount:r.amount};
      });
    }
    if(!a.skipped)validateAnswer(answer);
    return {id:a.id,questionId:a.questionId,level:q.level,category:q.category,correct:a.correct,at:a.at,elapsedMs:a.elapsedMs,answer,skipped:!!a.skipped};
  }).sort((a,b)=>a.at-b.at);
  const levels=new Set(['both',...questions.map(q=>q.level)]);
  const level=levels.has(data.settings?.level)?data.settings.level:'bookkeeping2';
  const groups=new Set(['all',...questions.map(q=>q.group)]);
  const group=groups.has(data.settings?.group)?data.settings.group:'all';
  return {attempts,settings:{level,group,mode:['3','5','10','30','endless','mistakes','weak'].includes(data.settings?.mode)?data.settings.mode:'10'}};
}
