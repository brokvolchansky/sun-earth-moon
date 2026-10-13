// (https://threejs.org/manual/en/offscreencanvas.html, ElementProxy / ElementProxyReceiver).
// getBoundingClientRect, focus, setPointerCapture.
import { EventDispatcher } from "three";

const noop = () => {};

export class ElementProxyReceiver extends EventDispatcher {
  constructor() {
    super();
    this.left = 0;
    this.top = 0;
    this.width = 1;
    this.height = 1;
    this.style = {};
  }
  get clientWidth() {
    return this.width;
  }
  get clientHeight() {
    return this.height;
  }
  getBoundingClientRect() {
    return { left: this.left, top: this.top, width: this.width, height: this.height, right: this.left + this.width, bottom: this.top + this.height, x: this.left, y: this.top };
  }
  handleEvent(data) {
    if (data.type === "size") {
      this.left = data.left;
      this.top = data.top;
      this.width = data.width;
      this.height = data.height;
      this.dispatchEvent({ type: "resize" });
      return;
    }
    data.preventDefault = noop;
    data.stopPropagation = noop;
    this.dispatchEvent(data);
  }
  get ownerDocument() {
    return this;
  }
  getRootNode() {
    return this;
  }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}

const POINTER_FIELDS = ["ctrlKey", "metaKey", "shiftKey", "altKey", "button", "buttons", "pointerType", "pointerId", "isPrimary", "clientX", "clientY", "pageX", "pageY"];
const copy = (src, fields, dst) => {
  for (const f of fields) dst[f] = src[f];
  return dst;
};

export class ElementProxy {
  constructor(element, send) {
    this.element = element;
    const pointer = (e) => send(copy(e, POINTER_FIELDS, { type: e.type }));
    const handlers = {
      pointerdown: (e) => {
        try {
          element.setPointerCapture(e.pointerId);
        } catch {}
        pointer(e);
      },
      pointermove: pointer,
      pointerup: pointer,
      pointercancel: pointer,
      pointerleave: pointer,
      dblclick: (e) => send(copy(e, ["clientX", "clientY", "button"], { type: "dblclick" })),
      contextmenu: (e) => e.preventDefault(),
      wheel: (e) => {
        e.preventDefault();
        send(copy(e, ["deltaX", "deltaY", "deltaMode", "ctrlKey", "metaKey", "shiftKey", "clientX", "clientY"], { type: "wheel" }));
      },
      touchstart: (e) => e.preventDefault(),
      touchmove: (e) => e.preventDefault(),
    };
    for (const [type, fn] of Object.entries(handlers)) element.addEventListener(type, fn, { passive: false });
    this.sendSize = () => {
      const r = element.getBoundingClientRect();
      send({ type: "size", left: r.left, top: r.top, width: Math.max(1, Math.round(element.clientWidth)), height: Math.max(1, Math.round(element.clientHeight)) });
    };
    new ResizeObserver(this.sendSize).observe(element);
    addEventListener("resize", this.sendSize);
    this.sendSize();
  }
}
