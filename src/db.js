// Thin data-access layer over Supabase. Every function scopes to the
// signed-in user via RLS (see supabase/schema.sql and
// supabase/migration_2_social.sql) -- we still pass user_id explicitly on
// writes since Postgres defaults don't cover it here.

import { supabase } from "./supabaseClient.js";

// ================= profile =================

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("unit, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: created, error: insertErr } = await supabase
      .from("profiles")
      .insert({ id: userId, unit: "kg" })
      .select("unit, display_name, avatar_url")
      .single();
    if (insertErr) throw insertErr;
    return created;
  }
  return data;
}

export async function setUnit(userId, unit) {
  const { error } = await supabase.from("profiles").upsert({ id: userId, unit });
  if (error) throw error;
}

export async function updateProfile(userId, { displayName, avatarUrl } = {}) {
  const patch = { id: userId };
  if (displayName !== undefined) patch.display_name = displayName;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
  const { data, error } = await supabase
    .from("profiles")
    .upsert(patch)
    .select("unit, display_name, avatar_url")
    .single();
  if (error) throw error;
  return data;
}

export async function uploadAvatar(userId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/avatar.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

// ================= exercises / templates =================

export async function listCustomExercises(userId) {
  const { data, error } = await supabase
    .from("custom_exercises")
    .select("id, name, cat")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((e) => ({ ...e, isCustom: true }));
}

export async function addCustomExercise(userId, name, cat) {
  const { data, error } = await supabase
    .from("custom_exercises")
    .insert({ user_id: userId, name, cat })
    .select("id, name, cat")
    .single();
  if (error) throw error;
  return { ...data, isCustom: true };
}

export async function deleteCustomExercise(id) {
  const { error } = await supabase.from("custom_exercises").delete().eq("id", id);
  if (error) throw error;
}

export async function listTemplates(userId) {
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, exercise_ids, targets")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((t) => ({ id: t.id, name: t.name, exerciseIds: t.exercise_ids, targets: t.targets || {}, isCustom: true }));
}

export async function addTemplate(userId, name, exerciseIds, targets) {
  const { data, error } = await supabase
    .from("templates")
    .insert({ user_id: userId, name, exercise_ids: exerciseIds, targets: targets || {} })
    .select("id, name, exercise_ids, targets")
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, exerciseIds: data.exercise_ids, targets: data.targets || {}, isCustom: true };
}

export async function updateTemplate(id, name, exerciseIds, targets) {
  const { data, error } = await supabase
    .from("templates")
    .update({ name, exercise_ids: exerciseIds, targets: targets || {} })
    .eq("id", id)
    .select("id, name, exercise_ids, targets")
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, exerciseIds: data.exercise_ids, targets: data.targets || {}, isCustom: true };
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) throw error;
}

// ================= workouts =================

export async function listWorkouts(userId) {
  const { data, error } = await supabase
    .from("workouts")
    .select("id, date, duration_sec, exercises")
    .eq("user_id", userId)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map((w) => ({
    id: w.id,
    date: w.date,
    durationSec: w.duration_sec,
    exercises: w.exercises
  }));
}

export async function saveWorkout(userId, workout) {
  const { error } = await supabase.from("workouts").insert({
    user_id: userId,
    date: workout.date,
    duration_sec: workout.durationSec,
    exercises: workout.exercises
  });
  if (error) throw error;
}

// Own workouts + friends' workouts in a date range (used by the calendar).
// RLS (workouts + is_friend()) enforces you only ever get back rows you're
// actually allowed to see, even if a stale friend id sneaks into userIds.
export async function listWorkoutsInRange(userIds, startIso, endIso) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("workouts")
    .select("id, user_id, date, duration_sec, exercises")
    .in("user_id", userIds)
    .gte("date", startIso)
    .lt("date", endIso)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data || []).map((w) => ({
    id: w.id, userId: w.user_id, date: w.date, durationSec: w.duration_sec, exercises: w.exercises
  }));
}

// ================= friends =================

export async function findUserByEmail(email) {
  const { data, error } = await supabase.rpc("find_user_by_email", { lookup_email: email.trim() });
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

export async function getProfilesPublic(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.rpc("get_profiles_public", { ids });
  if (error) throw error;
  return data || [];
}

export async function sendFriendRequest(userId, friendId) {
  const { error } = await supabase.from("friendships").insert({ user_id: userId, friend_id: friendId, status: "pending" });
  if (error) throw error;
}

export async function acceptFriendRequest(id) {
  const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
  if (error) throw error;
}

export async function removeFriendship(id) {
  const { error } = await supabase.from("friendships").delete().eq("id", id);
  if (error) throw error;
}

export async function listFriendships(userId) {
  const { data, error } = await supabase
    .from("friendships")
    .select("id, user_id, friend_id, status, created_at")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  if (error) throw error;
  const rows = data || [];
  const otherIds = [...new Set(rows.map((r) => (r.user_id === userId ? r.friend_id : r.user_id)))];
  const profiles = await getProfilesPublic(otherIds);
  const byId = {};
  profiles.forEach((p) => { byId[p.id] = p; });
  const withProfile = rows.map((r) => {
    const otherId = r.user_id === userId ? r.friend_id : r.user_id;
    return { ...r, otherId, otherProfile: byId[otherId] || { id: otherId, display_name: null, avatar_url: null } };
  });
  return {
    accepted: withProfile.filter((r) => r.status === "accepted"),
    incoming: withProfile.filter((r) => r.status === "pending" && r.friend_id === userId),
    outgoing: withProfile.filter((r) => r.status === "pending" && r.user_id === userId)
  };
}

// ================= day posts (calendar photos/videos) =================

export async function uploadDayMedia(userId, file) {
  const isVideo = file.type.startsWith("video/");
  const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("day-media").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("day-media").getPublicUrl(path);
  return { url: data.publicUrl, type: isVideo ? "video" : "image" };
}

export async function addDayPost(userId, dateStr, mediaUrl, mediaType, caption) {
  const { data, error } = await supabase
    .from("day_posts")
    .insert({ user_id: userId, post_date: dateStr, media_url: mediaUrl, media_type: mediaType, caption: caption || null })
    .select("id, user_id, post_date, media_url, media_type, caption")
    .single();
  if (error) throw error;
  return { id: data.id, userId: data.user_id, date: data.post_date, mediaUrl: data.media_url, mediaType: data.media_type, caption: data.caption };
}

export async function deleteDayPost(id) {
  const { error } = await supabase.from("day_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function listDayPosts(userIds, startDate, endDate) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from("day_posts")
    .select("id, user_id, post_date, media_url, media_type, caption, created_at")
    .in("user_id", userIds)
    .gte("post_date", startDate)
    .lte("post_date", endDate)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((p) => ({
    id: p.id, userId: p.user_id, date: p.post_date, mediaUrl: p.media_url, mediaType: p.media_type, caption: p.caption
  }));
}

// ================= gym plans (propose a time, vote) =================

export async function createGymPlan(userId, title, optionIsoDates) {
  const { data: plan, error } = await supabase
    .from("gym_plans")
    .insert({ creator_id: userId, title })
    .select("id, creator_id, title, created_at")
    .single();
  if (error) throw error;
  const rows = optionIsoDates.map((iso) => ({ plan_id: plan.id, starts_at: iso }));
  const { error: optErr } = await supabase.from("gym_plan_options").insert(rows);
  if (optErr) throw optErr;
  return plan;
}

export async function listGymPlans(userId, friendIds) {
  const ids = [userId, ...friendIds];
  const { data: plans, error } = await supabase
    .from("gym_plans")
    .select("id, creator_id, title, created_at")
    .in("creator_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!plans || !plans.length) return [];
  const planIds = plans.map((p) => p.id);
  const [{ data: options, error: optErr }, { data: votes, error: voteErr }] = await Promise.all([
    supabase.from("gym_plan_options").select("id, plan_id, starts_at").in("plan_id", planIds),
    supabase.from("gym_plan_votes").select("plan_id, option_id, user_id").in("plan_id", planIds)
  ]);
  if (optErr) throw optErr;
  if (voteErr) throw voteErr;
  return plans.map((p) => ({
    id: p.id,
    creatorId: p.creator_id,
    title: p.title,
    createdAt: p.created_at,
    options: (options || [])
      .filter((o) => o.plan_id === p.id)
      .map((o) => ({
        id: o.id,
        startsAt: o.starts_at,
        voterIds: (votes || []).filter((v) => v.option_id === o.id).map((v) => v.user_id)
      }))
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
  }));
}

export async function voteGymPlanOption(planId, optionId, userId) {
  const { error } = await supabase.from("gym_plan_votes").insert({ plan_id: planId, option_id: optionId, user_id: userId });
  if (error) throw error;
}

export async function unvoteGymPlanOption(optionId, userId) {
  const { error } = await supabase.from("gym_plan_votes").delete().eq("option_id", optionId).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteGymPlan(id) {
  const { error } = await supabase.from("gym_plans").delete().eq("id", id);
  if (error) throw error;
}
