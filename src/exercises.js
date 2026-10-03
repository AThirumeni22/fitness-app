// The built-in exercise library (~100 common lifts with plain names and
// drawn animations) lives in library.js and ships with the app.
//
// Older versions used a much larger library with different ids. Templates,
// history and in-progress workouts can still contain those ids, so
// public/exercises-legacy.json maps each old id to its new exercise
// ({ map: { oldId: newId } }) or, if there's no equivalent, keeps its old
// name and category ({ names: { oldId: [name, cat] } }).

import { LIBRARY } from "./library.js";

export const CAT_ORDER = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];

export async function fetchExerciseLibrary() {
  return LIBRARY.map((e) => ({ ...e }));
}

let legacy = null;
export async function fetchLegacyExercises() {
  if (legacy) return legacy;
  try {
    const res = await fetch("/exercises-legacy.json");
    legacy = res.ok ? await res.json() : { map: {}, names: {} };
  } catch (e) {
    legacy = { map: {}, names: {} };
  }
  return legacy;
}

export const DEFAULT_TEMPLATES = [
  {
    id: "default-push-day",
    name: "Push Day",
    exerciseIds: [
      "barbell-bench-press",
      "barbell-overhead-press",
      "barbell-incline-press",
      "cable-overhead-triceps-extension",
      "dumbbell-lateral-raise"
    ],
    targets: {},
    isCustom: false
  },
  {
    id: "default-pull-day",
    name: "Pull Day",
    exerciseIds: [
      "pull-up",
      "barbell-row",
      "cable-lat-pulldown",
      "barbell-curl",
      "cable-seated-row"
    ],
    targets: {},
    isCustom: false
  },
  {
    id: "default-leg-day",
    name: "Leg Day",
    exerciseIds: [
      "barbell-squat",
      "barbell-romanian-deadlift",
      "machine-leg-press",
      "machine-seated-calf-raise",
      "dumbbell-lunge"
    ],
    targets: {},
    isCustom: false
  }
];
