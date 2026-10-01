// Obonto — send-push Edge Function
//
// Called by a Database Webhook on INSERT into `notifications` (see README).
// Looks up every device the recipient turned notifications on for and sends
// the notification to each one as a Web Push message. Devices the push
// service says are gone (uninstalled, permission revoked) are removed.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
};

Deno.serve(async (req) => {
  let id: string | undefined;
  try {
    const payload = await req.json();
    id = payload?.record?.id;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!id) return new Response("No record", { status: 400 });

  // Only trust the id from the request: the anon key is public, so anyone
  // could call this function with a made-up payload. Re-reading the row means
  // only notifications the database triggers actually wrote ever get sent.
  const { data: record, error: recErr } = await supabase
    .from("notifications")
    .select("id, user_id, kind, title, body, url, created_at")
    .eq("id", id)
    .maybeSingle<NotificationRow & { created_at: string }>();
  if (recErr) return new Response(recErr.message, { status: 500 });
  if (!record) return new Response("Not found", { status: 404 });
  // Ignore replays of old rows.
  if (Date.now() - new Date(record.created_at).getTime() > 10 * 60 * 1000) return Response.json({ sent: 0, stale: true });

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", record.user_id);
  if (error) return new Response(error.message, { status: 500 });
  if (!subs || !subs.length) return Response.json({ sent: 0 });

  const message = JSON.stringify({
    id: record.id,
    title: record.title,
    body: record.body,
    url: record.url || "/",
    tag: record.kind
  });

  let sent = 0;
  const gone: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message,
        { TTL: 60 * 60 * 24 }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.id);
      else console.error("push failed", status, (err as Error).message);
    }
  }));

  if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  return Response.json({ sent, removed: gone.length });
});
