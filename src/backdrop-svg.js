// Parses SVGs with three.js SVGLoader on the page (SVGLoader needs DOMParser, which workers do not have)
// and returns plain data that can be posted to the render worker.
//  - loadBackdrop: for every silhouette layer of the 360° backdrop, its colour and its top edge
//    as [x0, y0, x1, y1, ...] in SVG pixels.
//  - loadClimber: the jointed climber figure: triangles per joint (fill + stroke), joint pivots and
//    hierarchy, and the CSS @keyframes of its animations.
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { ShapeGeometry } from "three";

export async function loadBackdrop(url) {
  const text = await (await fetch(url)).text();
  const { paths, xml: svg } = new SVGLoader().parse(text); // xml is the root <svg> element
  const [, , width, height] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
  const meta = svg.querySelector("metadata")?.textContent || "";
  const num = (key, def) => {
    const m = meta.match(new RegExp(key + "=([\\d.]+)"));
    return m ? Number(m[1]) : def;
  };
  const layers = [];
  for (const p of paths) {
    const node = p.userData.node;
    if (node.closest("defs")) continue;
    const pts = [];
    let lastX = -Infinity;
    for (const v of p.subPaths[0].getPoints()) {
      // keep only the top edge: left to right, above the bottom border of the image
      if (v.y >= height - 0.5 || v.x <= lastX) continue;
      pts.push(v.x, v.y);
      lastX = v.x;
    }
    if (pts.length >= 4) layers.push({ id: node.closest("g[id]")?.id || "", color: p.color.getHexString(), points: pts });
  }
  return {
    width,
    height,
    horizon: num("horizon-y", height * 0.74),
    waterX: num("water-center-x", width / 2),
    waterSpan: num("water-span-degrees", 80),
    layers,
  };
}

const jointOf = (el) => {
  for (let n = el; n && n.getAttribute; n = n.parentNode) {
    const c = (n.getAttribute("class") || "").split(/\s+/).find((x) => x.startsWith("j-"));
    if (c) return c.slice(2);
  }
  return "root";
};

export async function loadClimber(url) {
  const text = await (await fetch(url)).text();
  const { paths, xml: svg } = new SVGLoader().parse(text);
  const css = svg.querySelector("style")?.textContent || "";
  // joints: pivot (transform-origin), rest transform and parent joint, from the CSS rules and the DOM nesting
  const joints = {};
  for (const g of svg.querySelectorAll("g")) {
    const name = (g.getAttribute("class") || "").split(/\s+/).find((x) => x.startsWith("j-"));
    if (!name) continue;
    const j = name.slice(2);
    const rule = (css.match(new RegExp("\\.j-" + j + "\\{([^}]*)\\}")) || [])[1] || "";
    const o = rule.match(/transform-origin:\s*([\d.-]+)px\s+([\d.-]+)px/);
    joints[j] = {
      parent: jointOf(g.parentNode),
      origin: o ? [+o[1], +o[2]] : null,
      rot: +((rule.match(/rotate\(([-\d.]+)deg\)/) || [])[1] || 0),
      ty: +((rule.match(/translateY\(([-\d.]+)px\)/) || [])[1] || 0),
    };
  }
  // geometry: fill and stroke triangles per joint / effect group, in SVG units (y down)
  const parts = {};
  const add = (key, geo) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute("position").array;
    (parts[key] ||= []).push(...p);
  };
  for (const p of paths) {
    const node = p.userData.node;
    const fx = node.closest(".puffs") ? "puffs" : node.closest(".brr") ? "brr" : null;
    const key = (fx ? fx + "@" : "") + jointOf(node);
    const strokeOnly = fx === "brr";
    if (!strokeOnly) for (const s of p.toShapes()) add(key, new ShapeGeometry(s, 6));
    const w = strokeOnly ? 2.5 : 2;
    const style = { strokeWidth: w, strokeLineJoin: "round", strokeLineCap: strokeOnly ? "round" : "butt", strokeMiterLimit: 4 };
    for (const sp of p.subPaths) {
      const g = SVGLoader.pointsToStroke(sp.getPoints(), style);
      if (g) add(key, g);
    }
  }
  // @keyframes name { 0%{...} 25%,75%{...} } -> [{p, rot?, ty?, tx?, op?}]
  const keyframes = {};
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    const frames = [];
    for (const f of m[2].matchAll(/([\d.%,\s]+)\{([^}]*)\}/g)) {
      const body = f[2];
      const v = {};
      const r = body.match(/rotate\(([-\d.]+)deg\)/);
      if (r) v.rot = +r[1];
      const ty = body.match(/translateY\(([-\d.]+)px\)/);
      if (ty) v.ty = +ty[1];
      const tr = body.match(/translate\(([-\d.]+)(?:px)?\s*,\s*([-\d.]+)(?:px)?\)/);
      if (tr) (v.tx = +tr[1]), (v.ty = +tr[2]);
      const op = body.match(/opacity:\s*([-\d.]+)/);
      if (op) v.op = +op[1];
      for (const pc of f[1].split(",")) if (pc.trim()) frames.push({ p: parseFloat(pc) / 100, ...v });
    }
    frames.sort((a, b) => a.p - b.p);
    keyframes[m[1]] = frames;
  }
  const dur = (name, def) => +((css.match(new RegExp("--" + name + ":\\s*([\\d.]+)s")) || [])[1] || def);
  const out = {};
  for (const [k, arr] of Object.entries(parts)) out[k] = new Float32Array(arr);
  return { parts: out, joints, keyframes, climbDur: dur("climb-dur", 1.4), summitDur: dur("summit-dur", 9), color: "#ff7a00" };
}
