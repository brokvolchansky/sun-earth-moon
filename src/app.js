      import * as THREE from "three";
      const HOST = globalThis.__HOST;
      const UI = HOST.ui;
      const makeCanvas = (w, h) => new OffscreenCanvas(w, h);
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      import WebGPU from "three/addons/capabilities/WebGPU.js";
      import * as Astronomy from "astronomy-engine";
      import { Grass, GrassMap, presets as grassPresets } from "threejs-grass";
      import { SkyMesh } from "three/addons/objects/SkyMesh.js";
      import { WaterMesh } from "three/addons/objects/WaterMesh.js";
      import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
      import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
      const gltfLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
      import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
      import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js";
      import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
      import { bloom } from "three/addons/tsl/display/BloomNode.js";
      import { radialBlur } from "three/addons/tsl/display/radialBlur.js";
      import {
        Fn,
        float,
        vec2,
        vec3,
        vec4,
        uniform,
        attribute,
        time,
        positionWorld,
        positionView,
        normalWorld,
        normalView,
        normalLocal,
        cameraPosition,
        cameraProjectionMatrix,
        cameraViewMatrix,
        modelWorldMatrix,
        uv,
        texture,
        lights,
        mix,
        clamp,
        max,
        dot,
        normalize,
        cross,
        length,
        abs,
        floor,
        fract,
        step,
        smoothstep,
        sin,
        cos,
        sub,
        mul,
        output,
        color,
        acesFilmicToneMapping,
        sRGBTransferOETF,
        normalMap,
        normalWorldGeometry,
        modelViewMatrix,
        positionLocal,
        cubeTexture,
        mx_fractal_noise_float,
        min,
        hash,
        instanceIndex,
        Loop,
        If,
        Break,
        exp,
        screenUV,
        pow,
        instancedArray,
        billboarding,
        deltaTime,
        positionGeometry,
        Discard,
        pass,
        int,
        atan,
      } from "three/tsl";

      const displayOut = () =>
        vec4(sRGBTransferOETF(acesFilmicToneMapping(output.rgb, float(1.0))), output.a);

      const LOAD_STEPS = 7;
      let loadDone = 0;
      const progress = (label) => {
        loadDone = Math.min(loadDone + 1, LOAD_STEPS);
        const pct = Math.round((loadDone / LOAD_STEPS) * 100);
        UI.send("loader", { pct, label: `${label} · ${pct}%` });
      };
      const track = (promise, label) => promise.finally(() => progress(label));
      const loaderError = (text, retry = false) => UI.send("loaderError", { text, retry });
      const loaderDone = () => UI.send("loaderDone");
      const msg = (text, cls) => UI.send("toast", { text, cls });

      const CAMERA_DIST = 6;
      const TILT_DEG = 30;
      const BASE_ORBIT = 4.0;
      const AU_OVER_RSUN = 149597870.7 / 695700;
      const RSUN_OVER_REARTH = 695700 / 6371; // ≈ 109.20
      const RMOON_OVER_REARTH = 1737.4 / 6371; // ≈ 0.2727
      const SUN_ORBIT_FRAC = 0.5;
      const GLOBE_FRAC = SUN_ORBIT_FRAC / RSUN_OVER_REARTH;
      const MOON_DIST_COMPRESSED = 5;
      const REAL_BODY_SCALE = 1 / AU_OVER_RSUN / SUN_ORBIT_FRAC;
      const MARGIN = 0.04;
      const ORBIT_BASE = 0.28;
      const SPIN_BASE = ORBIT_BASE * (365.2564 / 0.99727);
      const MOON_BASE = ORBIT_BASE * (365.2564 / 27.3217);
      const GLOBE_TILT = (23.44 * Math.PI) / 180;
      const MOON_TILT = (5.14 * Math.PI) / 180;
      const SUN_FRAC = RSUN_OVER_REARTH;
      const HOVER_SCALE = (Math.PI * 2) / 10 / SPIN_BASE;
      const PARAMS = {
        timeScale: 1,
        distanceFactor: 1.0,
        realScale: false,
      };
      let bodyScale = 1;
      let sunBaseK = 0, sunBaseR = 0;
      let simTime = Date.now();
      let live = true;
      let lastObserve = null;
      const OBSERVE_MS = 60 * 1000;
      let holdEarth = false;
      let lastClock = 0;
      let follow = null;
      const _fp = new THREE.Vector3();

      let camera,
        renderer,
        scene,
        globe,
        sunMesh,
        halo,
        sunLight,
        rayMesh,
        moonOrbitGroup,
        moonMesh,
        sunRadius = 0;
      let moonTex = null;
      let moonPhase = 0;
      let baseOrbitR = 0;
      let globeR = 0;
      let orbitR = 0;
      let phase = 0;
      let prev = 0;
      let earthTex = null;
      let stars;
      let haloTex = null;
      let controls;

      function buildStatic() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x06061a);
        scene.backgroundNode = sRGBTransferOETF(acesFilmicToneMapping(color(0x06061a), float(1.0)));
        scene.fog = new THREE.FogExp2(0x06061a, 0.02);

        camera = new THREE.PerspectiveCamera(
          55,
          innerWidth / innerHeight,
          1e-6,
          200,
        );
        camera.position.set(
          0,
          CAMERA_DIST * Math.tan((TILT_DEG * Math.PI) / 180),
          CAMERA_DIST,
        );
        camera.lookAt(0, 0, 0);

        sunLight = new THREE.PointLight(0xffcc66, 60, 0, 2);
        sunLight.position.set(0, 0, 0);
        scene.add(sunLight);

        const n = 600;
        const p = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const th = Math.random() * Math.PI * 2;
          const ph = Math.acos(2 * Math.random() - 1);
          const r = 26 + Math.random() * 10;
          p[i * 3] = r * Math.sin(ph) * Math.cos(th);
          p[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
          p[i * 3 + 2] = r * Math.cos(ph);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(p, 3));
        stars = new THREE.Points(
          g,
          new THREE.PointsNodeMaterial({
            outputNode: displayOut(),
            color: 0xd8e8ff,
            size: 8,
            sizeAttenuation: false,
            fog: false,
          }),
        );
        scene.add(stars);
      }

      function bbox(R, G) {
        const w = innerWidth;
        const h = innerHeight;
        const tanA = Math.tan((camera.fov * Math.PI) / 360);
        const sample = 900;
        let minX = w,
          maxX = 0,
          minY = h,
          maxY = 0;
        const v = new THREE.Vector3();
        const ndc = new THREE.Vector3();
        const camPos = camera.position;
        for (let i = 0; i < sample; i++) {
          const phi = (i / sample) * Math.PI * 2;
          v.set(R * Math.cos(phi), 0, R * Math.sin(phi));
          const D = camPos.distanceTo(v);
          const rpx = (G * h) / (2 * D * tanA);
          ndc.copy(v).project(camera);
          const px = (ndc.x + 1) * 0.5 * w;
          const py = (1 - ndc.y) * 0.5 * h;
          if (px - rpx < minX) minX = px - rpx;
          if (px + rpx > maxX) maxX = px + rpx;
          if (py - rpx < minY) minY = py - rpx;
          if (py + rpx > maxY) maxY = py + rpx;
        }
        return { minX, minY, maxX, maxY };
      }

      function fits(R) {
        const camPos = camera.position;
        const viewDir = new THREE.Vector3();
        camera.getWorldDirection(viewDir);
        const tmp = new THREE.Vector3();
        const sample = 900;
        for (let i = 0; i < sample; i++) {
          const phi = (i / sample) * Math.PI * 2;
          tmp.set(R * Math.cos(phi), 0, R * Math.sin(phi)).sub(camPos);
          if (tmp.dot(viewDir) <= 0.5) return false;
        }
        const m = Math.min(innerWidth, innerHeight) * MARGIN;
        const bb = bbox(R, R * GLOBE_FRAC);
        if (![bb.minX, bb.maxX, bb.minY, bb.maxY].every(Number.isFinite))
          return false;
        return (
          bb.minX >= m &&
          bb.maxX <= innerWidth - m &&
          bb.minY >= m &&
          bb.maxY <= innerHeight - m
        );
      }

      function computeSizes() {
        const camDist = camera.position.length();
        let lo = 0;
        let hi = Math.min(BASE_ORBIT, 0.7 * camDist);
        for (let i = 0; i < 32; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        baseOrbitR = lo;
        globeR = baseOrbitR * GLOBE_FRAC;
        orbitR = baseOrbitR * PARAMS.distanceFactor;
      }

      function loadTexturePromise(url) {
        return new Promise((resolve, reject) => {
          new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY" }).load(
            url,
            (bmp) => {
              const t = new THREE.Texture(bmp);
              t.flipY = false;
              t.needsUpdate = true;
              resolve(t);
            },
            undefined,
            reject,
          );
        });
      }
      let earthDayTex = null, earthSpecTex = null, earthNormalTex = null, cityData = null;
      async function loadEarthAssets() {
        const opt = (p) => p.catch((e) => (console.warn("failed to load:", e), null));
        const [day, spec, nrm, cities] = await Promise.all([
          opt(track(loadTexturePromise("textures/earth_day_4k.jpg"), "Earth surface")),
          opt(track(loadTexturePromise("textures/earth_specular_4k.jpg"), "Water and land")),
          opt(track(loadTexturePromise("textures/earth_normal_4k.png"), "Earth relief")),
          opt(track(fetch("textures/cities_q.bin").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))), "Settlements")),
        ]);
        if (day) {
          day.colorSpace = THREE.SRGBColorSpace;
          day.anisotropy = 8;
        }
        for (const t of [spec, nrm]) if (t) t.anisotropy = 8;
        earthDayTex = day;
        if (day) texCache.set("textures/earth_day_4k.jpg", Promise.resolve(day));
        if (spec) texCache.set("textures/earth_specular_4k.jpg", Promise.resolve(spec));
        if (nrm) texCache.set("textures/earth_normal_4k.png", Promise.resolve(nrm));
        earthSpecTex = spec;
        earthNormalTex = nrm;
        if (cities) {
          const n = cities.byteLength / 8;
          const qa = new Int16Array(cities, 0, n), qo = new Int16Array(cities, n * 2, n), pp = new Float32Array(cities, n * 4, n);
          cityData = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) {
            cityData[i * 3] = (qa[i] * 90) / 32767;
            cityData[i * 3 + 1] = (qo[i] * 180) / 32767;
            cityData[i * 3 + 2] = pp[i];
          }
        } else cityData = null;
      }

      async function loadMoonTex() {
        try {
          moonTex = await track(loadTexturePromise("textures/moon_2k.jpg"), "Moon");
          texCache.set("textures/moon_2k.jpg", Promise.resolve(moonTex));
        } catch (e) {
          console.warn("Moon texture not found — the Moon stays grey");
        }
      }

      const dayTexNodes = [], moonTexNodes = [], specTexNodes = [], nrmTexNodes = [];
      const trackNode = (list, node) => (list.push(node), node);
      const texCache = new Map();
      const setupDay = (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
      };
      const setupData = (t) => (t.anisotropy = 8);
      const loadTexCached = (url, setup) => {
        if (!texCache.has(url)) texCache.set(url, loadTexturePromise(url).then((t) => (setup(t), t)));
        return texCache.get(url);
      };
      let texRes = null;
      function applyTexRes(res) {
        if (!res || res === texRes) return;
        texRes = res;
        if (CLOUD_SIZES[res] && CLOUD_SIZES[res] !== cloudSize) {
          cloudSize = CLOUD_SIZES[res];
          if (cloudsMesh) checkClouds();
        }
        loadTexCached(`textures/earth_day_${res}.jpg`, setupDay)
          .then((t) => {
            if (texRes !== res) return;
            earthDayTex = t;
            for (const n of dayTexNodes) n.value = t;
          })
          .catch((e) => console.warn("Earth texture failed to load:", e));
        for (const [url, nodes, set] of [
          [`textures/earth_specular_${res}.jpg`, specTexNodes, (t) => (earthSpecTex = t)],
          [`textures/earth_normal_${res}.png`, nrmTexNodes, (t) => (earthNormalTex = t)],
        ])
          loadTexCached(url, setupData)
            .then((t) => {
              if (texRes !== res) return;
              set(t);
              for (const n of nodes) n.value = t;
            })
            .catch((e) => console.warn("Earth map failed to load:", url, e));
        loadTexCached(`textures/moon_${res}.jpg`, () => {})
          .then((t) => {
            if (texRes !== res) return;
            moonTex = t;
            for (const n of moonTexNodes) n.value = t;
          })
          .catch((e) => console.warn("Moon texture failed to load:", e));
      }

      function makeHaloTexture() {
        const c = makeCanvas(1, 1);
        c.width = c.height = 512;
        const ctx = c.getContext("2d");
        const gr = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
        gr.addColorStop(0.0, "rgba(255,245,215,0.95)");
        gr.addColorStop(0.15, "rgba(255,225,160,0.90)");
        gr.addColorStop(0.28, "rgba(255,205,120,0.80)");
        gr.addColorStop(0.45, "rgba(255,170,70,0.55)");
        gr.addColorStop(0.6, "rgba(255,140,40,0.35)");
        gr.addColorStop(0.8, "rgba(255,100,25,0.15)");
        gr.addColorStop(1.0, "rgba(255,80,15,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, 512, 512);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }

      // =====================================================================
      // =====================================================================
      const SUN_SPHERE_R = 1.5;
      const SUN_RIBBON_R = 1.49;
      const SUN_IDLE_YAW = 0.08;
      let sunGroup, sunScaleU, camUpU;

      // ---------- includes/simplex4d.glsl (Ashima Arts, MIT) ----------
      const mod289 = (x) => x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
      const permute = (x) => mod289(x.mul(34.0).add(1.0).mul(x));
      const taylorInvSqrt = (r) => r.mul(-0.85373472095314).add(1.79284291400159);

      const grad4 = Fn(([j, ip]) => {
        const pxyz = floor(fract(vec3(j).mul(ip.xyz)).mul(7.0)).mul(ip.z).sub(1.0);
        const pw = float(1.5).sub(dot(abs(pxyz), vec3(1.0, 1.0, 1.0)));
        // s = vec4(lessThan(p, vec4(0.0)))
        const sxyz = vec3(1.0).sub(step(vec3(0.0), pxyz));
        const sw = float(1.0).sub(step(0.0, pw));
        // p.xyz = p.xyz + (s.xyz*2.0 - 1.0) * s.www
        return vec4(pxyz.add(sxyz.mul(2.0).sub(1.0).mul(sw)), pw);
      }).setLayout({
        name: "grad4",
        type: "vec4",
        inputs: [
          { name: "j", type: "float" },
          { name: "ip", type: "vec4" },
        ],
      });

      const snoise4 = Fn(([v]) => {
        const C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
        const F4 = 0.309016994374947451;
        const i = floor(v.add(dot(v, vec4(F4))));
        const x0 = v.sub(i).add(dot(i, C.xxxx));
        const isX = step(x0.yzw, x0.xxx);
        const isYZ = step(x0.zww, x0.yyz);
        const one = float(1.0);
        const i0 = vec4(
          isX.x.add(isX.y).add(isX.z),
          one.sub(isX.x).add(isYZ.x).add(isYZ.y),
          one.sub(isX.y).add(one.sub(isYZ.x)).add(isYZ.z),
          one.sub(isX.z).add(one.sub(isYZ.y)).add(one.sub(isYZ.z)),
        );
        const z4 = vec4(0.0), o4 = vec4(1.0);
        const i3 = clamp(i0, z4, o4);
        const i2 = clamp(i0.sub(1.0), z4, o4);
        const i1 = clamp(i0.sub(2.0), z4, o4);
        const x1 = x0.sub(i1).add(C.xxxx);
        const x2 = x0.sub(i2).add(C.yyyy);
        const x3 = x0.sub(i3).add(C.zzzz);
        const x4 = x0.add(C.wwww);
        const im = mod289(i);
        const j0 = permute(permute(permute(permute(im.w).add(im.z)).add(im.y)).add(im.x));
        const j1 = permute(
          permute(
            permute(permute(im.w.add(vec4(i1.w, i2.w, i3.w, 1.0))).add(im.z).add(vec4(i1.z, i2.z, i3.z, 1.0)))
              .add(im.y)
              .add(vec4(i1.y, i2.y, i3.y, 1.0)),
          )
            .add(im.x)
            .add(vec4(i1.x, i2.x, i3.x, 1.0)),
        );
        const ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
        let p0 = grad4(j0, ip);
        let p1 = grad4(j1.x, ip);
        let p2 = grad4(j1.y, ip);
        let p3 = grad4(j1.z, ip);
        let p4 = grad4(j1.w, ip);
        const norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 = p0.mul(norm.x);
        p1 = p1.mul(norm.y);
        p2 = p2.mul(norm.z);
        p3 = p3.mul(norm.w);
        p4 = p4.mul(taylorInvSqrt(dot(p4, p4)));
        const m0 = max(vec3(0.6).sub(vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2))), vec3(0.0));
        const m1 = max(vec2(0.6).sub(vec2(dot(x3, x3), dot(x4, x4))), vec2(0.0));
        const m0s = m0.mul(m0);
        const m1s = m1.mul(m1);
        return float(49.0).mul(
          dot(m0s.mul(m0s), vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2))).add(
            dot(m1s.mul(m1s), vec2(dot(p3, x3), dot(p4, x4))),
          ),
        );
      }).setLayout({ name: "snoise4", type: "float", inputs: [{ name: "v", type: "vec4" }] });

      // uSpatialFrequency 6, uTemporalFrequency .1, uH 1, uContrast .25, uFlatten .72, OCTAVES 5.
      const perlinX = Fn(([dir, t]) => {
        const world = normalize(dir).add(12.45);
        let sum = float(0.0);
        const OCT = 7;
        for (let o = 0; o < OCT; o++) {
          const f = Math.pow(2, o); // f *= 2.0; a = uH^o = 1
          sum = sum.add(snoise4(vec4(world.mul(6.0 * f), t.add(100.0 * o).mul(f))));
        }
        const fx = sum.mul(0.25 * Math.sqrt(5 / OCT)).add(0.5);
        const modulate = max(snoise4(vec4(world.mul(2.0), t)), 0.0);
        return clamp(mix(fx, fx.mul(modulate), 0.72), 0.0, 1.0);
      }).setLayout({
        name: "perlinX",
        type: "float",
        inputs: [
          { name: "dir", type: "vec3" },
          { name: "t", type: "float" },
        ],
      });

      // ---------- sunSphereVS/FS.glsl ----------
      function makeSunSphere() {
        const tL = time.mul(0.04); // sunMaterial.uTime = time * 0.04
        const tP = time.mul(0.01); // perlin: uTime(time*0.1) * uTemporalFrequency(0.1)
        const n = normalize(normalLocal);
        // setLayers: rot(a) = mat2(c,-s,s,c) -> (c*u + s*v, -s*u + c*v)
        const c0 = cos(tL), s0 = sin(tL);
        const layer0 = vec3(n.x, c0.mul(n.y).add(s0.mul(n.z)), c0.mul(n.z).sub(s0.mul(n.y)));
        const a1 = tL.add(2.094), c1 = cos(a1), s1 = sin(a1); // p1.zx
        const layer1 = vec3(c1.mul(n.x).sub(s1.mul(n.z)), n.y, c1.mul(n.z).add(s1.mul(n.x)));
        const a2 = tL.sub(4.188), c2 = cos(a2), s2 = sin(a2); // p1.xy
        const layer2 = vec3(c2.mul(n.x).add(s2.mul(n.y)), c2.mul(n.y).sub(s2.mul(n.x)), n.z);
        const ocean = perlinX(layer0, tP).add(perlinX(layer1, tP)).add(perlinX(layer2, tP)).mul(0.3333333);
        const camVirt = normalize(cameraPosition).mul(sunScaleU.mul(3.0));
        const nDotV = dot(normalWorld, normalize(camVirt.sub(positionWorld)));
        const fresnel = float(1.0).sub(nDotV).mul(0.8); // pow(1-nDotV, uFresnelPower=1) * 0.8
        const brightness = ocean.mul(4.0).add(1.0).add(fresnel); // uBase 4, uBrightnessOffset 1
        const b = brightness.mul(0.2); // uTint 0.2
        const b2 = b.mul(b);
        const col = clamp(vec3(b, b2, b2.mul(b2)).div(0.2).mul(0.6), vec3(0.0), vec3(1.0)); // uBrightness 0.6
        const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
        mat.colorNode = col;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_SPHERE_R, 128, 128), mat);
        mesh.renderOrder = 0;
        sunGroup.add(mesh);
      }

      const M4C0 = vec4(0.0, 0.8, 0.6, -0.4);
      const M4C1 = vec4(-0.8, 0.36, -0.48, -0.5);
      const M4C2 = vec4(-0.6, -0.48, 0.64, 0.2);
      const M4C3 = vec4(0.4, 0.3, 0.2, 0.4);
      const m4mul = (q) => M4C0.mul(q.x).add(M4C1.mul(q.y)).add(M4C2.mul(q.z)).add(M4C3.mul(q.w));
      const twistedSineNoise = Fn(([q0]) => {
        let q = q0;
        let a = 1.0,
          f = 1.0;
        let sum = vec4(0.0);
        for (let i = 0; i < 4; i++) {
          q = m4mul(q);
          const s = sin(q.ywxz.mul(f)).mul(a); // sin(q.ywxz * f) * a
          q = q.add(s);
          sum = sum.add(s);
          a *= 0.707; // falloff
          f /= 0.707;
        }
        return sum;
      }).setLayout({ name: "twistedSineNoise", type: "vec4", inputs: [{ name: "q", type: "vec4" }] });

      const viewProj = (pWorld) => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(pWorld, 1.0)));
      const toWorld = (p) => modelWorldMatrix.mul(vec4(p, 1.0)).xyz;

      const randomUnit = (v) => {
        const z = Math.random() * 2 - 1;
        const t = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        return v.set(r * Math.cos(t), r * Math.sin(t), z);
      };

      function finishRibbonGeometry(geo, anchor) {
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(anchor), 3));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SUN_SPHERE_R * 3);
      }

      // ---------- sunRaysVS/FS.glsl ----------
      function makeSunRays() {
        const lineCount = 8191;
        const lineLength = 8;
        const totalVerts = lineCount * lineLength * 2;
        const aPos = new Float32Array(totalVerts * 3);
        const aPos0 = new Float32Array(totalVerts * 3);
        const aWireRand = new Float32Array(totalVerts * 4);
        const indices = new Uint32Array(lineCount * (lineLength - 1) * 6);
        const base = new THREE.Vector3(), jitter = new THREE.Vector3(), held = new THREE.Vector3();
        let ip = 0, i0 = 0, ir = 0, ii = 0, rd0 = 0, rd1 = 0;
        for (let v = 0; v < lineCount; v++) {
          if (Math.random() < 0.1 || v === 0) {
            randomUnit(held).normalize();
            rd0 = Math.random();
            rd1 = Math.random();
          }
          base.copy(held);
          randomUnit(jitter).multiplyScalar(0.025);
          base.add(jitter).normalize();
          const rands = [rd0, rd1, Math.random(), Math.random()];
          for (let m = 0; m < lineLength; m++) {
            const vb = 2 * (v * lineLength + m);
            for (let y = 0; y <= 1; y++) {
              aPos[ip++] = (m + 0.5) / lineLength;
              aPos[ip++] = (v + 0.5) / lineCount;
              aPos[ip++] = 2 * y - 1;
              for (let t = 0; t < 4; t++) aWireRand[ir++] = rands[t];
              aPos0[i0++] = base.x * SUN_RIBBON_R;
              aPos0[i0++] = base.y * SUN_RIBBON_R;
              aPos0[i0++] = base.z * SUN_RIBBON_R;
            }
            if (m < lineLength - 1) {
              indices[ii++] = vb;
              indices[ii++] = vb + 1;
              indices[ii++] = vb + 2;
              indices[ii++] = vb + 2;
              indices[ii++] = vb + 1;
              indices[ii++] = vb + 3;
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("aPos", new THREE.BufferAttribute(aPos, 3));
        geo.setAttribute("aPos0", new THREE.BufferAttribute(aPos0, 3));
        geo.setAttribute("aWireRandom", new THREE.BufferAttribute(aWireRand, 4));
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
        finishRibbonGeometry(geo, aPos0);

        const A = attribute("aPos", "vec3");
        const A0 = attribute("aPos0", "vec3");
        const W = attribute("aWireRandom", "vec4");
        // uLength .45, uNoiseFrequency 8, uNoiseAmplitude .4, uWidth .03, uOpacity .03, uHue .2, uHueSpread .2
        const getPos = (phase) => {
          const size = W.z.add(0.2);
          const d = phase.mul(0.45).mul(size);
          const p = A0.add(A0.mul(d));
          return p.add(twistedSineNoise(vec4(p.mul(8.0), time)).xyz.mul(d.mul(0.4)));
        };
        const p0w = toWorld(getPos(A.x));
        const p1w = toWorld(getPos(A.x.add(0.01)));
        const dirW = normalize(p1w.sub(p0w));
        const vW = normalize(p0w.sub(cameraPosition));
        const sideW = normalize(cross(vW, dirW));
        const width = float(0.022).mul(A.z).mul(float(1.0).sub(A.x)).mul(sunScaleU);
        const pWorld = p0w.add(sideW.mul(width));

        const vOpacity = float(0.016).mul(W.w.add(0.5));
        const sd = vec3(W.w.mul(0.2).add(0.2)); // spectrum(aWireRandom.w * uHueSpread + uHue)
        const vColor = vec3(1.0).sub(smoothstep(vec3(0.0), vec3(0.25), abs(sd.add(vec3(-0.375, -0.5, -0.625)))));
        let alpha = float(1.0).sub(smoothstep(0.0, 1.0, abs(A.z)));
        alpha = alpha.mul(alpha).mul(vOpacity); // * getAlpha() = 1
        const mat = new THREE.MeshBasicNodeMaterial({
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        });
        mat.vertexNode = viewProj(pWorld);
        mat.colorNode = vColor;
        mat.opacityNode = alpha;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        sunGroup.add(mesh);
      }

      // ---------- sunFlaresVS/FS.glsl ----------
      function makeSunFlares() {
        const lineCount = 4095;
        const lineLength = 16;
        const totalVerts = lineCount * lineLength * 2;
        const aPos = new Float32Array(totalVerts * 3);
        const aPos0 = new Float32Array(totalVerts * 3);
        const aPos1 = new Float32Array(totalVerts * 3);
        const aWireRand = new Float32Array(totalVerts * 4);
        const indices = new Uint32Array(lineCount * (lineLength - 1) * 6);
        const held = new THREE.Vector3(), d = new THREE.Vector3(), f = new THREE.Vector3();
        const p = new THREE.Vector3(), g = new THREE.Vector3();
        let s = 0, l = 0, c = 0, h = 0, u = 0;
        let m = Math.random(), _p = Math.random();
        const rnd3 = (v) => v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
        for (let y = 0; y < lineCount; y++) {
          if (Math.random() < 0.0125 || y === 0) {
            rnd3(d);
            held.copy(d);
            held.add(rnd3(g).multiplyScalar(0.4)).normalize();
            m = Math.random();
            _p = Math.random();
          }
          f.copy(d).add(rnd3(g).multiplyScalar(0.02)).normalize();
          p.copy(held).add(rnd3(g).multiplyScalar(0.075)).normalize();
          const rands = [m, _p, Math.random(), Math.random()];
          for (let E = 0; E < lineLength; E++) {
            const base = 2 * (y * lineLength + E);
            for (let A = 0; A <= 1; A++) {
              aPos[s++] = (E + 0.5) / lineLength;
              aPos[s++] = (y + 0.5) / lineCount;
              aPos[s++] = 2 * A - 1;
              for (let R = 0; R < 4; R++) aWireRand[l++] = rands[R];
              aPos0[c++] = f.x * SUN_RIBBON_R;
              aPos0[c++] = f.y * SUN_RIBBON_R;
              aPos0[c++] = f.z * SUN_RIBBON_R;
              aPos1[h++] = p.x * SUN_RIBBON_R;
              aPos1[h++] = p.y * SUN_RIBBON_R;
              aPos1[h++] = p.z * SUN_RIBBON_R;
            }
            if (E < lineLength - 1) {
              indices[u++] = base;
              indices[u++] = base + 1;
              indices[u++] = base + 2;
              indices[u++] = base + 2;
              indices[u++] = base + 1;
              indices[u++] = base + 3;
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("aPos", new THREE.BufferAttribute(aPos, 3));
        geo.setAttribute("aPos0", new THREE.BufferAttribute(aPos0, 3));
        geo.setAttribute("aPos1", new THREE.BufferAttribute(aPos1, 3));
        geo.setAttribute("aWireRandom", new THREE.BufferAttribute(aWireRand, 4));
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
        finishRibbonGeometry(geo, aPos0);

        const A = attribute("aPos", "vec3");
        const A0 = attribute("aPos0", "vec3");
        const A1 = attribute("aPos1", "vec3");
        const W = attribute("aWireRandom", "vec4");
        // uWidth .005, uAmp .5, uOpacity .2, uAlphaBlended .65, uHueSpread .16, uHue 0,
        // uNoiseFrequency 4, uNoiseAmplitude .2
        const animPhase = fract(time.mul(0.3).mul(W.y.mul(0.5)).add(W.x));
        const getPosOBJ = (phase) => {
          const size = length(A1.sub(A0));
          const nrm = normalize(A0.add(A1).mul(0.5));
          let pp = mix(A0, A1, phase);
          const amp = sin(phase.mul(3.14159265)).mul(size).mul(0.5).mul(animPhase);
          pp = pp.add(nrm.mul(amp));
          return pp.add(twistedSineNoise(vec4(pp.mul(4.0), time)).xyz.mul(amp.mul(0.2)));
        };
        const pW = toWorld(getPosOBJ(A.x));
        const p1W = toWorld(getPosOBJ(A.x.add(0.01)));
        const dirW = normalize(p1W.sub(pW));
        const vW = normalize(pW.sub(cameraPosition));
        const sideW = normalize(cross(vW, dirW));
        const R = length(A0);
        const width = float(0.0038).mul(A.z).mul(float(1.0).add(animPhase)).mul(R).mul(sunScaleU);
        const pWorld = pW.add(sideW.mul(width));
        const lenW = length(pWorld).div(sunScaleU);
        const vOpacity = smoothstep(R, R.mul(1.03), lenW)
          .mul(float(1.0).sub(animPhase))
          .mul(0.12)
          .toVarying("vFlareOpacity");
        // hue(v) = .6 + .6*cos(6.3*v + vec3(0,23,21)), v = aWireRandom.w*0.16 + 0.0
        const hv = W.w.mul(0.16);
        const vColor = vec3(0.6).add(cos(vec3(hv.mul(6.3)).add(vec3(0.0, 23.0, 21.0))).mul(0.6));
        let alpha = float(1.0).sub(smoothstep(0.0, 1.0, abs(A.z)));
        alpha = alpha.mul(alpha).mul(vOpacity); // * getAlpha() = 1
        const mat = new THREE.MeshBasicNodeMaterial({
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
          fog: false,
        });
        mat.vertexNode = viewProj(pWorld);
        mat.colorNode = vColor.div(0.65);
        mat.opacityNode = alpha.mul(0.65);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        sunGroup.add(mesh);
      }

      // ---------- glowVS/FS.glsl ----------
      function makeSunGlow() {
        const segments = 134;
        const positions = new Float32Array(3 * (2 * segments));
        let r = 0;
        for (let a = 0; a < segments; a++) {
          const s = (a / segments) * Math.PI * 2.0;
          const sx = Math.sin(s) * SUN_RIBBON_R;
          const sy = Math.cos(s) * SUN_RIBBON_R;
          positions[r++] = sx;
          positions[r++] = sy;
          positions[r++] = 0.0;
          positions[r++] = sx;
          positions[r++] = sy;
          positions[r++] = 1.0;
        }
        const indices = new Uint16Array(2 * segments * 3);
        let o = 0;
        for (let a = 0; a < segments; a++) {
          const i0 = 2 * a, i1 = 2 * a + 1, i2 = 2 * ((a + 1) % segments), i3 = i2 + 1;
          indices[o++] = i0;
          indices[o++] = i1;
          indices[o++] = i2;
          indices[o++] = i2;
          indices[o++] = i1;
          indices[o++] = i3;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("aPos", new THREE.BufferAttribute(positions, 3));
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
        finishRibbonGeometry(geo, positions);

        const A = attribute("aPos", "vec3");
        // side = normalize(cross(normalize(-uCamPos), uCamUp)); p = x*side + y*uCamUp; p *= 1 + z*uRadius(0.4)
        const toSun = normalize(cameraPosition.mul(-1.0));
        const upOrtho = normalize(camUpU.sub(toSun.mul(dot(camUpU, toSun))));
        const side = normalize(cross(toSun, upOrtho));
        const dSun = length(cameraPosition).div(sunScaleU);
        const rOverD = float(SUN_SPHERE_R).div(dSun);
        const persp = float(1.0).div(max(float(1.0).sub(rOverD.mul(rOverD)), 0.0001).sqrt());
        const pp = side.mul(A.x).add(upOrtho.mul(A.y)).mul(float(1.0).add(A.z.mul(0.4))).mul(persp);
        const pWorld = pp.mul(sunScaleU);
        let alpha = float(1.0).sub(A.z); // vRadial
        alpha = alpha.mul(alpha);
        const brightness = float(1.0).add(alpha.mul(0.5)); // uFalloffColor 0.5
        const b = brightness.mul(0.4); // uTint 0.4
        const b2 = b.mul(b);
        const col = vec3(b, b2, b2.mul(b2)).div(0.4).mul(1.06); // uBrightness 1.06
        const mat = new THREE.MeshBasicNodeMaterial({
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
          fog: false,
        });
        mat.vertexNode = viewProj(pWorld);
        mat.colorNode = col;
        mat.opacityNode = alpha; // * getAlpha() = 1
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        sunGroup.add(mesh);
      }

      function buildSun() {
        const sr = globeR * SUN_FRAC;
        sunRadius = sr;
        const k = sr / SUN_SPHERE_R;
        sunBaseK = k;
        sunBaseR = sr;
        sunGroup = new THREE.Group();
        sunGroup.scale.setScalar(k);
        scene.add(sunGroup);
        sunScaleU = uniform(k);
        camUpU = uniform(new THREE.Vector3(0, 1, 0));
        makeSunSphere(); // renderOrder 0
        makeSunFlares(); // 1
        makeSunGlow(); // 2
        makeSunRays(); // 3

      }

      const _cityW = new THREE.Vector3();
      function updateCityLOD() {
        if (!cityMesh) return;
        const d = camera.position.distanceTo(globe.getWorldPosition(_cityW));
        const rpx = ((globeR * bodyScale) / Math.max(d, 1e-9) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2);
        const total = cityMesh.userData.cities;
        const nShow = rpx >= 150 ? total : Math.min(total, Math.floor(8 * rpx * rpx));
        cityMesh.visible = nShow >= 100;
        cityMesh.geometry.setDrawRange(0, nShow * 6);
      }
      function renderFrame() {
        updateCityLOD();
        camUpU.value.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        renderer.render(scene, camera);
      }

      // =====================================================================
      // =====================================================================
      const CLOUD_SIZES = { "8k": "8192x4096", "4k": "4096x2048", "2k": "2048x1024" };
      let cloudSize = CLOUD_SIZES["4k"];
      const cloudUrl = () => `https://clouds.matteason.co.uk/images/${cloudSize}/clouds-alpha.png`;
      const CLOUD_REFRESH_MS = 30 * 60 * 1000;
      const D2R = Math.PI / 180;
      let earthSunLight, sunDirU, cloudsMesh, cityPxU;
      const cloudTexNodes = [];
      let cloudsLoadedAt = null;
      const atmosphereDayColor = uniform(color("#4db2ff"));
      const atmosphereTwilightColor = uniform(color("#bc490b"));
      const roughnessLow = uniform(0.2);
      const roughnessHigh = uniform(0.35);
      const cityGain = uniform(1.0);
      const waterVar = uniform(1.0);

      function makeBlankTexture() {
        const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        t.needsUpdate = true;
        return t;
      }
      const blankCloudTex = makeBlankTexture();

      function makeGlobe() {
        globe = new THREE.Group();
        scene.add(globe);
        sunDirU = uniform(new THREE.Vector3(1, 0, 0));

        earthSunLight = new THREE.DirectionalLight("#ffffff", 2);
        earthSunLight.position.set(0, 0, 0);
        earthSunLight.target = globe;
        scene.add(earthSunLight);

        const geo = new THREE.SphereGeometry(globeR, 128, 64);

        const viewDirection = positionWorld.sub(cameraPosition).normalize();
        const fresnel = viewDirection.dot(normalWorldGeometry).abs().oneMinus().toVar();
        const sunOrientation = normalWorldGeometry.dot(sunDirU).toVar();
        const atmosphereColor = mix(
          atmosphereTwilightColor,
          atmosphereDayColor,
          sunOrientation.smoothstep(-0.25, 0.75),
        );

        const mat = new THREE.MeshStandardNodeMaterial();
        mat.lightsNode = lights([earthSunLight]);
        const dayTex = earthDayTex ? trackNode(dayTexNodes, texture(earthDayTex)) : vec4(0.16, 0.29, 0.54, 1.0);
        mat.colorNode = dayTex;
        const water = earthSpecTex ? trackNode(specTexNodes, texture(earthSpecTex)).r : float(0.0);
        const surf = normalize(positionLocal);
        const tw = time.mul(0.004);
        const windField = mx_fractal_noise_float(surf.mul(4.0).add(vec3(tw, tw.mul(0.7), tw.mul(-0.5))), 4, 2.0, 0.5, 1.0);
        const ripples = mx_fractal_noise_float(surf.mul(vec3(38.0, 90.0, 38.0)).add(vec3(0.0, tw.mul(3.0), 0.0)), 3, 2.0, 0.5, 1.0);
        const calm = smoothstep(-0.35, 0.45, windField);
        const waterRough = clamp(
          roughnessLow.add(calm.mul(0.35).add(ripples.mul(0.05)).mul(waterVar)),
          0.08,
          0.9,
        );
        mat.roughnessNode = mix(roughnessHigh, waterRough, water);
        if (earthNormalTex) mat.normalNode = normalMap(trackNode(nrmTexNodes, texture(earthNormalTex)), vec2(0.6, 0.6));

        const dayStrength = sunOrientation.smoothstep(-0.25, 0.5);
        const nightBase = dayTex.rgb.mul(0.012);
        const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1);
        const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1);
        let finalOutput = mix(nightBase, output.rgb, dayStrength);
        finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix);
        const over = max(finalOutput.sub(0.7), vec3(0.0));
        const knee = min(finalOutput, vec3(0.7)).add(over.div(over.div(0.35).add(1.0)));
        mat.outputNode = vec4(sRGBTransferOETF(knee), output.a);
        globe.add(new THREE.Mesh(geo, mat));

        const atmMat = new THREE.MeshBasicNodeMaterial({
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          fog: false,
        });
        let alpha = fresnel.remap(0.73, 1, 1, 0).pow(3);
        alpha = alpha.mul(sunOrientation.smoothstep(-0.5, 1));
        atmMat.outputNode = vec4(sRGBTransferOETF(atmosphereColor), alpha);
        const atm = new THREE.Mesh(geo, atmMat);
        atm.scale.setScalar(1.04);
        globe.add(atm);

        const cloudNode = texture(blankCloudTex);
        cloudTexNodes.push(cloudNode);
        const cloudMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
        const cLit = normalWorldGeometry.dot(sunDirU).smoothstep(-0.2, 0.4);
        const cCol = mix(vec3(0.0015, 0.0017, 0.0025), vec3(1.0), cLit);
        cloudMat.outputNode = vec4(sRGBTransferOETF(cCol), cloudNode.a.mul(0.95));
        cloudsMesh = new THREE.Mesh(new THREE.SphereGeometry(globeR * 1.012, 128, 64), cloudMat);
        cloudsMesh.visible = false;
        cloudsMesh.renderOrder = 2;
        globe.add(cloudsMesh);

        makeCityLights();
      }

      let cityMesh = null;
      function makeCityLights() {
        if (!cityData) return;
        const n = cityData.length / 3;
        const ord = new Uint32Array(n).map((_, i) => i).sort((a, b) => cityData[b * 3 + 2] - cityData[a * 3 + 2]);
        const cd = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) {
          cd[j * 3] = cityData[ord[j] * 3];
          cd[j * 3 + 1] = cityData[ord[j] * 3 + 1];
          cd[j * 3 + 2] = cityData[ord[j] * 3 + 2];
        }
        const R = globeR * 1.0015;
        const pos = new Float32Array(n * 12);
        const aCity = new Float32Array(n * 16);
        const aCorner = new Float32Array(n * 8);
        const aUvC = new Float32Array(n * 8);
        const idx = new Uint32Array(n * 6);
        const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
        for (let i = 0; i < n; i++) {
          const latD = cd[i * 3], lonD = cd[i * 3 + 1], pop = cd[i * 3 + 2];
          const lat = latD * D2R, lon = lonD * D2R, cl = Math.cos(lat);
          const dx = cl * Math.cos(lon), dy = Math.sin(lat), dz = -cl * Math.sin(lon);
          const b = Math.min(Math.max((Math.log10(pop) - 3) / 4.4, 0), 1);
          const u = (lonD + 180) / 360, v = (latD + 90) / 180;
          for (let k = 0; k < 4; k++) {
            const vi = i * 4 + k;
            pos[vi * 3] = dx * R;
            pos[vi * 3 + 1] = dy * R;
            pos[vi * 3 + 2] = dz * R;
            aCity[vi * 4] = dx;
            aCity[vi * 4 + 1] = dy;
            aCity[vi * 4 + 2] = dz;
            aCity[vi * 4 + 3] = b;
            aCorner[vi * 2] = corners[k * 2];
            aCorner[vi * 2 + 1] = corners[k * 2 + 1];
            aUvC[vi * 2] = u;
            aUvC[vi * 2 + 1] = v;
          }
          const o = i * 6, q = i * 4;
          idx[o] = q;
          idx[o + 1] = q + 1;
          idx[o + 2] = q + 2;
          idx[o + 3] = q;
          idx[o + 4] = q + 2;
          idx[o + 5] = q + 3;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aCity", new THREE.BufferAttribute(aCity, 4));
        geo.setAttribute("aCorner", new THREE.BufferAttribute(aCorner, 2));
        geo.setAttribute("aCityUv", new THREE.BufferAttribute(aUvC, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.1);

        const Cn = attribute("aCity", "vec4");
        const K = attribute("aCorner", "vec2");
        const CU = attribute("aCityUv", "vec2");
        cityPxU = uniform(new THREE.Vector2(2 / innerWidth, 2 / innerHeight));

        const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(Cn.xyz.mul(R), 1.0)));
        const sizePx = mix(float(1.0), float(3.2), Cn.w);
        const offs = K.mul(cityPxU).mul(sizePx).mul(clip.w);
        const dirW = normalize(modelWorldMatrix.mul(vec4(Cn.xyz, 0.0)).xyz);
        const night = float(1.0).sub(smoothstep(-0.12, 0.03, dot(dirW, sunDirU))).toVarying("vCityNight");

        const core = float(1.0).sub(smoothstep(0.0, 1.0, length(K)));
        const h = fract(sin(dot(CU, vec2(12.9898, 78.233))).mul(43758.5453));
        const h2 = fract(h.mul(7.13).add(0.37));
        const twinkle = sin(time.mul(h2.mul(4.0).add(1.2)).add(h.mul(40.0))).mul(0.35).add(0.65);
        const cloudNode = texture(blankCloudTex, CU);
        cloudTexNodes.push(cloudNode);
        const underCloud = float(1.0).sub(cloudNode.a.mul(0.75));
        const intensity = night.mul(mix(float(0.35), float(1.0), Cn.w)).mul(twinkle).mul(underCloud).mul(cityGain);
        const lightColor = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.86, 0.6), Cn.w);

        const mat = new THREE.MeshBasicNodeMaterial({
          transparent: true,
          premultipliedAlpha: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          fog: false,
        });
        mat.vertexNode = vec4(clip.xy.add(offs), clip.zw);
        mat.colorNode = lightColor;
        mat.opacityNode = core.mul(core).mul(intensity);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        mesh.userData.cities = n;
        cityMesh = mesh;
        globe.add(mesh);
      }

      let cloudsVersion = null;
      let cloudsPending = null;
      async function loadClouds(version, size) {
        const tex = await loadTexturePromise(`https://clouds.matteason.co.uk/images/${size}/clouds-alpha.png?v=${encodeURIComponent(version)}`);
        if (size !== cloudSize) return;
        tex.anisotropy = 8;
        for (const node of cloudTexNodes) node.value = tex;
        cloudsMesh.visible = true;
        cloudsLoadedAt = new Date();
      }
      async function checkClouds() {
        try {
          const size = cloudSize;
          const r = await fetch(cloudUrl(), { method: "HEAD", cache: "no-store" });
          const len = r.ok ? r.headers.get("content-length") : null;
          const version = `${size}:${len || Math.floor(Date.now() / CLOUD_REFRESH_MS)}`;
          if (size !== cloudSize) return;
          if (version !== cloudsVersion && version !== cloudsPending) {
            cloudsPending = version;
            try {
              await loadClouds(version, size);
              cloudsVersion = version;
            } finally {
              if (cloudsPending === version) cloudsPending = null;
            }
          }
        } catch (e) {
          console.warn("cloud check failed:", e);
        }
      }

      function makeMoon() {
        const moonR = globeR * RMOON_OVER_REARTH;
        const geo = new THREE.SphereGeometry(moonR, 48, 32);

        const mColor = moonTex
          ? trackNode(moonTexNodes, texture(moonTex, uv()))
          : vec4(0.78, 0.78, 0.78, 1.0);
        const toSun = normalize(sub(vec3(0.0, 0.0, 0.0), positionWorld));
        const diff = max(dot(normalWorld, toSun), 0.0);
        const dayC = mul(mColor, vec4(0.35, 0.33, 0.27, 1.0));
        const nightC = vec4(0.015, 0.015, 0.02, 1.0);
        const mEmis = mix(nightC, dayC, diff);

        const mMat = new THREE.MeshStandardNodeMaterial({
          color: new THREE.Color(0, 0, 0),
          metalness: 0.0,
          roughness: 1.0,
          emissiveNode: mEmis,
        });
        mMat.lightsNode = lights([]);
        mMat.outputNode = displayOut();
        moonMesh = new THREE.Mesh(geo, mMat);
        moonMesh.frustumCulled = false;
        scene.add(moonMesh);
      }

      const toScene = (v, out) => out.set(v.x, v.z, -v.y);
      const _e = new THREE.Vector3(), _mv = new THREE.Vector3();
      const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3();
      const _m4 = new THREE.Matrix4();
      function updateAstronomy(date) {
        const t = Astronomy.MakeTime(date);
        const rJ = Astronomy.Rotation_EQJ_ECT(t);
        const sunGeo = Astronomy.RotateVector(rJ, Astronomy.GeoVector(Astronomy.Body.Sun, t, true));
        toScene(sunGeo, _e).negate().normalize();
        globe.position.copy(_e).multiplyScalar(orbitR);
        sunDirU.value.copy(_e).negate();

        const g = Astronomy.SiderealTime(t) * 15 * D2R;
        const rD = Astronomy.Rotation_EQD_ECT(t);
        const lon0 = Astronomy.RotateVector(rD, new Astronomy.Vector(Math.cos(g), Math.sin(g), 0, t));
        const lon90 = Astronomy.RotateVector(rD, new Astronomy.Vector(-Math.sin(g), Math.cos(g), 0, t));
        const north = Astronomy.RotateVector(rD, new Astronomy.Vector(0, 0, 1, t));
        toScene(lon0, _ax);
        toScene(north, _ay);
        toScene(lon90, _az).negate();
        _m4.makeBasis(_ax, _ay, _az);
        globe.quaternion.setFromRotationMatrix(_m4);

        const m = Astronomy.RotateVector(rJ, Astronomy.GeoMoon(t));
        const moonDistEarthR = (m.Length() * 149597870.7) / 6371;
        toScene(m, _mv).normalize().multiplyScalar(globeR * bodyScale * (PARAMS.realScale ? moonDistEarthR : MOON_DIST_COMPRESSED));
        moonMesh.position.copy(globe.position).add(_mv);
        _ax.copy(_mv).negate().normalize();
        _ay.set(0, 1, 0).addScaledVector(_ax, -_ax.y).normalize();
        _az.crossVectors(_ax, _ay);
        _m4.makeBasis(_ax, _ay, _az);
        moonMesh.quaternion.setFromRotationMatrix(_m4);
      }

      // =====================================================================
      // =====================================================================
      const SKY_R = 800;
      const MOON_VIS_DEG = 5.0;
      const SUN_VIS_DEG = 3.5;
      const sky = {
        open: false,
        ready: null,
        lat: 0,
        lon: 0,
        tz: "UTC",
        cloud: null,
        yaw: 0,
        pitch: 0.25,
        fov: 70,
        lastInfo: 0,
        lastWeather: 0,
      };
      const CREATURES = { fishEvery: 9 };
      const PRECIP_MAX = 25000;
      const skyIn = HOST.input.sky;
      function lookAtBody(h) {
        sky.yaw = -h.azimuth * D2R;
        sky.pitch = Math.max(-1.4, Math.min(1.55, h.altitude * D2R));
      }
      UI.on("look", (b) => {
        const h = b === "sun" ? sky.sunH : sky.moonH;
        if (h) lookAtBody(h);
      });
      const _cv = new THREE.Vector3();
      function markPos(dir, above) {
        if (!above) return null;
        const cam = sky.camera;
        _cv.copy(dir).applyMatrix4(cam.matrixWorldInverse);
        const w = sky.viewW, h = sky.viewH;
        if (_cv.z < 0) {
          const ndc = _cv.clone().applyMatrix4(cam.projectionMatrix);
          if (Math.abs(ndc.x) < 0.97 && Math.abs(ndc.y) < 0.97) return null;
        }
        let dx = _cv.x, dy = -_cv.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const mx = w / 2 - 20, my = h / 2 - 20;
        const k = Math.min(mx / Math.max(Math.abs(dx), 1e-6), my / Math.max(Math.abs(dy), 1e-6));
        return [Math.round(w / 2 + dx * k), Math.round(h / 2 + dy * k)];
      }
      const horDir = (altDeg, azDeg, out) => {
        const a = altDeg * D2R, z = azDeg * D2R;
        return out.set(Math.cos(a) * Math.sin(z), Math.sin(a), -Math.cos(a) * Math.cos(z));
      };
      const horToSky = (v, out) => out.set(-v.y, v.z, -v.x);

      function makeLabel(text) {
        const c = makeCanvas(1, 1);
        c.width = c.height = 128;
        const g = c.getContext("2d");
        g.font = "bold 76px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.lineJoin = "round";
        g.lineWidth = 14;
        g.strokeStyle = "rgba(0,0,0,0.9)";
        g.strokeText(text, 64, 68);
        g.fillStyle = "rgba(255,255,255,1)";
        g.fillText(text, 64, 68);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, sizeAttenuation: false });

        const s = new THREE.Sprite(m);
        s.scale.setScalar(0.22);
        s.center.set(0.5, 0.17);
        return s;
      }

      async function initSky() {
        const r = new THREE.WebGPURenderer({ canvas: HOST.canvases.sky, antialias: true });
        r.setPixelRatio(Math.min(devicePixelRatio, QUALITY_TIERS[QUALITY.tier].dpr));
        const w = Math.max(1, skyIn.clientWidth > 1 ? skyIn.clientWidth : 600), h = Math.max(1, skyIn.clientHeight > 1 ? skyIn.clientHeight : 360);
        r.setSize(w, h, false);
        await r.init();
        r.toneMapping = THREE.NoToneMapping;
        r.outputColorSpace = THREE.SRGBColorSpace;
        sky.renderer = r;
        const scene = new THREE.Scene();
        sky.scene = scene;
        sky.camera = new THREE.PerspectiveCamera(sky.fov, w / h, 0.5, 5000);
        sky.camera.rotation.order = "YXZ";
        // Post-processing of the sky view: bloom on the bright sun disc and light shafts (radial blur of a
        // sun-only mask towards the sun's screen position). Mountains in front of the sun cut the mask,
        // so the shafts break through the ridge. Strongest when the sun is low.
        {
          const sp = pass(scene, sky.camera);
          const col = sp.getTextureNode();
          sky.raysU = uniform(0);
          sky.sunUV = uniform(new THREE.Vector2(0.5, 0.5));
          const lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
          const mask = vec4(col.rgb.mul(smoothstep(1.5, 4.0, lum)), 1.0);
          const shafts = radialBlur(mask, { center: sky.sunUV, weight: float(0.9), decay: float(0.96), count: int(48), exposure: float(1.2) });
          sky.glow = bloom(col, 0.3, 0.5, 1.2);
          const tint = vec3(1.0, 0.72, 0.42);
          sky.post = new THREE.RenderPipeline(r, col.add(sky.glow).add(vec4(shafts.rgb.mul(tint).mul(sky.raysU), 0.0)));
        }
        sky.pxU = uniform(new THREE.Vector2(2 / w, 2 / h));
        sky.starVis = uniform(0);
        sky.cloudDim = uniform(1);
        sky.sunDirU = uniform(new THREE.Vector3(0, 1, 0));
        sky.groundColor = uniform(new THREE.Color(0.02, 0.022, 0.025));

        const sm = new SkyMesh();
        sm.scale.setScalar(SKY_R * 2);
        sm.turbidity.value = 2.0;
        sm.rayleigh.value = 1.0;
        sm.mieCoefficient.value = 0.0006;
        sm.mieDirectionalG.value = 0.95;
        sm.cloudCoverage.value = 0.0;
        sm.cloudDensity.value = 0.22;
        sm.cloudElevation.value = 0.1;
        sm.cloudScale.value = 0.00035;
        sky.nightU = uniform(0);
        const viewDir = normalize(positionWorld.sub(cameraPosition));
        const nightCol = mix(vec3(0.03, 0.06, 0.17), vec3(0.008, 0.02, 0.075), smoothstep(0.0, 0.6, max(viewDir.y, 0.0)));
        const skyCol = sm.material.colorNode.add(vec4(nightCol.mul(sky.nightU), 0.0));
        sm.material.colorNode = vec4(acesFilmicToneMapping(skyCol.rgb, float(0.35)), 1.0);
        scene.add(sm);
        sky.mesh = sm;

        {
          const cu = {
            base: uniform(1500),
            top: uniform(4200),
            coverage: uniform(0.0),
            steps: uniform(QUALITY_TIERS[QUALITY.tier].clouds),
            absorb: uniform(0.0045),
            sunDir: uniform(new THREE.Vector3(0, 1, 0)),
            sunCol: uniform(new THREE.Color(1, 0.97, 0.92)),
            amb: uniform(new THREE.Color(0.55, 0.62, 0.75)),
            wind: uniform(new THREE.Vector3(14, 0, 5)),
          };
          sky.cloudU = cu;
          const tw = cu.wind.mul(time);

          const shapeD = Fn(([pp]) => {
            const n = mx_fractal_noise_float(pp.add(tw).mul(0.00028), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
            const cov = max(cu.coverage, 0.02);
            const sh = clamp(n.sub(float(1.0).sub(cov)).div(cov), 0.0, 1.0);
            const hh = clamp(pp.y.sub(cu.base).div(cu.top.sub(cu.base)), 0.0, 1.0);
            const prof = smoothstep(0.0, 0.1, hh).mul(float(1.0).sub(smoothstep(0.45, 1.0, hh)));
            return sh.mul(prof).mul(smoothstep(0.0, 0.02, cu.coverage));
          });
          const erodeD = Fn(([pp, sh]) => {
            const det = mx_fractal_noise_float(pp.add(tw.mul(1.7)).mul(0.0021), 2, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
            return clamp(sh.sub(det.mul(0.38).mul(float(1.0).sub(sh))), 0.0, 1.0);
          });
          const hg = (c, g) => float(1 - g * g).div(float(4 * Math.PI).mul(pow(float(1 + g * g).sub(c.mul(2 * g)), 1.5)));

          const cloudNode = Fn(() => {
            const rd = normalize(positionWorld.sub(cameraPosition));
            const res = vec4(0.0).toVar();
            If(rd.y.greaterThan(0.015), () => {
              const t0 = cu.base.div(rd.y);
              const t1 = min(cu.top.div(rd.y), t0.add(16000.0));
              const dt = t1.sub(t0).div(cu.steps);
              const jit = fract(sin(dot(screenUV, vec2(12.9898, 78.233))).mul(43758.5453));
              const t = t0.add(dt.mul(jit)).toVar();
              const cosT = dot(rd, cu.sunDir);
              const phase = hg(cosT, 0.6).mul(0.7).add(hg(cosT, -0.3).mul(0.3)).mul(4 * Math.PI);
              const ls = cu.top.sub(cu.base).div(6.0);
              Loop(26, ({ i }) => {
                If(float(i).greaterThanEqual(cu.steps).or(res.a.greaterThan(0.985)), () => {
                  Break();
                });
                const pp = rd.mul(t);
                const sh = shapeD(pp);
                const d = erodeD(pp, sh);
                If(sh.greaterThan(0.004).and(d.greaterThan(0.003)), () => {
                  const ld = float(0.0).toVar();
                  Loop(3, ({ i }) => {
                    ld.addAssign(shapeD(pp.add(cu.sunDir.mul(ls.mul(float(i).add(0.6))))));
                  });
                  const tau = ld.mul(ls).mul(cu.absorb);
                  const beer = exp(tau.negate());
                  const powder = float(1.0).sub(exp(tau.mul(-2.0)));
                  const light = mix(beer, beer.mul(powder), 0.5);
                  const hh = clamp(pp.y.sub(cu.base).div(cu.top.sub(cu.base)), 0.0, 1.0);
                  const col = cu.sunCol.mul(light.mul(phase).mul(1.1)).add(cu.amb.mul(hh.mul(0.45).add(0.3)));
                  const a = float(1.0).sub(exp(d.mul(dt).mul(cu.absorb).negate()));
                  res.rgb.addAssign(col.mul(a).mul(float(1.0).sub(res.a)));
                  res.a.addAssign(a.mul(float(1.0).sub(res.a)));
                });
                t.addAssign(dt);
              });
              res.mulAssign(smoothstep(0.015, 0.09, rd.y));
            });
            return res;
          })();

          const cm = new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            fog: false,
          });
          cm.colorNode = cloudNode.rgb.div(max(cloudNode.a, 0.0001));
          cm.opacityNode = cloudNode.a;
          const vc = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * 0.85, 48, 24), cm);
          vc.renderOrder = 3;
          vc.frustumCulled = false;
          scene.add(vc);
          sky.vclouds = vc;
        }

        // Lake in front of the backdrop's water cut-out (land only): a hole in the ground with water under it.
        const LAKE = { dist: 28, a: 30, b: 12 };
        sky.lake = LAKE;
        sky.lakeC = uniform(new THREE.Vector2(0, LAKE.dist));
        sky.lakeT = uniform(new THREE.Vector2(1, 0));
        sky.lakeOn = uniform(0);
        const lakeDist = Fn(() => {
          const p = positionWorld.xz.sub(sky.lakeC);
          const u = dot(p, sky.lakeT).div(LAKE.a);
          const v = dot(p, vec2(sky.lakeT.y.negate(), sky.lakeT.x)).div(LAKE.b);
          return u.mul(u).add(v.mul(v)).add(mx_fractal_noise_float(positionWorld.xz.mul(0.09), 2, 2.0, 0.5, 1.0).mul(0.22));
        })();

        const groundMat = new THREE.MeshBasicNodeMaterial({ fog: false });
        sky.dayLight = uniform(1);
        {
          const gn = mx_fractal_noise_float(positionWorld.xz.mul(0.08), 4, 2.0, 0.5, 1.0);
          const gn2 = mx_fractal_noise_float(positionWorld.xz.mul(0.7), 3, 2.0, 0.5, 1.0);
          const plain = mix(vec3(0.018, 0.035, 0.01), vec3(0.05, 0.08, 0.022), smoothstep(-0.6, 0.6, gn)).mul(gn2.mul(0.18).add(0.9));
          const gt = new THREE.Texture();
          gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
          gt.colorSpace = THREE.SRGBColorSpace;
          gt.anisotropy = 8;
          sky.groundTex = gt;
          const soil = texture(gt, positionWorld.xz.div(2.0)).rgb.mul(0.42).mul(gn.mul(0.15).add(1.0));
          const far = smoothstep(25.0, 90.0, length(positionWorld.xz));
          groundMat.colorNode = Fn(() => {
            Discard(sky.lakeOn.greaterThan(0.5).and(lakeDist.lessThan(1.0)));
            const shore = mix(float(1.0), mix(float(0.5), float(1.0), smoothstep(1.0, 1.6, lakeDist)), sky.lakeOn);
            return mix(soil, plain, far).mul(sky.dayLight).mul(shore);
          })();
          setGroundRes(QUALITY_TIERS[QUALITY.tier].tex);
        }
        const ground = new THREE.Mesh(new THREE.CircleGeometry(SKY_R * 1.2, 96), groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -2;
        ground.renderOrder = 5;
        scene.add(ground);
        sky.ground = ground;

        const wn = new THREE.Texture();
        loadTexturePromise("textures/waternormals.jpg").then((t) => {
          wn.image = t.image;
          wn.flipY = false;
          wn.needsUpdate = true;
        });
        wn.wrapS = wn.wrapT = THREE.RepeatWrapping;
        sky.water = new WaterMesh(new THREE.PlaneGeometry(SKY_R * 2.4, SKY_R * 2.4), {
          waterNormals: wn,
          sunDirection: new THREE.Vector3(0, 1, 0),
          sunColor: 0xffffff,
          waterColor: 0x00303a,
          distortionScale: 3.7,
          size: 4.0,
          resolutionScale: 0.5,
        });
        sky.water.rotation.x = -Math.PI / 2;
        sky.water.position.y = -2;
        sky.water.visible = false;
        scene.add(sky.water);

        // Backdrop: silhouette layers of assets/backdrop.svg (parsed on the page by SVGLoader), bent into rings.
        sky.backdrop = new THREE.Group();
        sky.backdrop.visible = false;
        sky.backdropWater = Math.PI;
        scene.add(sky.backdrop);
        HOST.backdrop?.then((bd) => bd && buildBackdrop(bd, 600));

        {
          const img = await createImageBitmap(await (await fetch("textures/earth_specular_4k.jpg")).blob());
          const c = new OffscreenCanvas(1024, 512);
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0, 1024, 512);
          sky.waterMask = g.getImageData(0, 0, 1024, 512).data;
        }

        sky.sunLightM = new THREE.DirectionalLight(0xffffff, 2.5);
        sky.skyLightM = new THREE.HemisphereLight(0xbfd8ff, 0x3a4a20, 0.6);
        scene.add(sky.sunLightM, sky.skyLightM);

        sky.torchOn = true;
        sky.torchNdc = new THREE.Vector2(0, -0.25);
        sky.torchDir = new THREE.Vector3(0, -0.3, -1).normalize();
        const TORCH_ANGLE = 0.25;
        const torch = new THREE.SpotLight(0xfff4e0, 0, 120, TORCH_ANGLE, 0.6, 1.5);
        torch.position.set(0, -0.9, 0.6);
        scene.add(torch, torch.target);
        sky.torch = torch;
        {
          const S0 = 0.02, L = 40;
          const geo = new THREE.CylinderGeometry(Math.tan(TORCH_ANGLE) * S0, Math.tan(TORCH_ANGLE) * L, L - S0, 48, 1, true);
          geo.translate(0, -(S0 + (L - S0) / 2), 0);
          geo.rotateX(-Math.PI / 2);
          const beamU = uniform(0);
          const bm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
          bm.colorNode = vec3(1.0, 0.96, 0.85);
          const facing = abs(dot(normalize(normalView), normalize(positionView).negate()));
          const along = float(1).sub(uv().y).mul(L);
          const fadeIn = smoothstep(float(0), float(1.5), along);
          const nearGround = smoothstep(float(-2.0), float(-1.4), positionWorld.y);
          const nearEye = smoothstep(float(1.0), float(3.0), length(positionView));
          bm.opacityNode = pow(facing, float(2.0)).mul(pow(uv().y, float(1.3))).mul(fadeIn).mul(nearGround).mul(nearEye).mul(beamU).mul(0.045);
          const beam = new THREE.Mesh(geo, bm);
          beam.frustumCulled = false;
          beam.renderOrder = 4;
          scene.add(beam);
          sky.beam = beam;
          sky.beamU = beamU;
        }

        {
          const MAX = PRECIP_MAX;
          const K = 0.56;
          const BOX = 28, FLOOR = -2, TOP = 25 * K;
          const SURF = FLOOR + 0.05 * K;
          const pos = instancedArray(MAX, "vec3");
          const ripplePos = instancedArray(MAX, "vec3");
          const rippleTime = instancedArray(MAX, "vec3");
          const rainOnU = uniform(1.0);
          const fallU = uniform(6.0);
          const windU = uniform(new THREE.Vector2(0, 0));
          const swayU = uniform(0.0);
          const lightU = uniform(1.0);
          const init = Fn(() => {
            const p = pos.element(instanceIndex);
            p.x = hash(instanceIndex).mul(2 * BOX).sub(BOX);
            p.y = hash(instanceIndex.add(7919)).mul(TOP - FLOOR).add(FLOOR);
            p.z = hash(instanceIndex.add(15485)).mul(2 * BOX).sub(BOX);
            rippleTime.element(instanceIndex).x = 1000;
          })().compute(MAX);
          const update = Fn(() => {
            const p = pos.element(instanceIndex);
            const rn = hash(instanceIndex.add(31337));
            const dtc = deltaTime.min(0.1);
            p.y.subAssign(fallU.mul(rn.mul(0.35).add(0.8)).mul(dtc));
            const ph = rn.mul(40.0);
            p.x.addAssign(windU.x.add(sin(time.mul(rn.mul(1.3).add(0.6)).add(ph)).mul(swayU)).mul(dtc));
            p.z.addAssign(windU.y.add(cos(time.mul(rn.add(0.5)).add(ph.mul(0.43))).mul(swayU)).mul(dtc));
            const rt = rippleTime.element(instanceIndex);
            rt.x = rt.x.add(deltaTime.mul(4));
            If(p.y.sub(0.9 * K).lessThan(SURF), () => {
              If(rainOnU.greaterThan(0.5), () => {
                const rp = ripplePos.element(instanceIndex);
                rp.x = p.x;
                rp.y = SURF;
                rp.z = p.z;
                rt.x = 1;
              });
              p.y.addAssign(TOP);
              p.x = hash(instanceIndex.add(time)).mul(2 * BOX).sub(BOX);
              p.z = hash(instanceIndex.add(time.add(7.31))).mul(2 * BOX).sub(BOX);
            });
            p.x = fract(p.x.add(BOX).div(2 * BOX)).mul(2 * BOX).sub(BOX);
            p.z = fract(p.z.add(BOX).div(2 * BOX)).mul(2 * BOX).sub(BOX);
          })().compute(MAX);

          const pAttr = pos.toAttribute();
          const nearFade = smoothstep(1.5, 3.5, length(vec2(pAttr.x, pAttr.z)));

          const rainMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide });
          rainMat.colorNode = vec3(0.86, 0.89, 0.94).mul(lightU);
          rainMat.opacityNode = float(1)
            .sub(abs(uv().x.sub(0.5)).mul(2))
            .mul(float(1).sub(uv().y).mul(0.7).add(0.3))
            .mul(0.45);
          const lenU = uniform(1.0);
          {
            const rn = hash(instanceIndex.add(31337));
            const vel = vec3(windU.x, fallU.mul(rn.mul(0.35).add(0.8)).negate(), windU.y);
            const along = normalize(vel);
            const side = normalize(cross(along, cameraPosition.sub(pAttr)));
            const g = positionGeometry.mul(nearFade);
            rainMat.positionNode = pAttr.add(along.mul(g.y.mul(lenU).negate())).add(side.mul(g.x));
          }
          const rain = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 2 * K), rainMat);
          rain.frustumCulled = false;
          rain.visible = false;
          rain.renderOrder = 6;
          scene.add(rain);

          const rTime = rippleTime.element(instanceIndex).x;
          const rippleEffect = Fn(() => {
            const center = uv().add(vec2(-0.5)).length().mul(7);
            const distance = rTime.sub(center);
            return distance.min(1).sub(distance.max(1).sub(1));
          });
          const rippleMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false });
          rippleMat.colorNode = rippleEffect().mul(lightU);
          const rpAttr = ripplePos.toAttribute();
          const rippleScaleU = uniform(1.0); // splash size: 1 on water, 0.1 on land
          rippleMat.positionNode = positionGeometry.mul(rippleScaleU).mul(smoothstep(1.5, 3.5, length(vec2(rpAttr.x, rpAttr.z)))).add(rpAttr);
          rippleMat.opacityNode = rTime.mul(0.3).oneMinus().max(0).mul(0.5);
          rippleMat.forceSinglePass = true;
          const surfG = new THREE.PlaneGeometry(2.5 * K, 2.5 * K);
          surfG.rotateX(-Math.PI / 2);
          const xG = new THREE.PlaneGeometry(1 * K, 2 * K);
          xG.rotateY(-Math.PI / 2);
          const zG = new THREE.PlaneGeometry(1 * K, 2 * K);
          const ripples = new THREE.Mesh(BufferGeometryUtils.mergeGeometries([surfG, xG, zG]), rippleMat);
          ripples.frustumCulled = false;
          ripples.visible = false;
          ripples.renderOrder = 6;
          scene.add(ripples);

          const snowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false });
          snowMat.colorNode = vec3(0.95, 0.96, 1.0).mul(lightU);
          snowMat.opacityNode = smoothstep(0.5, 0.15, uv().distance(vec2(0.5, 0.5))).mul(0.9);
          snowMat.positionNode = positionGeometry.mul(nearFade).add(pAttr);
          snowMat.vertexNode = billboarding();
          const snow = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.035), snowMat);
          snow.frustumCulled = false;
          snow.visible = false;
          snow.renderOrder = 6;
          scene.add(snow);

          r.compute(init);
          sky.precipFx = { rain, ripples, snow, update, fallU, windU, swayU, lightU, rainOnU, lenU, rippleScaleU };
        }

        sky.grassField = await skyTask("Grass", Grass.create({
          camera: sky.camera,
          scene,
          renderer: r,
          terrain: () => -2,
          preset: "perennialRyegrass",
          bladeHeight: 0.45,
          density: (sky.grassBase = { density: grassPresets.perennialRyegrass.density * 3.5 }).density * QUALITY_TIERS[QUALITY.tier].grass,
          lods: [
            { distance: 8, density: 1, segments: 5 },
            { distance: 25, density: 0.6, segments: 3 },
            { distance: 60, density: 0.25, segments: 2 },
            { distance: 120, density: 0.1, segments: 1 },
          ],
          bladeWidth: grassPresets.perennialRyegrass.bladeWidth * 0.6,
          tileSize: 20,
          maxDistance: 60,
          sun: sky.sunLightM,
          castShadow: false,
          receiveShadow: false,
        }));
        sky.grassField.material.roughness = 0.95;
        sky.grassField.material.specularIntensity = 0.03;
        sky.grassField.material.needsUpdate = true;

        const fishTask = skyTaskStart("Fish");
        gltfLoader().load("assets/atlantic_mackerel_animated_and_game-ready.glb", (gltf) => {
          fishTask();
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const inner = new THREE.Group();
          inner.add(model);
          if (size.z > size.x) inner.rotation.y = Math.PI / 2 + FISH_FLIP;
          const len = Math.max(size.x, size.z);
          inner.scale.setScalar(0.75 / len);
          const fish = new THREE.Group();
          fish.add(inner);
          fish.visible = false;
          scene.add(fish);
          const mixer = new THREE.AnimationMixer(model);
          const swim = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, "Swimming") || gltf.animations[0]);
          swim.timeScale = 2.2;
          swim.play();
          sky.fish = { obj: fish, inner, mixer, last: performance.now(), t0: -1, next: performance.now() + 3000 };
        });

        sky.herd = [];
        const SPECIES = [
          { key: "rhino", label: "Rhinos", url: "assets/rhino_animation_walk.glb", count: 2, length: 3.8, footSpeed: 0.86, animScale: 1.0, radius: 1.95, mass: 2.2, spacing: 8.0, cohesion: 0.6, proxy: [1.3, 1.7], sound: "rhino" },
          { key: "elephant", label: "Elephants", url: "assets/elephant.glb", clip: "TRS|walk", trumpetClip: "TRS|idle Trumped", count: 3, length: 6.0, footSpeed: 1.67, animScale: 1.0, radius: 2.9, mass: 5.0, spacing: 9.0, cohesion: 0.6, proxy: [2.4, 3.3], sound: "elephant" },
          { key: "rhinoRun", label: "Running rhino", url: "assets/rhino_running.glb", count: 1, length: 3.8, footSpeed: 5.0, animScale: 1.0, radius: 1.95, mass: 2.2, spacing: 8.0, cohesion: 0, turnRate: 0.45, proxy: [1.3, 1.7], sound: "rhino" },
          { key: "lioness", label: "Lionesses", url: "assets/lioness.glb", clip: "Lioness|Lioness_WalkFast_F", idleClip: "Lioness|Lioness_Idle", walkSec: [12, 30], restSec: [8, 20], count: 5, length: 2.5, footSpeed: 2.53, animScale: 1.0, radius: 1.3, mass: 0.6, spacing: 4.0, cohesion: 0.7, proxy: [0.5, 1.2], sound: "lion", jaw: { bone: "Jaw_037", max: 0.5, gain: 9 } },
          { key: "alligator", label: "Alligators", url: "assets/alligator.glb", clip: "AmericanAligator|AmericanAlligator_Trot_F", idleClip: "AmericanAligator|AmericanAlligator_Idle", hoverVoice: true, threat: { from: 1.5, to: 4.7, hissAt: 1.9 }, count: 3, length: 3.0, footSpeed: 1.62, animScale: 1.0, radius: 1.55, mass: 0.7, spacing: 5.0, cohesion: 0.5, proxy: [0.65, 0.55], sound: "alligator" },
        ];
        const loadSpecies = (sp) =>
          new Promise((resolve) => {
            gltfLoader().load(sp.url, async (gltf) => {
              if (sp.specGloss) {
                const tex = await gltf.parser.getDependency("texture", 0);
                tex.colorSpace = THREE.SRGBColorSpace;
                gltf.scene.traverse((o) => {
                  if (o.isMesh) {
                    o.material.map = tex;
                    o.material.color.set(0xffffff);
                    o.material.metalness = 0;
                    o.material.roughness = 0.92;
                    o.material.needsUpdate = true;
                  }
                });
              }
              resolve(gltf);
            });
          });
        (async () => {
          const rnd = (a, b) => a + Math.random() * (b - a);
          sky.groups = {};
          for (const sp of SPECIES) {
            const gltf = await skyTask(sp.label, loadSpecies(sp));
            const walkClip = (sp.clip && gltf.animations.find((a) => a.name === sp.clip)) || gltf.animations[0];
            const idleClip = sp.idleClip ? gltf.animations.find((a) => a.name === sp.idleClip) : null;
            const trumpetClip = sp.trumpetClip ? gltf.animations.find((a) => a.name === sp.trumpetClip) : null;
            const gAng = rnd(0, Math.PI * 2), gR = rnd(18, 28);
            const gCenter = new THREE.Vector2(Math.cos(gAng) * gR, Math.sin(gAng) * gR);
            const gHeading = gAng + Math.PI / 2 + rnd(-0.5, 0.5);
            sky.groups[sp.key] = { target: null, retarget: 0 };
            gltf.scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const longX = size.x > size.z;
            const scale = sp.length / Math.max(size.x, size.z);
            for (let n = 0; n < sp.count; n++) {
              const model = SkeletonUtils.clone(gltf.scene);
              model.position.set(-center.x, -box.min.y, -center.z);
              const inner = new THREE.Group();
              inner.add(model);
              if (longX) inner.rotation.y = -Math.PI / 2;
              const sizeK = rnd(0.92, 1.08);
              inner.scale.setScalar(scale * sizeK);
              const obj = new THREE.Group();
              obj.add(inner);
              scene.add(obj);
              const proxy = new THREE.Mesh(new THREE.BoxGeometry(sp.proxy[0] * sizeK, sp.proxy[1] * sizeK, sp.length * sizeK), new THREE.MeshBasicMaterial({ visible: false }));
              proxy.position.y = (sp.proxy[1] * sizeK) / 2;
              proxy.userData.kind = sp.key;
              obj.add(proxy);
              const mixer = new THREE.AnimationMixer(model);
              const action = mixer.clipAction(walkClip);
              action.play();
              action.time = rnd(0, walkClip.duration);
              let trumpet = null;
              if (trumpetClip) {
                trumpet = mixer.clipAction(trumpetClip);
                trumpet.setLoop(THREE.LoopOnce, 1);
                trumpet.clampWhenFinished = true;
              }
              let idle = null;
              if (idleClip) {
                idle = mixer.clipAction(idleClip);
                idle.time = rnd(0, idleClip.duration);
              }
              const jaw = sp.jaw ? makeJaw(model, sp.jaw, [walkClip, idleClip]) : null;
              const oa = rnd(0, Math.PI * 2), orr = rnd(0.4, 1.0) * sp.spacing * 0.9 * Math.sqrt(n + 1);
              const heading = gHeading + rnd(-0.15, 0.15);
              sky.herd.push({
                sp, obj, inner, mixer, action,
                pos: gCenter.clone().add(new THREE.Vector2(Math.cos(oa) * orr, Math.sin(oa) * orr)),
                heading,
                dir: new THREE.Vector2(Math.sin(heading), Math.cos(heading)),
                target: null,
                speed: sp.footSpeed * sp.animScale * sizeK,
                radius: sp.radius * sizeK,
                retarget: 0,
                trumpet,
                idle,
                jaw,
                voiceTap: null,
                resting: false,
                phaseUntil: sp.walkSec ? performance.now() + rnd(0, sp.walkSec[1]) * 1000 : Infinity,
                stopUntil: 0,
                nextHoverSound: 0,
                proxy,
              });
              proxy.userData.ref = sky.herd[sky.herd.length - 1];
            }
          }
          updateGrassInteractors();
        })();

        sky.clown = null;
        const clownTask = skyTaskStart("Clown");
        gltfLoader().load("assets/clown.glb", (gltf) => {
          const model = gltf.scene;
          model.traverse((o) => {
            if (!o.isMesh) return;
            o.frustumCulled = false;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (m.name === "Clown_MouthDark") continue;
              m.side = THREE.FrontSide;
              m.needsUpdate = true;
            }
          });
          const obj = new THREE.Group();
          obj.add(model);
          const ang = Math.random() * Math.PI * 2, r = 6 + Math.random() * 3;
          const x = Math.sin(ang) * r, z = -Math.cos(ang) * r;
          obj.position.set(x, -2, z);
          obj.rotation.y = Math.atan2(-x, -z);
          scene.add(obj);
          const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
          proxy.position.set(x, -2 + 0.85, z);
          proxy.userData.kind = "clown";
          scene.add(proxy);
          const eyes = ["Clown_Eye_L", "Clown_Eye_R"].map((n) => model.getObjectByName(n)).filter(Boolean).map((e) => ({ e, pos: e.position.clone(), scl: e.scale.clone() }));
          const bulgeU = uniform(0);
          for (const ey of eyes)
            ey.e.traverse((o) => {
              if (!o.isMesh || !o.material?.map) return;
              const m0 = o.material;
              const t = texture(m0.map, uv());
              const lum = dot(t.rgb, vec3(0.299, 0.587, 0.114));
              const sat = max(max(t.r, t.g), t.b).sub(min(min(t.r, t.g), t.b));
              const sclera = smoothstep(0.45, 0.65, lum).mul(float(1).sub(smoothstep(0.08, 0.2, sat)));
              const crazy = mix(vec3(0.012, 0.0, 0.0), vec3(0.9, 0.36, 0.32), sclera);
              const nm = new THREE.MeshStandardNodeMaterial({ roughness: m0.roughness, metalness: m0.metalness });
              nm.colorNode = mix(t.rgb, crazy, bulgeU);
              o.material = nm;
            });
          const mouthMeshes = [];
          model.traverse((o) => o.morphTargetDictionary && o.morphTargetDictionary.MouthOpen !== undefined && mouthMeshes.push(o));
          const mixer = new THREE.AnimationMixer(model);
          const dance = mixer.clipAction(gltf.animations.find((a) => a.name === "Clown_Thriller"));
          const laugh = mixer.clipAction(gltf.animations.find((a) => a.name === "Clown_Laugh"));
          laugh.setLoop(THREE.LoopOnce, 1);
          laugh.clampWhenFinished = true;
          dance.play();
          dance.time = Math.random() * dance.getClip().duration;
          const c = { obj, mixer, dance, laugh, proxy, eyes, bulgeU, mouthMeshes, mouth: 0, bulge: 0, turn: null, analyser: null, laughing: false, pos: new THREE.Vector2(x, z), radius: 0.6, home: obj.position.clone() };
          const hips = model.getObjectByName("mixamorigHips");
          c.hips = hips;
          const trackOf = (clip) => clip.tracks.find((t) => t.name === "mixamorigHips.position");
          const dTr = trackOf(dance.getClip()), lTr = trackOf(laugh.getClip());
          const lOrig = lTr.values.slice();
          const at = (tr, t) => new THREE.Vector3().fromArray(tr.createInterpolant().evaluate(t));
          const M3 = new THREE.Matrix3();
          const toWorld = (v) => (hips.parent.updateWorldMatrix(true, false), v.clone().applyMatrix3(M3.setFromMatrix4(hips.parent.matrixWorld)));
          const toLocal = (v) => (hips.parent.updateWorldMatrix(true, false), v.clone().applyMatrix3(M3.setFromMatrix4(hips.parent.matrixWorld).invert()));
          const horiz = (v) => ((v.y = 0), v);
          const dStart = at(dTr, 0), dEnd = at(dTr, dance.getClip().duration);
          const syncPos = () => c.pos.set(obj.position.x, obj.position.z);
          mixer.addEventListener("loop", (e) => {
            if (e.action !== dance) return;
            obj.updateMatrixWorld(true);
            const pv = hips.getWorldPosition(new THREE.Vector3());
            obj.position.add(horiz(toWorld(dEnd.clone().sub(dStart))));
            obj.updateMatrixWorld(true);
            if (obj.position.distanceTo(c.home) > 3.5) {
              obj.position.set(2 * pv.x - obj.position.x, obj.position.y, 2 * pv.z - obj.position.z);
              obj.rotation.y += Math.PI;
              obj.updateMatrixWorld(true);
            }
            syncPos();
          });
          c.alignLaugh = () => {
            const off = toLocal(horiz(toWorld(at(dTr, dance.time).sub(new THREE.Vector3(lOrig[0], lOrig[1], lOrig[2])))));
            for (let i = 0; i < lOrig.length; i += 3) {
              lTr.values[i] = lOrig[i] + off.x;
              lTr.values[i + 1] = lOrig[i + 1] + off.y;
              lTr.values[i + 2] = lOrig[i + 2] + off.z;
            }
          };
          mixer.addEventListener("finished", (e) => {
            if (e.action !== laugh) return;
            c.analyser = null;
            const n = lTr.values.length;
            const lEnd = new THREE.Vector3(lTr.values[n - 3], lTr.values[n - 2], lTr.values[n - 1]);
            obj.position.add(horiz(toWorld(lEnd.sub(at(dTr, dance.time)))));
            syncPos();
            c.laughing = false;
            dance.paused = false;
            dance.enabled = true;
            dance.setEffectiveWeight(1);
            dance.crossFadeFrom(laugh, 0.4, false);
          });
          sky.clown = c;
          clownTask();
        });
        sky.bats = [];
        const batTask = skyTaskStart("Bats");
        gltfLoader().load("assets/bat.glb", (gltf) => {
          const clip = gltf.animations[0];
          const rnd = (a, b) => a + Math.random() * (b - a);
          for (let i = 0; i < 3; i++) {
            const model = SkeletonUtils.clone(gltf.scene);
            model.traverse((o) => o.isMesh && (o.frustumCulled = false));
            model.scale.setScalar(0.5 / 2.74);
            const obj = new THREE.Group();
            obj.rotation.order = "YXZ";
            obj.add(model);
            obj.visible = false;
            scene.add(obj);
            const mixer = new THREE.AnimationMixer(model);
            const act = mixer.clipAction(clip);
            act.play();
            act.time = rnd(0, clip.duration);
            act.timeScale = rnd(0.9, 1.15);
            const ang = (i / 3) * Math.PI * 2 + rnd(-0.4, 0.4), dist = rnd(3, 7);
            sky.bats.push({
              obj, mixer,
              c: new THREE.Vector2(Math.cos(ang) * dist, Math.sin(ang) * dist),
              a: rnd(3, 5),
              rot: rnd(0, Math.PI),
              h: rnd(0.5, 3.0),
              v: rnd(5, 7),
              t: rnd(0, Math.PI * 2),
              bob: rnd(0, Math.PI * 2),
            });
          }
          batTask();
        });

        sky.gulls = [];
        const gullTask = skyTaskStart("Gulls");
        gltfLoader().load("assets/seagull.glb", (gltf) => {
          const clip = gltf.animations[0];
          const rnd = (a, b) => a + Math.random() * (b - a);
          gltf.scene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
          for (let i = 0; i < 5; i++) {
            const model = SkeletonUtils.clone(gltf.scene);
            model.traverse((o) => o.isMesh && (o.frustumCulled = false));
            model.position.sub(center);
            const inner = new THREE.Group();
            inner.add(model);
            inner.rotation.y = Math.PI;
            inner.scale.setScalar(rnd(1.3, 1.5) / size.z);
            const obj = new THREE.Group();
            obj.rotation.order = "YXZ";
            obj.add(inner);
            obj.visible = false;
            scene.add(obj);
            const proxy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
            proxy.userData.kind = "gull";
            obj.add(proxy);
            const mixer = new THREE.AnimationMixer(model);
            const act = mixer.clipAction(clip);
            act.play();
            act.time = rnd(0, clip.duration);
            const ang = (i / 5) * Math.PI * 2 + rnd(-0.4, 0.4), dist = rnd(8, 22);
            sky.gulls.push({
              obj, mixer, proxy,
              c: new THREE.Vector2(Math.cos(ang) * dist, Math.sin(ang) * dist),
              a: rnd(9, 16),
              rot: rnd(0, Math.PI),
              h: rnd(4, 12),
              v: rnd(9, 11),
              t: rnd(0, Math.PI * 2),
              bob: rnd(0, Math.PI * 2),
            });
          }
          gullTask();
        });

        // Hummingbirds: five birds darting around the viewer by day on land — hover, dash, hover.
        sky.hummers = [];
        const hummerTask = skyTaskStart("Hummingbirds");
        gltfLoader().load("assets/hummingbird.glb", (gltf) => {
          const hover = gltf.animations.find((a) => a.name.startsWith("01_Hover")) || gltf.animations[0];
          const fly = gltf.animations.find((a) => a.name.startsWith("02_Forward")) || hover;
          const rnd = (a, b) => a + Math.random() * (b - a);
          gltf.scene.updateMatrixWorld(true);
          const box = new THREE.Box3();
          gltf.scene.traverse((o) => o.isMesh && box.expandByObject(o));
          const center = box.getCenter(new THREE.Vector3());
          for (let i = 0; i < 5; i++) {
            const model = SkeletonUtils.clone(gltf.scene);
            model.traverse((o) => o.isMesh && (o.frustumCulled = false));
            model.position.sub(center);
            const inner = new THREE.Group();
            inner.add(model);
            inner.scale.setScalar(0.075 * rnd(0.9, 1.1)); // bill to tail about 12 cm
            const obj = new THREE.Group();
            obj.rotation.order = "YXZ";
            obj.add(inner);
            obj.visible = false;
            scene.add(obj);
            const mixer = new THREE.AnimationMixer(model);
            const aHover = mixer.clipAction(hover), aFly = mixer.clipAction(fly);
            aHover.play();
            aFly.play();
            aFly.setEffectiveWeight(0);
            aHover.time = rnd(0, hover.duration);
            const az = rnd(0, Math.PI * 2), r = rnd(2, 6);
            const pos = new THREE.Vector3(Math.sin(az) * r, -2 + rnd(0.8, 2.2), -Math.cos(az) * r);
            sky.hummers.push({ obj, mixer, aHover, aFly, pos, from: pos.clone(), to: pos.clone(), mode: "hover", until: performance.now() + rnd(300, 2000), t: 0, dur: 1, yaw: rnd(0, Math.PI * 2), jit: rnd(0, 100) });
          }
          hummerTask();
        });

        // Cattails: a thicket along the lake shore — from the left end round to the far side, towards the mountains.
        // One InstancedMesh per part of the model; every clump sways in its own phase.
        const cattailTask = skyTaskStart("Cattails");
        gltfLoader().load("assets/cattail.glb", (gltf) => {
          const N = 90;
          const CAT_H = 2.4; // metres, before the per-clump scale
          gltf.scene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const h = Math.max(box.max.y - box.min.y, 1e-3);
          const norm = new THREE.Matrix4().makeScale(CAT_H / h, CAT_H / h, CAT_H / h).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
          const obj = new THREE.Group();
          const parts = [];
          gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            // the GLB is quantized (normalized int16 positions): convert to float first, otherwise the
            // transformed coordinates are clamped to [-1, 1] and the tops of the stems get cut off
            const geo = o.geometry.clone();
            for (const name of ["position", "normal"]) {
              const a = geo.getAttribute(name);
              if (!a || a.array instanceof Float32Array) continue;
              const f = new Float32Array(a.count * 3);
              for (let j = 0; j < a.count; j++) (f[j * 3] = a.getX(j)), (f[j * 3 + 1] = a.getY(j)), (f[j * 3 + 2] = a.getZ(j));
              geo.setAttribute(name, new THREE.BufferAttribute(f, 3));
            }
            geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
            const src = o.material;
            const mat = new THREE.MeshStandardNodeMaterial({ map: src.map, color: src.color, roughness: src.roughness ?? 1, metalness: src.metalness ?? 0, normalMap: src.normalMap, alphaTest: src.alphaTest, transparent: src.transparent, side: THREE.DoubleSide });
            const bend = pow(clamp(positionLocal.y.div(CAT_H), 0, 1), 2.0);
            const ph = hash(instanceIndex).mul(6.283);
            mat.positionNode = positionLocal.add(vec3(sin(time.mul(1.1).add(ph)).mul(0.06), 0, cos(time.mul(0.8).add(ph.mul(1.7))).mul(0.045)).mul(bend));
            const im = new THREE.InstancedMesh(geo, mat, N);
            im.frustumCulled = false;
            obj.add(im);
            parts.push(im);
          });
          obj.visible = false;
          scene.add(obj);
          // placement in lake coordinates: phi along the shore (deg), radial factor, scale, turn
          const rnd = (a, b) => a + Math.random() * (b - a);
          const spots = [];
          for (let i = 0; i < N; i++) {
            const k = Math.pow(i / (N - 1), 1.4); // denser at the left end
            spots.push({ phi: 112 + k * 145 + rnd(-3, 3), r: rnd(0.86, 1.14), s: rnd(0.8, 1.35), turn: rnd(0, Math.PI * 2) });
          }
          sky.cattail = { obj, parts, spots, n: N };
          placeCattail();
          if (sky.open) applyGroundMode(); // loaded after the place was opened
          cattailTask();
        });

        // Heron: stands in the shallows by the cattails.
        const heronTask = skyTaskStart("Heron");
        gltfLoader().load("assets/heron.glb", (gltf) => {
          // Skinned + quantized GLB: positions are normalized and the real size lives in the bind matrices,
          // so the box has to be taken from the posed skin (precise mode, after the bones are updated).
          gltf.scene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(gltf.scene, true);
          const k = 1.3 / Math.max(box.max.y - box.min.y, 1e-3); // about 1.3 m tall
          const model = gltf.scene;
          model.scale.setScalar(k);
          model.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
          model.traverse((o) => o.isMesh && (o.frustumCulled = false));
          const obj = new THREE.Group();
          obj.add(model);
          obj.visible = false;
          scene.add(obj);
          const mixer = new THREE.AnimationMixer(model);
          if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
          const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
          proxy.position.y = 0.7;
          proxy.userData.kind = "heron";
          obj.add(proxy);
          // neck chain for the head-up call; share of the full angle per bone
          const neck = [["top_of_spine_04", 0.15], ["middle_of_neck__05", 0.3], ["top_of_neck_06", 0.35], ["beak_07", 0.2]]
            .map(([n, w]) => ({ bone: model.getObjectByName(n), w, pose: new THREE.Quaternion(), out: null }))
            .filter((b) => b.bone);
          sky.heron = { obj, model, mixer, proxy, neck, raise: 0, callUntil: 0, callAt: 0 };
          placeCattail();
          if (sky.open) applyGroundMode();
          heronTask();
        });

        sky.ducks = [];
        const duckTask = skyTaskStart("Ducks");
        gltfLoader().load("assets/duck.glb", (gltf) => {
          const clip = gltf.animations.find((a) => a.name === "Armature") || gltf.animations[0];
          const rnd = (a, b) => a + Math.random() * (b - a);
          gltf.scene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
          const a0 = rnd(0, Math.PI * 2);
          for (let i = 0; i < 2; i++) {
            const model = SkeletonUtils.clone(gltf.scene);
            model.traverse((o) => {
              if (o.isMesh) {
                o.frustumCulled = false;
                o.material.transparent = false;
                o.material.depthWrite = true;
              }
            });
            model.position.set(-center.x, -box.min.y, -center.z);
            const inner = new THREE.Group();
            inner.add(model);
            inner.scale.setScalar((0.58 * rnd(0.94, 1.06)) / Math.max(size.x, size.z));
            const obj = new THREE.Group();
            obj.add(inner);
            obj.visible = false;
            scene.add(obj);
            const mixer = new THREE.AnimationMixer(model);
            const act = mixer.clipAction(clip);
            act.play();
            act.time = rnd(0, clip.duration);
            act.timeScale = rnd(0.9, 1.1);
            const ang = a0 + i * rnd(0.25, 0.4), dist = rnd(4, 6);
            const pos = new THREE.Vector2(Math.cos(ang) * dist, Math.sin(ang) * dist);
            obj.position.set(pos.x, -2, pos.y);
            obj.rotation.y = rnd(0, Math.PI * 2);
            const jaw = makeJaw(model, { bone: "duck_Mandible_bone", max: 0.45, gain: 10 }, [clip]);
            const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
            proxy.position.y = 0.28;
            proxy.userData.kind = "duck";
            obj.add(proxy);
            const d = { obj, mixer, pos, radius: 0.35, jaw, tap: null, proxy };
            proxy.userData.duck = d;
            sky.ducks.push(d);
          }
          duckTask();
          updateGrassInteractors();
        });

        sky.toads = [];
        const toadTask = skyTaskStart("Toads");
        gltfLoader().load("assets/japanese_toad.glb", (gltf) => {
          const TOAD_COUNT = 14;
          const TOAD_SCALE = 2.0;
          const clip = gltf.animations[0];
          sky.toadClip = clip;
          sky.toadScale = TOAD_SCALE;
          sky.toadRM = computeRootMotion(gltf.scene, clip);
          const rnd = (a, b) => a + Math.random() * (b - a);
          const placed = [];
          for (let n = 0, tries = 0; n < TOAD_COUNT && tries < 2000; tries++) {
            const ang = rnd(0, Math.PI * 2), r = rnd(2.2, 6.0);
            const x = Math.sin(ang) * r, z = -Math.cos(ang) * r;
            if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < 0.9)) continue;
            placed.push({ x, z });
            const model = SkeletonUtils.clone(gltf.scene);
            model.traverse((o) => o.isMesh && (o.frustumCulled = false));
            const obj = new THREE.Group();
            obj.add(model);
            obj.scale.setScalar(TOAD_SCALE);
            obj.position.set(x, -2, z);
            const dx = -x, dz = -z;
            obj.rotation.y = Math.atan2(dz, -dx) + rnd(-1.0, 1.0);
            const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
            proxy.position.y = 0.06;
            proxy.userData.kind = "toad";
            obj.add(proxy);
            scene.add(obj);
            const mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(clip);
            action.play();
            action.time = rnd(0, clip.duration);
            action.timeScale = rnd(0.9, 1.1);
            sky.toads.push({
              obj, mixer, action, proxy,
              radius: 0.22 * TOAD_SCALE,
              pos: new THREE.Vector2(x, z),
              nextHop: performance.now() + rnd(3000, 15000),
              hop: null,
              lastT: action.time % clip.duration,
              crawlYaw: null,
              turnFrom: 0,
            });
            n++;
          }
          updateGrassInteractors();
          toadTask();
        });

        for (const [txt, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
          const s = makeLabel(txt);
          horDir(0, az, s.position).multiplyScalar(SKY_R * 0.7);
          s.renderOrder = 6;
          scene.add(s);
          (sky.labels ||= []).push(s);
        }

        const cel = new THREE.Group();
        cel.matrixAutoUpdate = false;
        scene.add(cel);
        sky.celestial = cel;
        const [stars, lines] = await skyTask(
          "Stars",
          Promise.all([
            fetch("textures/sky/stars.6.json").then((x) => x.json()),
            fetch("textures/sky/constellations.lines.json").then((x) => x.json()),
          ]),
        );
        cel.add(makeStars(stars.features));
        cel.add(makeConstellationLines(lines.features));
        skyTask(
          "Constellations",
          Promise.all([
            fetch("textures/sky/constellations.bounds.json").then((x) => x.json()),
            fetch("textures/sky/constellations.json").then((x) => x.json()),
          ]),
        )
          .then(([b, n]) => {
            const meta = {};
            for (const f of n.features) (meta[f.id] ||= []).push(f.properties);
            const used = {};
            sky.constBounds = b.features.map((f) => {
              const k = (used[f.id] = (used[f.id] || 0) + 1) - 1;
              const pr = (meta[f.id] || [])[k] || (meta[f.id] || [])[0] || {};
              return { id: f.id, name: pr.name || f.id, en: pr.en || "", gen: pr.gen || "", ring: f.geometry.coordinates[0] };
            });
            sky.constLines = new Map(lines.features.map((f) => [f.id, f.geometry.coordinates]));
          })
          .catch((e) => console.warn("constellation boundaries failed to load:", e));

        {
          const dc = makeCanvas(1, 1);
          dc.width = dc.height = 256;
          const g = dc.getContext("2d");
          const img = g.createImageData(256, 256);
          const R0 = 124, base = [255, 250, 238], uK = [0.5, 0.6, 0.75];
          for (let y = 0; y < 256; y++)
            for (let x = 0; x < 256; x++) {
              const dx = x + 0.5 - 128, dy = y + 0.5 - 128;
              const r = Math.hypot(dx, dy) / R0;
              const i = (y * 256 + x) * 4;
              const a = Math.min(Math.max((1 - r) * R0 / 4, 0), 1);
              if (a <= 0) continue;
              const mu = Math.sqrt(Math.max(0, 1 - Math.min(r, 1) ** 2));
              for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(base[c] * (1 - uK[c] * (1 - mu)));
              img.data[i + 3] = Math.round(a * 255);
            }
          g.putImageData(img, 0, 0);
          const dt = new THREE.CanvasTexture(dc);
          dt.colorSpace = THREE.SRGBColorSpace;
          const dmat = new THREE.SpriteMaterial({ map: dt, transparent: true, depthWrite: false, fog: false });
          sky.sun = new THREE.Sprite(dmat);
          sky.sun.renderOrder = 1;
          scene.add(sky.sun);

          const hc = makeCanvas(1, 1);
          hc.width = hc.height = 256;
          const h = hc.getContext("2d");
          const hg = h.createRadialGradient(128, 128, 0, 128, 128, 128);
          hg.addColorStop(0.0, "rgba(255,230,180,0.35)");
          hg.addColorStop(0.25, "rgba(255,220,160,0.12)");
          hg.addColorStop(0.6, "rgba(255,200,140,0.03)");
          hg.addColorStop(1.0, "rgba(255,190,130,0)");
          h.fillStyle = hg;
          h.fillRect(0, 0, 256, 256);
          const ht = new THREE.CanvasTexture(hc);
          ht.colorSpace = THREE.SRGBColorSpace;
          sky.sunHalo = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: ht, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
          );
          sky.sunHalo.renderOrder = 4;
          sky.sunHalo.visible = false;
        }

        const moonR = SKY_R * 0.875 * Math.tan((MOON_VIS_DEG / 2) * D2R);
        const mm = new THREE.MeshBasicNodeMaterial({
          fog: false,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: true,
        });
        const tex = moonTex ? trackNode(moonTexNodes, texture(moonTex)) : vec4(0.8, 0.8, 0.8, 1.0);
        const lit = max(dot(normalWorld, sky.sunDirU), 0.0);
        mm.colorNode = tex.rgb.mul(vec3(1.0, 0.94, 0.78)).mul(lit.mul(0.35).add(0.01));
        mm.opacityNode = sky.cloudDim;
        sky.moon = new THREE.Mesh(new THREE.SphereGeometry(moonR, 48, 32), mm);
        sky.moon.renderOrder = 0;
        scene.add(sky.moon);

        const applySkySize = () => {
          const w = Math.max(1, Math.round(skyIn.clientWidth)), h = Math.max(1, Math.round(skyIn.clientHeight));
          if (w < 2 || h < 2) return;
          sky.viewW = w;
          sky.viewH = h;
          sky.renderer.setSize(w, h, false);
          sky.camera.aspect = w / h;
          sky.camera.updateProjectionMatrix();
        };
        sky.viewW = w;
        sky.viewH = h;
        applySkySize();
        skyIn.addEventListener("resize", applySkySize);

        let drag = null;
        const touches = new Map();
        let pinch = null;
        skyIn.addEventListener("pointerdown", (e) => {
          if (e.pointerType !== "touch") return;
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.size === 2) {
            const [a, b] = [...touches.values()];
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: sky.fov };
            drag = null;
          }
        });
        skyIn.addEventListener("pointermove", (e) => {
          if (!touches.has(e.pointerId)) return;
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch && touches.size === 2) {
            const [a, b] = [...touches.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 10) sky.fov = Math.max(15, Math.min(100, (pinch.fov * pinch.d) / d));
          }
        });
        const endTouch = (e) => {
          touches.delete(e.pointerId);
          if (touches.size < 2) pinch = null;
        };
        skyIn.addEventListener("pointerup", endTouch);
        skyIn.addEventListener("pointercancel", endTouch);
        skyIn.addEventListener("pointerdown", (e) => {
          drag = { x: e.clientX, y: e.clientY, yaw: sky.yaw, pitch: sky.pitch };
          skyIn.setPointerCapture(e.pointerId);
        });
        UI.on("skyMax", (on) => (sky.max = on));
        skyIn.addEventListener("pointermove", (e) => {
          const r = skyIn.getBoundingClientRect();
          sky.torchNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        });
        UI.on("torch", () => {
          sky.torchOn = !sky.torchOn;
          UI.send("torchState", { on: sky.torchOn });
        });
        UI.on("sound", async () => {
          SND.on = !SND.on;
          UI.send("soundState", { on: SND.on });
          if (SND.on) await soundStart();
        });
        const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _m3 = new THREE.Matrix3();
        const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
        const inPoly = (pts, x, y) => {
          let inside = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        };
        const inRing = (ring, ra, dec) => {
          const pts = [[norm180(ring[0][0] - ra), ring[0][1]]];
          for (let i = 1; i < ring.length; i++) pts.push([pts[i - 1][0] + norm180(ring[i][0] - ring[i - 1][0]), ring[i][1]]);
          const sweep = pts[pts.length - 1][0] + norm180(ring[0][0] - ring[ring.length - 1][0]) - pts[0][0];
          if (Math.abs(sweep) > 180) {
            const pole = ring[0][1] > 0 ? 90 : -90;
            pts.push([pts[pts.length - 1][0], pole], [pts[0][0], pole]);
          }
          return inPoly(pts, 0, dec) || inPoly(pts, 360, dec) || inPoly(pts, -360, dec);
        };
        const constAt = (e) => {
          if (!sky.constBounds || sky.starVis.value < 0.25) return null;
          const r = skyIn.getBoundingClientRect();
          _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          _ray.setFromCamera(_ndc, sky.camera);
          const d = _ray.ray.direction;
          if (d.y <= 0.0) return null;
          const v = d.clone().applyMatrix3(_m3.setFromMatrix4(sky.celestial.matrix).transpose()).normalize();
          const ra = Math.atan2(v.y, v.x) / D2R, dec = Math.asin(Math.max(-1, Math.min(1, v.z))) / D2R;
          return sky.constBounds.find((c) => inRing(c.ring, ra, dec)) || null;
        };

        const NEON = new THREE.Color("#ff4fe0");
        const glowLayers = [
          { width: 9, opacity: 0.22 },
          { width: 4.5, opacity: 0.45 },
          { width: 2, opacity: 1.0, core: true },
        ].map(({ width, opacity, core }) => {
          const m = new THREE.Line2NodeMaterial({
            color: core ? new THREE.Color("#ffd6f7") : NEON,
            linewidth: width,
            transparent: true,
            opacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
          });
          const obj = new LineSegments2(new LineSegmentsGeometry(), m);
          obj.frustumCulled = false;
          obj.renderOrder = 2;
          obj.visible = false;
          sky.celestial.add(obj);
          return obj;
        });
        const toV = ([raDeg, decDeg]) => {
          const ra = raDeg * D2R, dec = decDeg * D2R, rr = SKY_R * 0.98;
          return [Math.cos(dec) * Math.cos(ra) * rr, Math.cos(dec) * Math.sin(ra) * rr, Math.sin(dec) * rr];
        };
        let hoverId = null;
        const setHighlight = (id) => {
          if (id === hoverId) return;
          hoverId = id;
          const coords = id && sky.constLines ? sky.constLines.get(id) : null;
          if (!coords) {
            for (const o of glowLayers) o.visible = false;
            return;
          }
          const pts = [];
          for (const line of coords) for (let i = 0; i < line.length - 1; i++) pts.push(...toV(line[i]), ...toV(line[i + 1]));
          for (const o of glowLayers) {
            o.geometry.dispose();
            o.geometry = new LineSegmentsGeometry().setPositions(pts);
            o.visible = true;
          }
        };
        let hovered = null;
        const animalAt = (e) => {
          const r = skyIn.getBoundingClientRect();
          _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          _ray.setFromCamera(_ndc, sky.camera);
          const proxies = [];
          for (const h of sky.herd || []) if (h.obj.visible) h.obj.traverse((o) => o.userData.kind && proxies.push(o));
          for (const t of sky.toads || []) if (t.obj.visible) proxies.push(t.proxy);
          for (const d of sky.ducks || []) if (d.obj.visible) proxies.push(d.proxy);
          for (const g of sky.gulls || []) if (g.obj.visible) proxies.push(g.proxy);
          if (sky.heron?.obj.visible) proxies.push(sky.heron.proxy);
          if (sky.clown?.obj.visible) proxies.push(sky.clown.proxy);
          const hit = _ray.intersectObjects(proxies, false)[0];
          return hit ? { kind: hit.object.userData.kind, obj: hit.object, ref: hit.object.userData.ref || null } : null;
        };
        let cursor = "", tipShown = false;
        const setCursor = (v) => v !== cursor && UI.send("skyCursor", { value: (cursor = v) });
        const hideTip = () => tipShown && ((tipShown = false), UI.send("constTip", { c: null }));
        const updateHover = (e) => {
          const an = drag ? null : animalAt(e);
          if (an) {
            setHighlight(null);
            hideTip();
            setCursor("pointer");
            return;
          }
          hovered = drag ? null : constAt(e);
          setHighlight(hovered ? hovered.id : null);
          setCursor(hovered ? "pointer" : "");
          if (!hovered) return hideTip();
          tipShown = true;
          UI.send("constTip", { c: { name: hovered.name, en: hovered.en }, x: e.clientX, y: e.clientY });
        };
        const clearHover = () => {
          hovered = null;
          setHighlight(null);
          setCursor("");
          hideTip();
        };
        skyIn.addEventListener("pointermove", updateHover);
        skyIn.addEventListener("pointerleave", clearHover);

        let downAt = null;
        skyIn.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
        skyIn.addEventListener("pointerup", (e) => {
          const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
          downAt = null;
          if (moved > 5) return;
          const a = animalAt(e);
          if (a) {
            soundStart().then(() =>
              a.kind === "clown"
                ? clownLaugh()
                : a.kind === "duck"
                  ? duckQuack(a.obj.userData.duck, true)
                  : a.kind === "gull"
                    ? gullCry({ obj: a.obj.parent }, true)
                    : a.kind === "heron"
                      ? heronCall()
                    : a.ref
                      ? animalVoice(a.ref, true)
                      : soundAt("croak", a.obj, 1.6, 0.95 + Math.random() * 0.1, true),
            );
            return;
          }
          if (e.pointerType === "touch") updateHover(e);
          const c = constAt(e);
          if (c) UI.send("constInfo", { c: { name: c.name, en: c.en, gen: c.gen, id: c.id }, x: e.clientX, y: e.clientY });
        });
        skyIn.addEventListener("pointermove", (e) => {
          if (!drag || pinch) return;
          const k = (sky.fov * D2R) / sky.viewH;
          sky.yaw = drag.yaw + (e.clientX - drag.x) * k;
          sky.pitch = Math.max(-1.4, Math.min(1.55, drag.pitch + (e.clientY - drag.y) * k));
        });
        skyIn.addEventListener("pointerup", () => (drag = null));
        skyIn.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            sky.fov = Math.max(15, Math.min(100, sky.fov * Math.exp(e.deltaY * 0.001)));
          },
          { passive: false },
        );
        UI.on("skyClose", () => {
          sky.open = false;
          sky.max = false;
          SND.ctx?.suspend();
          clearHover();
          if (sky.marker) sky.marker.visible = false;
        });
      }

      function makeStars(features) {
        const n = features.length;
        const pos = new Float32Array(n * 12), aSt = new Float32Array(n * 16), aK = new Float32Array(n * 12);
        const idx = new Uint32Array(n * 6);
        const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
        const col = new THREE.Color(), blue = new THREE.Color(0.62, 0.72, 1.0);
        const white = new THREE.Color(1.0, 0.98, 0.95), orange = new THREE.Color(1.0, 0.7, 0.42);
        for (let i = 0; i < n; i++) {
          const [raDeg, decDeg] = features[i].geometry.coordinates;
          const mag = features[i].properties.mag;
          const bv = parseFloat(features[i].properties.bv) || 0.6;
          const ra = raDeg * D2R, dec = decDeg * D2R;
          const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
          const t = Math.min(Math.max((bv + 0.4) / 2.4, 0), 1);
          if (t < 0.3) col.copy(blue).lerp(white, t / 0.3);
          else col.copy(white).lerp(orange, (t - 0.3) / 0.7);
          const bright = Math.min(Math.max(Math.pow(10, -0.4 * (mag - 2.0)), 0.12), 2.5);
          const size = Math.min(Math.max(3.6 - 0.45 * mag, 1.2), 5.2);
          for (let k = 0; k < 4; k++) {
            const v = i * 4 + k;
            pos[v * 3] = x * SKY_R;
            pos[v * 3 + 1] = y * SKY_R;
            pos[v * 3 + 2] = z * SKY_R;
            aSt[v * 4] = col.r;
            aSt[v * 4 + 1] = col.g;
            aSt[v * 4 + 2] = col.b;
            aSt[v * 4 + 3] = bright;
            aK[v * 3] = corners[k * 2];
            aK[v * 3 + 1] = corners[k * 2 + 1];
            aK[v * 3 + 2] = size;
          }
          idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aStar", new THREE.BufferAttribute(aSt, 4));
        geo.setAttribute("aCornerPx", new THREE.BufferAttribute(aK, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_R * 1.1);
        const S = attribute("aStar", "vec4"), K = attribute("aCornerPx", "vec3");
        const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1.0)));
        const mat = new THREE.MeshBasicNodeMaterial({
          transparent: true,
          premultipliedAlpha: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        });
        mat.vertexNode = vec4(clip.xy.add(K.xy.mul(K.z).mul(sky.pxU).mul(clip.w)), clip.zw);
        const upW = normalize(modelWorldMatrix.mul(vec4(positionLocal, 0.0)).xyz).y;
        const horizonFade = smoothstep(-0.01, 0.12, upW).toVarying("vStarHorizon");
        const core = float(1.0).sub(smoothstep(0.0, 1.0, length(K.xy)));
        mat.colorNode = S.rgb;
        mat.opacityNode = core.mul(core).mul(S.w).mul(sky.starVis).mul(sky.cloudDim).mul(horizonFade).mul(0.9);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        return mesh;
      }

      function makeConstellationLines(features) {
        const pts = [];
        const toV = ([raDeg, decDeg]) => {
          const ra = raDeg * D2R, dec = decDeg * D2R, r = SKY_R * 0.99;
          return [Math.cos(dec) * Math.cos(ra) * r, Math.cos(dec) * Math.sin(ra) * r, Math.sin(dec) * r];
        };
        for (const f of features)
          for (const line of f.geometry.coordinates)
            for (let i = 0; i < line.length - 1; i++) pts.push(...toV(line[i]), ...toV(line[i + 1]));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
        const mat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
        mat.colorNode = vec3(0.35, 0.55, 0.9);
        mat.opacityNode = sky.starVis.mul(sky.cloudDim).mul(0.35);
        const ls = new THREE.LineSegments(geo, mat);
        ls.frustumCulled = false;
        ls.renderOrder = 1;
        return ls;
      }

      async function fetchWeather() {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${sky.lat.toFixed(3)}&longitude=${sky.lon.toFixed(3)}` +
          `&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m` +
          `,weather_code,precipitation,rain,showers,snowfall&wind_speed_unit=ms&timezone=auto`;
        try {
          const j = await (await fetch(url)).json();
          sky.cloud = j.current;
          sky.tz = j.timezone || "UTC";
          if (sky.grassField && j.current.wind_speed_10m != null) {
            const ms = j.current.wind_speed_10m;
            const v = horDir(0, (j.current.wind_direction_10m + 180) % 360, new THREE.Vector3());
            sky.grassField.set({ wind: { direction: [v.x, v.z], strength: 0.12 + Math.min(ms / 12, 1) * 0.9 } });
          }
          sky.precip = precipFromWeather(j.current);
          sky.lastWeather = performance.now();
        } catch (e) {
          console.warn("Open-Meteo did not respond:", e);
          sky.cloud = null;
          sky.precip = null;
        }
      }

      const WMO_TEXT = {
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Heavy freezing rain",
        71: "Slight snowfall", 73: "Moderate snowfall", 75: "Heavy snowfall", 77: "Snow grains",
        80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers", 85: "Slight snow showers", 86: "Heavy snow showers",
        95: "Thunderstorm", 96: "Thunderstorm with slight hail", 97: "Heavy thunderstorm", 99: "Thunderstorm with heavy hail",
      };
      function precipFromWeather(c) {
        if (!c) return null;
        const code = c.weather_code ?? 0;
        const mm = c.precipitation ?? 0, snowCm = c.snowfall ?? 0;
        const snowCode = (code >= 71 && code <= 77) || code === 85 || code === 86;
        const rainCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
        const text = WMO_TEXT[code] || null;
        if (snowCode || (!rainCode && snowCm > 0)) return { type: "snow", mm: Math.max(mm, (snowCm * 10) / 7), code, text: text || "Snow" };
        if (rainCode || mm > 0.05) return { type: code >= 51 && code <= 57 ? "drizzle" : "rain", mm, code, text: text || "Rain" };
        return null;
      }

      const _sd = new THREE.Vector3(), _md = new THREE.Vector3(), _sp = new THREE.Vector3();
      const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
      const _skyM = new THREE.Matrix4();
      function skyBodies(date) {
        const obs = new Astronomy.Observer(sky.lat, sky.lon, 0);
        const sEq = Astronomy.Equator(Astronomy.Body.Sun, date, obs, true, true);
        const sH = Astronomy.Horizon(date, obs, sEq.ra, sEq.dec, "normal");
        const mEq = Astronomy.Equator(Astronomy.Body.Moon, date, obs, true, true);
        const mH = Astronomy.Horizon(date, obs, mEq.ra, mEq.dec, "normal");
        return { obs, sH, mH };
      }

      function isWaterAt(lat, lon) {
        if (!sky.waterMask) return false;
        const x = Math.min(1023, Math.max(0, Math.floor(((lon + 180) / 360) * 1024)));
        const y = Math.min(511, Math.max(0, Math.floor(((90 - lat) / 180) * 512)));
        return sky.waterMask[(y * 1024 + x) * 4] > 127;
      }

      const SKYLOAD = { pending: new Set(), total: 0, compiling: false, silent: false, guard: null };
      const placeTitle = (lat, lon) => `Loading ${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;
      function skyLoadFinish() {
        clearInterval(SKYLOAD.guard);
        UI.send("skyLoad", { op: "finish", silent: SKYLOAD.silent });
      }
      function skyLoadBegin(steps, silent) {
        clearInterval(SKYLOAD.guard);
        SKYLOAD.pending = new Set(steps);
        SKYLOAD.total = steps.length;
        SKYLOAD.compiling = false;
        SKYLOAD.silent = !!silent;
        UI.send("skyLoad", { op: "begin", silent: !!silent, show: !silent && steps.length > 0, title: placeTitle(sky.lat, sky.lon) });
        if (steps.length === 0) return skyLoadFinish();
        SKYLOAD.guard = setInterval(() => {
          if (!SKYLOAD.pending.size) return clearInterval(SKYLOAD.guard);
          UI.send("skyLoad", { op: "text", text: `Still loading: ${[...SKYLOAD.pending].join(", ")}` });
        }, 10000);
      }
      function skyLoadDone(label) {
        if (!SKYLOAD.pending.delete(label)) return;
        const pct = Math.round(((SKYLOAD.total - SKYLOAD.pending.size) / SKYLOAD.total) * 100);
        UI.send("skyLoad", { op: "step", pct, text: `${label} · ${pct}%` });
        if (SKYLOAD.pending.size === 1 && SKYLOAD.pending.has("Scene") && !SKYLOAD.compiling) {
          SKYLOAD.compiling = true;
          UI.send("skyLoad", { op: "text", text: `Preparing scene · ${pct}%` });
          (async () => {
            try {
              await sky.renderer.compileAsync(sky.scene, sky.camera);
            } catch (e) {
              console.warn("compileAsync:", e);
            }
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            skyLoadDone("Scene");
          })();
        }
        if (SKYLOAD.pending.size === 0) {
          if (!SKYLOAD.silent) sky.loaded = true;
          skyLoadFinish();
        }
      }
      const skyTask = (label, promise) => Promise.resolve(promise).finally(() => skyLoadDone(label));
      const skyTaskStart = (label) => () => skyLoadDone(label);

      let PLACES = null, placesPromise = null;
      const loadPlaces = () =>
        (placesPromise ||= fetch("textures/sky/places15000.json")
          .then((r) => r.json())
          .then((a) => (PLACES = a))
          .catch((e) => (console.warn("place names failed to load:", e), null)));
      function nearestPlace(lat, lon) {
        if (!PLACES) return null;
        const la = lat * D2R, lo = lon * D2R, cla = Math.cos(la);
        let best = null, bestH = Infinity;
        for (const p of PLACES) {
          const pa = p[2] * D2R, dl = p[3] * D2R - lo;
          const h = Math.sin((pa - la) / 2) ** 2 + cla * Math.cos(pa) * Math.sin(dl / 2) ** 2;
          if (h < bestH) (bestH = h), (best = p);
        }
        const km = 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, bestH)));
        return { name: best[0], cc: best[1], km };
      }

      function buildBackdrop(bd, R) {
        const k = (2 * Math.PI * R) / bd.width; // same scale across and up: no distortion
        // Heights: about half of the SVG everywhere, full height only around the highest summit,
        // and a gap on the opposite side where the far ranges sink below the forest.
        const mt = bd.layers.find((L) => L.id === "mountains") || bd.layers[0];
        let peakX = 0, peakY = Infinity;
        for (let j = 0; j < mt.points.length; j += 2) if (mt.points[j + 1] < peakY) (peakY = mt.points[j + 1]), (peakX = mt.points[j]);
        const gapX = (peakX + bd.width / 2) % bd.width;
        const bump = (x, c, w) => {
          let d = Math.abs(x - c) % bd.width;
          d = Math.min(d, bd.width - d);
          return d < w ? Math.cos(((d / w) * Math.PI) / 2) ** 2 : 0;
        };
        const SCALE = {
          mountains: (x) => 0.45 + 0.55 * bump(x, peakX, 700) - 0.42 * bump(x, gapX, 520),
          foothills: (x) => 0.7 + 0.3 * bump(x, peakX, 700) - 0.55 * bump(x, gapX, 520),
        };
        bd.layers.forEach((L, i) => {
          const scale = SCALE[L.id] || (() => 1);
          const r = R - i * 12; // nearer layers slightly closer: correct overlap without z-fighting
          const n = L.points.length / 2;
          const pos = new Float32Array(n * 6);
          for (let j = 0; j < n; j++) {
            const a = (L.points[j * 2] / bd.width) * Math.PI * 2;
            const y = (bd.horizon - L.points[j * 2 + 1]) * k * scale(L.points[j * 2]);
            const x = Math.sin(a) * r, z = -Math.cos(a) * r;
            pos.set([x, y, z, x, -60, z], j * 6);
          }
          const idx = [];
          for (let j = 0; j < n - 1; j++) {
            const q = j * 2;
            idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setIndex(idx);
          geo.computeBoundingSphere();
          const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
          m.colorNode = uniform(new THREE.Color("#" + L.color)).mul(sky.dayLight);
          const mesh = new THREE.Mesh(geo, m);
          mesh.name = "backdrop-" + L.id;
          sky.backdrop.add(mesh);
        });
        sky.backdropWater = (bd.waterX / bd.width) * Math.PI * 2;
        // the highest summit: azimuth in backdrop coordinates, its height, and the height of the foothills in front of it
        const yAt = (L, x) => {
          const p = L.points;
          for (let j = 0; j < p.length - 2; j += 2) if (p[j] <= x && p[j + 2] >= x) return p[j + 1] + (p[j + 3] - p[j + 1]) * ((x - p[j]) / (p[j + 2] - p[j] || 1));
          return p[1];
        };
        const fh = bd.layers.find((L) => L.id === "foothills");
        sky.peak = {
          a: (peakX / bd.width) * Math.PI * 2,
          // ridge height (m) at a sideways offset dx (m) from the summit line
          ridgeAt: (dx) => {
            const x = (((peakX + dx / k) % bd.width) + bd.width) % bd.width;
            return (bd.horizon - yAt(mt, x)) * k * SCALE.mountains(x);
          },
          top: (bd.horizon - peakY) * k * SCALE.mountains(peakX),
          foot: fh ? (bd.horizon - yAt(fh, peakX)) * k * SCALE.foothills(peakX) : 0,
          r: R - 6, // between the mountains (R) and the foothills (R - 12): the foothills hide the start of the climb
        };
        placeBackdrop();
        if (sky.open) applyGroundMode();
        HOST.climber?.then((cd) => cd && buildClimber(cd));
      }

      // Climber: the jointed SVG figure (parsed on the page) as flat meshes per joint, with its CSS @keyframes
      // replayed here. He climbs straight up the middle of the highest summit, sits there in the lotus pose,
      // rubs himself against the cold, climbs back down (the climb cycle reversed) and starts again.
      const CLIMBER_H = 55; // metres from sole to helmet: deliberately oversized against the mountain
      const _ease = (t) => {
        // CSS ease-in-out = cubic-bezier(.42, 0, .58, 1): solve x(u) = t, return y(u)
        let u = t;
        for (let i = 0; i < 6; i++) {
          const x = 3 * (1 - u) * (1 - u) * u * 0.42 + 3 * (1 - u) * u * u * 0.58 + u * u * u - t;
          const dx = 3 * (1 - u) * (1 - u) * 0.42 + 6 * (1 - u) * u * 0.16 + 3 * u * u * 0.42;
          u = Math.min(1, Math.max(0, u - x / (dx || 1)));
        }
        return 3 * (1 - u) * u * u + u * u * u;
      };
      function sampleKeys(frames, t, prop, ease) {
        if (!frames || !frames.length) return undefined;
        let a = frames[0], b = frames[frames.length - 1];
        if (t <= a.p) return a[prop];
        if (t >= b.p) return b[prop];
        for (let i = 0; i < frames.length - 1; i++)
          if (frames[i].p <= t && frames[i + 1].p >= t) {
            a = frames[i];
            b = frames[i + 1];
            break;
          }
        const u = (t - a.p) / (b.p - a.p || 1);
        return a[prop] + (b[prop] - a[prop]) * (ease ? _ease(u) : u);
      }
      function buildClimber(cd) {
        const P = sky.peak;
        if (!P || sky.climber) return;
        const S = CLIMBER_H / 164; // SVG units: sole y=216, helmet top y=52
        const ANCHOR = [100, 140]; // pelvis: the point driven along the path
        const tone = sky.dayLight.mul(0.8).add(0.2);
        const col = uniform(new THREE.Color(cd.color));
        const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
        mat.colorNode = col.mul(tone);
        const originOf = (j) => (j === "root" ? ANCHOR : cd.joints[j]?.origin || originOf(cd.joints[j]?.parent || "root"));
        const groups = { root: new THREE.Group() };
        const make = (j) => {
          if (groups[j]) return groups[j];
          const J = cd.joints[j];
          const parent = make(J?.parent || "root");
          const g = new THREE.Group();
          const o = originOf(j), po = originOf(J?.parent || "root");
          g.position.set(o[0] - po[0], -(o[1] - po[1]), 0);
          g.userData.base = g.position.clone();
          parent.add(g);
          return (groups[j] = g);
        };
        for (const j of Object.keys(cd.joints)) make(j);
        const fx = {};
        for (const [key, arr] of Object.entries(cd.parts)) {
          const [f, j] = key.includes("@") ? key.split("@") : [null, key];
          if (f) continue; // the "brr" shiver lines and the breath puffs are not drawn: the pale neon glow already shows the cold
          const o = originOf(j);
          const pos = new Float32Array(arr.length);
          for (let i = 0; i < arr.length; i += 3) (pos[i] = arr[i] - o[0]), (pos[i + 1] = -(arr[i + 1] - o[1])), (pos[i + 2] = 0);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          let m = mat;
          if (f) {
            m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false, transparent: true, depthWrite: false });
            const op = uniform(0);
            m.colorNode = col.mul(tone);
            m.opacityNode = op;
            const fg = new THREE.Group();
            (groups[j] || groups.root).add(fg);
            fx[f] = { g: fg, op };
            fg.add(new THREE.Mesh(geo, m));
          } else (groups[j] || groups.root).add(new THREE.Mesh(geo, m));
        }
        // halo behind the figure while he sits on the summit: orange in the lotus pose, pale neon while he rubs himself
        const glowU = { on: uniform(0), mix: uniform(0) };
        const gm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
        // TSL: polar coordinates around the centre of the halo
        const gp = uv().sub(0.5).mul(2.0);
        const gd = length(gp);
        const ga = atan(gp.y, gp.x);
        // orange: soft halo + two sets of slowly turning rays that reach the edge
        const haloO = pow(clamp(float(1.0).sub(gd.mul(1.6)), 0, 1), 1.6);
        const rays = pow(abs(sin(ga.mul(8.0).add(time.mul(0.35)))), 10.0)
          .add(pow(abs(sin(ga.mul(13.0).sub(time.mul(0.22)))), 14.0).mul(0.6))
          .mul(pow(clamp(float(1.0).sub(gd), 0, 1), 1.2))
          .mul(smoothstep(0.08, 0.3, gd));
        const orangeA = haloO.add(rays.mul(0.9)).mul(sin(time.mul(2.0)).mul(0.08).add(0.92));
        // pale neon: the edge trembles (fast radial jitter and a wobbling outline) and the light flickers
        const jit = sin(time.mul(23.0)).mul(0.05).add(sin(time.mul(37.0).add(ga.mul(5.0))).mul(0.035)).add(sin(ga.mul(9.0).add(time.mul(17.0))).mul(0.03));
        const dn = gd.mul(2.3).mul(float(1.0).add(jit));
        const haloN = pow(clamp(float(1.0).sub(dn), 0, 1), 1.3);
        const rimN = smoothstep(0.55, 0.75, float(1.0).sub(dn)).oneMinus().mul(smoothstep(0.0, 0.25, float(1.0).sub(dn))).mul(0.6);
        const flicker = sin(time.mul(41.0)).mul(sin(time.mul(17.0))).mul(0.18).add(0.82);
        const neonA = haloN.add(rimN).mul(flicker);
        // colours stay below 1 so neither the additive blend nor the bloom pass burns them out to white
        gm.colorNode = mix(vec3(1.0, 0.34, 0.0), vec3(0.5, 0.95, 0.85), glowU.mix).mul(0.85);
        gm.opacityNode = mix(orangeA.mul(0.8), neonA.mul(0.55), glowU.mix).mul(glowU.on);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), gm);
        glow.position.set(0, -30, -2); // around the seated figure (pelvis drops 68 units when he sits), just behind it
        glow.renderOrder = 6;
        groups.root.add(glow);
        groups.root.traverse((o) => o.isMesh && (o.frustumCulled = false));
        groups.root.scale.setScalar(S);
        const holder = new THREE.Group();
        holder.position.set(Math.sin(P.a) * P.r, 0, -Math.cos(P.a) * P.r);
        holder.rotation.y = -P.a; // the figure's plane faces the viewer at the centre of the ring
        holder.add(groups.root);
        sky.backdrop.add(holder);
        // y0: start, hidden behind the foothills; ySum: on the tip, seat on it with no gap;
        // y1: hanging below the tip, hands on the two faces: in the hang pose (arms in a V) the hands sit
        // ~48 units left/right of the summit line and ~105 units above the pelvis, so put them a little
        // below the actual ridge line at those offsets
        const ridge = Math.min(P.ridgeAt(-48 * S), P.ridgeAt(48 * S));
        const ySum = P.top + 60 * S, y1 = ridge - 105 * S - 8 * S, y0 = P.foot - 110 * S;
        // the limbs move 1.6x slower than the CSS --climb-dur; one stride = two hand-over-hand pulls ~120 units,
        // so the body travels exactly as far as the hands pull and nothing slips
        const D = cd.climbDur * 1.6;
        sky.climber = { cd, groups, fx, glowU, S, y0, y1, ySum, y: y0, state: "rest", t: 0, until: 0, D, speed: (120 * S) / D };
      }
      function poseClimber(c, anim, t, ease) {
        for (const [j, g] of Object.entries(c.groups)) {
          if (j === "root") continue;
          const k = c.cd.keyframes[anim + "-" + j];
          const J = c.cd.joints[j];
          const rot = k ? sampleKeys(k.filter((f) => f.rot !== undefined), t, "rot", ease) : undefined;
          const ty = k ? sampleKeys(k.filter((f) => f.ty !== undefined), t, "ty", ease) : undefined;
          g.rotation.z = -THREE.MathUtils.degToRad(rot ?? J.rot ?? 0);
          g.position.y = g.userData.base.y - (ty ?? J.ty ?? 0);
        }
        for (const [name, e] of Object.entries(c.fx)) {
          const k = anim === "summit" ? c.cd.keyframes["summit-" + name] : null;
          e.op.value = k ? sampleKeys(k.filter((f) => f.op !== undefined), t, "op", false) ?? 0 : 0;
          const tx = k ? sampleKeys(k.filter((f) => f.tx !== undefined), t, "tx", false) : 0;
          const ty = k ? sampleKeys(k.filter((f) => f.ty !== undefined), t, "ty", false) : 0;
          e.g.position.set(tx || 0, -(ty || 0), 0);
        }
      }
      // hanging below the tip: arms in a V gripping the two faces of the summit, legs straight down, head tilted up
      const HANG = { "ua-l": 150, "fa-l": 10, "ua-r": -150, "fa-r": -10, "th-l": 4, "sh-l": 0, "th-r": -4, "sh-r": 0, torso: 0, head: -8 };
      function hangPose(c) {
        poseClimber(c, "climb", 0, true);
        for (const [j, deg] of Object.entries(HANG)) if (c.groups[j]) c.groups[j].rotation.z = -THREE.MathUtils.degToRad(deg);
      }
      let climberLast = performance.now();
      function updateClimber() {
        const c = sky.climber;
        const now = performance.now();
        const dt = Math.min((now - climberLast) / 1000, 0.1);
        climberLast = now;
        if (!c || !sky.backdrop.visible) return;
        const D = c.D;
        c.t += dt;
        // pulls: speed peaks in the middle of each half-stride and drops to zero when the hands change over
        const pull = (cyc) => c.speed * (1 - Math.cos(4 * Math.PI * cyc)) * dt;
        if (c.state === "rest") {
          poseClimber(c, "climb", 0, true);
          if (now > c.until) (c.state = "climb"), (c.t = 0);
        } else if (c.state === "climb") {
          const cyc = (c.t % D) / D;
          if (c.y < c.y1) c.y = Math.min(c.y1, c.y + pull(cyc));
          // at the end of a stride (shared start pose): hands on the tip -> hang for a moment, then hop up onto it
          if (c.y >= c.y1 && c.t % D < dt) (c.state = "hangUp"), (c.t = 0), hangPose(c);
          else poseClimber(c, "climb", cyc, true);
        } else if (c.state === "hangUp" || c.state === "hang") {
          hangPose(c);
          if (c.t >= (c.state === "hangUp" ? 0.4 : 0.6)) (c.state = c.state === "hangUp" ? "hopUp" : "descend"), (c.t = 0);
        } else if (c.state === "hopUp" || c.state === "hopDown") {
          const HOP = 0.35;
          const u = Math.min(1, c.t / HOP), s = u * u * (3 - 2 * u);
          const up = c.state === "hopUp";
          c.y = up ? c.y1 + (c.ySum - c.y1) * s : c.ySum - (c.ySum - c.y1) * s;
          if (up && u < 0.5) hangPose(c);
          else if (up) poseClimber(c, "summit", 0, true);
          else hangPose(c); // drops off the tip straight into the hang
          if (!up) c.glowU.on.value = Math.max(0, c.glowU.on.value - dt / HOP); // the halo goes out as he starts down
          if (u >= 1) (c.state = up ? "summit" : "hang"), (c.t = 0);
        } else if (c.state === "summit") {
          const t = Math.min(1, c.t / c.cd.summitDur);
          poseClimber(c, "summit", t, true);
          // halo: in once he is seated in the lotus (28%), orange -> pale neon as the rubbing starts (~38-42%)
          const ss = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
          c.glowU.on.value = ss(0.22, 0.3, t);
          c.glowU.mix.value = ss(0.36, 0.42, t);
          if (t >= 1) (c.state = "hopDown"), (c.t = 0);
        } else if (c.state === "descend") {
          c.glowU.on.value = 0;
          poseClimber(c, "climb", 1 - (c.t % D) / D, true); // animation-direction: reverse
          c.y = Math.max(c.y0, c.y - pull((c.t % D) / D));
          if (c.y <= c.y0 && c.t % D < dt) (c.state = "rest"), (c.until = now + 4000 + Math.random() * 6000);
        }
        c.groups.root.position.y = c.y;
      }

      // Random turn of the backdrop; the lake follows the water cut-out.
      function placeBackdrop() {
        const yaw = Math.random() * Math.PI * 2;
        sky.backdrop.rotation.y = yaw;
        const a = sky.backdropWater;
        const lx = Math.sin(a), lz = -Math.cos(a);
        const dx = lx * Math.cos(yaw) + lz * Math.sin(yaw), dz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
        sky.lakeC.value.set(dx * sky.lake.dist, dz * sky.lake.dist);
        sky.lakeT.value.set(-dz, dx);
        updateLakeGrass();
        placeCattail();
      }

      // Lake coordinates: lakeT points right (as seen from the viewer), (-t.y, t.x) points back to the viewer.
      // phi 90° = shore nearest to the viewer, 180° = left end, 270° = far shore under the mountains.
      const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _cs = new THREE.Vector3(), _cy = new THREE.Vector3(0, 1, 0);
      function placeCattail() {
        if (!sky.cattail || !sky.lakeC) return;
        const c = sky.lakeC.value, t = sky.lakeT.value;
        sky.cattail.spots.forEach((s, i) => {
          const phi = THREE.MathUtils.degToRad(s.phi);
          const u = sky.lake.a * s.r * Math.cos(phi), v = sky.lake.b * s.r * Math.sin(phi);
          _cp.set(c.x + t.x * u - t.y * v, -2, c.y + t.y * u + t.x * v);
          _cq.setFromAxisAngle(_cy, s.turn);
          _cs.setScalar(s.s);
          _cm.compose(_cp, _cq, _cs);
          for (const im of sky.cattail.parts) im.setMatrixAt(i, _cm);
        });
        for (const im of sky.cattail.parts) im.instanceMatrix.needsUpdate = true;
        if (sky.heron) {
          // in the shallows of the near-left shore, in front of the thicket, turned along the shore
          const phi = THREE.MathUtils.degToRad(108);
          const u = sky.lake.a * 0.8 * Math.cos(phi), v = sky.lake.b * 0.8 * Math.sin(phi);
          const x = c.x + t.x * u - t.y * v, z = c.y + t.y * u + t.x * v;
          sky.heron.obj.position.set(x, -2.05, z);
          sky.heron.obj.rotation.y = Math.atan2(x, z) + Math.PI * (0.35 + Math.random() * 0.3);
        }
      }

      // No grass in the lake: zero coverage in a grass map around it.
      function updateLakeGrass() {
        if (!sky.grassField) return;
        const { a, b } = sky.lake, c = sky.lakeC.value, t = sky.lakeT.value;
        sky.lakeGrassMap?.dispose();
        const map = new GrassMap({ center: [c.x, c.y], size: a * 2 + 20, resolution: 256 });
        map.fill(1, 1);
        const res = map.resolution, d = map.data;
        for (let j = 0; j < res; j++)
          for (let i = 0; i < res; i++) {
            const px = map.minX + ((i + 0.5) / res) * map.size - c.x, pz = map.minZ + ((j + 0.5) / res) * map.size - c.y;
            const u = (px * t.x + pz * t.y) / a, v = (-px * t.y + pz * t.x) / b;
            if (u * u + v * v < 1.3) d[(j * res + i) * 4] = 0;
          }
        map.texture.needsUpdate = true;
        sky.lakeGrassMap = map;
      }

      function applyGroundMode() {
        const land = !sky.isWater;
        const lake = land && sky.backdrop.children.length > 0;
        sky.ground.visible = land;
        sky.backdrop.visible = land;
        sky.lakeOn.value = lake ? 1 : 0;
        sky.water.visible = sky.isWater || lake;
        if (sky.cattail) sky.cattail.obj.visible = lake;
        if (sky.heron) sky.heron.obj.visible = lake;
        if (lake) {
          sky.water.scale.setScalar((sky.lake.a * 2.6) / (SKY_R * 2.4));
          sky.water.position.set(sky.lakeC.value.x, -2.04, sky.lakeC.value.y);
        } else {
          sky.water.scale.setScalar(1);
          sky.water.position.set(0, -2, 0);
        }
        sky.grassField?.set({ grassMap: lake ? sky.lakeGrassMap ?? null : null });
      }

      async function openSky(lat, lon) {
        sky.lat = lat;
        sky.lon = lon;
        UI.send("skyOpen");
        if (sky.loaded) {
          skyLoadBegin([], true);
        } else if (!sky.ready) {
          const steps = ["Grass", "Stars", "Constellations", "Places", "Fish", "Rhinos", "Elephants", "Running rhino", "Lionesses", "Alligators", "Toads", "Bats", "Gulls", "Hummingbirds", "Cattails", "Heron", "Ducks", "Clown", "Weather", "Scene"];
          if (SND.on && !SND.ctx) steps.push("Sounds");
          skyLoadBegin(steps, false);
        } else {
          UI.send("skyLoad", { op: "title", title: placeTitle(lat, lon) });
        }
        if (SND.on) soundStart();
        sky.place = null;
        skyTask("Places", loadPlaces().then(() => (sky.place = nearestPlace(lat, lon))));
        if (!sky.ready) sky.ready = initSky();
        await sky.ready;
        sky.open = true;
        sky.isWater = isWaterAt(lat, lon);
        if (sky.backdrop.children.length) placeBackdrop();
        applyGroundMode();
        const { sH, mH } = skyBodies(new Date(simTime));
        const target = mH.altitude > 0 ? mH : sH.altitude > 0 ? sH : { azimuth: 180, altitude: 20 };
        lookAtBody(target);
        sky.pitch = 0;
        sky.cloud = null;
        skyTask("Weather", fetchWeather());
      }

      const SOUND_FILES = {
        night: "assets/sounds/night_meadow.mp3",
        day: "assets/sounds/day_countryside.mp3",
        wind: "assets/sounds/wind_grass.mp3",
        sea: "assets/sounds/sea_waves.mp3",
        splashOut: "assets/sounds/splash_out.mp3",
        splashIn: "assets/sounds/splash_in.mp3",
        croak1: "assets/sounds/croak_1.mp3",
        croak2: "assets/sounds/croak_2.mp3",
        croak3: "assets/sounds/croak_3.mp3",
        croak4: "assets/sounds/croak_4.mp3",
        croak5: "assets/sounds/croak_5.mp3",
        croak6: "assets/sounds/croak_6.mp3",
        croak7: "assets/sounds/croak_7.mp3",
        croak8: "assets/sounds/croak_8.mp3",
        rhino: "assets/sounds/rhino.mp3", // «Indian rhinoceros», Breviceps (Freesound), Pixabay Content License
        elephant1: "assets/sounds/elephant_1.mp3",
        elephant2: "assets/sounds/elephant_2.mp3",
        elephant3: "assets/sounds/elephant_3.mp3",
        elephant4: "assets/sounds/elephant_4.mp3",
        clownLaugh: "assets/sounds/clown_laugh.mp3",
        lion1: "assets/sounds/lion_1.mp3",
        lion2: "assets/sounds/lion_2.mp3",
        alligator1: "assets/sounds/alligator_1.mp3",
        duck1: "assets/sounds/duck_1.mp3",
        duck2: "assets/sounds/duck_2.mp3",
        duck3: "assets/sounds/duck_3.mp3",
        duck4: "assets/sounds/duck_4.mp3",
        gull1: "assets/sounds/gull_1.mp3",
        gull2: "assets/sounds/gull_2.mp3",
        gull3: "assets/sounds/gull_3.mp3",
        heron1: "assets/sounds/heron_1.mp3",
        heron2: "assets/sounds/heron_2.mp3",
      };
      const SOUND_VARIANTS = { croak: 8, elephant: 4, lion: 2, alligator: 1, duck: 4, gull: 3, heron: 2 };
      const SND = { ctx: null, on: true, nextFrog: 0, nextRhino: 0, voices: new Map(), nextId: 1, lastLand: undefined, fastUntil: 0 };
      HOST.onAudioEvent = (m) => {
        if (m.type === "ended") SND.voices.delete(m.id);
        else if (m.type === "levels") for (const [id, lv] of Object.entries(m.levels)) { const v = SND.voices.get(+id); if (v) v.level = lv; }
      };
      async function soundStart() {
        if (!SND.ctx) {
          SND.ctx = { resume: () => HOST.audio.resume(), suspend: () => HOST.audio.suspend() };
          await skyTask("Sounds", HOST.audio.start(SOUND_FILES));
        } else HOST.audio.resume();
      }
      const _vp = new THREE.Vector3(), _vf = new THREE.Vector3();
      function soundAt(name, where, gain = 1, rate = 1, force = false, tap = false) {
        if (SOUND_VARIANTS[name]) name = name + (1 + ((Math.random() * SOUND_VARIANTS[name]) | 0));
        if ((!SND.on && !force) || !SND.ctx || !sky.open) return;
        const id = SND.nextId++;
        const obj = where.isObject3D ? where : null;
        const p = obj ? obj.getWorldPosition(_vp) : where;
        const voice = { obj, level: 0 };
        if (obj || tap) SND.voices.set(id, voice);
        HOST.audio.play({ id, name, gain, rate, toMaster: SND.on, pos: [p.x, p.y, p.z], tap });
        if (!tap) return;
        return {
          getFloatTimeDomainData: (buf) => buf.fill(voice.level),
          level: () => (SND.voices.has(id) ? voice.level : 0),
          alive: () => SND.voices.has(id),
        };
      }

      const _jA = new THREE.Vector3(), _jQ = new THREE.Quaternion(), _jQ2 = new THREE.Quaternion();
      function makeJaw(model, cfg, clips) {
        const bone = model.getObjectByName(cfg.bone);
        if (!bone) {
          console.warn("jaw bone not found", cfg.bone);
          return null;
        }
        return { bone, model, pose: bone.quaternion.clone(), out: null, max: cfg.max, gain: cfg.gain, open: 0 };
      }
      function applyJaw(j, tap, dt) {
        if (!j) return;
        const target = tap ? Math.min(1, tap.level() * j.gain) : 0;
        j.open += (target - j.open) * (1 - Math.exp(-dt * (target > j.open ? 25 : 10)));
        if (j.out && j.bone.quaternion.equals(j.out)) j.bone.quaternion.copy(j.pose);
        j.pose.copy(j.bone.quaternion);
        j.out = null;
        if (j.open < 0.002) return;
        j.bone.updateWorldMatrix(true, false);
        const axisW = _jA.set(1, 0, 0).applyQuaternion(j.model.getWorldQuaternion(_jQ));
        j.bone.getWorldQuaternion(_jQ);
        const axisL = axisW.applyQuaternion(_jQ.invert()).normalize();
        j.bone.quaternion.multiply(_jQ2.setFromAxisAngle(axisL, j.max * j.open));
        j.out = j.bone.quaternion.clone();
      }

      function animalVoice(h, force = false) {
        const now = performance.now();
        if (h.sp.key === "elephant" && h.trumpet && now >= h.stopUntil) {
          h.trumpeting = true;
          h.action.fadeOut(0.3);
          h.trumpet.reset().setEffectiveWeight(1).fadeIn(0.3).play();
          h.stopUntil = now + h.trumpet.getClip().duration * 1000;
        }
        if (!h.sp.sound) return;
        if (h.sp.threat && h.idle) {
          if (now < h.stopUntil + 1500) return;
          const t = h.sp.threat;
          h.idle.reset().setEffectiveWeight(1).fadeIn(0.25).play();
          h.idle.time = t.from;
          h.action.fadeOut(0.25);
          h.voicePause = true;
          h.stopUntil = now + (t.to - t.from) * 1000;
          h.hissAt = now + (t.hissAt - t.from) * 1000;
          h.hissForce = force;
          return;
        }
        if (h.jaw) {
          if (h.voiceTap?.alive()) return;
          h.voiceTap = soundAt(h.sp.sound, h.obj, 1.5, 0.95 + Math.random() * 0.1, force, true) || null;
          if (h.voiceTap) h.stopUntil = Math.max(h.stopUntil, now + 400);
          return;
        }
        soundAt(h.sp.sound, h.obj, h.sp.key === "elephant" ? 1.6 : 1.4, 0.95 + Math.random() * 0.1, force);
      }
      function duckQuack(d, force = false) {
        if (d.tap?.alive()) return;
        d.tap = soundAt("duck", d.obj, 1.2, 0.95 + Math.random() * 0.1, force, true) || null;
      }
      function gullCry(g, force = false) {
        soundAt("gull", g.obj, 1.3, 0.92 + Math.random() * 0.16, force);
      }
      function soundUpdate(day, night) {
        if (!SND.ctx) return;
        const land = !sky.isWater;
        const ws = sky.cloud?.wind_speed_10m ?? 3;
        const target = {
          day: land ? 0.5 * day : 0,
          night: land ? 0.6 * night : 0,
          sea: land ? 0 : 0.7,
          wind: (0.1 + Math.min(ws / 15, 1) * 0.45) * (land ? 1 : 0.7),
        };
        const nowMs = performance.now();
        if (SND.lastLand !== land) {
          SND.lastLand = land;
          SND.fastUntil = nowMs + 1000;
        }
        const tau = nowMs < (SND.fastUntil || 0) ? 0.12 : 1.5;
        const cam = sky.camera;
        cam.getWorldPosition(_vp);
        cam.getWorldDirection(_vf);
        const voices = [];
        for (const [id, v] of SND.voices) if (v.obj) { const q = v.obj.getWorldPosition(new THREE.Vector3()); voices.push([id, q.x, q.y, q.z]); }
        HOST.audio.frame({
          listener: [_vp.x, _vp.y, _vp.z, _vf.x, _vf.y, _vf.z, cam.up.x, cam.up.y, cam.up.z],
          voices,
          master: SND.on && sky.open ? 0.9 : 0,
          beds: target,
          tau,
        });
        const now = performance.now();
        if (SND.on && land && night > 0.3 && sky.toads?.length && now > SND.nextFrog) {
          SND.nextFrog = now + 5000 + Math.random() * 10000;
          const t = sky.toads[(Math.random() * sky.toads.length) | 0];
          soundAt("croak", t.obj, 0.9, 0.9 + Math.random() * 0.2);
        }
        if (SND.on && land && sky.herd?.length && now > SND.nextRhino) {
          SND.nextRhino = now + 15000 + Math.random() * 25000;
          const voiced = sky.herd.filter((x) => x.sp.sound && !x.sp.hoverVoice);
          const h = voiced[(Math.random() * voiced.length) | 0];
          if (h) animalVoice(h);
        }
        if (SND.on && land && day > 0.2 && sky.ducks?.length && now > (SND.nextDuck || 0)) {
          SND.nextDuck = now + 8000 + Math.random() * 14000;
          duckQuack(sky.ducks[(Math.random() * sky.ducks.length) | 0]);
        }
        if (SND.on && !land && sky.gulls?.[0]?.obj.visible && now > (SND.nextGull || 0)) {
          SND.nextGull = now + 4000 + Math.random() * 9000;
          gullCry(sky.gulls[(Math.random() * sky.gulls.length) | 0]);
        }
      }

      const FISH_FLIP = 0;
      function updateFish() {
        const F = sky.fish;
        if (!F) return;
        const now = performance.now();
        const fdt = Math.min((now - F.last) / 1000, 0.1);
        F.last = now;
        if (!sky.isWater || CREATURES.fishEvery <= 0) {
          F.obj.visible = false;
          F.t0 = -1;
          F.next = now + 2000;
          return;
        }
        if (F.t0 < 0 && now > F.next) {
          F.t0 = now;
          F.dur = 1100 + Math.random() * 500;
          const az = -sky.yaw + (Math.random() - 0.5) * 0.7;
          const d = 4 + Math.random() * 5;
          F.cx = Math.sin(az) * d;
          F.cz = -Math.cos(az) * d;
          F.dir = Math.random() * Math.PI * 2;
          F.h = 1.2 + Math.random() * 0.9;
          F.len = 2.4 + Math.random() * 1.6;
          soundAt("splashOut", new THREE.Vector3(F.cx - Math.cos(F.dir) * F.len * 0.5, -2.25, F.cz - Math.sin(F.dir) * F.len * 0.5), 1.0);
        }
        if (F.t0 < 0) return;
        const k = (now - F.t0) / F.dur;
        if (k >= 1) {
          soundAt("splashIn", new THREE.Vector3(F.cx + Math.cos(F.dir) * F.len * 0.5, -2.25, F.cz + Math.sin(F.dir) * F.len * 0.5), 1.1);
          F.t0 = -1;
          F.obj.visible = false;
          const mean = CREATURES.fishEvery * 1000;
          F.next = now + mean * (0.5 + Math.random());
          return;
        }
        const sArc = k * 2 - 1; // −1..1
        const half = F.len / 2;
        F.obj.position.set(F.cx + Math.cos(F.dir) * sArc * half, -2.25 + F.h * (1 - sArc * sArc), F.cz + Math.sin(F.dir) * sArc * half);
        F.obj.rotation.set(0, -F.dir, Math.atan2(-2 * F.h * sArc, half), "YZX");
        F.mixer.update(fdt);
        F.obj.visible = true;
      }

      function updateGrassInteractors() {
        if (!sky.grassField) return;
        const list = [
          ...(sky.herd || []).map((h) => ({ object: h.obj, radius: h.sp.radius * 0.8 })),
          ...(sky.toads || []).map((t) => ({ object: t.obj, radius: 0.35 })),
          ...(sky.ducks || []).map((d) => ({ object: d.obj, radius: 0.3 })),
          ...(sky.clown ? [{ object: sky.clown.proxy, radius: 0.7 }] : []),
        ]
          .sort((a, b) => a.object.position.lengthSq() - b.object.position.lengthSq())
          .slice(0, 16);
        sky.grassField.set({ interactors: list, interactionStrength: 1.6 });
      }
      function computeRootMotion(src, clip) {
        const sc = SkeletonUtils.clone(src);
        const mx = new THREE.AnimationMixer(sc);
        const ac = mx.clipAction(clip);
        ac.play();
        const names = ["foot_L", "leg3_R001", "hand_L", "hand_R"];
        const bones = names.map((n) => sc.getObjectByName(n));
        if (bones.some((x) => !x)) {
          console.warn("toad leg bones not found — crawling without moving");
          return null;
        }
        const FPS = 30, N = Math.floor(clip.duration * FPS);
        const pts = [];
        for (let k = 0; k <= N; k++) {
          ac.time = k / FPS;
          mx.update(0);
          sc.updateMatrixWorld(true);
          pts.push(bones.map((x) => x.getWorldPosition(new THREE.Vector3())));
        }
        const minY = names.map((_, i) => Math.min(...pts.map((q) => q[i].y)));
        const xs = new Float32Array(N + 1), zs = new Float32Array(N + 1);
        for (let k = 0; k < N; k++) {
          let sx = 0, sz = 0, n = 0;
          for (let i = 0; i < names.length; i++) {
            const p0 = pts[k][i], p1 = pts[k + 1][i];
            if (p0.y < minY[i] + 0.006 && p1.y < minY[i] + 0.006) {
              sx -= p1.x - p0.x;
              sz -= p1.z - p0.z;
              n++;
            }
          }
          xs[k + 1] = xs[k] + (n ? sx / n : 0);
          zs[k + 1] = zs[k] + (n ? sz / n : 0);
        }
        const total = Math.hypot(xs[N], zs[N]);
        return { fps: FPS, n: N, xs, zs, total };
      }
      const rmAt = (rm, t) => {
        const f = Math.min(Math.max(t * rm.fps, 0), rm.n);
        const i = Math.min(Math.floor(f), rm.n - 1), u = f - i;
        return [rm.xs[i] + (rm.xs[i + 1] - rm.xs[i]) * u, rm.zs[i] + (rm.zs[i + 1] - rm.zs[i]) * u];
      };
      const CRAWL_FROM = 15.0, CRAWL_TO = 25.3, TURN_START = 15.0, TURN_END = 16.0, HUNT_FROM = 6.5, HUNT_TO = 10.5;
      const pathFree = (t, from, to) => {
        const r = to.length();
        if (r < 1.8 || r > 6.5) return false;
        const seg = to.clone().sub(from), L2 = seg.lengthSq() || 1;
        const distToSeg = (q) => {
          const k = Math.max(0, Math.min(1, q.clone().sub(from).dot(seg) / L2));
          return q.distanceTo(from.clone().addScaledVector(seg, k));
        };
        for (const o of sky.toads) {
          if (o === t) continue;
          if (distToSeg(o.pos) < 0.9) return false;
          if (o.hop && distToSeg(o.hop.to) < 0.9) return false;
          if (o.crawlTo && distToSeg(o.crawlTo) < 0.9) return false;
        }
        for (const h of sky.herd || []) if (distToSeg(h.pos) < h.radius + t.radius + 1.0) return false;
        if (sky.clown && distToSeg(sky.clown.pos) < sky.clown.radius + t.radius + 0.4) return false;
        return true;
      };
      const yawDir = (yaw) => new THREE.Vector2(-Math.cos(yaw), Math.sin(yaw));
      let clownLast = performance.now();
      function updateClown() {
        const c = sky.clown;
        if (!c) return;
        const now = performance.now();
        const dt = Math.min((now - clownLast) / 1000, 0.1);
        clownLast = now;
        c.obj.visible = !sky.isWater;
        c.proxy.visible = c.obj.visible;
        if (!c.obj.visible) return;
        if (c.turn) {
          const k = Math.min((now - c.turn.t0) / c.turn.dur, 1), e = k * k * (3 - 2 * k);
          const ang = c.turn.from + c.turn.d * e;
          const dA = ang - c.obj.rotation.y;
          const px = c.turn.pv.x, pz = c.turn.pv.z;
          const ox = c.obj.position.x - px, oz = c.obj.position.z - pz;
          const cs = Math.cos(dA), sn = Math.sin(dA);
          c.obj.position.x = px + ox * cs + oz * sn;
          c.obj.position.z = pz - ox * sn + oz * cs;
          c.obj.rotation.y = ang;
          if (k >= 1) {
            c.turn = null;
            startLaugh(c);
          }
        }
        c.mixer.update(dt);
        c.obj.updateMatrixWorld(true);
        const hp = c.hips.getWorldPosition(_clownV);
        c.proxy.position.set(hp.x, -2 + 0.85, hp.z);
        c.pos.set(hp.x, hp.z);
        let target = 0;
        if (c.analyser) {
          c.analyser.getFloatTimeDomainData(_clownBuf);
          let sum = 0;
          for (let i = 0; i < _clownBuf.length; i++) sum += _clownBuf[i] * _clownBuf[i];
          target = Math.min(1, Math.sqrt(sum / _clownBuf.length) * 7);
        }
        c.mouth += (target - c.mouth) * (1 - Math.exp(-dt * (target > c.mouth ? 30 : 12)));
        for (const m of c.mouthMeshes) m.morphTargetInfluences[m.morphTargetDictionary.MouthOpen] = c.mouth;
        const bt = c.laughing && !c.turn ? 1 : 0;
        c.bulge += (bt - c.bulge) * (1 - Math.exp(-dt * (bt ? 8 : 4)));
        c.bulgeU.value = c.bulge;
        const fx = Math.sin(c.obj.rotation.y), fz = Math.cos(c.obj.rotation.y);
        for (const ey of c.eyes) {
          ey.e.position.copy(ey.pos);
          ey.e.scale.copy(ey.scl).multiplyScalar(1 + c.bulge);
          if (c.bulge > 1e-3) {
            ey.e.parent.updateMatrixWorld(true);
            const w = ey.e.parent.localToWorld(ey.pos.clone());
            w.x += fx * 0.015 * c.bulge;
            w.z += fz * 0.015 * c.bulge;
            ey.e.position.copy(ey.e.parent.worldToLocal(w));
          }
        }
      }
      const _clownV = new THREE.Vector3(), _clownBuf = new Float32Array(512);
      function clownLaugh() {
        const c = sky.clown;
        if (!c || c.laughing) return;
        c.laughing = true;
        c.dance.paused = true;
        c.obj.updateMatrixWorld(true);
        const pv = c.hips.getWorldPosition(new THREE.Vector3());
        const want = Math.atan2(-pv.x, -pv.z);
        let d = ((want - c.obj.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        c.turn = { t0: performance.now(), dur: 500, from: c.obj.rotation.y, d, pv };
      }
      function startLaugh(c) {
        c.alignLaugh();
        c.laugh.reset();
        c.laugh.setEffectiveWeight(1);
        c.laugh.play();
        c.laugh.crossFadeFrom(c.dance, 0.3, false);
        c.analyser = soundAt("clownLaugh", c.obj, 1.6, 1, true, true);
      }

      let batLast = performance.now();
      const lemn = (b, t) => {
        const d = 1 + Math.sin(t) ** 2;
        const x = (b.a * Math.cos(t)) / d, y = (b.a * Math.sin(t) * Math.cos(t)) / d;
        const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
        return new THREE.Vector2(b.c.x + x * cr - y * sr, b.c.y + x * sr + y * cr);
      };
      function updateBats(sunAlt) {
        if (!sky.bats?.length) return;
        const now = performance.now();
        const dt = Math.min((now - batLast) / 1000, 0.1);
        batLast = now;
        const show = sunAlt < 5 && !sky.isWater;
        for (const b of sky.bats) {
          b.obj.visible = show;
          if (!show) continue;
          const p0 = lemn(b, b.t), p1 = lemn(b, b.t + 1e-3);
          const ds = Math.max(p1.distanceTo(p0) / 1e-3, 1e-3);
          const tPrev = b.t;
          b.t += (b.v * dt) / ds;
          const p = lemn(b, b.t), pa = lemn(b, b.t + 0.01), pb = lemn(b, tPrev);
          const dir = pa.clone().sub(p).normalize();
          const dirPrev = p.clone().sub(pb).normalize();
          const turn = Math.atan2(dirPrev.x * dir.y - dirPrev.y * dir.x, dirPrev.dot(dir)) / Math.max(dt, 1e-3);
          b.bob += dt * 2.3;
          b.obj.position.set(p.x, -2 + 2.0 + b.h + Math.sin(b.bob) * 0.3, p.y);
          b.obj.rotation.y = Math.atan2(-dir.y, dir.x);
          b.obj.rotation.x = THREE.MathUtils.lerp(b.obj.rotation.x, Math.max(-0.7, Math.min(0.7, -turn * 0.35)), 1 - Math.exp(-dt * 6));
          b.mixer.update(dt);
        }
      }

      let gullLast = performance.now();
      function updateGulls(sunAlt) {
        if (!sky.gulls?.length) return;
        const now = performance.now();
        const dt = Math.min((now - gullLast) / 1000, 0.1);
        gullLast = now;
        const show = sunAlt > -6 && sky.isWater;
        for (const b of sky.gulls) {
          b.obj.visible = show;
          if (!show) continue;
          const p0 = lemn(b, b.t), p1 = lemn(b, b.t + 1e-3);
          const ds = Math.max(p1.distanceTo(p0) / 1e-3, 1e-3);
          const tPrev = b.t;
          b.t += (b.v * dt) / ds;
          const p = lemn(b, b.t), pa = lemn(b, b.t + 0.01), pb = lemn(b, tPrev);
          const dir = pa.clone().sub(p).normalize();
          const dirPrev = p.clone().sub(pb).normalize();
          const turn = Math.atan2(dirPrev.x * dir.y - dirPrev.y * dir.x, dirPrev.dot(dir)) / Math.max(dt, 1e-3);
          b.bob += dt * 0.7;
          b.obj.position.set(p.x, -2 + b.h + Math.sin(b.bob) * 0.6, p.y);
          b.obj.rotation.y = Math.atan2(-dir.y, dir.x);
          b.obj.rotation.x = THREE.MathUtils.lerp(b.obj.rotation.x, Math.max(-0.6, Math.min(0.6, -turn * 0.5)), 1 - Math.exp(-dt * 4));
          b.mixer.update(dt);
        }
      }

      // Hummingbirds: hover in place for a moment, then a quick dash to a new point around the viewer.
      let hummerLast = performance.now();
      function updateHummers(sunAlt) {
        if (!sky.hummers?.length) return;
        const now = performance.now();
        const dt = Math.min((now - hummerLast) / 1000, 0.1);
        hummerLast = now;
        const show = sunAlt > -2 && !sky.isWater;
        const rnd = (a, b) => a + Math.random() * (b - a);
        const fade = 1 - Math.exp(-dt / 0.08);
        for (const b of sky.hummers) {
          b.obj.visible = show;
          if (!show) continue;
          if (b.mode === "hover" && now > b.until) {
            // next point: 1.8-7 m from the viewer, roughly around the current bearing, 0.6-2.6 m above the ground
            const cur = Math.atan2(b.pos.x, -b.pos.z);
            const az = cur + rnd(-1.2, 1.2), r = rnd(1.8, 7);
            b.from.copy(b.pos);
            b.to.set(Math.sin(az) * r, -2 + rnd(0.6, 2.6), -Math.cos(az) * r);
            b.dur = Math.max(0.25, b.from.distanceTo(b.to) / rnd(6, 10));
            b.t = 0;
            b.mode = "dart";
          }
          let wFly = 0, pitch = 0;
          if (b.mode === "dart") {
            b.t = Math.min(1, b.t + dt / b.dur);
            const s = b.t * b.t * (3 - 2 * b.t);
            b.pos.lerpVectors(b.from, b.to, s);
            b.pos.y += Math.sin(Math.PI * b.t) * 0.25;
            const dx = b.to.x - b.from.x, dz = b.to.z - b.from.z;
            b.yaw = Math.atan2(-dz, dx);
            wFly = 1;
            pitch = -0.35 * Math.sin(Math.PI * b.t);
            if (b.t >= 1) {
              b.mode = "hover";
              b.until = now + rnd(400, 2500);
              // hovering: turn roughly towards the viewer or sideways
              b.yawHover = Math.atan2(b.pos.z, -b.pos.x) + rnd(-1.2, 1.2);
            }
          } else {
            b.jit += dt;
            if (b.yawHover !== undefined) {
              const d = ((b.yawHover - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
              b.yaw += d * (1 - Math.exp(-dt * 6));
            }
          }
          b.aFly.setEffectiveWeight(THREE.MathUtils.lerp(b.aFly.getEffectiveWeight(), wFly, fade));
          b.aHover.setEffectiveWeight(1 - b.aFly.getEffectiveWeight());
          b.obj.position.copy(b.pos);
          b.obj.position.x += Math.sin(b.jit * 2.3) * 0.03;
          b.obj.position.y += Math.sin(b.jit * 3.1) * 0.03;
          b.obj.rotation.y = b.yaw;
          b.obj.rotation.z = THREE.MathUtils.lerp(b.obj.rotation.z, pitch, fade);
          b.mixer.update(dt);
        }
        if (sky.heron?.obj.visible) {
          const h = sky.heron;
          h.mixer.update(dt);
          if (h.callAt && now >= h.callAt) {
            h.callAt = 0;
            soundAt("heron", h.obj, 1.6, 0.95 + Math.random() * 0.1, true);
          }
          const target = now < h.callUntil ? 1 : 0;
          h.raise += (target - h.raise) * (1 - Math.exp(-dt * (target ? 7 : 3)));
          applyHeronNeck(h);
        }
      }

      // Head-up call: bend the neck chain about the bird's lateral axis (model +Z) so the bill points to the sky.
      const _hA = new THREE.Vector3(), _hQ = new THREE.Quaternion(), _hQ2 = new THREE.Quaternion();
      const HERON_UP = 1.35; // radians, whole chain
      function applyHeronNeck(h) {
        for (const b of h.neck) {
          if (b.out && b.bone.quaternion.equals(b.out)) b.bone.quaternion.copy(b.pose); // undo last frame if the clip did not touch it
          b.pose.copy(b.bone.quaternion);
          b.out = null;
        }
        if (h.raise < 0.002) return;
        h.model.updateMatrixWorld(true);
        const axisW = _hA.set(0, 0, 1).applyQuaternion(h.model.getWorldQuaternion(_hQ));
        for (const b of h.neck) {
          b.bone.getWorldQuaternion(_hQ);
          const axisL = axisW.clone().applyQuaternion(_hQ.invert()).normalize();
          b.bone.quaternion.multiply(_hQ2.setFromAxisAngle(axisL, HERON_UP * b.w * h.raise));
          b.bone.updateMatrixWorld(true);
          b.out = b.bone.quaternion.clone();
        }
      }
      function heronCall() {
        const h = sky.heron;
        const now = performance.now();
        if (!h || now < h.callUntil) return;
        h.callAt = now + 280; // the call starts as the head goes up
        h.callUntil = now + 2200 + Math.random() * 700;
      }

      let duckLast = performance.now();
      function updateDucks() {
        if (!sky.ducks?.length) return;
        const now = performance.now();
        const dt = Math.min((now - duckLast) / 1000, 0.1);
        duckLast = now;
        const show = !sky.isWater;
        for (const d of sky.ducks) {
          d.obj.visible = show;
          if (!show) continue;
          d.mixer.update(dt);
          applyJaw(d.jaw, d.tap, dt);
        }
      }

      function updatePrecip(day) {
        const fx = sky.precipFx;
        if (!fx) return;
        const p = sky.precip;
        if (!p) {
          fx.rain.visible = fx.ripples.visible = fx.snow.visible = false;
          return;
        }
        const k = Math.min(Math.max(p.mm / 7.6, 0.35), 1);
        const n = Math.max(1, Math.round(QUALITY_TIERS[QUALITY.tier].precip * k));
        const isSnow = p.type === "snow";
        fx.rain.visible = fx.ripples.visible = !isSnow;
        fx.snow.visible = isSnow;
        fx.rain.count = fx.ripples.count = fx.snow.count = n;
        fx.rainOnU.value = isSnow ? 0 : 1;
        fx.rippleScaleU.value = sky.isWater ? 1 : 0.1; // splashes on land are 10x smaller
        fx.fallU.value = isSnow ? 1.0 : 7 * (p.type === "drizzle" ? 2.0 : 6 + 3 * k);
        fx.lenU.value = p.type === "drizzle" ? 0.45 : 1;
        fx.swayU.value = isSnow ? 0.35 : 0;
        const c = sky.cloud;
        if (c && c.wind_speed_10m != null) {
          const v = horDir(0, (c.wind_direction_10m + 180) % 360, _pv);
          const ms = Math.min(c.wind_speed_10m, 15);
          fx.windU.value.set(v.x * ms, v.z * ms);
        }
        fx.lightU.value = 0.12 + 0.88 * day;
        sky.renderer.compute(fx.update);
      }
      const _pv = new THREE.Vector3();

      const _tRay = new THREE.Raycaster();
      const TORCH_OFS = new THREE.Vector3(0, -0.9, 0.6);
      function updateTorch(sunAlt) {
        if (!sky.torch) return;
        const k = sky.torchOn ? Math.min(Math.max((4 - sunAlt) / 7, 0), 1) : 0;
        const sm = k * k * (3 - 2 * k);
        sky.torch.intensity = 40 * sm;
        sky.beam.visible = sm > 0.001;
        sky.beamU.value = sm;
        if (sm <= 0.001) return;
        const cam = sky.camera;
        cam.rotation.set(sky.pitch, sky.yaw, 0);
        cam.updateMatrixWorld();
        sky.torch.position.copy(TORCH_OFS).applyQuaternion(cam.quaternion).add(cam.position);
        _tRay.setFromCamera(sky.torchNdc, cam);
        const o = _tRay.ray.origin, d = _tRay.ray.direction;
        let aim = null;
        const proxies = [];
        for (const h of sky.herd || []) if (h.obj.visible) h.obj.traverse((x) => x.userData.kind && proxies.push(x));
        for (const t of sky.toads || []) if (t.obj.visible) proxies.push(t.proxy);
        const hit = proxies.length ? _tRay.intersectObjects(proxies, false)[0] : null;
        if (hit) aim = hit.point;
        else {
          const groundY = sky.isWater ? -2.25 : -1.8;
          if (d.y < -1e-4) {
            const tt = (groundY - o.y) / d.y;
            if (tt > 0 && tt < 200) aim = o.clone().addScaledVector(d, tt);
          }
          if (!aim) aim = o.clone().addScaledVector(d, 200);
        }
        const p = sky.torch.position;
        sky.torchDir.copy(aim).sub(p).normalize();
        sky.torch.target.position.copy(p).addScaledVector(sky.torchDir, 30);
        sky.torch.target.updateMatrixWorld();
        sky.beam.position.copy(p);
        sky.beam.lookAt(p.clone().add(sky.torchDir));
      }

      let toadLast = performance.now(), grassPick = 0;
      function updateToads() {
        if (!sky.toads?.length) return;
        const now = performance.now();
        const dt = Math.min((now - toadLast) / 1000, 0.1);
        toadLast = now;
        const rnd = (a, b) => a + Math.random() * (b - a);
        const rm = sky.toadRM, dur = sky.toadClip.duration, S = sky.toadScale;
        if (now > grassPick) {
          grassPick = now + 500;
          updateGrassInteractors();
        }
        for (const t of sky.toads) {
          t.obj.visible = !sky.isWater;
          if (!t.obj.visible) continue;
          t.mixer.update(dt);
          const ct = t.action.time % dur;
          const pt = t.lastT;
          t.lastT = ct;
          if (ct < pt) t.crawlYaw = null;

          if (t.hop) {
            const k = Math.min((now - t.hop.t0) / t.hop.dur, 1);
            t.pos.lerpVectors(t.hop.from, t.hop.to, k);
            t.obj.position.set(t.pos.x, -2 + t.hop.h * 4 * k * (1 - k), t.pos.y);
            if (k >= 1) {
              t.hop = null;
              t.nextHop = now + rnd(8000, 20000);
            }
            continue;
          }

          if (rm && ct >= TURN_START && ct < CRAWL_TO && t.crawlYaw === null) {
            const L = rm.total * S;
            const base = t.obj.rotation.y;
            let best = null;
            for (const d of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
              const yaw = base + d + rnd(-0.15, 0.15);
              const to = t.pos.clone().addScaledVector(yawDir(yaw), L);
              if (pathFree(t, t.pos, to)) {
                best = { yaw, to };
                break;
              }
            }
            t.crawlYaw = best ? best.yaw : base;
            t.crawlTo = best ? best.to : null;
            t.crawlBlocked = !best;
            t.turnFrom = base;
          }
          if (t.crawlYaw !== null && ct >= TURN_START && ct < TURN_END) {
            let d = ((t.crawlYaw - t.turnFrom + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            const k = (ct - TURN_START) / (TURN_END - TURN_START);
            t.obj.rotation.y = t.turnFrom + d * (k * k * (3 - 2 * k));
          }

          if (rm && ct >= TURN_END && ct < CRAWL_TO && pt <= ct && !t.crawlBlocked) {
            if (t.crawlYaw !== null) t.obj.rotation.y = t.crawlYaw;
            const [x1, z1] = rmAt(rm, ct), [x0, z0] = rmAt(rm, pt);
            const dx = (x1 - x0) * S, dz = (z1 - z0) * S, th = t.obj.rotation.y;
            const step = new THREE.Vector2(dx * Math.cos(th) + dz * Math.sin(th), -dx * Math.sin(th) + dz * Math.cos(th));
            const next = t.pos.clone().add(step);
            const blocked =
              sky.toads.some((o) => o !== t && next.distanceTo(o.pos) < 0.9 && next.distanceTo(o.pos) < t.pos.distanceTo(o.pos)) ||
              (sky.herd || []).some((h) => next.distanceTo(h.pos) < h.radius + t.radius) ||
              (sky.ducks || []).some((d) => next.distanceTo(d.pos) < d.radius + t.radius && next.distanceTo(d.pos) < t.pos.distanceTo(d.pos));
            if (!blocked) {
              t.pos.copy(next);
              t.obj.position.set(t.pos.x, -2, t.pos.y);
            }
            continue;
          }
          if (ct >= CRAWL_TO) t.crawlTo = null;

          const busy = (ct > HUNT_FROM && ct < HUNT_TO) || (ct >= CRAWL_FROM - 1.0 && ct < CRAWL_TO);
          if (now < t.nextHop || busy) continue;
          const face = t.obj.rotation.y;
          let target = null;
          for (let i = 0; i < 24 && !target; i++) {
            const yaw = face + rnd(-1.3, 1.3);
            const c = t.pos.clone().addScaledVector(yawDir(yaw), rnd(0.3, 0.7) * S);
            if (pathFree(t, t.pos, c)) target = c;
          }
          if (!target) {
            t.nextHop = now + 3000;
            continue;
          }
          const dir = target.clone().sub(t.pos);
          t.obj.rotation.y = Math.atan2(dir.y, -dir.x);
          t.hop = { t0: now, dur: rnd(350, 450), from: t.pos.clone(), to: target, h: rnd(0.12, 0.2) * S };
        }
      }

      const HEADING_FIX = {};
      const HERD_RMIN = 9, HERD_RMAX = 42;
      // Elliptic distance to the lake (1 = shore), widened by `pad` metres; Infinity when there is no lake.
      function lakeMetric(p, pad = 0) {
        if (!sky.lakeOn || sky.lakeOn.value < 0.5) return Infinity;
        const c = sky.lakeC.value, t = sky.lakeT.value;
        const x = p.x - c.x, z = p.y - c.y;
        const u = (x * t.x + z * t.y) / (sky.lake.a + pad), v = (-x * t.y + z * t.x) / (sky.lake.b + pad);
        return u * u + v * v;
      }
      const TURN_RATE = 0.3;
      const DIR_TAU = 2.0;
      let herdLast = performance.now();
      function updateHerd() {
        const H = sky.herd;
        if (!H || !H.length || !sky.groups) return;
        const now = performance.now();
        const dt = Math.min((now - herdLast) / 1000, 0.1);
        herdLast = now;
        const show = !sky.isWater;
        const rnd = (a, b) => a + Math.random() * (b - a);
        const G = {};
        for (const h of H) {
          const g = (G[h.sp.key] ||= { c: new THREE.Vector2(), d: new THREE.Vector2(), n: 0 });
          g.c.add(h.pos); g.d.add(new THREE.Vector2(Math.sin(h.heading), Math.cos(h.heading))); g.n++;
        }
        for (const [key, g] of Object.entries(G)) {
          g.c.multiplyScalar(1 / g.n); g.d.normalize();
          const st = sky.groups[key];
          if (!st.target || g.c.distanceTo(st.target) < 6 || now > st.retarget) {
            for (let tries = 0; tries < 20; tries++) {
              const base = Math.atan2(g.d.x, g.d.y) + rnd(-1.05, 1.05);
              const dist = rnd(15, 30);
              const t = g.c.clone().add(new THREE.Vector2(Math.sin(base) * dist, Math.cos(base) * dist));
              const r = t.length();
              if (r > HERD_RMIN + 6 && r < HERD_RMAX - 6 && lakeMetric(t, 8) > 1) { st.target = t; break; }
              if (tries === 19) st.target = g.c.clone().normalize().multiplyScalar((HERD_RMIN + HERD_RMAX) / 2).rotateAround(new THREE.Vector2(), 0.6);
            }
            st.retarget = now + rnd(40000, 80000);
          }
          g.target = st.target;
        }
        for (const h of H) {
          h.obj.visible = show;
          if (!show) continue;
          const g = G[h.sp.key], sp = h.sp;
          const want = new THREE.Vector2();
          want.add(g.target.clone().sub(g.c).normalize().multiplyScalar(1.0));
          want.add(g.d.clone().multiplyScalar(0.8));
          const toC = g.c.clone().sub(h.pos), dc = toC.length();
          const loose = sp.spacing * Math.sqrt(g.n) * 0.7;
          if (dc > loose) want.add(toC.normalize().multiplyScalar(sp.cohesion * Math.min(1.5, (dc - loose) / sp.spacing)));
          for (const o of H) {
            if (o === h) continue;
            const keep = o.sp.key === sp.key ? sp.spacing : 9.0;
            const d = h.pos.clone().sub(o.pos), dist = d.length();
            if (dist < keep && dist > 1e-3) want.add(d.normalize().multiplyScalar(3.0 * (1 - dist / keep) ** 2));
          }
          {
            const fwd = new THREE.Vector2(Math.sin(h.heading), Math.cos(h.heading));
            for (const o of H) {
              if (o === h) continue;
              const rel = o.pos.clone().sub(h.pos);
              const ahead = rel.dot(fwd);
              const lat = fwd.x * rel.y - fwd.y * rel.x;
              const clear = (h.radius + o.radius) * 1.4;
              if (ahead > 0 && ahead < 8 && Math.abs(lat) < clear) {
                const side = new THREE.Vector2(fwd.y, -fwd.x).multiplyScalar(lat >= 0 ? 1 : -1);
                want.add(side.multiplyScalar(3.0 * (1 - ahead / 8) * (1 - Math.abs(lat) / clear)));
              }
            }
          }
          const r = h.pos.length();
          if (r < HERD_RMIN) want.add(h.pos.clone().normalize().multiplyScalar(1.5 * (1 - r / HERD_RMIN)));
          if (r > HERD_RMAX) want.add(h.pos.clone().normalize().multiplyScalar(-0.8));
          {
            const m = lakeMetric(h.pos, h.radius + 3);
            if (m < 1) {
              const away = h.pos.clone().sub(sky.lakeC.value);
              if (away.lengthSq() > 1e-6) want.add(away.normalize().multiplyScalar(4.0 * (1 - m)));
            }
          }
          if (want.lengthSq() > 1e-6) want.normalize();
          h.dir.lerp(want, 1 - Math.exp(-dt / DIR_TAU)).normalize();
          const wantAng = Math.atan2(h.dir.x, h.dir.y);
          let dAng = ((wantAng - h.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const turnRate = sp.turnRate || TURN_RATE;
          dAng = Math.max(-turnRate * dt, Math.min(turnRate * dt, dAng));
          h.heading += dAng;
          const ahead = h.pos.clone().sub(g.c).dot(g.d);
          let k = 1 - Math.max(-0.15, Math.min(0.25, ahead / (sp.spacing * 3)));
          k *= 0.85 + 0.15 * Math.cos(Math.min(Math.abs(dAng / Math.max(dt, 1e-3)) / turnRate, 1) * (Math.PI / 2));
          if (h.idle && now > h.phaseUntil) {
            h.resting = !h.resting;
            const [a, b] = h.resting ? sp.restSec : sp.walkSec;
            h.phaseUntil = now + rnd(a, b) * 1000;
            if (h.resting) {
              h.idle.reset().setEffectiveWeight(1).fadeIn(0.6).play();
              h.action.fadeOut(0.6);
            } else {
              h.action.reset().setEffectiveWeight(1).fadeIn(0.6).play();
              h.idle.fadeOut(0.6);
            }
          }
          if (h.voiceTap && h.voiceTap.alive()) h.stopUntil = Math.max(h.stopUntil, now + 150);
          if (h.hissAt && now >= h.hissAt) {
            h.hissAt = 0;
            soundAt(sp.sound, h.obj, 1.5, 0.95 + Math.random() * 0.1, h.hissForce);
          }
          const stopped = now < h.stopUntil || h.resting;
          if (h.trumpeting && now >= h.stopUntil) {
            h.trumpeting = false;
            h.trumpet.fadeOut(0.4);
            h.action.reset().fadeIn(0.4).play();
          }
          const v = stopped ? 0 : h.speed * k;
          if (stopped) h.heading -= dAng;
          h.pos.x += Math.sin(h.heading) * v * dt;
          h.pos.y += Math.cos(h.heading) * v * dt;

          h.obj.rotation.y = h.heading + (HEADING_FIX[sp.key] || 0);
          h.action.timeScale = stopped && !h.trumpeting ? (h.idle ? sp.animScale * k : 0) : sp.animScale * k;
          if (stopped && h.idle && !h.resting && !h.voicePause) {
            h.idle.reset().setEffectiveWeight(1).fadeIn(0.3).play();
            h.action.fadeOut(0.3);
            h.voicePause = true;
          } else if (!stopped && h.voicePause) {
            h.voicePause = false;
            h.action.reset().setEffectiveWeight(1).fadeIn(0.4).play();
            h.idle.fadeOut(0.4);
          }
          h.mixer.update(dt);
          applyJaw(h.jaw, h.voiceTap, dt);
        }
        if (show) {
          for (let it = 0; it < 4; it++) {
            for (let i = 0; i < H.length; i++) {
              for (let j = i + 1; j < H.length; j++) {
                const a = H[i], b = H[j];
                const minD = (a.radius + b.radius) * 1.05;
                const d = a.pos.clone().sub(b.pos);
                let dist = d.length();
                if (dist >= minD) continue;
                if (dist < 1e-4) { d.set(Math.random() - 0.5, Math.random() - 0.5); dist = d.length(); }
                const push = d.multiplyScalar((minD - dist) / dist);
                const wa = b.sp.mass / (a.sp.mass + b.sp.mass), wb = a.sp.mass / (a.sp.mass + b.sp.mass);
                a.pos.addScaledVector(push, wa);
                b.pos.addScaledVector(push, -wb);
              }
            }
          }
          if (sky.clown)
            for (const h of H) {
              const c = sky.clown, minD = h.radius + c.radius;
              const d = h.pos.clone().sub(c.pos), dist = d.length();
              if (dist < minD && dist > 1e-4) h.pos.addScaledVector(d, (minD - dist) / dist);
            }
          for (const h of H)
            for (const t of [...(sky.toads || []), ...(sky.ducks || [])]) {
              const minD = h.radius + t.radius;
              const d = h.pos.clone().sub(t.pos), dist = d.length();
              if (dist < minD && dist > 1e-4) h.pos.addScaledVector(d, (minD - dist) / dist);
            }
          // hard shore: whoever ended up in the lake is moved back onto the (widened) shoreline and slides along it
          for (const h of H) {
            const m = lakeMetric(h.pos, h.radius * 0.6);
            if (m >= 1 || m < 1e-6) continue;
            const c = sky.lakeC.value, f = 1 / Math.sqrt(m);
            h.pos.set(c.x + (h.pos.x - c.x) * f, c.y + (h.pos.y - c.y) * f);
          }
          for (const h of H) h.obj.position.set(h.pos.x, -2, h.pos.y);
        }
      }

      function updateSky(date) {
        if (!sky.open || !sky.renderer) return;
        const { obs, sH, mH } = skyBodies(date);
        sky.sunH = sH;
        sky.moonH = mH;
        horDir(sH.altitude, sH.azimuth, _sd);
        sky.mesh.sunPosition.value.copy(_sd);
        sky.sun.position.copy(_sd).multiplyScalar(SKY_R * 0.9);
        sky.sunHalo.position.copy(sky.sun.position);
        {
          const low = Math.min(Math.max(sH.altitude / 15, 0), 1);
          const SUN_HDR = 8.0;
          sky.sun.material.color.setRGB(SUN_HDR, SUN_HDR * (0.62 + 0.38 * low), SUN_HDR * (0.3 + 0.7 * low));
          const vis = sH.altitude > -1.5 ? Math.max(0.25, 1 - 0.75 * (sky.cloud ? sky.cloud.cloud_cover / 100 : 0)) : 0;
          sky.sun.material.opacity = vis;
          sky.sunHalo.material.opacity = vis;
        }
        sky.sunDirU.value.copy(_sd);
        if (sky.water.visible) {
          if (sH.altitude > -3) {
            const k = Math.min(Math.max((sH.altitude + 3) / 10, 0), 1);
            const low = Math.min(Math.max(sH.altitude / 15, 0), 1);
            sky.water.sunDirection.value.copy(_sd);
            sky.water.sunColor.value.setRGB(k, k * (0.75 + 0.25 * low), k * (0.5 + 0.5 * low));
          } else if (mH.altitude > 0) {
            horDir(mH.altitude, mH.azimuth, _md);
            const f = sky.moonFrac ?? 0.5;
            sky.water.sunDirection.value.copy(_md);
            sky.water.sunColor.value.setRGB(0.3 * f, 0.32 * f, 0.38 * f);
          } else {
            sky.water.sunColor.value.setRGB(0, 0, 0);
          }
        }
        horDir(mH.altitude, mH.azimuth, _md);
        sky.moon.position.copy(_md).multiplyScalar(SKY_R * 0.875);
        _c0.copy(_md).negate();
        _c1.set(0, 1, 0).addScaledVector(_c0, -_c0.y).normalize();
        _c2.crossVectors(_c0, _c1);
        sky.moon.quaternion.setFromRotationMatrix(_skyM.makeBasis(_c0, _c1, _c2));

        const rot = Astronomy.Rotation_EQJ_HOR(date, obs);
        const t = Astronomy.MakeTime(date);
        horToSky(Astronomy.RotateVector(rot, new Astronomy.Vector(1, 0, 0, t)), _c0);
        horToSky(Astronomy.RotateVector(rot, new Astronomy.Vector(0, 1, 0, t)), _c1);
        horToSky(Astronomy.RotateVector(rot, new Astronomy.Vector(0, 0, 1, t)), _c2);
        sky.celestial.matrix.makeBasis(_c0, _c1, _c2);
        sky.celestial.matrixWorldNeedsUpdate = true;

        sky.starVis.value = Math.min(Math.max((-sH.altitude - 2) / 12, 0), 1);
        sky.nightU.value = Math.min(Math.max(-sH.altitude / 12, 0), 1);
        const day = Math.min(Math.max((sH.altitude + 6) / 16, 0), 1);
        sky.groundColor.value.setRGB(0.012 + 0.16 * day, 0.014 + 0.17 * day, 0.016 + 0.1 * day);
        sky.dayLight.value = 0.06 + 0.94 * day;
        {
          const cu = sky.cloudU;
          const e = sH.altitude;
          if (e > -4) {
            const k = Math.min(Math.max((e + 4) / 5, 0), 1);
            const low = Math.min(Math.max(e / 20, 0), 1);
            const glow = 1.6 - 0.6 * low;
            cu.sunDir.value.copy(_sd);
            cu.sunCol.value.setRGB(1.05 * k * glow, (0.42 + 0.55 * low) * k * glow, (0.2 + 0.72 * low) * k * glow);
          } else if (mH.altitude > 0) {
            horDir(mH.altitude, mH.azimuth, _md);
            const f = sky.moonFrac ?? 0.5;
            cu.sunDir.value.copy(_md);
            cu.sunCol.value.setRGB(0.1 * f, 0.11 * f, 0.14 * f);
          } else {
            cu.sunCol.value.setRGB(0, 0, 0);
          }
          const warm = Math.min(Math.max(1 - Math.abs(e - 2) / 10, 0), 1);
          const ambK = day * (1 - 0.55 * warm);
          cu.amb.value.setRGB(0.02 + ambK * 0.5, 0.025 + ambK * 0.58, 0.05 + ambK * 0.72);
        }
        sky.grassField.object.visible = !sky.isWater;
        sky.sunLightM.position.copy(_sd).multiplyScalar(100);
        sky.sunLightM.intensity = 2.5 * Math.min(Math.max(sH.altitude / 10, 0), 1);
        sky.skyLightM.intensity = 0.15 + 1.0 * day;
        updateFish();
        updateHerd();
        updateToads();
        updateClown();
        updateTorch(sH.altitude);
        updateBats(sH.altitude);
        updateGulls(sH.altitude);
        updateHummers(sH.altitude);
        updateClimber();
        updateDucks();
        updatePrecip(day);
        soundUpdate(day, sky.nightU.value);

        const low = sky.cloud ? sky.cloud.cloud_cover_low / 100 : 0;
        const mid = sky.cloud ? sky.cloud.cloud_cover_mid / 100 : 0;
        const high = sky.cloud ? sky.cloud.cloud_cover_high / 100 : 0;
        const vol = 1 - (1 - low) * (1 - mid);
        sky.cloudU.coverage.value = Math.min(vol * 0.85 + (vol > 0.02 ? 0.12 : 0), 0.97);
        sky.cloudU.absorb.value = 0.0035 + 0.003 * low;
        sky.mesh.cloudCoverage.value = high * 0.75;
        sky.mesh.cloudDensity.value = 0.22;
        sky.cloudDim.value = 1 - 0.85 * vol - 0.3 * high * (1 - vol);

        const W = sky.viewW, H = sky.viewH;
        const AU_KM = 149597870.7;
        const sunDistKm = Astronomy.GeoVector(Astronomy.Body.Sun, date, true).Length() * AU_KM;
        const moonDistKm = Astronomy.GeoMoon(date).Length() * AU_KM;
        const sunDeg = 2 * Math.atan(695700 / sunDistKm) / D2R;
        const moonDeg = 2 * Math.atan(1737.4 / moonDistKm) / D2R;
        sky.sunDeg = sunDeg; sky.moonDeg = moonDeg;
        {
          const VIS_C = 6;
          sky.sun.scale.setScalar(2 * SKY_R * 0.9 * Math.tan((sunDeg * VIS_C / 2) * D2R));
          sky.sunHalo.scale.setScalar(sky.sun.scale.x * 4);
          sky.moon.scale.setScalar((moonDeg * VIS_C) / MOON_VIS_DEG);
          sky.pxU.value.set(2 / W, 2 / H);
          for (const l of sky.labels) {
            l.visible = true;
            l.scale.setScalar(0.22 * (Math.tan((sky.fov / 2) * D2R) / Math.tan(35 * D2R)));
          }
          const cam = sky.camera;
          cam.fov = sky.fov;
          cam.aspect = W / H;
          cam.updateProjectionMatrix();
          cam.rotation.set(sky.pitch, sky.yaw, 0);
          cam.updateMatrixWorld();
          if (sky.post && QUALITY_TIERS[QUALITY.tier].rays) {
            // sunset strength: full below 8°, fading out by 25°, and below the horizon down to -2°
            const alt = sH.altitude;
            let rays = alt < -2 || alt > 25 ? 0 : alt < 8 ? 1 : 1 - (alt - 8) / 17;
            if (alt < 0) rays *= (alt + 2) / 2;
            _sp.copy(sky.sun.position).project(cam);
            const off = Math.max(Math.abs(_sp.x), Math.abs(_sp.y));
            const onScreen = _sp.z < 1 ? Math.min(Math.max((1.8 - off) / 0.8, 0), 1) : 0;
            sky.sunUV.value.set(_sp.x * 0.5 + 0.5, 0.5 - _sp.y * 0.5);
            sky.raysU.value = rays * onScreen;
            sky.glow.strength.value = 0.3 + 0.7 * rays;
            sky.post.render();
          } else sky.renderer.render(sky.scene, cam);
          const sunUp = sH.altitude > -0.8, moonUp = mH.altitude > -0.5;
          const sunMark = markPos(_sd, sunUp), moonMark = markPos(_md, moonUp);
          const frameKey = `${sunMark}|${moonMark}|${sunUp}|${moonUp}`;
          if (frameKey !== sky.frameKey) {
            sky.frameKey = frameKey;
            UI.send("skyFrame", { sun: sunMark, moon: moonMark, sunUp, moonUp });
          }
        }

        const now = performance.now();
        if (now - sky.lastInfo > 300) {
          sky.lastInfo = now;
          const ill = Astronomy.Illumination(Astronomy.Body.Moon, date);
          sky.moonFrac = ill.phase_fraction;
          const local = date.toLocaleString("en-GB", { timeZone: sky.tz, hour12: false });
          const f = (v) => v.toFixed(1);
          const pl = sky.place;
          const where = pl ? (pl.km < 5 ? `in ${pl.name}, ${pl.cc} · ` : `near ${pl.name}, ${pl.cc} — ${Math.round(pl.km)} km · `) : "";
          const title = `Sky: ${where}${f(Math.abs(sky.lat))}° ${sky.lat >= 0 ? "N" : "S"}, ${f(Math.abs(sky.lon))}° ${sky.lon >= 0 ? "E" : "W"} · ${local} (time zone ${sky.tz}) · ${sky.isWater ? "over water" : "on land"}`;
          const c = sky.cloud;
          const infoText =
            `Sun: altitude ${f(sH.altitude)}°, azimuth ${f(sH.azimuth)}° · Moon: altitude ${f(mH.altitude)}°, azimuth ${f(mH.azimuth)}°, ${Math.round(ill.phase_fraction * 100)}% lit\n` +
            (c
              ? `Cloud cover ${c.cloud_cover}% (low ${c.cloud_cover_low}%, mid ${c.cloud_cover_mid}%, high ${c.cloud_cover_high}%)` +
                (sky.precip
                  ? ` · ${sky.precip.text}, ${sky.precip.type === "snow" && c.snowfall ? `${f(c.snowfall)} cm snow` : `${f(c.precipitation ?? 0)} mm`} in the last hour`
                  : " · no precipitation") +
                " · Open-Meteo, now"
              : "Cloud cover: loading… (Open-Meteo)") +
            " · drag to look around, scroll to zoom";
          UI.send("skyText", { title, info: infoText });
        }
      }

      function placeMarker(local) {
        if (!sky.marker) {
          const pin = new THREE.Group();
          const h = globeR * 0.2;
          const shaftMat = new THREE.MeshBasicNodeMaterial({ fog: false });
          shaftMat.colorNode = mix(vec3(0.45, 0.47, 0.5), vec3(0.85, 0.87, 0.9), normalWorld.y.mul(0.5).add(0.5));
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(globeR * 0.0035, globeR * 0.0015, h, 12), shaftMat);
          shaft.position.y = h / 2 - globeR * 0.01;
          const headMat = new THREE.MeshBasicNodeMaterial({ fog: false });
          headMat.colorNode = mix(vec3(0.55, 0.02, 0.02), vec3(1.0, 0.25, 0.2), normalWorld.y.mul(0.5).add(0.5));
          const head = new THREE.Mesh(new THREE.SphereGeometry(globeR * 0.018, 20, 14), headMat);
          head.position.y = h - globeR * 0.01;
          pin.add(shaft, head);
          globe.add(pin);
          sky.marker = pin;
        }
        sky.marker.position.copy(local).multiplyScalar(globeR);
        sky.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local);
        sky.marker.visible = true;
      }

      function observe() {
        lastObserve = new Date();
        if (live) simTime = Date.now();
        checkClouds();
        if (sky.open) fetchWeather();
      }

      function setGroundRes(tex) {
        if (!sky.groundTex) return;
        const r = tex === "8k" ? "2k" : "1k";
        if (sky.groundRes === r) return;
        sky.groundRes = r;
        loadTexturePromise(`textures/ground_${r}.jpg`).then((t) => {
          if (sky.groundRes !== r) return;
          sky.groundTex.image = t.image;
          sky.groundTex.needsUpdate = true;
        });
      }

      const QUALITY_TIERS = [
        { name: "High", dpr: 2, clouds: 26, sun: 1.0, grass: 1.0, tex: "8k", precip: 25000, rays: true },
        { name: "Medium", dpr: 1.5, clouds: 20, sun: 1.0, grass: 0.8, tex: "4k", precip: 18000, rays: true },
        { name: "Low", dpr: 1.25, clouds: 16, sun: 0.6, grass: 0.6, tex: "2k", precip: 12000, rays: true },
        { name: "Lowest", dpr: 1.0, clouds: 12, sun: 0.4, grass: 0.45, tex: "2k", precip: 8000, rays: false },
      ];
      const QUALITY = { mode: "Auto", tier: 0, applied: -1, sunLines: null, t0: Infinity, acc: 0, n: 0, hitch: false, good: 0 };
      function applyQuality(force = false) {
        const t = QUALITY_TIERS[QUALITY.tier];
        if (!force && QUALITY.applied === QUALITY.tier) return;
        QUALITY.applied = QUALITY.tier;
        const dpr = Math.min(devicePixelRatio, t.dpr);
        renderer.setPixelRatio(dpr);
        if (sky.renderer) sky.renderer.setPixelRatio(dpr);
        if (sky.cloudU) sky.cloudU.steps.value = t.clouds;
        applyTexRes(t.tex);
        setGroundRes(t.tex);
        if (!QUALITY.sunLines) {
          QUALITY.sunLines = [];
          scene.traverse((o) => o.isMesh && o !== cityMesh && o.geometry.index && o.geometry.index.count > 200000 && QUALITY.sunLines.push(o));
        }
        for (const m of QUALITY.sunLines) m.geometry.setDrawRange(0, Math.floor((m.geometry.index.count * t.sun) / 6) * 6);
        if (sky.grassField && sky.grassBase) sky.grassField.set({ density: sky.grassBase.density * t.grass, maxDistance: 38 + 22 * ((t.grass - 0.45) / 0.55) });
      }
      function setQualityMode(mode) {
        QUALITY.mode = mode;
        if (mode !== "Auto") QUALITY.tier = QUALITY_TIERS.findIndex((t) => t.name === mode);
        QUALITY.acc = QUALITY.n = QUALITY.good = 0;
        QUALITY.t0 = performance.now();
        applyQuality(true);
      }
      function sampleQuality(frameMs) {
        if (QUALITY.mode !== "Auto") return;
        const now = performance.now();
        if (now < QUALITY.t0) return;
        if (frameMs > 250) QUALITY.hitch = true;
        QUALITY.acc += frameMs;
        QUALITY.n++;
        if (now - QUALITY.t0 < 2000) return;
        const avg = QUALITY.acc / QUALITY.n, hitch = QUALITY.hitch;
        QUALITY.t0 = now;
        QUALITY.acc = QUALITY.n = 0;
        QUALITY.hitch = false;
        if (hitch) return;
        if (avg > 24 && QUALITY.tier < QUALITY_TIERS.length - 1) {
          QUALITY.tier++;
          QUALITY.good = 0;
          applyQuality();
        } else if (avg < 13 && QUALITY.tier > 0) {
          if (++QUALITY.good >= 3) {
            QUALITY.tier--;
            QUALITY.good = 0;
            applyQuality();
          }
        } else QUALITY.good = 0;
      }

      const EMPTY_SCENE = new THREE.Scene();
      let prevRaw = 0, fpsN = 0, fpsT = 0;
      function loop(now) {
        requestAnimationFrame(loop);
        fpsN++;
        if (now - fpsT > 1000) {
          HOST.gui.fps(Math.round((fpsN * 1000) / (now - fpsT)));
          fpsN = 0;
          fpsT = now;
        }
        if (prevRaw) sampleQuality(now - prevRaw);
        prevRaw = now;
        const dt = Math.min((now - prev) / 1000, 0.05);
        prev = now;
        orbitR = baseOrbitR * PARAMS.distanceFactor;
        if (PARAMS.timeScale !== 1) live = false;
        if (live || (holdEarth && PARAMS.timeScale === 1)) simTime = Date.now();
        else simTime += dt * 1000 * (holdEarth ? 1 : PARAMS.timeScale);
        const date = new Date(simTime);
        updateAstronomy(date);
        updateSky(date);
        sunGroup.rotation.y += dt * SUN_IDLE_YAW;
        if (follow) {
          follow.body.getWorldPosition(_fp);
          if (follow.flying) {
            const k = Math.min((performance.now() - follow.t0) / 600, 1);
            const ease = k * k * (3 - 2 * k);
            controls.target.lerpVectors(follow.fromTarget, _fp, ease);
            camera.position.lerpVectors(follow.fromCam, _fp.clone().add(follow.offset), ease);
            if (k >= 1) follow.flying = false;
          } else {
            const d = _fp.clone().sub(follow.prev);
            controls.target.add(d);
            camera.position.add(d);
          }
          follow.prev.copy(_fp);
        }
        controls.update();
        if (!(sky.open && sky.max)) renderFrame();
        else if (HOST.isWorker) renderer.render(EMPTY_SCENE, camera);
      }

      async function main() {
        UI.send("loader", { label: "Starting WebGPU…" });
        const available = !!navigator.gpu && WebGPU.isAvailable();
        if (!available) {
          loaderError(
            "WebGPU is not available in this browser.\n\n" +
              (navigator.gpu
                ? "Try an up-to-date Chrome or Edge (113+); details are in DevTools → Console."
                : "WebGPU needs a secure context (https or localhost) and an up-to-date Chrome, Edge or Safari."),
          );
          return;
        }

        buildStatic();

        renderer = new THREE.WebGPURenderer({ antialias: true, reversedDepthBuffer: true, canvas: HOST.canvases.main });
        renderer.setSize(innerWidth, innerHeight, false);
        renderer.setPixelRatio(devicePixelRatio);
        const initPromise = track(renderer.init(), "WebGPU");
        await loadEarthAssets();
        await loadMoonTex();
        const gpuTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error("gpu-timeout")), 15000));
        try {
          await Promise.race([initPromise, gpuTimeout]);
        } catch (e) {
          if (e.message !== "gpu-timeout") throw e;
          loaderError("The graphics device is not responding.\nClose other tabs with 3D content (or restart the browser) and try again.", true);
          return;
        }
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        computeSizes();
        makeGlobe();
        makeMoon();
        buildSun();
        progress("Scene");
        simTime = Date.now();
        orbitR = baseOrbitR * PARAMS.distanceFactor;
        updateAstronomy(new Date(simTime));
        observe();
        setInterval(observe, OBSERVE_MS);
        UI.on("visibility", (visible) => {
          if (visible) {
            observe();
            if (SND.on && sky.open) SND.ctx?.resume();
          } else SND.ctx?.suspend();
        });

        const mainInput = HOST.input.main;
        controls = new OrbitControls(camera, mainInput);
        controls.target.set(0, 0, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = sunRadius * 1.2;
        controls.maxDistance = baseOrbitR * 40;
        const gui = HOST.gui.createParameters("Parameters");
        const timeCtrl = gui.add(PARAMS, "timeScale", 0, 20000, 1).name("TIME ×");
        const distCtrl = gui.add(PARAMS, "distanceFactor", 0.4, 3.0, 0.01).name("DISTANCE ×");
        function applyBodyScale() {
          const nb = PARAMS.realScale ? REAL_BODY_SCALE : 1;
          const ratio = nb / bodyScale;
          bodyScale = nb;
          sunGroup.scale.setScalar(sunBaseK * nb);
          sunScaleU.value = sunBaseK * nb;
          sunRadius = sunBaseR * nb;
          globe.scale.setScalar(nb);
          moonMesh.scale.setScalar(nb);
          if (follow) {
            follow.offset.multiplyScalar(ratio);
            follow.fromTarget = controls.target.clone();
            follow.fromCam = camera.position.clone();
            follow.t0 = performance.now();
            follow.flying = true;
            controls.minDistance *= ratio;
          } else {
            controls.minDistance = sunRadius * 1.2;
          }
        }
        gui.add(PARAMS, "realScale").name("Show REAL scale").onChange(applyBodyScale);
        PARAMS.quality = "Auto";
        gui.add(PARAMS, "quality", ["Auto", "High", "Medium", "Low", "Lowest"]).name("quality").onChange((v) => setQualityMode(v));
        const syncNow = () => {
          simTime = Date.now();
          timeCtrl.setValue(1);
          PARAMS.timeScale = 1;
          live = true;
        };
        gui
          .add(
            {
              now() {
                syncNow();
                distCtrl.setValue(1);
              },
            },
            "now",
          )
          .name("NOW");

        function focusEarthPoint(local) {
          const p = globe.getWorldPosition(new THREE.Vector3());
          const dirW = local.clone().applyQuaternion(globe.quaternion).normalize();
          follow = {
            body: globe,
            t0: performance.now(),
            fromTarget: controls.target.clone(),
            fromCam: camera.position.clone(),
            offset: dirW.multiplyScalar(globeR * bodyScale * 3.2),
            prev: p.clone(),
            flying: true,
          };
          controls.minDistance = globeR * bodyScale * 1.15;
        }
        UI.on("whereAmI", ({ lat, lon }) => {
          const la = lat * D2R, lo = lon * D2R;
          const local = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
          syncNow();
          placeMarker(local);
          openSky(lat, lon);
          focusEarthPoint(local);
        });
        const earthFolder = gui.addFolder("Earth");
        earthFolder
          .addColor({ color: atmosphereDayColor.value.getHex(THREE.SRGBColorSpace) }, "color")
          .onChange((v) => atmosphereDayColor.value.set(v))
          .name("atmosphere (day)");
        earthFolder
          .addColor({ color: atmosphereTwilightColor.value.getHex(THREE.SRGBColorSpace) }, "color")
          .onChange((v) => atmosphereTwilightColor.value.set(v))
          .name("atmosphere (twilight)");
        earthFolder.add(roughnessLow, "value", 0, 1, 0.001).name("water roughness");
        earthFolder.add(waterVar, "value", 0, 1.5, 0.01).name("water variation");
        earthFolder.add(roughnessHigh, "value", 0, 1, 0.001).name("land roughness");
        earthFolder.add(cityGain, "value", 0, 3, 0.01).name("city lights");
        const animFolder = gui.addFolder("Animals (sky view)");
        animFolder.add(CREATURES, "fishEvery", 0, 60, 1).name("fish jump: every … s");

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        function overEarth(e) {
          const rect = mainInput.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          return raycaster.intersectObject(globe.children[0], false)[0] || null;
        }
        let downAt = null;
        mainInput.addEventListener("pointerdown", (e) => {
          downAt = { x: e.clientX, y: e.clientY };
          if (overEarth(e)) holdEarth = true;
        });
        let pendingClick = null;
        mainInput.addEventListener("pointerup", (e) => {
          if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
          const hit = overEarth(e);
          if (!hit) return;
          const local = globe.worldToLocal(hit.point.clone()).normalize();
          clearTimeout(pendingClick);
          pendingClick = setTimeout(() => {
            pendingClick = null;
            syncNow();
            const lat = Math.asin(local.y) / D2R;
            const lon = Math.atan2(-local.z, local.x) / D2R;
            placeMarker(local);
            openSky(lat, lon);
          }, 260);
        });

        function flyToBody(body) {
          const r = body === sunGroup ? sunRadius : (body === moonMesh ? globeR * RMOON_OVER_REARTH : globeR) * bodyScale;
          const p = body.getWorldPosition(new THREE.Vector3());
          const dir = camera.position.clone().sub(controls.target).normalize();
          const dist = Math.max(r * 2.2, Math.min(camera.position.distanceTo(p), r * 7));
          follow = {
            body,
            t0: performance.now(),
            fromTarget: controls.target.clone(),
            fromCam: camera.position.clone(),
            offset: dir.multiplyScalar(dist),
            prev: p.clone(),
            flying: true,
          };
          controls.minDistance = r * 1.15;
        }
        {
          let lastTap = null;
          mainInput.addEventListener("pointerup", (e) => {
            if (e.pointerType !== "touch") return;
            const now = performance.now();
            if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
              lastTap = null;
              mainInput.dispatchEvent({ type: "dblclick", clientX: e.clientX, clientY: e.clientY });
            } else lastTap = { t: now, x: e.clientX, y: e.clientY };
          });
        }
        mainInput.addEventListener("dblclick", (e) => {
          clearTimeout(pendingClick);
          pendingClick = null;
          const rect = mainInput.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const sunBall = sunGroup.children[0], earthBall = globe.children[0];
          let hitObj = raycaster.intersectObjects([sunBall, moonMesh, earthBall], false)[0]?.object || null;
          if (!hitObj) {
            const camDir = camera.getWorldDirection(new THREE.Vector3());
            let best = 30;
            for (const o of [sunBall, earthBall, moonMesh]) {
              const wp = o.getWorldPosition(new THREE.Vector3());
              if (wp.clone().sub(camera.position).dot(camDir) <= 0) continue;
              const pr = wp.project(camera);
              const sx = ((pr.x + 1) / 2) * rect.width, sy = ((1 - pr.y) / 2) * rect.height;
              const d = Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top));
              if (d < best) { best = d; hitObj = o; }
            }
          }
          if (!hitObj) {
            follow = null;
            controls.minDistance = sunRadius * 1.2;
            return;
          }
          flyToBody(hitObj === sunBall ? sunGroup : hitObj === moonMesh ? moonMesh : globe);
        });
        UI.on("go", (b) => flyToBody(b === "sun" ? sunGroup : b === "moon" ? moonMesh : globe));
        for (const t of ["pointerup", "pointercancel", "pointerleave"]) mainInput.addEventListener(t, () => (holdEarth = false));

        prev = performance.now();
        requestAnimationFrame(loop);

        mainInput.addEventListener("resize", () => {
          camera.aspect = innerWidth / innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(innerWidth, innerHeight, false);
          if (cityPxU) cityPxU.value.set(2 / innerWidth, 2 / innerHeight);
        });

        loaderDone();
        HOST.gui.hide();
        applyQuality(true);
        QUALITY.t0 = performance.now() + 4000;
        const prefetchSky = () => {
          const urls = [
            ...Object.values(SOUND_FILES),
            "assets/japanese_toad.glb",
            "assets/rhino_animation_walk.glb",
            "assets/atlantic_mackerel_animated_and_game-ready.glb",
            "assets/elephant.glb",
            "assets/rhino_running.glb",
            "assets/bat.glb",
            "assets/clown.glb",
            "assets/lioness.glb",
            "assets/alligator.glb",
            "assets/seagull.glb",
            "assets/duck.glb",
            "assets/hummingbird.glb",
            "assets/cattail.glb",
            "assets/heron.glb",
            "assets/backdrop.svg",
            "textures/sky/stars.6.json",
            "textures/sky/constellations.lines.json",
            "textures/sky/constellations.bounds.json",
            "textures/sky/constellations.json",
            "textures/sky/places15000.json",
            "textures/waternormals.jpg",
          ];
          Promise.all(urls.map((u) => fetch(u, { priority: "low" }).then((r) => r.arrayBuffer())))
            .then(() => {
              sky.prefetched = true;
            })
            .catch((e) => console.warn("sky view prefetch:", e));
        };
        if (typeof requestIdleCallback === "function") requestIdleCallback(prefetchSky, { timeout: 5000 });
        else setTimeout(prefetchSky, 3000);
      }

      main().catch((e) => {
        console.error(e);
        loaderError("Something went wrong:\n" + (e.message || e));
      });
    
