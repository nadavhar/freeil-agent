# Solar Audio — ambient space music + planet narration

A single dependency-free file (`solar-audio.js`, ~13 KB unminified) that adds two things to a
solar-system app:

1. **Ambient space music** — generated live in the browser with the Web Audio API. No audio
   files to host, no bandwidth cost, and it never loops audibly because every element is
   scheduled with randomised timing.
2. **Planet narration in a male voice** — Web Speech API, with copy for the Sun, all eight
   planets, the Moon and Pluto.

Both have their own on/off toggle, sized and positioned to work on desktop and mobile.

---

## Install

```html
<script src="solar-audio.js"></script>
```

That is the whole integration if your planets are already tagged:

```html
<button data-planet="Jupiter">Jupiter</button>
```

Any element carrying `data-planet` narrates when clicked or tapped. If your planets are canvas
or WebGL objects rather than DOM nodes, call the API directly from your existing click handler:

```js
SolarAudio.narrate('Jupiter');
```

Open `demo.html` for a working page.

### React / Vite

```jsx
import { useEffect } from 'react';

export function useSolarAudio() {
  useEffect(() => {
    const s = document.createElement('script');
    s.src = '/solar-audio.js';   // place the file in public/
    document.body.appendChild(s);
  }, []);
}

// then, in your planet click handler:
onClick={() => window.SolarAudio?.narrate(planet.name)}
```

Put `solar-audio.js` in `public/` so Vite serves it as-is. The module guards against double
initialisation, so React 18 StrictMode double-mounting is harmless.

---

## API

| Call | Does |
| --- | --- |
| `SolarAudio.narrate(name)` | Speaks that body's description. Returns `false` if narration is off or the name is unknown. Matching is case-insensitive and tolerates wrappers like `"planet-jupiter"`. |
| `SolarAudio.stopNarration()` | Stops mid-sentence. |
| `SolarAudio.setMusic(bool)` / `setVoice(bool)` | Drive the toggles programmatically. |
| `SolarAudio.isMusicOn()` / `isVoiceOn()` / `isSpeaking()` | Current state. |
| `SolarAudio.setPlanetTexts({ Mars: '…' })` | Replace or extend the narration copy. |
| `SolarAudio.getPlanetTexts()` | The current copy, for rendering as on-screen captions. |
| `SolarAudio.getVoice()` | The `SpeechSynthesisVoice` that was picked. |
| `SolarAudio.getAudioState()` | Diagnostics: context state, output level, voice count. |
| `SolarAudio.on(evt, fn)` | `musictoggle`, `voicetoggle`, `planetnarrated`, `narrationend`. |

---

## How the music is built

Everything runs through one graph: sources → slow-sweeping lowpass → master gain → duck gain →
compressor → output, with a parallel send into a convolver whose impulse response is generated
from decaying noise (a ~5.5 s hall).

- **Drone** — five oscillators at the root, fifth, octave, twelfth and double octave. Each has
  its own slow LFO on `detune`, so the layers beat against each other instead of sitting still
  like a test tone.
- **Chord drift** — every 22–32 s the root glides between A1, G1, C2 and F1 via
  `setTargetAtTime`, so harmony moves without any audible step.
- **Bells** — a sine tone from a minor pentatonic scale every 5–14 s, randomly panned, with a
  0.6 s attack and 5.5 s exponential decay.
- **Whoosh** — filtered noise sweeping 160 Hz → 1.5 kHz → 220 Hz every 28–54 s, sent to reverb only.
- **Limiter** — a `DynamicsCompressor` keeps the stacked layers from clipping on phone speakers.

Toggling off fades over 1.5 s and then **suspends** the AudioContext, releasing the audio
hardware. Toggling on rebuilds nothing — the graph is retained, so it restarts instantly.

## Voice selection

`speechSynthesis.getVoices()` is scored rather than matched on a fixed name, because the
available voices differ on every platform:

- +100 for names that are male across Chrome/Edge/Safari/Android (David, Guy, Mark, Alex,
  Daniel, Fred, George, James, Aaron, Arthur, Thomas, Oliver, Ryan)
- −100 for known female names (Zira, Samantha, Victoria, Karen, Moira, Tessa, Fiona, Hazel…)
- +25 for Natural/Enhanced/Premium/Neural variants, which sound far better than the compact defaults
- small bonuses for `en-GB`/`en-US` and local (offline) voices

`pitch` is set to 0.85 as a safety net, so even if a platform only ships female voices the
result still reads as male.

## Browser quirks handled

| Quirk | Handling |
| --- | --- |
| Autoplay policy blocks audio before interaction | Nothing is created until the first `pointerdown`/`touchstart`/`keydown`/`click` anywhere on the page; the saved preference is then applied. |
| iOS refuses speech unless primed in a gesture | A silent zero-volume utterance is spoken on that first gesture. |
| Chrome truncates utterances past ~15 s | Text is split on sentence boundaries into ≤180-char chunks and queued via `onend`, plus a 9 s pause/resume heartbeat (skipped on iOS, where it breaks playback). |
| Chrome loads voices asynchronously | Listens for `voiceschanged`, with a 5 s polling backstop for Android builds that never fire it. |
| Background tabs drain battery | `visibilitychange` suspends the context and pauses speech, resuming on return. |
| Music drowns out the narration | The music ducks to 22 % for the duration of a narration and ramps back afterwards. |
| Safari needs the prefixed constructor | `webkitAudioContext` fallback. |

## Mobile specifics

- Buttons are 48 px on desktop, 52 px on screens ≤640 px — above the 44 px minimum tap target.
- Positioned with `env(safe-area-inset-*)` so they clear the iPhone home indicator.
- `touch-action: manipulation` and a transparent tap highlight remove the 300 ms delay and the grey flash.
- `prefers-reduced-motion` disables the speaking pulse animation.
- Toggles carry `aria-pressed` and a descriptive `aria-label`.

While a narration is playing, the narration button becomes a **stop** button and pulses; tapping
it stops that sentence without switching the feature off. Tapping it when idle toggles the
feature. Both settings persist in `localStorage` (wrapped in try/catch for Safari private mode).

## Verification

Tested in headless Chromium at 390×780 and 1280×800:

- 0 page errors, 0 console errors
- No AudioContext created before the first gesture; `running` at level 0.55 after it
- Output measured with an analyser tapped onto the destination: RMS 0.054 → 0.144 as the pad
  fades in, sustained ~0.13, and 0.00003 after toggling off
- Context suspends on toggle-off and on tab-hide; resumes correctly on both
- Preferences survive a reload; `narrate()` returns `false` when narration is off or the name is
  unknown, and `true` for a fuzzy name like `"planet-jupiter"`

Headless Chromium ships no speech engine (`voiceCount: 0`), so voice *selection* could not be
exercised there — it needs a real browser. The narration path itself runs without errors and
degrades cleanly when no voice exists.
