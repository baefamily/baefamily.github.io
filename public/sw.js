self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? JSON.parse(event.data.text()) : {};
  } catch {
    payload = { title: "Our Family", body: "새로운 가족 소식이 도착했어요." };
  }
  const title = payload.title || "Our Family";
  const options = {
    body: payload.body || "새로운 가족 소식이 도착했어요.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "our-family-update",
    renotify: true,
    data: { url: payload.url || "/" },
  };
  const jobs = [self.registration.showNotification(title, options)];
  if ("setAppBadge" in self.navigator && Number.isFinite(payload.badge)) {
    jobs.push(self.navigator.setAppBadge(payload.badge));
  }
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
