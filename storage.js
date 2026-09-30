// GitHub Pagesの同一オリジンにある他のリポジトリと保存領域を分離。
export class StudyStore {
  constructor(scope) { this.name=`shiwake-training:${scope}`; this.db=null; this.fallback=false; }
  async open() {
    // 一度フォールバックで保存した端末では、その保存先を優先して履歴を継続。
    try { if(localStorage.getItem(this.name)) {this.fallback=true;this.readFallback();return;} } catch { /* IndexedDBを試す */ }
    try {
      this.db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open(this.name,1);
        req.onupgradeneeded=()=>{req.result.createObjectStore('attempts',{keyPath:'id'});req.result.createObjectStore('kv');};
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error);
        req.onblocked=()=>reject(new Error('別のタブを閉じて再度開いてください。'));
      });
      this.db.onversionchange=()=>this.db.close();
    } catch {
      const initial={attempts:[],settings:null,session:null};
      localStorage.setItem(this.name,JSON.stringify(initial)); // 失敗は呼出側に通知し、保存できない学習を始めない
      this.fallback=true;
    }
  }
  readFallback() {
    const data=JSON.parse(localStorage.getItem(this.name));
    if(!data||!Array.isArray(data.attempts))throw new Error('端末データを読み込めません。');
    return data;
  }
  async read() {
    if(this.fallback)return this.readFallback();
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['attempts','kv'],'readonly');
      const attempts=tx.objectStore('attempts').getAll(), settings=tx.objectStore('kv').get('settings'), session=tx.objectStore('kv').get('session');
      tx.oncomplete=()=>resolve({attempts:attempts.result.sort((a,b)=>a.at-b.at),settings:settings.result,session:session.result});
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('読込中断'));
    });
  }
  async set(key,value) {
    if(this.fallback){const data=this.readFallback();data[key]=value;localStorage.setItem(this.name,JSON.stringify(data));return;}
    return this.write(['kv'],tx=>tx.objectStore('kv').put(value,key));
  }
  async record(attempt,session) {
    if(this.fallback){
      const data=this.readFallback();
      if(!data.attempts.some(a=>a.id===attempt.id))data.attempts.push(attempt);
      data.session=session;localStorage.setItem(this.name,JSON.stringify(data));return;
    }
    // 回答と採点後セッションを一つのトランザクションで永続化。
    // 同一attempt.idの再送は上書きとなり、二重計上されない。
    return this.write(['attempts','kv'],tx=>{tx.objectStore('attempts').put(attempt);tx.objectStore('kv').put(session,'session');});
  }
  async mergeBackup(backup) {
    if(this.fallback){
      const data=this.readFallback(), rows=new Map(data.attempts.map(a=>[a.id,a]));
      for(const a of backup.attempts)if(!rows.has(a.id))rows.set(a.id,a);
      data.attempts=[...rows.values()].sort((a,b)=>a.at-b.at);data.settings=backup.settings;data.session=null;
      localStorage.setItem(this.name,JSON.stringify(data));return;
    }
    return this.write(['attempts','kv'],tx=>{
      const store=tx.objectStore('attempts');
      for(const a of backup.attempts){const request=store.getKey(a.id);request.onsuccess=()=>{if(request.result===undefined)store.put(a);};}
      tx.objectStore('kv').put(backup.settings,'settings');tx.objectStore('kv').put(null,'session');
    });
  }
  write(stores,fn) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(stores,'readwrite');
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存中断'));
      try{fn(tx);}catch(e){tx.abort();reject(e);}
    });
  }
}
