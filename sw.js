// Agendio: aplicativo instalável e avisos no celular. Não guarda páginas em cache de propósito (assim o sistema sempre abre atualizado).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});   // presença do tratador mantém o app instalável em todos os navegadores

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titulo: 'Agendio', corpo: e.data ? e.data.text() : '' }; }
  const titulo = String(d.titulo || 'Agendio').slice(0, 120);
  e.waitUntil(self.registration.showNotification(titulo, {
    body: String(d.corpo || '').slice(0, 240),
    icon: '/icon-192.png', badge: '/favicon-192.png', tag: d.tipo || 'agendio', renotify: true,
    data: { url: /^\/[A-Za-z0-9/_?=&.-]{0,100}$/.test(d.url || '') ? d.url : '/saas' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/saas';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    for (const c of l) { if (c.url.includes('/saas') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
