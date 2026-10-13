import { createUI } from "./ui.js";
import { ElementProxy, ElementProxyReceiver } from "./proxy.js";
import { createAudioEngine } from "./audio-engine.js";
import { createGuiHost, createLocalGui } from "./gui-host.js";

const mainCanvas = document.getElementById("mainCanvas");
const skyCanvas = document.getElementById("skyCanvas");
const forceMain = new URLSearchParams(location.search).has("main");
const BACKDROP_URL = "assets/backdrop.svg";
const CLIMBER_URL = "assets/climber.svg";
const loadBackdrop = () =>
  import("./backdrop-svg.js")
    .then((m) => m.loadBackdrop(BACKDROP_URL))
    .catch((err) => (console.warn("backdrop:", err), null));
const loadClimber = () =>
  import("./backdrop-svg.js")
    .then((m) => m.loadClimber(CLIMBER_URL))
    .catch((err) => (console.warn("climber:", err), null));
const canWorker = !forceMain && "transferControlToOffscreen" in HTMLCanvasElement.prototype && !!navigator.gpu;

if (canWorker) startWorker();
else startMain();

function startWorker() {
  const worker = new Worker(new URL("./worker-entry.js", import.meta.url), { type: "module" });
  const handleUI = createUI((name, data) => worker.postMessage({ type: "cmd", name, data }));
  const audio = createAudioEngine((e) => worker.postMessage({ type: "audioEvent", e }));
  const gui = createGuiHost((m) => worker.postMessage(m));
  worker.addEventListener("message", (m) => {
    const d = m.data;
    if (d.type === "ui") handleUI(d.m);
    else if (d.type === "audio") {
      if (d.cmd === "start") audio.start(d.files).then(() => worker.postMessage({ type: "audioStarted", id: d.id }));
      else audio[d.cmd](d.o);
    } else if (d.type === "gui") gui(d);
    else if (d.type === "fatal") {
      console.warn("worker failed, falling back to main thread:", d.reason);
      location.replace(location.pathname + "?main=1");
    }
  });
  worker.addEventListener("error", (e) => console.error("worker error:", e.message));
  new ElementProxy(mainCanvas, (data) => worker.postMessage({ type: "proxy", id: "main", data }));
  new ElementProxy(skyCanvas, (data) => worker.postMessage({ type: "proxy", id: "sky", data }));
  const sendDpr = () => worker.postMessage({ type: "dpr", value: devicePixelRatio });
  addEventListener("resize", sendDpr);
  const main = mainCanvas.transferControlToOffscreen();
  const sky = skyCanvas.transferControlToOffscreen();
  worker.postMessage({ type: "boot", canvases: { main, sky }, base: location.href, dpr: devicePixelRatio }, [main, sky]);
  loadBackdrop().then((data) => worker.postMessage({ type: "backdrop", data }));
  loadClimber().then((data) => worker.postMessage({ type: "climber", data }));
  window.__mode = "worker";
}

async function startMain() {
  const input = { main: new ElementProxyReceiver(), sky: new ElementProxyReceiver() };
  const cmdHandlers = new Map();
  const handleUI = createUI((name, data) => cmdHandlers.get(name)?.(data));
  new ElementProxy(mainCanvas, (data) => input.main.handleEvent(data));
  new ElementProxy(skyCanvas, (data) => input.sky.handleEvent(data));
  const audio = createAudioEngine((e) => globalThis.__HOST?.onAudioEvent?.(e));
  globalThis.__HOST = {
    isWorker: false,
    canvases: { main: mainCanvas, sky: skyCanvas },
    input,
    ui: { send: (type, data) => handleUI({ type, ...data }), on: (name, fn) => cmdHandlers.set(name, fn) },
    gui: createLocalGui(),
    audio: {
      start: (f) => audio.start(f),
      play: (o) => audio.play(o),
      frame: (o) => audio.frame(o),
      resume: () => audio.resume(),
      suspend: () => audio.suspend(),
    },
    onAudioEvent: null,
    backdrop: loadBackdrop(),
    climber: loadClimber(),
  };
  window.__mode = "main";
  await import("./app.js");
}
