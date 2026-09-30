import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,stat}from'node:fs/promises';
import {fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await readFile(root+'service-worker.js','utf8');

async function makeWorker(pathname,offline=false){
  const scope='https://test.example'+pathname,listeners={},cacheStores=new Map(),deleted=[];
  const cache={
    async addAll(requests){for(const req of requests){const path=new URL(req.url).pathname.slice(pathname.length)||'index.html';await stat(root+path);cacheStores.set(req.url,new Response(path));}},
    async match(request,options={}){const url=typeof request==='string'?request:request.url;return cacheStores.get(options.ignoreSearch?url.split('?')[0]:url)?.clone();}
  };
  const cacheNames=[`shiwake:${scope}:v0.9.0`,'unrelated-cache','shiwake:https://test.example/other/:v1.0.0'];
  let claimed=false,network=0,skip=false;
  const self={registration:{scope},location:{origin:'https://test.example'},clients:{claim:async()=>claimed=true},skipWaiting:()=>{skip=true;},addEventListener:(name,fn)=>listeners[name]=fn};
  vm.runInNewContext(source,{self,URL,Request,Response,Promise,caches:{open:async()=>cache,keys:async()=>cacheNames,delete:async key=>deleted.push(key)},fetch:async()=>{network++;if(offline)throw new Error('OFFLINE');return new Response('network');}});
  const fire=async(name,event={})=>{let work;listeners[name]({...event,waitUntil:p=>work=p,respondWith:p=>work=p});return await work;};
  return {scope,fire,cacheStores,deleted,state:()=>({claimed,network,skip}),offline:()=>offline=true};
}
for(const path of ['/','/shiwake-training/','/nested/custom-name/'])test(`Service Worker: ${path} 配下で事前保存・オフライン取得・更新キャッシュの分離`,async()=>{
  const w=await makeWorker(path);await w.fire('install');assert.equal(w.cacheStores.size,12);
  await w.fire('activate');assert.equal(w.state().claimed,true);assert.deepEqual(w.deleted,[`shiwake:${w.scope}:v0.9.0`]);
  let status;await w.fire('message',{data:{type:'CHECK_READY'},ports:[{postMessage:data=>status=data}]});assert.equal(status.ready,true);
  w.offline();
  for(const file of ['','index.html','app.js','core.js','storage.js','questions.js','styles.css','manifest.json','icons/apple-touch-icon.png']){
    const request={method:'GET',url:w.scope+file,mode:file.endsWith('.html')||!file?'navigate':'cors'};
    const response=await w.fire('fetch',{request});assert.equal(response.status,200);assert.ok(await response.text());
  }
  assert.equal(w.state().network,0);
  await w.fire('message',{data:{type:'SKIP_WAITING'}});assert.equal(w.state().skip,true);
});
test('ManifestとHTMLがサブディレクトリ対応の相対パス、アイコンの実在',async()=>{
  const m=JSON.parse(await readFile(root+'manifest.json','utf8'));assert.equal(m.start_url,'./');assert.equal(m.scope,'./');assert.equal(m.display,'standalone');
  for(const icon of m.icons){assert.ok(icon.src.startsWith('./'));await stat(root+icon.src);}
  const html=await readFile(root+'index.html','utf8');assert.match(html,/viewport-fit=cover/);assert.match(html,/apple-mobile-web-app-capable/);assert.doesNotMatch(html,/(?:src|href)="\//);
});
