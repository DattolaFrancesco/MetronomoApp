// English strings — the source of truth for every user-facing string in the
// app. lib/translations/it.ts is typed against this file's shape (`typeof
// en`), so TypeScript fails to compile if a translation is ever missing a
// key this file has. See lib/i18n.tsx for how these are looked up at
// runtime (dotted-path key, e.g. "settings.title").

export const en = {
  common: {
    subdivision: {
      quarter: "Quarters",
      eighth: "Eighths",
      triplet: "Triplets",
      sixteenth: "Sixteenths",
    },
    status: {
      onTime: "ON TIME",
      early: "EARLY",
      late: "LATE",
    },
    timingAnalysis: "Timing Analysis",
    start: "Start",
    stop: "Stop",
    goBack: "Go back",
    retry: "Retry",
  },
  tourButtons: {
    next: "Next",
    back: "Back",
    skip: "Skip",
    done: "Done",
  },
  setup: {
    trainingTab: "Training",
    challengeTab: "Challenge",
    microphone: "Microphone",
    tap: "Tap",
    bars: "Bars",
    tempo: "Tempo",
    start: "Start",
  },
  home: {
    noteToEvaluate: "Note to evaluate",
    tolerance: "Tolerance",
    ready: "READY",
    listening: "LISTENING",
  },
  settings: {
    title: "Settings",
    language: {
      sectionTitle: "Language",
      english: "English",
      italian: "Italiano",
    },
    tutorials: {
      sectionTitle: "Tutorials",
      replayMain: "Replay main tutorial",
      replayChallenge: "Replay challenge tutorial",
    },
  },
  mainTour: {
    setupBars: {
      title: "Bars",
      description:
        "How many bars the session lasts — the metronome stops itself once they're done.",
    },
    setupSubdivision: {
      title: "Subdivision",
      description:
        "Which rhythmic subdivision to practice against — quarters, eighths, triplets, or sixteenths.",
    },
    setupInputMode: {
      title: "Microphone or Tap",
      description:
        "Microphone listens for real hits through your mic. Tap lets you practice by pressing a button instead — no mic needed.",
    },
    setupStart: {
      title: "Start",
      description: "Starts the metronome with a short count-in, then begins tracking your timing.",
    },
    sessionBeatIndicator: {
      title: "Beat indicator",
      description:
        "These dots pulse in real time with the metronome's beat, so you can follow the tempo visually too.",
    },
    sessionStop: {
      title: "Stop",
      description: "Stops the session at any time — you don't have to wait for it to finish on its own.",
    },
    reportResult: {
      title: "Result",
      description: "The headline number for the session — the percentage of hits that landed on time.",
    },
    reportStatus: {
      title: "Early, on time, late",
      description:
        "The same result broken down by how each hit missed, when it did — early, on time, or late.",
    },
    reportDebugChart: {
      title: "Timing Analysis",
      description: "The full waveform against the beat grid — the red line marks exactly where each hit landed.",
    },
  },
  challengeTour: {
    list: {
      title: "Challenges",
      description: "Ordered easiest to hardest, top to bottom.",
    },
    difficultyBadge: {
      title: "Difficulty",
      description:
        "Easy, Medium, Hard, Expert — harder tiers ask for more (or trickier) subdivisions and a tighter timing tolerance.",
    },
    cardFirst: {
      title: "A challenge",
      description: "Tap any card to see its details and start it.",
    },
    tolerance: {
      title: "Tolerance",
      description: "How close to the beat every hit needs to land to pass — tighter on harder challenges.",
    },
  },
  challengeScreen: {
    difficulty: {
      facile: "Easy",
      medio: "Medium",
      difficile: "Hard",
      expert: "Expert",
    },
    title: "Challenge",
    masteryBanner: "You're a Timing Master",
    view: "View",
    toleranceLabel: "±{{ms}}ms tolerance",
    report: {
      passedTitle: "You crushed it!",
      failedTitle: "Not quite!",
      passedSubtitle: "All {{count}} hits were on time.",
      failedSubtitle: "Not all hits were on time — try again!",
      onTimeCount: "{{onTime}} of {{total}} on time",
      barLabel: "Bar {{n}} — {{label}}",
      missed: "missed",
    },
  },
  sessionReport: {
    title: "Session report",
    result: "Result",
    noHits: "No hits detected in this session.",
    onTimeCount: "{{onTime}} of {{total}} hits on time",
    newSession: "New session",
  },
  syncRecorder: {
    inputAudio: "Input audio",
    micNotAuthorized: "Microphone not authorized. Enable access in settings to see the sync.",
    tip: "Tip: use headphones or earbuds for more precise detection — this keeps the mic from also picking up the metronome's own click.",
  },
  tapRecorder: {
    inputTap: "Input tap",
    soundToggle: "Sound",
    tap: "Tap",
    tapsCount: "{{count}} taps",
    hintArmed: "Tap the button in time with the metronome.",
    hintIdle: "Tap the button to start — no microphone needed.",
  },
  wiredHeadphonesNotice: {
    title: "For accurate results, use wired headphones",
    body: "This app measures your timing down to the millisecond. Bluetooth headphones add audio delay that throws off the measurement — even a great pair can be off by 100ms or more. For precise results, use wired headphones. This also keeps the mic from picking up the metronome's own click.",
    dontShowAgain: "Don't show this again",
    gotIt: "Got it",
  },
  micPermissionGate: {
    title: "Microphone access required",
    body: "Timing compares your timing against the metronome using the microphone. You need to grant access to continue.",
    allowAccess: "Allow access",
    openSettings: "Open settings",
    useTapInstead: "Use Tap instead — no microphone needed",
  },
  debugChart: {
    description: {
      tap: {
        triplet:
          "The numbered white lines mark the quarters (the downbeat), the thinner lines the two triplet subdivisions. Each line is a tap — green if on time, red if outside tolerance.",
        sixteenth:
          "The numbered white lines mark the quarters (the downbeat), the thinner lines the three inner sixteenths. Each line is a tap — green if on time, red if outside tolerance.",
        default:
          "The numbered white lines mark the quarters, the short dashes the sixteenths. Each line is a tap — green if on time, red if outside tolerance.",
      },
      mic: {
        triplet:
          "The numbered white lines mark the quarters (the downbeat), the thinner lines the two triplet subdivisions. The solid red line is the peak detected by the microphone.",
        sixteenth:
          "The numbered white lines mark the quarters (the downbeat), the thinner lines the three inner sixteenths. The solid red line is the peak detected by the microphone.",
        default:
          "The numbered white lines mark the quarters, the short dashes the sixteenths. The solid red line is the peak detected by the microphone.",
      },
    },
    legend: {
      quarter: "quarter",
      tripletSubdivisions: "triplet subdivisions",
      innerSixteenths: "inner sixteenths",
      onTime: "on time",
      outOfTolerance: "out of tolerance",
      hit: "hit",
    },
    barLabel: "Bar {{n}}",
  },
  debugHitTable: {
    description:
      "For each quarter: outcome, the strongest peak found in the listening window, and how much it rose from the preceding minimum — compared against the minimum thresholds (amplitude {{amplitude}}, rise {{rise}}).",
    barLabel: "Bar {{n}}",
    notDetected: "NOT DETECTED",
    peak: "peak",
    rise: "rise",
  },
  challenges: {
    "battere-poi-levare": {
      name: "Downbeat → Upbeat",
      description:
        "One bar on the downbeat (the quarters), then immediately one bar on the upbeat (the off-beat eighths).",
    },
    "levare-poi-battere": {
      name: "Upbeat → Downbeat",
      description: "The same pair as the previous challenge, but reversed: upbeat first, then immediately the downbeat.",
    },
    "battere-levare-battere": {
      name: "Downbeat → Upbeat → Downbeat",
      description: "Three bars in a row: one on the downbeat, then one on the upbeat, then back to the downbeat.",
    },
    "battere-poi-sedicesimo2": {
      name: "Downbeat → 2nd Sixteenth",
      description:
        "One bar on the downbeat (the quarters), then immediately one bar on the second sixteenth of each quarter.",
    },
    "battere-poi-terzina3": {
      name: "Downbeat → 3rd Triplet",
      description: "One bar on the downbeat (the quarters), then immediately one bar on the third note of each triplet.",
    },
    "sedicesimo2-battere-sedicesimo4": {
      name: "2nd Sixteenth → Downbeat → 4th Sixteenth",
      description: "Three bars in a row: the second sixteenth of each quarter, then the downbeat, then the fourth sixteenth.",
    },
    "levare-poi-sedicesimo2": {
      name: "Upbeat → 2nd Sixteenth",
      description:
        "One bar on the upbeat (the off-beat eighths), then immediately one bar on the second sixteenth of each quarter.",
    },
    "giro-sedicesimi": {
      name: "1st → 2nd → 3rd → 4th Sixteenth",
      description:
        "Four bars in a row, one per sixteenth-note position within the beat: first the downbeat, then the second, third, and fourth sixteenth in turn.",
    },
    "doppia-alternanza-levare": {
      name: "Alternating 16th/Downbeat → Upbeat → Alternating 16th/Upbeat",
      description:
        "Three bars: the first alternates the second sixteenth and the downbeat every quarter, the second bar is all upbeat, and the third alternates the fourth sixteenth and the upbeat every quarter.",
    },
    "battere-levare-terzina3": {
      name: "Downbeat → Upbeat → 3rd Triplet",
      description: "Three bars in a row, each with a different subdivision: quarters, then upbeat, then the third note of the triplet.",
    },
    "alternanza-battuta": {
      name: "Alternating Within a Bar",
      description:
        "A single bar: the 1st and 3rd quarters are played on the downbeat, the 2nd and 4th on the second sixteenth — the subdivision change happens within the same bar.",
    },
  },
};
