// Authored bounded static data port from src/reference/solfege.ts; not an upstream source.
export const MODE_SAMPLES = {
  major: [
    ["Do", "1P", "Home, rest, stability", "The foundation. Complete resolution.", "foundation, trust, warmth from peace", "circle"],
    ["Re", "2M", "Forward motion, stepping up", "Moving away from home with purpose.", "hopeful lift, gentle curiosity", "mist"],
    ["Mi", "3M", "Bright, joyful optimism", "Sunny and optimistic, wants to rise.", "clarity and rising joy", "sparkle"],
    ["Fa", "4P", "Tension, unease", "Unstable, wants to fall back to Mi.", "inward pull, leaning fall, yearning", "diamond"],
    ["Sol", "5P", "Strength, confidence, dominance", "Confident and stable, but not quite home.", "a triumphant beacon", "star"],
    ["La", "6M", "Longing, wistfulness", "Beautiful sadness, reaching for Do.", "emotional openness, romantic ache", "circle"],
    ["Ti", "7M", "Urgency, restlessness", "Restless, must resolve up to Do!", "spiritual tension, strong upward pull", "sparkle"]
  ],
  minor: [
    ["Do", "1P", "Grounded, somber home", "Dark but stable foundation.", "dignified stability with emotional weight", "circle"],
    ["Re", "2M", "Gentle, uncertain step", "Cautious movement forward.", "cautious, introverted motion", "mist"],
    ["Me", "3m", "Melancholy, introspection", "Minor third - tender sadness.", "tender vulnerability", "diamond"],
    ["Fa", "4P", "Tension, yearning", "Same tension, deeper in minor.", "a shadowed inward pull", "circle"],
    ["Sol", "5P", "Bittersweet strength", "Strong but tinged with sadness.", "noble sorrow with resilience", "star"],
    ["Le", "6m", "Deep longing, sorrow", "Minor sixth - profound yearning.", "grounded grief, ancient ache", "mist"],
    ["Te", "7m", "Gentle leading, subdued", "Softer leading tone than Ti.", "shadowed anticipation", "sparkle"]
  ]
};

export function samplesFor(mode) {
  return MODE_SAMPLES[mode] ?? MODE_SAMPLES.major;
}
