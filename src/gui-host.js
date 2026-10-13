import { Pane } from "tweakpane";

function bindingParams(kind, m, label) {
  const p = { label };
  if (kind === "number") {
    if (m.min !== undefined) p.min = m.min;
    if (m.max !== undefined) p.max = m.max;
    if (m.step !== undefined) p.step = m.step;
  } else if (kind === "select") p.options = Object.fromEntries(m.options.map((o) => [o, o]));
  else if (kind === "color") p.view = "color";
  return p;
}

export function createGuiHost(send) {
  let pane = null, title = "Parameters";
  const nodes = new Map();
  const items = new Map(); // id → { holder, blade, kind, parent, m }
  let muting = false;

  function build(id) {
    const it = items.get(id);
    const parent = nodes.get(it.parent);
    if (it.kind === "function") {
      it.blade = parent.addButton({ title: it.label });
      it.blade.on("click", () => send({ type: "guiCall", id }));
    } else {
      it.blade = parent.addBinding(it.holder, "v", bindingParams(it.kind, it.m, it.label));
      it.blade.on("change", (ev) => {
        if (!muting) send({ type: "guiChange", id, value: ev.value });
      });
    }
  }

  return function handle(m) {
    switch (m.op) {
      case "root":
        title = m.title;
        pane = new Pane({ title, container: document.getElementById("paneHost") || undefined });
        nodes.set(0, pane);
        break;
      case "folder":
        nodes.set(m.id, nodes.get(m.parent).addFolder({ title: m.title }));
        break;
      case "add":
        items.set(m.id, { holder: { v: m.value }, kind: m.kind, parent: m.parent, m, label: m.prop });
        build(m.id);
        break;
      case "name": {
        const it = items.get(m.id);
        if (!it) break;
        it.label = m.label;
        if (it.kind === "function") it.blade.title = m.label;
        else it.blade.label = m.label;
        break;
      }
      case "set": {
        const it = items.get(m.id);
        if (!it || it.kind === "function") break;
        it.holder.v = m.value;
        muting = true;
        it.blade.refresh();
        muting = false;
        break;
      }
      case "hide":
        if (pane) pane.expanded = false;
        break;
      case "fps":
        if (pane) pane.title = `${title} · ${m.value} fps`;
        break;
    }
  };
}

export function createLocalGui() {
  let pane = null, title = "Parameters";
  function folder(f) {
    function control(obj, prop, kind, m) {
      let on = null;
      let blade;
      if (kind === "function") {
        blade = f.addButton({ title: prop });
        blade.on("click", () => obj[prop]());
      } else {
        blade = f.addBinding(obj, prop, bindingParams(kind, m, prop));
        blade.on("change", (ev) => on?.(ev.value));
      }
      const c = {
        name(l) {
          if (kind === "function") blade.title = l;
          else blade.label = l;
          return c;
        },
        onChange(fn) {
          on = fn;
          return c;
        },
        setValue(v) {
          obj[prop] = v;
          blade.refresh?.();
          on?.(v);
          return c;
        },
      };
      return c;
    }
    return {
      add(obj, prop, ...args) {
        const v = obj[prop];
        if (typeof v === "function") return control(obj, prop, "function", {});
        if (Array.isArray(args[0])) return control(obj, prop, "select", { options: args[0] });
        if (typeof v === "number") return control(obj, prop, "number", { min: args[0], max: args[1], step: args[2] });
        return control(obj, prop, typeof v === "boolean" ? "boolean" : "string", {});
      },
      addColor: (obj, prop) => control(obj, prop, "color", {}),
      addFolder: (t) => folder(f.addFolder({ title: t })),
    };
  }
  return {
    createParameters(t) {
      title = t;
      pane = new Pane({ title: t, container: document.getElementById("paneHost") || undefined });
      return folder(pane);
    },
    hide: () => pane && (pane.expanded = false),
    fps: (n) => pane && (pane.title = `${title} · ${n} fps`),
  };
}
