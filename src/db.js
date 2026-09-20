// Thin data-access layer over Supabase. Every function scopes to the
// signed-in user via RLS (see supabase/schema.sql) -- we still pass
// user_id explicitly on writes since Postgres defaults don't cover it here.

import { supabase } from "./supabaseClient.js";

export async function getProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("unit").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: created, error: insertErr } = await supabase
      .from("profiles")
      .insert({ id: userId, unit: "kg" })
      .select("unit")
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
    .select("id, name, exercise_ids")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((t) => ({ id: t.id, name: t.name, exerciseIds: t.exercise_ids, isCustom: true }));
}

export async function addTemplate(userId, name, exerciseIds) {
  const { data, error } = await supabase
    .from("templates")
    .insert({ user_id: userId, name, exercise_ids: exerciseIds })
    .select("id, name, exercise_ids")
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, exerciseIds: data.exercise_ids, isCustom: true };
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) throw error;
}

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
