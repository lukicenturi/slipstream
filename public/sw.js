/*
 * Slipstream service worker. It shows Web Push notifications from the push
 * Worker and opens the right page on a click. No caching, no offline logic.
 * The registration URL carries the push API URL and the VAPID public key:
 * /sw.js?api=<url>&vapid=<key>.
 */

const params = new URLSearchParams(self.location.search);
const API_URL = (params.get("api") || "").replace(/\/+$/, "");
const VAPID_KEY = params.get("vapid") || "";

// The app writes the last subscription body here (lib/push.ts), so that a
// renewed subscription keeps its watches.
const PAYLOAD_CACHE = "slipstream-push-v1";
const PAYLOAD_KEY = "/__slipstream/push-payload";

const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-72.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/** Only a path on this origin, never another site. */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function readPush(event) {
  if (!event.data) return {};
  try {
    const data = event.data.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener("push", (event) => {
  const data = readPush(event);
  const options = {
    body: text(data.body, ""),
    data: { url: safePath(data.url) },
    icon: ICON,
    badge: BADGE,
    renotify: false,
  };
  const tag = text(data.tag, "");
  if (tag) options.tag = tag;
  if (typeof data.time === "number" && Number.isFinite(data.time)) options.timestamp = data.time;
  event.waitUntil(
    self.registration.showNotification(text(data.title, "Slipstream"), options).catch(() => {}),
  );
});

async function openPage(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    try {
      await client.focus();
    } catch {
      // Focus needs the click gesture; the navigation below still runs.
    }
    try {
      await client.navigate(target);
    } catch {
      // Not controlled by this worker: the app navigates on this message.
      client.postMessage({ type: "slipstream:navigate", url: path });
    }
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openPage(safePath(data.url)).catch(() => {}));
});

function keyBytes(base64url) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function readStoredPayload() {
  try {
    const cache = await caches.open(PAYLOAD_CACHE);
    const response = await cache.match(PAYLOAD_KEY);
    if (!response) return null;
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

async function renewSubscription(event) {
  if (!API_URL || !VAPID_KEY) return;
  const stored = await readStoredPayload();
  if (!stored) return;
  const subscription =
    event.newSubscription ||
    (await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_KEY),
    }));
  const body = { ...stored, subscription: subscription.toJSON() };
  await fetch(`${API_URL}/subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (event.oldSubscription && event.oldSubscription.endpoint !== subscription.endpoint) {
    await fetch(`${API_URL}/subscriptions`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
    });
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(renewSubscription(event).catch(() => {}));
});
