// ABOUTME: Plays the iMessage receive sound for incoming texts in HAH Messages.
// ABOUTME: One chime per text; a flood layers into an overwhelming wall of sound.

// The receive chime lives in public/ so it ships as a static asset.
const SOUND_URL = "/imessage-sound.wav";

const ENABLED_STORAGE_KEY = "hah.messages.sound";

// A preloaded base element. Each play clones it so simultaneous chimes layer
// instead of restarting one shared clip — under a flood they pile up by design.
let base: HTMLAudioElement | null = null;

// Sound is on by default; the user can mute it via the header toggle.
let enabled = ((): boolean => {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(ENABLED_STORAGE_KEY) !== "0";
})();

export function isMessageSoundEnabled(): boolean {
  return enabled;
}

export function setMessageSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(ENABLED_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

function getBase(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!base) {
    base = new Audio(SOUND_URL);
    base.preload = "auto";
  }
  return base;
}

// Play the receive chime once per call. Each chime is its own audio node, so
// overlapping arrivals layer rather than cut each other off. Fails silently
// when the browser blocks playback (e.g. no user gesture yet).
export function playMessageSound(): void {
  if (!enabled) return;
  const src = getBase();
  if (!src) return;
  const chime = src.cloneNode() as HTMLAudioElement;
  void chime.play().catch(() => {});
}
