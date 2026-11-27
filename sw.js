/* 站点加速 Service Worker
 * 策略：
 *  - 页面导航（index.html 及 ?a= 深链）：SWR —— 缓存秒回，后台静默更新
 *  - articles.js / g/ 分站页：SWR —— 缓存秒回，后台静默更新
 *  - 图片等静态资源：缓存优先（内容带 hash 语义，基本不变）
 *  - 统计接口等第三方请求：完全不接管
 */
var CACHE = 'gg-v3';
var SWR_URLS = ['/game-guide/', '/game-guide/index.html', '/game-guide/assets/articles.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 预缓存核心文件：第一次访问后，之后断网/慢网也能秒开 */
      return Promise.all(SWR_URLS.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k !== CACHE ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 第三方（统计接口）不接管

  /* 页面导航：去掉 query 缓存秒回（?a=xxx 深链由页面 JS 自己处理），后台静默更新 */
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    var path = url.pathname;
    if (path === '/game-guide' || path === '/game-guide/') path = '/game-guide/index.html';
    e.respondWith(swr(path));
    return;
  }
  /* 文章数据与分站页：SWR */
  var p = url.pathname;
  if (p === '/game-guide/assets/articles.js' || p.indexOf('/game-guide/g/') === 0) {
    e.respondWith(swr(req));
    return;
  }
  /* 其余同站资源（图片/css）：缓存优先 */
  if (p.indexOf('/game-guide/assets/') === 0 || p === '/game-guide/robots.txt' || p === '/game-guide/sitemap.xml') {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var cp = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, cp); });
          }
          return res;
        });
      })
    );
  }
});

/* stale-while-revalidate：缓存秒回 + 后台更新 */
function swr(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200) c.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  });
}
