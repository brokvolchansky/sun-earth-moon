import { ElementProxyReceiver } from "./proxy.js";
import { createRemoteGui } from "./gui-remote.js";
import { DefaultLoadingManager } from "three";

const post = (m) => self.postMessage(m);
const gui = createRemoteGui(post);
const input = { main: new ElementProxyReceiver(), sky: new ElementProxyReceiver() };
Object.defineProperty(self, "innerWidth", { configurable: true, get: () => input.main.clientWidth });
Object.defineProperty(self, "innerHeight", { configurable: true, get: () => input.main.clientHeight });
let dpr = 1;
Object.defineProperty(self, "devicePixelRatio", { configurable: true, get: () => dpr });

const cmdHandlers = new Map();
const ui = {
  send: (type, data) => post({ type: "ui", m: { type, ...data } }),
  on: (name, fn) => cmdHandlers.set(name, fn),
};
const audioWait = new Map();
let audioId = 1;
let backdropResolve, climberResolve;
const backdrop = new Promise((res) => (backdropResolve = res));
const climber = new Promise((res) => (climberResolve = res));

self.onmessage = (e) => {
  const d = e.data;
  switch (d.type) {
    case "proxy":
      input[d.id].handleEvent(d.data);
      break;
    case "cmd":
      cmdHandlers.get(d.name)?.(d.data);
      break;
    case "dpr":
      dpr = d.value;
      break;
    case "boot":
      boot(d);
      break;
    case "guiChange":
    case "guiCall":
      gui.handle(d);
      break;
    case "audioEvent":
      globalThis.__HOST?.onAudioEvent?.(d.e);
      break;
    case "backdrop":
      backdropResolve(d.data);
      break;
    case "climber":
      climberResolve(d.data);
      break;
    case "audioStarted":
      audioWait.get(d.id)?.();
      audioWait.delete(d.id);
      break;
  }
};

function boot(d) {
  dpr = d.dpr;
  const nativeFetch = self.fetch.bind(self);
  self.fetch = (url, init) => nativeFetch(typeof url === "string" ? new URL(url, d.base).href : url, init);
  DefaultLoadingManager.setURLModifier((url) => (/^(blob:|data:)/.test(url) ? url : new URL(url, d.base).href));
  d.canvases.main.style = {};
  d.canvases.sky.style = {};
  globalThis.__HOST = {
    isWorker: true,
    canvases: d.canvases,
    input,
    ui,
    gui,
    audio: {
      start(files) {
        const id = audioId++;
        return new Promise((res) => {
          audioWait.set(id, res);
          post({ type: "audio", cmd: "start", id, files });
        });
      },
      play: (o) => post({ type: "audio", cmd: "play", o }),
      frame: (o) => post({ type: "audio", cmd: "frame", o }),
      resume: () => post({ type: "audio", cmd: "resume" }),
      suspend: () => post({ type: "audio", cmd: "suspend" }),
    },
    onAudioEvent: null,
    backdrop,
    climber,
  };
  import("./app.js").catch((err) => {
    console.error("worker: app failed", err);
    post({ type: "fatal", reason: String(err?.message || err) });
  });
}
