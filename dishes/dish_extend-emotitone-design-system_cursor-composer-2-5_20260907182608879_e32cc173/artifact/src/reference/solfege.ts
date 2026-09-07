/**
 * Solfege Data
 * Interval-driven movable-do identities with major/minor legacy overrides.
 */

import type { MusicalMode, SolfegeData } from "@/types/music";

export type { SolfegeData };

type SolfegeIdentity = Omit<SolfegeData, "number" | "intervalName" | "semitones">;

export const INTERVAL_TO_SOLFEGE: Record<string, string> = {
  "1P": "Do",
  "2m": "Ra",
  "2M": "Re",
  "3m": "Me",
  "3M": "Mi",
  "4P": "Fa",
  "4A": "Fi",
  "5d": "Se",
  "5P": "Sol",
  "6m": "Le",
  "6M": "La",
  "7m": "Te",
  "7M": "Ti",
};

export const MOVABLE_DO_SOLFEGE_NOTES = [
  "Do",
  "Ra",
  "Re",
  "Me",
  "Mi",
  "Fa",
  "Fi",
  "Se",
  "Sol",
  "Le",
  "La",
  "Te",
  "Ti",
];

export const INTERVAL_IDENTITY_MAP: Record<string, SolfegeIdentity> = {
  "1P": {
    name: "Do",
    emotion: "Home, rest, stability",
    description: "The tonic center. It makes the rest of the mode make sense.",
    fleckShape: "circle",
    texture: "foundation, trust, warmth from peace",
  },
  "2m": {
    name: "Ra",
    emotion: "Close friction, raw ache",
    description: "A tight rub above home. It glows with uneasy closeness.",
    fleckShape: "diamond",
    texture: "grainy tension, urgent nearness",
  },
  "2M": {
    name: "Re",
    emotion: "Forward motion, stepping up",
    description: "Movement away from home with momentum and curiosity.",
    fleckShape: "mist",
    texture: "hopeful lift, gentle curiosity",
  },
  "3m": {
    name: "Me",
    emotion: "Melancholy, introspection",
    description: "A tender inward turn that darkens the tonic without breaking it.",
    fleckShape: "diamond",
    texture: "tender vulnerability",
  },
  "3M": {
    name: "Mi",
    emotion: "Bright, joyful optimism",
    description: "A clear brightening that opens the mode into warmth.",
    fleckShape: "sparkle",
    texture: "clarity and rising joy",
  },
  "4P": {
    name: "Fa",
    emotion: "Tension, unease",
    description: "A leaning tone that wants to fall or resolve.",
    fleckShape: "diamond",
    texture: "inward pull, leaning fall, yearning",
  },
  "4A": {
    name: "Fi",
    emotion: "Lift, shimmer, surprise",
    description: "A sharpened fourth that opens a bright suspended skylight.",
    fleckShape: "sparkle",
    texture: "electric lift, suspended shine",
  },
  "5d": {
    name: "Se",
    emotion: "Blue strain, instability",
    description: "A narrowed fifth that sounds split, smoky, and unresolved.",
    fleckShape: "mist",
    texture: "smoke, grit, bent tension",
  },
  "5P": {
    name: "Sol",
    emotion: "Strength, confidence, dominance",
    description: "Stable and outward-facing. It gathers energy without landing home.",
    fleckShape: "star",
    texture: "a triumphant beacon",
  },
  "6m": {
    name: "Le",
    emotion: "Deep longing, sorrow",
    description: "A dark reach outward, full of memory and ache.",
    fleckShape: "mist",
    texture: "grounded grief, ancient ache",
  },
  "6M": {
    name: "La",
    emotion: "Longing, wistfulness",
    description: "Open yearning with tenderness and reach.",
    fleckShape: "circle",
    texture: "emotional openness, romantic ache",
  },
  "7m": {
    name: "Te",
    emotion: "Shadowed anticipation",
    description: "A softer leading pull that circles the tonic instead of piercing it.",
    fleckShape: "sparkle",
    texture: "shadowed anticipation",
  },
  "7M": {
    name: "Ti",
    emotion: "Urgency, restlessness",
    description: "A bright leading edge that urgently resolves upward to home.",
    fleckShape: "sparkle",
    texture: "spiritual tension, strong upward pull",
  },
};

const MAJOR_INTERVAL_OVERRIDES: Record<string, SolfegeIdentity> = {
  "1P": {
    name: "Do",
    emotion: "Home, rest, stability",
    description: "The foundation. Complete resolution.",
    fleckShape: "circle",
    texture: "foundation, trust, warmth from peace",
  },
  "2M": {
    name: "Re",
    emotion: "Forward motion, stepping up",
    description: "Moving away from home with purpose.",
    fleckShape: "mist",
    texture: "hopeful lift, gentle curiosity",
  },
  "3M": {
    name: "Mi",
    emotion: "Bright, joyful optimism",
    description: "Sunny and optimistic, wants to rise.",
    fleckShape: "sparkle",
    texture: "clarity and rising joy",
  },
  "4P": {
    name: "Fa",
    emotion: "Tension, unease",
    description: "Unstable, wants to fall back to Mi.",
    fleckShape: "diamond",
    texture: "inward pull, leaning fall, yearning",
  },
  "5P": {
    name: "Sol",
    emotion: "Strength, confidence, dominance",
    description: "Confident and stable, but not quite home.",
    fleckShape: "star",
    texture: "a triumphant beacon",
  },
  "6M": {
    name: "La",
    emotion: "Longing, wistfulness",
    description: "Beautiful sadness, reaching for Do.",
    fleckShape: "circle",
    texture: "emotional openness, romantic ache",
  },
  "7M": {
    name: "Ti",
    emotion: "Urgency, restlessness",
    description: "Restless, must resolve up to Do!",
    fleckShape: "sparkle",
    texture: "spiritual tension, strong upward pull",
  },
};

const MINOR_INTERVAL_OVERRIDES: Record<string, SolfegeIdentity> = {
  "1P": {
    name: "Do",
    emotion: "Grounded, somber home",
    description: "Dark but stable foundation.",
    fleckShape: "circle",
    texture: "dignified stability with emotional weight",
  },
  "2M": {
    name: "Re",
    emotion: "Gentle, uncertain step",
    description: "Cautious movement forward.",
    fleckShape: "mist",
    texture: "cautious, introverted motion",
  },
  "3m": {
    name: "Me",
    emotion: "Melancholy, introspection",
    description: "Minor third - tender sadness.",
    fleckShape: "diamond",
    texture: "tender vulnerability",
  },
  "4P": {
    name: "Fa",
    emotion: "Tension, yearning",
    description: "Same tension, deeper in minor.",
    fleckShape: "circle",
    texture: "a shadowed inward pull",
  },
  "5P": {
    name: "Sol",
    emotion: "Bittersweet strength",
    description: "Strong but tinged with sadness.",
    fleckShape: "star",
    texture: "noble sorrow with resilience",
  },
  "6m": {
    name: "Le",
    emotion: "Deep longing, sorrow",
    description: "Minor sixth - profound yearning.",
    fleckShape: "mist",
    texture: "grounded grief, ancient ache",
  },
  "7m": {
    name: "Te",
    emotion: "Gentle leading, subdued",
    description: "Softer leading tone than Ti.",
    fleckShape: "sparkle",
    texture: "shadowed anticipation",
  },
};

const MODE_IDENTITY_OVERRIDES: Partial<Record<MusicalMode, Record<string, SolfegeIdentity>>> = {
  major: MAJOR_INTERVAL_OVERRIDES,
  minor: MINOR_INTERVAL_OVERRIDES,
};

const C_MAJOR_INTERVAL_NAMES = ["1P", "2M", "3M", "4P", "5P", "6M", "7M"];
const C_MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const C_MINOR_INTERVAL_NAMES = ["1P", "2M", "3m", "4P", "5P", "6m", "7m"];
const C_MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

function getIdentityForInterval(
  intervalName: string,
  mode?: MusicalMode
): SolfegeIdentity {
  return (
    (mode && MODE_IDENTITY_OVERRIDES[mode]?.[intervalName]) ||
    INTERVAL_IDENTITY_MAP[intervalName] ||
    INTERVAL_IDENTITY_MAP["1P"]
  );
}

export function getSolfegeLabelForInterval(intervalName: string): string {
  return INTERVAL_TO_SOLFEGE[intervalName] || INTERVAL_TO_SOLFEGE["1P"];
}

export function createSolfegeData(
  intervalNames: string[],
  semitoneIntervals: number[],
  mode?: MusicalMode
): SolfegeData[] {
  return intervalNames.map((intervalName, index) => {
    const identity = getIdentityForInterval(intervalName, mode);

    return {
      ...identity,
      name: getSolfegeLabelForInterval(intervalName),
      number: index + 1,
      intervalName,
      semitones: semitoneIntervals[index] ?? 0,
    };
  });
}

export const MAJOR_SOLFEGE = createSolfegeData(
  C_MAJOR_INTERVAL_NAMES,
  C_MAJOR_INTERVALS,
  "major"
);

export const MINOR_SOLFEGE = createSolfegeData(
  C_MINOR_INTERVAL_NAMES,
  C_MINOR_INTERVALS,
  "minor"
);
