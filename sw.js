// Guarda en caché lo que Monvi descarga, para que funcione sin internet después de abrirla una vez con conexión.
const V = "monvi-v1";
const CDN = ["cdn.jsdelivr.net", "storage.googleapis.com", "fonts.googleapis.com", "fonts.gstatic.com"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(["./", "index.html", "css/style.css", "js/app.js", "js/frases.js", "senas.json", "frases.json"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.endsWith(".mp4")) return;       // videos: siempre directo
  const externo = CDN.includes(u.hostname);
  if (!externo && u.origin !== location.origin) return;
  e.respondWith(caches.open(V).then(async (c) => {
    const guardado = await c.match(e.request);
    const red = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => guardado);
    return externo ? (guardado || red) : (guardado ? (red.catch(() => {}), guardado) : red); // CDN: caché primero; propios: caché y se actualiza
  }));
});
