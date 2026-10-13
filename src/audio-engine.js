
export function createAudioEngine(onEvent) {
  const E = { ctx: null, master: null, buf: {}, beds: {}, voices: new Map(), started: null };

  E.paused = false;
  function ensureCtx() {
    if (!E.ctx) {
      E.ctx = new AudioContext();
      E.master = E.ctx.createGain();
      E.master.gain.value = 0;
      E.master.connect(E.ctx.destination);
    }
    if (!E.paused && E.ctx.state !== "running") E.ctx.resume().catch(() => {});
  }
  addEventListener("pointerdown", ensureCtx, { capture: true });
  addEventListener("keydown", ensureCtx, { capture: true });

  E.start = (files) => {
    ensureCtx();
    if (!E.started) {
      E.started = Promise.all(
        Object.entries(files).map(async ([k, url]) => {
          try {
            E.buf[k] = await E.ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
          } catch (e) {
            console.warn("sound failed to load:", url, e);
          }
        }),
      ).then(() => {
        for (const k of ["night", "day", "wind", "sea"]) {
          if (!E.buf[k]) continue;
          const src = E.ctx.createBufferSource();
          src.buffer = E.buf[k];
          src.loop = true;
          const g = E.ctx.createGain();
          g.gain.value = 0;
          src.connect(g).connect(E.master);
          src.start(0, Math.random() * E.buf[k].duration);
          E.beds[k] = g;
        }
      });
    }
    E.paused = false;
    return E.started.then(() => E.ctx.resume());
  };

  function setPos(pn, p) {
    const t = E.ctx.currentTime;
    pn.positionX.setValueAtTime(p[0], t);
    pn.positionY.setValueAtTime(p[1], t);
    pn.positionZ.setValueAtTime(p[2], t);
  }

  E.play = ({ id, name, gain = 1, rate = 1, toMaster = true, pos, tap = false }) => {
    if (!E.ctx || !E.buf[name]) return;
    const ctx = E.ctx;
    const src = ctx.createBufferSource();
    src.buffer = E.buf[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pn = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 3, rolloffFactor: 1, maxDistance: 200 });
    setPos(pn, pos);
    src.connect(g).connect(pn).connect(toMaster ? E.master : ctx.destination);
    let an = null;
    if (tap) {
      an = ctx.createAnalyser();
      an.fftSize = 512;
      const mute = ctx.createGain();
      mute.gain.value = 0;
      g.connect(an).connect(mute).connect(ctx.destination);
    }
    E.voices.set(id, { pn, an, buf: an ? new Float32Array(an.fftSize) : null });
    src.onended = () => {
      E.voices.delete(id);
      onEvent({ type: "ended", id });
    };
    src.start();
  };

  E.frame = ({ listener, voices, master, beds, tau }) => {
    if (!E.ctx) return;
    const t = E.ctx.currentTime, L = E.ctx.listener;
    if (listener) {
      const [px, py, pz, fx, fy, fz, ux, uy, uz] = listener;
      if (L.positionX) {
        L.positionX.setValueAtTime(px, t); L.positionY.setValueAtTime(py, t); L.positionZ.setValueAtTime(pz, t);
        L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
        L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
      } else {
        L.setPosition(px, py, pz);
        L.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    }
    for (const [id, x, y, z] of voices || []) {
      const v = E.voices.get(id);
      if (v) setPos(v.pn, [x, y, z]);
    }
    if (master !== undefined) E.master.gain.setTargetAtTime(master, t, 0.4);
    if (beds) for (const [k, g] of Object.entries(E.beds)) g.gain.setTargetAtTime(beds[k] ?? 0, t, tau);
    let levels = null;
    for (const [id, v] of E.voices) {
      if (!v.an) continue;
      v.an.getFloatTimeDomainData(v.buf);
      let s = 0;
      for (let i = 0; i < v.buf.length; i++) s += v.buf[i] * v.buf[i];
      (levels ||= {})[id] = Math.sqrt(s / v.buf.length);
    }
    if (levels) onEvent({ type: "levels", levels });
  };

  E.resume = () => {
    E.paused = false;
    return E.ctx?.resume().catch(() => {});
  };
  E.suspend = () => {
    E.paused = true;
    return E.ctx?.suspend().catch(() => {});
  };
  return E;
}
