const CACHE="mood-atlas-v27-20260809223515";
const ASSETS=["./","./index.html","./guide.html","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png","./icon-maskable-512.png"];
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS).catch(function(){});}).then(function(){return self.skipWaiting();}));});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener("fetch",function(e){
  if(e.request.method!=="GET")return;
  if(e.request.mode==="navigate"){ /* 页面导航：网络优先，保证新部署立即生效 */
    e.respondWith(fetch(e.request).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});return res;}).catch(function(){return caches.match(e.request).then(function(r){return r||caches.match("./index.html");});}));
    return;
  }
  e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,cp);});return res;}).catch(function(){return caches.match("./index.html");});}));
});