/*
 * solar-audio.js — ambient space music + planet voice narration
 * ------------------------------------------------------------
 * Zero dependencies. Drop into any page:
 *
 *     <script src="solar-audio.js"></script>
 *
 * It injects a two-button control cluster (music / narration) and exposes:
 *
 *     SolarAudio.narrate('Jupiter')   // speak a planet's description
 *     SolarAudio.stopNarration()
 *     SolarAudio.setMusic(true|false)
 *     SolarAudio.setVoice(true|false)
 *     SolarAudio.setPlanetTexts({ Jupiter: '...' })   // override copy
 *     SolarAudio.on('planetnarrated', fn)
 *
 * Anything with data-planet="Mars" auto-narrates on click/tap.
 *
 * Browser autoplay rules mean audio can only begin inside a user gesture, so
 * the engine stays dormant until the first click/tap and then honours whatever
 * the user last had switched on (persisted in localStorage).
 */
(function () {
  'use strict';

  if (window.SolarAudio) return;

  var STORE_MUSIC = 'solarAudio.music';
  var STORE_VOICE = 'solarAudio.voice';

  var IS_IOS =
    /iP(hone|ad|od)/.test(navigator.platform) ||
    (navigator.userAgent.indexOf('Mac') > -1 && 'ontouchend' in document);

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) {
      /* private mode — fall back to session-only state */
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Narration copy                                                      */
  /* ------------------------------------------------------------------ */

  var PLANET_TEXTS = {
    Sun:
      'The Sun. A middle-aged yellow dwarf holding ninety-nine point eight percent of all the mass in the solar system. ' +
      'At its core, hydrogen fuses into helium at fifteen million degrees Celsius, and the light released takes tens of thousands of years to claw its way to the surface. ' +
      'Every planet you see here is a leftover crumb from the cloud that built it.',
    Mercury:
      'Mercury. The smallest planet, and the fastest, tearing around the Sun once every eighty-eight days. ' +
      'With almost no atmosphere to hold heat, its surface swings from four hundred and thirty degrees Celsius in daylight to minus one hundred and eighty at night. ' +
      'Its iron core fills three quarters of its diameter, making it the densest world after Earth.',
    Venus:
      'Venus. Nearly Earth\'s twin in size, and nothing like it in temperament. ' +
      'A crushing carbon dioxide atmosphere traps heat so effectively that the surface sits at four hundred and sixty-five degrees Celsius, hot enough to melt lead, hotter even than Mercury. ' +
      'Clouds of sulphuric acid race around the planet in four days, while the planet itself turns backwards, once every two hundred and forty-three.',
    Earth:
      'Earth. The only world we know of where the story got interesting. ' +
      'Seventy-one percent of the surface is liquid water, held there by a temperature and pressure balance no other planet in this system manages. ' +
      'A molten iron core generates the magnetic field that deflects the solar wind, and a large stabilising Moon keeps the axial tilt steady enough for seasons to stay predictable.',
    Moon:
      'The Moon. Born roughly four and a half billion years ago when a Mars-sized body struck the young Earth and threw debris into orbit. ' +
      'It is slowly drifting away, about three point eight centimetres a year, and it keeps one face permanently turned toward us. ' +
      'Its gravity is the engine behind our tides.',
    Mars:
      'Mars. A cold desert world with a thin carbon dioxide atmosphere and rust-red iron oxide dust covering everything. ' +
      'It holds Olympus Mons, the tallest volcano in the solar system at twenty-two kilometres, and Valles Marineris, a canyon system four thousand kilometres long. ' +
      'Dry river valleys and polar ice tell us liquid water ran here billions of years ago.',
    Jupiter:
      'Jupiter. A gas giant so massive that it outweighs every other planet combined, two and a half times over. ' +
      'The Great Red Spot is a storm wider than Earth that has been turning for at least three hundred and fifty years. ' +
      'Its ninety-five known moons include Europa, whose icy shell hides a salt water ocean holding more water than all of Earth\'s seas.',
    Saturn:
      'Saturn. The lightest planet in the solar system, less dense than water. ' +
      'Its rings stretch out roughly two hundred and eighty thousand kilometres yet are typically only about ten metres thick, made almost entirely of water ice. ' +
      'Titan, its largest moon, has a thick nitrogen atmosphere and lakes of liquid methane on its surface.',
    Uranus:
      'Uranus. An ice giant tipped on its side, rotating at ninety-eight degrees, most likely knocked over by an ancient collision. ' +
      'That tilt gives each pole a summer of forty-two years of continuous sunlight, followed by forty-two years of darkness. ' +
      'Methane in the upper atmosphere absorbs red light and gives the planet its pale blue-green colour.',
    Neptune:
      'Neptune. The most distant planet, thirty times further from the Sun than Earth, taking a hundred and sixty-five years to complete one orbit. ' +
      'It has the fiercest winds in the solar system, exceeding two thousand kilometres per hour. ' +
      'It was found in eighteen forty-six by mathematics rather than by telescope, predicted from irregularities in the orbit of Uranus.',
    Pluto:
      'Pluto. Reclassified as a dwarf planet in two thousand and six, it orbits in the Kuiper Belt on a path tilted and elongated enough to sometimes bring it inside Neptune\'s orbit. ' +
      'New Horizons flew past in twenty fifteen and revealed Sputnik Planitia, a vast plain of nitrogen ice with no impact craters at all, meaning the surface is being actively renewed.'
  };

  /* ------------------------------------------------------------------ */
  /* Tiny event emitter                                                  */
  /* ------------------------------------------------------------------ */

  var listeners = {};
  function on(evt, fn) {
    (listeners[evt] || (listeners[evt] = [])).push(fn);
  }
  function emit(evt, detail) {
    (listeners[evt] || []).forEach(function (fn) {
      try {
        fn(detail);
      } catch (e) {
        /* a bad listener must not break playback */
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Ambient music engine (procedural Web Audio)                         */
  /* ------------------------------------------------------------------ */

  var music = {
    ctx: null,
    master: null,   // overall level, used for fades
    duck: null,     // pulled down while narration plays
    bus: null,      // dry signal
    wet: null,      // reverb send
    filter: null,
    nodes: [],
    timers: [],
    running: false
  };

  // Root notes for the slow chord drift: A1, G1, C2, F1.
  var ROOTS = [55.0, 49.0, 65.41, 43.65];
  // Minor pentatonic offsets in semitones, for the sparse bell tones.
  var SCALE = [0, 3, 5, 7, 10, 12, 15];

  function semis(base, n) {
    return base * Math.pow(2, n / 12);
  }

  function makeReverbBuffer(ctx, seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function makeNoiseBuffer(ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ensureContext() {
    if (music.ctx) return music.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    music.ctx = new AC();
    return music.ctx;
  }

  function buildGraph() {
    var ctx = music.ctx;
    var now = ctx.currentTime;

    var master = ctx.createGain();
    master.gain.value = 0;

    var duck = ctx.createGain();
    duck.gain.value = 1;

    // A gentle limiter keeps the layered drones from clipping on phones.
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;

    master.connect(duck);
    duck.connect(comp);
    comp.connect(ctx.destination);

    // Slow lowpass sweep across the whole bed — this is what makes the drone
    // feel like it is breathing rather than sitting still.
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.2;
    filter.connect(master);

    var sweepLfo = ctx.createOscillator();
    sweepLfo.type = 'sine';
    sweepLfo.frequency.value = 0.025; // one full sweep every 40 seconds
    var sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 550;
    sweepLfo.connect(sweepDepth);
    sweepDepth.connect(filter.frequency);
    sweepLfo.start(now);

    var convolver = ctx.createConvolver();
    convolver.buffer = makeReverbBuffer(ctx, 5.5, 2.6);
    var wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(convolver);
    convolver.connect(master);

    var bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(filter);
    bus.connect(wet);

    music.master = master;
    music.duck = duck;
    music.filter = filter;
    music.bus = bus;
    music.wet = wet;
    music.nodes.push(sweepLfo, sweepDepth, convolver, comp);

    startDrones();
    scheduleChordDrift();
    scheduleBells();
    scheduleWhoosh();
  }

  var droneOscs = [];

  function startDrones() {
    var ctx = music.ctx;
    var now = ctx.currentTime;
    var root = ROOTS[0];

    // ratio = interval above the root, type, level, detune drift in cents
    var layers = [
      { ratio: 1, type: 'sine', gain: 0.20, drift: 3 },
      { ratio: 1.5, type: 'sine', gain: 0.11, drift: 5 },
      { ratio: 2, type: 'triangle', gain: 0.075, drift: 7 },
      { ratio: 3, type: 'triangle', gain: 0.035, drift: 9 },
      { ratio: 4, type: 'sine', gain: 0.022, drift: 11 }
    ];

    droneOscs = layers.map(function (layer, idx) {
      var osc = ctx.createOscillator();
      osc.type = layer.type;
      osc.frequency.value = root * layer.ratio;

      var gain = ctx.createGain();
      gain.gain.value = layer.gain;

      // Each layer drifts slightly out of tune with the others; the resulting
      // beating is what stops the pad sounding like a synth test tone.
      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05 + idx * 0.017;
      var depth = ctx.createGain();
      depth.gain.value = layer.drift;
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(now);

      osc.connect(gain);
      gain.connect(music.bus);
      osc.start(now);

      music.nodes.push(osc, gain, lfo, depth);
      return { osc: osc, ratio: layer.ratio };
    });
  }

  function scheduleChordDrift() {
    var i = 0;
    function drift() {
      if (!music.running) return;
      i = (i + 1) % ROOTS.length;
      var root = ROOTS[i];
      var t = music.ctx.currentTime;
      droneOscs.forEach(function (d) {
        // setTargetAtTime glides between chords instead of stepping.
        d.osc.frequency.setTargetAtTime(root * d.ratio, t, 4);
      });
      music.timers.push(setTimeout(drift, 22000 + Math.random() * 10000));
    }
    music.timers.push(setTimeout(drift, 20000));
  }

  function playBell() {
    var ctx = music.ctx;
    var now = ctx.currentTime;
    var root = ROOTS[Math.floor(Math.random() * ROOTS.length)] * 8;
    var freq = semis(root, SCALE[Math.floor(Math.random() * SCALE.length)]);

    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    var gain = ctx.createGain();
    var peak = 0.05 + Math.random() * 0.04;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.5);

    var dest = music.bus;
    if (ctx.createStereoPanner) {
      var pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      gain.connect(pan);
      pan.connect(dest);
      setTimeout(function () {
        try { pan.disconnect(); } catch (e) {}
      }, 7000);
    } else {
      gain.connect(dest);
    }

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 6);
    osc.onended = function () {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {}
    };
  }

  function scheduleBells() {
    function next() {
      if (!music.running) return;
      playBell();
      music.timers.push(setTimeout(next, 5000 + Math.random() * 9000));
    }
    music.timers.push(setTimeout(next, 3000));
  }

  function playWhoosh() {
    var ctx = music.ctx;
    var now = ctx.currentTime;

    var src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, 8);

    var band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(160, now);
    band.frequency.exponentialRampToValueAtTime(1500, now + 5);
    band.frequency.exponentialRampToValueAtTime(220, now + 8);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 3);
    gain.gain.linearRampToValueAtTime(0.0001, now + 8);

    src.connect(band);
    band.connect(gain);
    gain.connect(music.wet);
    src.start(now);
    src.stop(now + 8);
    src.onended = function () {
      try {
        src.disconnect();
        band.disconnect();
        gain.disconnect();
      } catch (e) {}
    };
  }

  function scheduleWhoosh() {
    function next() {
      if (!music.running) return;
      playWhoosh();
      music.timers.push(setTimeout(next, 28000 + Math.random() * 26000));
    }
    music.timers.push(setTimeout(next, 12000));
  }

  function clearTimers() {
    music.timers.forEach(clearTimeout);
    music.timers = [];
  }

  var TARGET_LEVEL = 0.55;

  function startMusic() {
    var ctx = ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();

    if (!music.master) {
      music.running = true;
      buildGraph();
    } else if (!music.running) {
      music.running = true;
      clearTimers();
      scheduleChordDrift();
      scheduleBells();
      scheduleWhoosh();
    }

    var now = ctx.currentTime;
    music.master.gain.cancelScheduledValues(now);
    music.master.gain.setValueAtTime(music.master.gain.value, now);
    music.master.gain.linearRampToValueAtTime(TARGET_LEVEL, now + 2.5);
    return true;
  }

  function stopMusic() {
    if (!music.ctx || !music.master) return;
    var now = music.ctx.currentTime;
    music.master.gain.cancelScheduledValues(now);
    music.master.gain.setValueAtTime(music.master.gain.value, now);
    music.master.gain.linearRampToValueAtTime(0.0001, now + 1.5);
    music.running = false;
    clearTimers();
    // Free the audio hardware once the fade has finished, but keep the graph
    // so toggling back on is instant.
    setTimeout(function () {
      if (!music.running && music.ctx && music.ctx.state === 'running') {
        music.ctx.suspend();
      }
    }, 1800);
  }

  function duckMusic(down) {
    if (!music.duck || !music.ctx) return;
    var now = music.ctx.currentTime;
    music.duck.gain.cancelScheduledValues(now);
    music.duck.gain.setValueAtTime(music.duck.gain.value, now);
    music.duck.gain.linearRampToValueAtTime(down ? 0.22 : 1, now + 0.4);
  }

  /* ------------------------------------------------------------------ */
  /* Narration (Web Speech API)                                          */
  /* ------------------------------------------------------------------ */

  var synth = window.speechSynthesis;
  var chosenVoice = null;
  var voicesReady = false;
  var speaking = false;
  var speechQueue = [];
  var heartbeat = null;

  // Voices commonly shipped as male across Chrome, Edge, Safari and Android.
  var MALE_NAMES = /(david|guy|mark|alex|daniel|fred|george|james|aaron|arthur|thomas|oliver|ryan|male)/i;
  var FEMALE_NAMES = /(zira|susan|samantha|victoria|karen|moira|tessa|fiona|hazel|catherine|female|woman)/i;

  function pickVoice() {
    if (!synth) return null;
    var voices = synth.getVoices() || [];
    if (!voices.length) return null;

    var english = voices.filter(function (v) {
      return /^en(-|_|$)/i.test(v.lang || '');
    });
    var pool = english.length ? english : voices;

    function score(v) {
      var name = v.name || '';
      var s = 0;
      if (MALE_NAMES.test(name)) s += 100;
      if (FEMALE_NAMES.test(name)) s -= 100;
      // Natural/Enhanced/Premium voices sound dramatically better than the
      // default compact ones, especially on iOS.
      if (/natural|enhanced|premium|neural/i.test(name)) s += 25;
      if (/^en-GB/i.test(v.lang)) s += 8;
      if (/^en-US/i.test(v.lang)) s += 6;
      if (v.localService) s += 3;
      return s;
    }

    var best = pool.slice().sort(function (a, b) {
      return score(b) - score(a);
    })[0];

    return best || null;
  }

  function refreshVoices() {
    var v = pickVoice();
    if (v) {
      chosenVoice = v;
      voicesReady = true;
    }
  }

  if (synth) {
    refreshVoices();
    // Chrome populates the voice list asynchronously.
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.addEventListener('voiceschanged', refreshVoices);
    }
    // Some Android builds never fire voiceschanged; poll briefly as a backstop.
    var tries = 0;
    var poll = setInterval(function () {
      if (voicesReady || ++tries > 20) return clearInterval(poll);
      refreshVoices();
    }, 250);
  }

  // Chrome silently truncates utterances longer than roughly fifteen seconds,
  // so split on sentence boundaries and queue the pieces.
  function chunkText(text, max) {
    max = max || 180;
    var sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    var chunks = [];
    var buf = '';
    sentences.forEach(function (s) {
      if ((buf + s).length > max && buf) {
        chunks.push(buf.trim());
        buf = s;
      } else {
        buf += s;
      }
    });
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  function startHeartbeat() {
    // Belt-and-braces for the same Chrome bug. It breaks speech on iOS, so it
    // is desktop-Chrome only.
    if (IS_IOS || heartbeat) return;
    heartbeat = setInterval(function () {
      if (!synth) return;
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 9000);
  }

  function stopHeartbeat() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function speakNext() {
    if (!speechQueue.length) {
      speaking = false;
      stopHeartbeat();
      duckMusic(false);
      setToggleActive(btnVoice, state.voice, state.voice ? 'Narration on' : 'Narration off');
      emit('narrationend');
      return;
    }
    var text = speechQueue.shift();
    var u = new SpeechSynthesisUtterance(text);
    if (chosenVoice) {
      u.voice = chosenVoice;
      u.lang = chosenVoice.lang || 'en-US';
    } else {
      u.lang = 'en-US';
    }
    // Nudged below default so fallback voices still read as male.
    u.pitch = 0.85;
    u.rate = 0.95;
    u.volume = 1;
    u.onend = speakNext;
    u.onerror = function (e) {
      // 'interrupted'/'canceled' are expected when the user taps another planet.
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      speakNext();
    };
    synth.speak(u);
  }

  function narrate(name) {
    if (!synth) return false;
    if (!state.voice) return false;

    var key = resolveKey(name);
    var text = key ? PLANET_TEXTS[key] : null;
    if (!text) return false;

    stopNarration();
    if (!chosenVoice) refreshVoices();

    speechQueue = chunkText(text);
    speaking = true;
    duckMusic(true);
    startHeartbeat();
    setToggleActive(btnVoice, true, 'Speaking — tap to stop');
    emit('planetnarrated', { planet: key, text: text });
    speakNext();
    return true;
  }

  function stopNarration() {
    speechQueue = [];
    if (synth) {
      try {
        synth.cancel();
      } catch (e) {}
    }
    speaking = false;
    stopHeartbeat();
    duckMusic(false);
  }

  function resolveKey(name) {
    if (!name) return null;
    var want = String(name).trim().toLowerCase();
    var keys = Object.keys(PLANET_TEXTS);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === want) return keys[i];
    }
    for (var j = 0; j < keys.length; j++) {
      if (want.indexOf(keys[j].toLowerCase()) > -1) return keys[j];
    }
    return null;
  }

  // iOS will not speak unless the synth has been touched inside a real gesture.
  var speechUnlocked = false;
  function unlockSpeech() {
    if (speechUnlocked || !synth) return;
    speechUnlocked = true;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  var state = {
    music: store(STORE_MUSIC) !== 'off',
    voice: store(STORE_VOICE) !== 'off'
  };

  var btnMusic, btnVoice, root;

  var CSS =
    '.solar-audio-controls{position:fixed;right:max(14px,env(safe-area-inset-right));' +
    'bottom:max(14px,env(safe-area-inset-bottom));z-index:2147483000;display:flex;' +
    'flex-direction:column;gap:10px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.solar-audio-btn{-webkit-appearance:none;appearance:none;width:48px;height:48px;' +
    'border-radius:50%;border:1px solid rgba(255,255,255,.28);background:rgba(10,14,30,.62);' +
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#dfe6ff;cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;padding:0;line-height:1;' +
    'transition:background .2s,border-color .2s,color .2s,transform .12s;' +
    '-webkit-tap-highlight-color:transparent;touch-action:manipulation}' +
    '.solar-audio-btn svg{width:22px;height:22px;display:block;pointer-events:none}' +
    '.solar-audio-btn:hover{background:rgba(30,40,80,.8)}' +
    '.solar-audio-btn:active{transform:scale(.93)}' +
    '.solar-audio-btn:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px}' +
    '.solar-audio-btn[aria-pressed="true"]{background:rgba(60,110,220,.42);' +
    'border-color:rgba(150,190,255,.75);color:#fff}' +
    '.solar-audio-btn[aria-pressed="false"]{color:rgba(200,210,235,.5)}' +
    '.solar-audio-btn[data-speaking="true"]{animation:solarAudioPulse 1.4s ease-in-out infinite}' +
    '@keyframes solarAudioPulse{0%,100%{box-shadow:0 0 0 0 rgba(124,196,255,.5)}' +
    '50%{box-shadow:0 0 0 9px rgba(124,196,255,0)}}' +
    '@media (max-width:640px){.solar-audio-btn{width:52px;height:52px}' +
    '.solar-audio-btn svg{width:24px;height:24px}}' +
    '@media (prefers-reduced-motion:reduce){.solar-audio-btn,.solar-audio-btn[data-speaking="true"]' +
    '{transition:none;animation:none}}';

  var ICON_MUSIC_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/>' +
    '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  var ICON_MUSIC_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/>' +
    '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' +
    '<line x1="3" y1="3" x2="21" y2="21"/></svg>';
  var ICON_VOICE_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/>' +
    '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  var ICON_VOICE_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/>' +
    '<line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';

  function setToggleActive(btn, active, label) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (label) {
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
    if (btn === btnVoice) {
      btn.setAttribute('data-speaking', speaking ? 'true' : 'false');
      btn.innerHTML = active ? ICON_VOICE_ON : ICON_VOICE_OFF;
    } else {
      btn.innerHTML = active ? ICON_MUSIC_ON : ICON_MUSIC_OFF;
    }
  }

  function setMusic(onFlag) {
    state.music = !!onFlag;
    store(STORE_MUSIC, state.music ? 'on' : 'off');
    setToggleActive(btnMusic, state.music, state.music ? 'Ambient music on' : 'Ambient music off');
    if (state.music) startMusic();
    else stopMusic();
    emit('musictoggle', state.music);
  }

  function setVoice(onFlag) {
    state.voice = !!onFlag;
    store(STORE_VOICE, state.voice ? 'on' : 'off');
    if (!state.voice) stopNarration();
    setToggleActive(btnVoice, state.voice, state.voice ? 'Narration on' : 'Narration off');
    emit('voicetoggle', state.voice);
  }

  function buildUI() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.className = 'solar-audio-controls';

    btnMusic = document.createElement('button');
    btnMusic.type = 'button';
    btnMusic.className = 'solar-audio-btn';

    btnVoice = document.createElement('button');
    btnVoice.type = 'button';
    btnVoice.className = 'solar-audio-btn';

    btnMusic.addEventListener('click', function () {
      unlockSpeech();
      setMusic(!state.music);
    });

    btnVoice.addEventListener('click', function () {
      unlockSpeech();
      // While mid-sentence the button acts as a stop, without switching the
      // feature off entirely.
      if (state.voice && speaking) {
        stopNarration();
        setToggleActive(btnVoice, true, 'Narration on');
        return;
      }
      setVoice(!state.voice);
    });

    root.appendChild(btnMusic);
    root.appendChild(btnVoice);
    document.body.appendChild(root);

    setToggleActive(btnMusic, state.music, state.music ? 'Ambient music on' : 'Ambient music off');
    setToggleActive(btnVoice, state.voice, state.voice ? 'Narration on' : 'Narration off');
  }

  // Autoplay policy: nothing can sound until the user has interacted, so wait
  // for the first gesture anywhere on the page and honour the saved setting.
  function armFirstGesture() {
    var done = false;
    function go() {
      if (done) return;
      done = true;
      ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (evt) {
        window.removeEventListener(evt, go, true);
      });
      unlockSpeech();
      if (state.music) startMusic();
    }
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (evt) {
      window.addEventListener(evt, go, true);
    });
  }

  // Opt-in auto-wiring: any element tagged with data-planet narrates on tap.
  function armPlanetClicks() {
    document.addEventListener(
      'click',
      function (e) {
        var el = e.target && e.target.closest && e.target.closest('[data-planet]');
        if (!el) return;
        narrate(el.getAttribute('data-planet'));
      },
      false
    );
  }

  // Pause everything when the tab is hidden; phones otherwise keep the drone
  // running in the background and drain the battery.
  function armVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (music.ctx && music.ctx.state === 'running') music.ctx.suspend();
        if (synth && speaking) synth.pause();
      } else {
        if (state.music && music.running && music.ctx) music.ctx.resume();
        if (synth && speaking) synth.resume();
      }
    });
  }

  function init() {
    buildUI();
    armFirstGesture();
    armPlanetClicks();
    armVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SolarAudio = {
    narrate: narrate,
    stopNarration: stopNarration,
    setMusic: setMusic,
    setVoice: setVoice,
    isMusicOn: function () {
      return state.music;
    },
    isVoiceOn: function () {
      return state.voice;
    },
    isSpeaking: function () {
      return speaking;
    },
    getVoice: function () {
      return chosenVoice;
    },
    // Diagnostics — handy when checking why nothing is audible on a device.
    getAudioState: function () {
      return {
        context: music.ctx ? music.ctx.state : 'not-created',
        running: music.running,
        level: music.master ? Math.round(music.master.gain.value * 100) / 100 : 0,
        speechSupported: !!synth,
        voiceCount: synth ? (synth.getVoices() || []).length : 0
      };
    },
    setPlanetTexts: function (map) {
      Object.keys(map || {}).forEach(function (k) {
        PLANET_TEXTS[k] = map[k];
      });
    },
    getPlanetTexts: function () {
      return PLANET_TEXTS;
    },
    on: on
  };
})();
