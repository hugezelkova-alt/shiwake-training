// ファイルや問題を更新するたび、このVERSIONを必ず変更してください。
const VERSION = 'v1.0.1';
const PREFIX = `shiwake:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = ['./','./index.html','./styles.css','./app.js','./core.js','./storage.js','./questions.js','./manifest.json','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png'];
const absolute = path => new URL(path,self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // 全資産を保存できた場合だけインストール成功。更新途中の自動切替はしない。
    await cache.addAll(ASSETS.map(path=>new Request(absolute(path),{cache:'reload'})));
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith(PREFIX)&&n!==CACHE).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data?.type==='CHECK_READY')event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    const ready=(await Promise.all(ASSETS.map(p=>cache.match(absolute(p))))).every(Boolean);
    event.ports[0]?.postMessage({ready,version:VERSION});
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // ページとコードを同じバージョンから提供し、新旧の組合せを避ける。
    if(event.request.mode==='navigate' && (url.pathname===new URL(self.registration.scope).pathname || url.pathname===new URL('index.html',self.registration.scope).pathname)) {
      return await cache.match(absolute('./index.html')) || fetch(event.request);
    }
    const cached=await cache.match(event.request,{ignoreSearch:true});
    if(cached)return cached;
    return fetch(event.request);
  })());
});
