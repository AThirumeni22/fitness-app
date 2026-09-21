// The exercise library is large (800+ entries with demonstration images), so
// it isn't bundled into the JS -- it ships as a static JSON file
// (public/exercises-data.json, sourced from the free-exercise-db open
// dataset) and is fetched once at startup, in parallel with the user's
// Supabase data. See README.md for attribution/licensing notes.

export const CAT_ORDER = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];

let cached = null;

export async function fetchExerciseLibrary() {
  if (cached) return cached;
  const res = await fetch("/exercises-data.json");
  if (!res.ok) throw new Error("Couldn't load the exercise library (" + res.status + ")");
  const data = await res.json();
  cached = data.map((e) => ({ ...e, isCustom: false }));
  return cached;
}

export const DEFAULT_TEMPLATES = [
  {
    id: "default-push-day",
    name: "Push Day",
    exerciseIds: [
      "Barbell_Bench_Press_-_Medium_Grip",
      "Standing_Military_Press",
      "Barbell_Incline_Bench_Press_-_Medium_Grip",
      "Cable_Incline_Triceps_Extension",
      "Side_Lateral_Raise"
    ],
    targets: {},
    isCustom: false
  },
  {
    id: "default-pull-day",
    name: "Pull Day",
    exerciseIds: [
      "Pullups",
      "Bent_Over_Barbell_Row",
      "Full_Range-Of-Motion_Lat_Pulldown",
      "Barbell_Curl",
      "Seated_Cable_Rows"
    ],
    targets: {},
    isCustom: false
  },
  {
    id: "default-leg-day",
    name: "Leg Day",
    exerciseIds: [
      "Barbell_Squat",
      "Romanian_Deadlift",
      "Leg_Press",
      "Seated_Calf_Raise",
      "Dumbbell_Lunges"
    ],
    targets: {},
    isCustom: false
  }
];
