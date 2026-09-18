/** Logical sound bank for H5 — paths relative to Vite `public/`. */
export const H5_SOUND_BANK: Record<string, string[]> = {
  bgm: ['assets/audio/bgm-forest.mp3'],
  // Successful / heavy cleave — random-no-repeat axe hits (CC0).
  'chop:sweet': [
    'assets/audio/chop-1.mp3',
    'assets/audio/chop-2.mp3',
    'assets/audio/chop-3.mp3',
    'assets/audio/chop-4.mp3',
    'assets/audio/chop-5.mp3',
    'assets/audio/chop-6.mp3',
  ],
  'chop:too_heavy': [
    'assets/audio/chop-1.mp3',
    'assets/audio/chop-2.mp3',
    'assets/audio/chop-3.mp3',
    'assets/audio/chop-4.mp3',
    'assets/audio/chop-5.mp3',
    'assets/audio/chop-6.mp3',
  ],
  // Weak nick — softer wood crack + quieter chop variants.
  'chop:too_light': [
    'assets/audio/nick.mp3',
    'assets/audio/chop-2.mp3',
    'assets/audio/chop-5.mp3',
  ],
  // Too-thin camera nudge / thin tap.
  nudge: [
    'assets/audio/nudge-01.mp3',
    'assets/audio/nudge-03.mp3',
    'assets/audio/nudge-05.mp3',
  ],
};
