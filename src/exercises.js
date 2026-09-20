// Built-in exercise library and starter templates.
// These ship with the app for every user (not stored in the database) --
// only exercises/templates a person adds themselves are saved per-account.

export const DEFAULT_EXERCISES = [
  { id: "bench-press", name: "Bench Press", cat: "Chest" },
  { id: "incline-db-press", name: "Incline Dumbbell Press", cat: "Chest" },
  { id: "push-up", name: "Push-Up", cat: "Chest" },
  { id: "cable-fly", name: "Cable Fly", cat: "Chest" },
  { id: "pull-up", name: "Pull-Up", cat: "Back" },
  { id: "barbell-row", name: "Barbell Row", cat: "Back" },
  { id: "lat-pulldown", name: "Lat Pulldown", cat: "Back" },
  { id: "deadlift", name: "Deadlift", cat: "Back" },
  { id: "seated-cable-row", name: "Seated Cable Row", cat: "Back" },
  { id: "back-squat", name: "Back Squat", cat: "Legs" },
  { id: "front-squat", name: "Front Squat", cat: "Legs" },
  { id: "leg-press", name: "Leg Press", cat: "Legs" },
  { id: "romanian-deadlift", name: "Romanian Deadlift", cat: "Legs" },
  { id: "walking-lunge", name: "Walking Lunge", cat: "Legs" },
  { id: "calf-raise", name: "Calf Raise", cat: "Legs" },
  { id: "overhead-press", name: "Overhead Press", cat: "Shoulders" },
  { id: "lateral-raise", name: "Lateral Raise", cat: "Shoulders" },
  { id: "rear-delt-fly", name: "Rear Delt Fly", cat: "Shoulders" },
  { id: "bicep-curl", name: "Bicep Curl", cat: "Arms" },
  { id: "hammer-curl", name: "Hammer Curl", cat: "Arms" },
  { id: "tricep-pushdown", name: "Tricep Pushdown", cat: "Arms" },
  { id: "skull-crusher", name: "Skull Crusher", cat: "Arms" },
  { id: "plank", name: "Plank", cat: "Core" },
  { id: "hanging-leg-raise", name: "Hanging Leg Raise", cat: "Core" },
  { id: "cable-crunch", name: "Cable Crunch", cat: "Core" },
  { id: "russian-twist", name: "Russian Twist", cat: "Core" }
].map((e) => ({ ...e, isCustom: false }));

export const CAT_ORDER = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];

export const DEFAULT_TEMPLATES = [
  {
    id: "default-push-day",
    name: "Push Day",
    exerciseIds: ["bench-press", "overhead-press", "incline-db-press", "tricep-pushdown", "lateral-raise"],
    isCustom: false
  },
  {
    id: "default-pull-day",
    name: "Pull Day",
    exerciseIds: ["pull-up", "barbell-row", "lat-pulldown", "bicep-curl", "seated-cable-row"],
    isCustom: false
  },
  {
    id: "default-leg-day",
    name: "Leg Day",
    exerciseIds: ["back-squat", "romanian-deadlift", "leg-press", "calf-raise", "walking-lunge"],
    isCustom: false
  }
];
