// Push notifications on this device: checking support, turning them on/off.
// The server side (who gets told what) lives in
// supabase/migration_6_notifications.sql and supabase/functions/send-push.

import { supabase } from "./supabaseClient.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

// "ok" | "unsupported" | "ios-install-needed" | "denied" | "not-configured"
export function pushSupport() {
  if (!VAPID_PUBLIC_KEY) return "not-configured";
  // iPhone/iPad only allow web push for apps added to the Home Screen.
  if (isIos() && !isStandalone()) return "ios-install-needed";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function isPushEnabled() {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  try { return !!(await currentSubscription()); } catch (e) { return false; }
}

export async function enablePush() {
  const support = pushSupport();
  if (support !== "ok") throw new Error(support);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "dismissed");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  const json = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 300)
  });
  if (error) throw error;
}

// Re-save this device's subscription for whoever is signed in now (a
// subscription can be rotated by the browser, or the device can change hands).
export async function syncPushSubscription() {
  try {
    if (!(await isPushEnabled())) return;
    const json = (await currentSubscription()).toJSON();
    await supabase.rpc("save_push_subscription", {
      p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 300)
    });
  } catch (e) {}
}

export async function disablePush() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  } catch (e) {}
}
