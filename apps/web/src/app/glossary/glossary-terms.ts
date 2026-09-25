/**
 * The glossary's content. `inForge` ties each term to how this app actually uses it, so
 * numbers here must stay in sync with the code they describe -- the fitness model
 * (apps/api/src/fitness/fitness-model.ts), the dashboard's form bands
 * (dashboard-page.component.ts, formDescription) and the plan generator's zones
 * (apps/api/src/plan-generator/workout-library.ts).
 */

export type GlossaryCategory = 'load' | 'thresholds' | 'intensity' | 'workouts' | 'planning' | 'races' | 'data';

export interface GlossaryTerm {
  /** URL fragment on /glossary, and the key <app-term> looks up. */
  id: string;
  term: string;
  /** What the abbreviation stands for, when it is one. */
  fullName?: string;
  category: GlossaryCategory;
  /** One sentence, shown in the inline hint. */
  short: string;
  body: string[];
  inForge?: string;
  related?: string[];
}

export const GLOSSARY_CATEGORIES: { id: GlossaryCategory; label: string }[] = [
  { id: 'load', label: 'Training load' },
  { id: 'thresholds', label: 'Thresholds' },
  { id: 'intensity', label: 'Intensity & zones' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'planning', label: 'Planning' },
  { id: 'races', label: 'Race distances' },
  { id: 'data', label: 'Data & sync' },
];

export const GLOSSARY: GlossaryTerm[] = [
  // Training load
  {
    id: 'tss',
    term: 'TSS',
    fullName: 'Training Stress Score',
    category: 'load',
    short: 'How much stress a workout put on your body, from its duration and intensity. One hour at threshold = 100.',
    body: [
      'TSS combines how long you trained with how hard, relative to your own threshold: TSS = IF² × hours × 100. An hour at exactly threshold scores 100; an hour of easy riding at IF 0.6 scores 36.',
      'Because intensity is squared, hard efforts count for much more than their duration alone suggests.',
    ],
    inForge:
      'Completed workouts use the best available intensity: the matched Strava activity’s power, pace or heart rate against your thresholds, else the intensity implied by the planned steps, else an easy-effort default (IF 0.55). The builder shows a live TSS estimate from step targets.',
    related: ['if', 'np', 'ctl', 'atl'],
  },
  {
    id: 'if',
    term: 'IF',
    fullName: 'Intensity Factor',
    category: 'load',
    short: 'How hard a workout was relative to your threshold: 1.0 is threshold, 0.7 is steady endurance.',
    body: [
      'IF is your effort divided by your threshold: normalized power ÷ FTP on the bike, threshold pace ÷ actual pace for running and swimming (faster than threshold gives IF above 1), or heart rate ÷ threshold heart rate.',
      'As a rough guide: under 0.75 is easy/endurance, 0.75–0.85 tempo, 0.85–0.95 sweet spot, around 1.0 a threshold effort you could hold for about an hour.',
    ],
    inForge: 'A %-of-threshold step target in the builder is its IF: a step at 90% is IF 0.9.',
    related: ['tss', 'np', 'ftp'],
  },
  {
    id: 'np',
    term: 'NP',
    fullName: 'Normalized Power',
    category: 'load',
    short: 'An adjusted average power that reflects how hard a variable ride really felt.',
    body: [
      'Surges cost more than their share of plain average power suggests. NP takes a 30-second rolling average of power, raises it to the 4th power, averages that, and takes the 4th root, so hard surges weigh more.',
      'For a steady ride NP ≈ average power; for a punchy group ride NP can be 10–20% higher.',
    ],
    inForge:
      'Strava sync only fetches whole-activity averages (no second-by-second data yet), so Forge uses average power in place of NP. Bike TSS therefore reads slightly low on very variable rides.',
    related: ['if', 'tss', 'ftp'],
  },
  {
    id: 'ctl',
    term: 'CTL',
    fullName: 'Chronic Training Load (“Fitness”)',
    category: 'load',
    short: 'Your fitness: roughly your average daily TSS over the last 6 weeks.',
    body: [
      'CTL is an exponentially weighted average of daily TSS with a 42-day time constant: CTL today = CTL yesterday + (TSS today − CTL yesterday) ÷ 42. Rest days count as 0, so fitness slowly fades without training.',
      'It rises slowly, so a big week barely moves it; consistency does. Ironman athletes often peak somewhere around 80–120, but the right number is individual.',
    ],
    inForge: 'Shown on the dashboard as Fitness, with dashed lines projecting it forward from the workouts on your calendar.',
    related: ['atl', 'tsb', 'tss', 'ramp-rate'],
  },
  {
    id: 'atl',
    term: 'ATL',
    fullName: 'Acute Training Load (“Fatigue”)',
    category: 'load',
    short: 'Your fatigue: roughly your average daily TSS over the last week.',
    body: [
      'ATL is the same kind of average as CTL but with a 7-day time constant: ATL today = ATL yesterday + (TSS today − ATL yesterday) ÷ 7. It reacts quickly: it jumps after a hard block and drops within days of rest.',
    ],
    inForge: 'Shown on the dashboard as Fatigue.',
    related: ['ctl', 'tsb'],
  },
  {
    id: 'tsb',
    term: 'TSB',
    fullName: 'Training Stress Balance (“Form”)',
    category: 'load',
    short: 'Your form: fitness minus fatigue. Negative while training hard, positive when rested.',
    body: [
      'TSB = yesterday’s CTL − yesterday’s ATL: how fresh you are coming into the day. During a build it sits negative (you’re carrying fatigue); a taper lets fatigue drop faster than fitness, so form turns positive for race day.',
    ],
    inForge:
      'The dashboard reads it as: above +25 very fresh (fitness fades if this lasts), +5 to +25 fresh, −10 to +5 neutral, −30 to −10 productive training, below −30 heavy load (watch for overreaching).',
    related: ['ctl', 'atl', 'taper'],
  },
  {
    id: 'pmc',
    term: 'Performance Management Chart',
    category: 'load',
    short: 'The chart of fitness (CTL), fatigue (ATL) and form (TSB) over time.',
    body: [
      'Popularized by TrainingPeaks, it plots the three numbers together so you can see a build (fitness climbing, form negative), a recovery week (fatigue dropping) and a taper (form rising into race day) at a glance.',
    ],
    inForge: 'The Performance chart on the dashboard; the dashed part is projected from your planned workouts.',
    related: ['ctl', 'atl', 'tsb'],
  },
  {
    id: 'ramp-rate',
    term: 'Ramp rate',
    category: 'load',
    short: 'How fast training load increases week on week.',
    body: [
      'Increasing load too fast is a classic route to injury or illness. A common rule of thumb is to raise weekly volume by no more than about 10% at a time, and to follow a few building weeks with an easier one.',
    ],
    inForge: 'The plan generator never raises a load week’s hours by more than 10% over the previous one.',
    related: ['ctl', 'recovery-week', 'periodization'],
  },

  // Thresholds
  {
    id: 'ftp',
    term: 'FTP',
    fullName: 'Functional Threshold Power',
    category: 'thresholds',
    short: 'The highest power you can sustain for about an hour on the bike, in watts.',
    body: [
      'FTP anchors every bike intensity: zones, IF and TSS are all percentages of it. The usual estimate is 95% of your average power in an all-out 20-minute test after a thorough warm-up.',
      'Retest every 6–8 weeks during a build; an out-of-date FTP makes every target and TSS number wrong.',
    ],
    inForge: 'Set in Settings → Thresholds & zones. Converts %-of-FTP steps into watts, and Strava average power into TSS.',
    related: ['if', 'np', 'zones', 'sweet-spot'],
  },
  {
    id: 'threshold-pace',
    term: 'Threshold pace',
    category: 'thresholds',
    short: 'The fastest running pace you can hold for about an hour, per kilometre.',
    body: [
      'For many runners it falls between 10K and half-marathon race pace. A simple test: run 30 minutes all-out on your own; your average pace for the last 20 minutes approximates threshold pace.',
      'Running intensity is the inverse of pace: faster (fewer seconds per km) means harder.',
    ],
    inForge: 'Set in Settings (mm:ss per km). A run step at 90% is 90% of threshold speed, i.e. a slightly slower pace.',
    related: ['if', 'lthr', 'zones'],
  },
  {
    id: 'css',
    term: 'CSS',
    fullName: 'Critical Swim Speed',
    category: 'thresholds',
    short: 'Your threshold swim pace per 100 m: the pace you can hold for a long continuous swim.',
    body: [
      'Swim a 400 m and a 200 m time trial (well rested between them). CSS pace per 100 m = (400 m time − 200 m time) ÷ 2. For example, 6:40 and 3:00 give (400 s − 180 s) ÷ 2 = 1:50 per 100 m.',
    ],
    inForge: 'Set in Settings as the swim threshold pace. Generated “CSS intervals” are short repeats at 100% of it.',
    related: ['threshold-pace', 'zones'],
  },
  {
    id: 'lthr',
    term: 'Threshold heart rate',
    fullName: 'Lactate threshold heart rate (LTHR)',
    category: 'thresholds',
    short: 'Your heart rate at threshold effort, used when there’s no power or pace to go on.',
    body: [
      'A common field test (Joe Friel’s): a 30-minute solo all-out effort; your average heart rate over the last 20 minutes approximates LTHR. It differs between cycling and running, often a few beats lower on the bike.',
      'Heart rate lags effort and drifts with heat, fatigue and caffeine, so it’s a coarser intensity signal than power or pace.',
    ],
    inForge: 'Set in Settings. The fallback for TSS when a synced activity has no power (bike) or pace (run, swim).',
    related: ['ftp', 'threshold-pace', 'if'],
  },

  // Intensity & zones
  {
    id: 'zones',
    term: 'Training zones',
    category: 'intensity',
    short: 'Bands of intensity, as percentages of your threshold, each with a different training purpose.',
    body: [
      'A typical bike scale (% of FTP): recovery under 55%, endurance 56–75%, tempo 76–90%, sweet spot 88–94%, threshold 91–105%, VO2max 106–120%. Run and swim zones follow the same idea against threshold pace or CSS.',
      'Most endurance training, often around 80% of it, sits in the easy zones; the hard sessions matter because they’re few.',
    ],
    inForge:
      'Power, pace and heart-rate steps in the builder can target a % of threshold instead of a fixed number, so the same workout stays correct as your thresholds change.',
    related: ['ftp', 'endurance', 'tempo', 'sweet-spot', 'vo2max'],
  },
  {
    id: 'endurance',
    term: 'Endurance (Zone 2)',
    category: 'intensity',
    short: 'Steady, conversational effort: the bulk of triathlon training.',
    body: [
      'Easy enough to talk in full sentences and hold for hours. It builds the aerobic engine, fat use and durability that long-course racing depends on.',
    ],
    inForge: 'Generated endurance rides are at 68% of FTP; long runs at 78% of threshold pace.',
    related: ['zones', 'tempo'],
  },
  {
    id: 'tempo',
    term: 'Tempo',
    category: 'intensity',
    short: 'Moderately hard, steady effort: faster than endurance, well below threshold.',
    body: ['Sustainable for an hour or more with focus. Useful for muscular endurance, and close to Ironman bike race effort.'],
    inForge: 'Build-phase long rides include tempo blocks at about 78% of FTP.',
    related: ['zones', 'endurance', 'sweet-spot'],
  },
  {
    id: 'sweet-spot',
    term: 'Sweet spot',
    category: 'intensity',
    short: 'Just below threshold (about 88–94% of FTP): a lot of fitness for manageable fatigue.',
    body: [
      'Hard enough to raise FTP, easy enough to recover from and repeat within a week, typically done as 10–20 minute intervals.',
    ],
    inForge: 'Generated sweet-spot intervals target 88% of FTP.',
    related: ['zones', 'ftp', 'tempo'],
  },
  {
    id: 'vo2max',
    term: 'VO2max',
    category: 'intensity',
    short: 'The top of your aerobic range: very hard efforts of 3–8 minutes.',
    body: [
      'VO2max is the maximum rate your body can use oxygen. Intervals near it (roughly 106–120% of FTP) raise your aerobic ceiling. They’re short, hard and fatiguing, so used sparingly.',
    ],
    inForge: 'Peak-phase bike sessions for Sprint/Olympic plans use 4-minute efforts at 108% of FTP.',
    related: ['zones', 'ftp'],
  },
  {
    id: 'rpe',
    term: 'RPE',
    fullName: 'Rate of Perceived Exertion',
    category: 'intensity',
    short: 'How hard an effort feels, on a 1–10 scale.',
    body: [
      '1 is barely moving, 5 a steady conversational pace, 7 comfortably hard, 9–10 all-out. It needs no device and captures things power and heart rate miss, like heat or accumulated fatigue.',
    ],
    inForge: 'Any builder step can target an RPE instead of power, pace or heart rate; for TSS it counts as IF ≈ RPE ÷ 10.',
    related: ['zones', 'if'],
  },
  {
    id: 'race-pace',
    term: 'Race pace',
    category: 'intensity',
    short: 'The effort you plan to hold on race day. Much lower for an Ironman than a sprint.',
    body: [
      'The longer the race, the lower the sustainable intensity. Rough bike targets: Ironman about 70% of FTP, 70.3 about 80%, Olympic about 90%, Sprint about 95%. Rehearsing it in training teaches pacing and fuelling.',
    ],
    inForge: 'The plan generator’s race-pace blocks use these values: bike 72/80/90/95% of FTP and run 80/86/95/100% of threshold pace (Ironman/70.3/Olympic/Sprint).',
    related: ['brick', 'zones'],
  },

  // Workouts
  {
    id: 'intervals',
    term: 'Intervals',
    category: 'workouts',
    short: 'Repeated hard efforts separated by recovery, like “4 × 8 min at threshold, 4 min easy”.',
    body: [
      'Breaking hard work into repeats lets you accumulate more time at an intensity than one continuous effort would.',
    ],
    inForge: 'In the builder, a repeat group holds the on/off steps and a repeat count.',
    related: ['zones', 'fartlek'],
  },
  {
    id: 'brick',
    term: 'Brick',
    category: 'workouts',
    short: 'A run straight off the bike, to practise running on tired legs.',
    body: [
      'The first minutes of running after a hard ride feel heavy and uncoordinated. Short brick runs train that transition and your race-pace rhythm. The name is usually explained as legs that feel “like bricks”.',
    ],
    inForge: 'Generated plans add a 15–30 minute brick run after the long ride from the build phase on (not for Sprint).',
    related: ['race-pace', 'long-sessions'],
  },
  {
    id: 'long-sessions',
    term: 'Long ride / long run',
    category: 'workouts',
    short: 'The week’s longest session in each sport: the backbone of endurance.',
    body: [
      'Mostly easy, progressively longer through a plan, and the place to rehearse race nutrition. Later in a plan they include race-pace segments.',
    ],
    inForge: 'The plan generator puts them on your chosen days, capped by race distance (e.g. up to 6 h riding and 2 h 45 running for an Ironman).',
    related: ['endurance', 'brick', 'race-pace'],
  },
  {
    id: 'fartlek',
    term: 'Fartlek',
    category: 'workouts',
    short: 'Swedish for “speed play”: unstructured bursts of faster running within an easy run.',
    body: ['A low-pressure way to add some speed, especially in the base phase.'],
    inForge: 'Base-phase run sessions use 6 × 1 min fast / 2 min easy.',
    related: ['intervals', 'strides'],
  },
  {
    id: 'strides',
    term: 'Strides',
    category: 'workouts',
    short: 'Short, relaxed accelerations of 20–30 seconds, near sprint speed but not straining.',
    body: ['They improve running form and leg speed without adding meaningful fatigue.'],
    inForge: 'Race-week runs include 4 × 30 s strides.',
    related: ['openers', 'fartlek'],
  },
  {
    id: 'drills',
    term: 'Drills',
    category: 'workouts',
    short: 'Technique exercises (swimming especially) that isolate one part of the stroke.',
    body: ['Swimming speed is mostly technique. Drills such as catch-up, fingertip drag or single-arm target body position and the catch.'],
    inForge: 'Generated technique swims start with 10 minutes of drills.',
    related: ['css'],
  },
  {
    id: 'openers',
    term: 'Openers',
    category: 'workouts',
    short: 'Short sessions with a few race-pace efforts just before a race, to feel sharp.',
    body: ['They wake the legs up without adding fatigue. Typically 2–3 days out, with the day before the race kept very easy or off.'],
    inForge: 'Race week in a generated plan is only openers (a short swim, bike and run), and the day before the race stays free.',
    related: ['taper', 'strides'],
  },

  // Planning
  {
    id: 'periodization',
    term: 'Periodization',
    category: 'planning',
    short: 'Organising training into phases that build toward a race: base, build, peak, taper.',
    body: [
      'Each phase has a purpose: first build aerobic volume, then add intensity, then make training race-specific, then shed fatigue. Phases are usually planned backwards from race day.',
    ],
    inForge: 'The plan generator counts phases back from your target race; if time is short, the earliest phases shrink first.',
    related: ['base', 'build', 'peak', 'taper'],
  },
  {
    id: 'base',
    term: 'Base phase',
    category: 'planning',
    short: 'The foundation: mostly easy aerobic volume, growing week by week.',
    body: ['Builds the aerobic engine, durability and technique that later, harder training relies on.'],
    inForge: 'Mostly endurance sessions with sweet-spot bike work and fartlek runs.',
    related: ['periodization', 'build', 'endurance'],
  },
  {
    id: 'build',
    term: 'Build phase',
    category: 'planning',
    short: 'Adds harder work (threshold intervals, tempo, bricks) on top of the base.',
    body: ['Volume keeps rising, and intensity is introduced to raise threshold and muscular endurance.'],
    inForge: 'Threshold intervals, tempo blocks in long rides, race-pace finishes on long runs, and brick runs.',
    related: ['periodization', 'base', 'peak'],
  },
  {
    id: 'peak',
    term: 'Peak phase',
    category: 'planning',
    short: 'The biggest, most race-specific weeks, just before the taper.',
    body: ['Training looks most like the race: long sessions with race-pace sections and bricks.'],
    inForge: 'Your peak-week hours are reached here: 3 weeks for 70.3/Ironman, 2 for shorter races.',
    related: ['periodization', 'build', 'taper'],
  },
  {
    id: 'taper',
    term: 'Taper',
    category: 'planning',
    short: 'Cutting training before a race so fatigue clears while fitness stays.',
    body: [
      'Fatigue (ATL) falls within days while fitness (CTL) fades slowly, so a well-judged taper leaves you fit and fresh: form (TSB) turns positive for race day. Volume drops; a little intensity stays.',
    ],
    inForge: 'Ironman: 2 taper weeks at 70% then 50% of peak hours; 70.3 and Olympic: 1 week at 60%; then race week.',
    related: ['tsb', 'openers', 'peak'],
  },
  {
    id: 'recovery-week',
    term: 'Recovery week',
    category: 'planning',
    short: 'A lighter week, usually every 3rd or 4th, so your body absorbs the training.',
    body: ['Adaptation happens during recovery, not during the work. A “3:1” rhythm is three building weeks followed by one easier week.'],
    inForge: 'Every 4th base/build week in a generated plan drops to 65% of the previous week’s hours, with no hard sessions.',
    related: ['ramp-rate', 'periodization'],
  },

  // Race distances
  {
    id: 'ironman',
    term: 'Ironman',
    fullName: 'Full distance (140.6)',
    category: 'races',
    short: '3.8 km swim, 180 km bike, 42.2 km run.',
    body: ['Typically 9–17 hours. Pacing and nutrition matter as much as fitness. “Ironman” is a brand; “full distance” is the generic name.'],
    related: ['half-ironman', 'race-pace'],
  },
  {
    id: 'half-ironman',
    term: '70.3',
    fullName: 'Half distance',
    category: 'races',
    short: '1.9 km swim, 90 km bike, 21.1 km run (70.3 miles in total).',
    body: ['Typically 4–7 hours, raced noticeably harder than a full distance.'],
    related: ['ironman', 'olympic'],
  },
  {
    id: 'olympic',
    term: 'Olympic',
    fullName: 'Standard distance',
    category: 'races',
    short: '1.5 km swim, 40 km bike, 10 km run.',
    body: ['Around 2–3 hours for most age-groupers; raced close to threshold.'],
    related: ['sprint', 'half-ironman'],
  },
  {
    id: 'sprint',
    term: 'Sprint',
    category: 'races',
    short: '750 m swim, 20 km bike, 5 km run.',
    body: ['Around an hour to 90 minutes; raced hard from the start.'],
    related: ['olympic'],
  },

  // Data & sync
  {
    id: 'planned-vs-actual',
    term: 'Planned vs actual',
    category: 'data',
    short: 'A workout’s target (what the plan said) next to what you really did.',
    body: [
      'Every workout can carry both: target duration, distance and intensity from a plan, and actual values once done.',
    ],
    inForge:
      'Strava sync fills in the actual side by matching an activity to a planned workout on the same date and discipline. A wrong match can be undone with “Unmatch”.',
    related: ['strava-sync'],
  },
  {
    id: 'strava-sync',
    term: 'Strava sync',
    category: 'data',
    short: 'Pulls your recorded activities from Strava into Forge (read-only).',
    body: ['Forge never writes to Strava.'],
    inForge:
      'Settings → Strava. Each synced activity either completes a planned workout on the same day and discipline, or becomes a new completed workout.',
    related: ['planned-vs-actual', 'tss'],
  },
  {
    id: 'ics',
    term: 'ICS',
    fullName: 'iCalendar',
    category: 'data',
    short: 'The standard calendar file format, used by Apple, Google and Outlook calendars.',
    body: ['An ICS feed is a URL a calendar app subscribes to and refreshes periodically.'],
    inForge: 'Settings → Calendar sync gives you a private feed URL so your workouts appear in your phone’s calendar. Plan import also accepts .ics files.',
    related: ['fit-tcx'],
  },
  {
    id: 'fit-tcx',
    term: '.fit / .tcx',
    category: 'data',
    short: 'Workout file formats used by Garmin and other devices and apps.',
    body: ['.fit is Garmin’s compact binary format; .tcx is an older XML format. Both can describe structured workouts (steps and targets).'],
    inForge: 'Settings → Plan import accepts both, keeping their structured steps.',
    related: ['ics'],
  },
];

export const GLOSSARY_BY_ID = new Map(GLOSSARY.map((t) => [t.id, t]));
