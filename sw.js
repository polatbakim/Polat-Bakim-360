const CACHE_NAME='polat-bakim-360-v20261002-mobile-correction';
const APP_SHELL=['./','./index.html','./operator.html','./styles.css','./fault-catalog.css','./completion-time.css','./avatar-alignment.css','./app.js','./machine-import.js','./supabase-config.js','./supabase-cloud.js','./vendor/xlsx.full.min.js','./vendor/qrcode.min.js','./manifest.webmanifest','./icons/polat-bakim.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);if(url.origin!==location.origin)return;
  if(url.pathname.endsWith('/supabase-config.js')){event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match(event.request)));return}
  if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',copy));return response}).catch(()=>caches.match('./index.html')));return}
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy))}return response})))
});
self.addEventListener('push',event=>{let data={};try{data=event.data?.json?.()||{body:event.data?.text?.()||''}}catch{data={body:event.data?.text?.()||''}};event.waitUntil(self.registration.showNotification(data.title||'Yeni iş emri atandı',{body:data.body||'Size yeni bir bakım işi atandı.',icon:'./icons/polat-bakim.svg',badge:'./icons/polat-bakim.svg',tag:data.tag||`assignment-${data.orderId||Date.now()}`,renotify:true,data:{orderId:data.orderId||'',url:data.url||`./index.html?role=operator${data.orderId?`&order=${encodeURIComponent(data.orderId)}`:''}`}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=new URL(event.notification.data?.url||'./index.html?role=operator',self.location.origin).href;event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{const current=windows.find(client=>client.url.includes('index.html'));if(current){current.navigate(target);return current.focus()}return clients.openWindow(target)}))});
