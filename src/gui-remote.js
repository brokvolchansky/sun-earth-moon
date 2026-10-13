
export function createRemoteGui(post) {
  let nextId = 1;
  const ctrls = new Map();

  function makeFolder(parentId) {
    return {
      add(obj, prop, ...args) {
        const id = nextId++;
        const v = obj[prop];
        let kind, extra = {};
        if (typeof v === "function") kind = "function";
        else if (Array.isArray(args[0])) (kind = "select"), (extra.options = args[0]);
        else if (typeof v === "boolean") kind = "boolean";
        else if (typeof v === "number") (kind = "number"), (extra.min = args[0]), (extra.max = args[1]), (extra.step = args[2]);
        else kind = "string";
        const c = {
          name(l) {
            post({ type: "gui", op: "name", id, label: l });
            return c;
          },
          onChange(fn) {
            c._on = fn;
            return c;
          },
          setValue(val) {
            obj[prop] = val;
            post({ type: "gui", op: "set", id, value: val });
            c._on?.(val);
            return c;
          },
          _obj: obj,
          _prop: prop,
        };
        ctrls.set(id, c);
        post({ type: "gui", op: "add", id, parent: parentId, kind, prop, value: kind === "function" ? null : v, ...extra });
        return c;
      },
      addColor(obj, prop) {
        const id = nextId++;
        const c = {
          name(l) {
            post({ type: "gui", op: "name", id, label: l });
            return c;
          },
          onChange(fn) {
            c._on = fn;
            return c;
          },
          setValue(val) {
            obj[prop] = val;
            post({ type: "gui", op: "set", id, value: val });
            c._on?.(val);
            return c;
          },
          _obj: obj,
          _prop: prop,
        };
        ctrls.set(id, c);
        post({ type: "gui", op: "add", id, parent: parentId, kind: "color", prop, value: obj[prop] });
        return c;
      },
      addFolder(title) {
        const id = nextId++;
        post({ type: "gui", op: "folder", id, parent: parentId, title });
        return makeFolder(id);
      },
    };
  }

  return {
    createParameters(title) {
      post({ type: "gui", op: "root", id: 0, title });
      return makeFolder(0);
    },
    hide() {
      post({ type: "gui", op: "hide" });
    },
    fps(n) {
      post({ type: "gui", op: "fps", value: n });
    },
    handle(m) {
      const c = ctrls.get(m.id);
      if (!c) return;
      if (m.type === "guiCall") c._obj[c._prop]();
      else {
        c._obj[c._prop] = m.value;
        c._on?.(m.value);
      }
    },
  };
}
