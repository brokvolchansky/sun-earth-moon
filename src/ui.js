const $ = (id) => document.getElementById(id);

export function createUI(cmd) {
  // ---- Credits ----
  const dlg = $("creditsDlg");
  $("creditsBtn").addEventListener("click", () => dlg.showModal());
  $("creditsClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());

  const loaderEl = $("loader"), loaderBar = $("loaderBar"), loaderStep = $("loaderStep");

  const toastEl = $("toast");
  let toastTimer = null;
  const toast = (t, cls) => {
    toastEl.textContent = t;
    toastEl.className = `show ${cls || ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = ""), cls === "err" ? 8000 : 4000);
  };

  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const enterFs = (el) =>
    (el.requestFullscreen || el.webkitRequestFullscreen)
      ?.call(el, { navigationUI: "hide" })
      ?.catch?.((e) => console.error("requestFullscreen:", e.name, e.message));
  const exitFs = () => (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.((e) => console.error("exitFullscreen:", e.name, e.message));
  $("mainFull").addEventListener("click", () => (fsEl() ? exitFs() : enterFs($("mainView"))));

  $("goSun").addEventListener("click", () => cmd("go", "sun"));
  $("goEarth").addEventListener("click", () => cmd("go", "earth"));
  $("goMoon").addEventListener("click", () => cmd("go", "moon"));
  $("whereAmI").addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Geolocation is not available in this browser", "err");
    toast("Locating…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        cmd("whereAmI", { lat, lon });
        toast(`📍 You are here: ${lat.toFixed(3)}°, ${lon.toFixed(3)}° (±${Math.round(accuracy)} m)`, "ok");
      },
      (err) => toast(`Geolocation: ${err.code === 1 ? "permission denied" : err.message}`, "err"),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });
  document.addEventListener("visibilitychange", () => cmd("visibility", document.visibilityState === "visible"));

  const SKY_SIZE = [600, 360];
  const panel = $("skyPanel"), skyCanvas = $("skyCanvas"), skyTitle = $("skyTitle"), skyInfo = $("skyInfo");
  const btnSun = $("btnSun"), btnMoon = $("btnMoon"), markSun = $("markSun"), markMoon = $("markMoon");
  const skyLoader = $("skyLoader"), skyLoaderBar = skyLoader.querySelector(".bar"), skyLoaderStep = skyLoader.querySelector(".step"), skyLoaderTitle = skyLoader.querySelector(".title");
  const layoutSky = () => {
    let w = Math.min(SKY_SIZE[0], innerWidth - 16);
    let h = Math.round((w * SKY_SIZE[1]) / SKY_SIZE[0]);
    if (panel.classList.contains("max")) {
      w = innerWidth;
      h = Math.max(200, innerHeight - $("skyHead").offsetHeight - skyInfo.offsetHeight);
    }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    panel.style.width = `${w}px`;
    skyCanvas.style.width = `${w}px`;
    skyCanvas.style.height = `${h}px`;
  };
  layoutSky();
  addEventListener("resize", layoutSky);
  const setSkyMax = (on) => {
    panel.classList.toggle("max", on);
    layoutSky();
    cmd("skyMax", on);
  };
  $("skyFull").addEventListener("click", () => {
    if (panel.classList.contains("max")) {
      setSkyMax(false);
      if (fsEl()) exitFs();
    } else {
      setSkyMax(true);
      if (!fsEl()) enterFs(panel);
    }
  });
  const onFsChange = () => {
    if (!fsEl() && panel.classList.contains("max")) setSkyMax(false);
    else layoutSky();
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  for (const [el, body] of [[btnSun, "sun"], [markSun, "sun"], [btnMoon, "moon"], [markMoon, "moon"]]) el.addEventListener("click", () => cmd("look", body));
  const torchBtn = $("skyTorch"), sndBtn = $("skySound");
  torchBtn.addEventListener("click", () => cmd("torch"));
  sndBtn.addEventListener("click", () => cmd("sound"));

  const constTip = document.createElement("div");
  constTip.id = "constTip";
  constTip.hidden = true;
  panel.appendChild(constTip);

  const info = document.createElement("div");
  info.id = "constInfo";
  info.hidden = true;
  panel.appendChild(info);
  const closeInfo = () => (info.hidden = true);
  addEventListener("keydown", (e) => e.key === "Escape" && closeInfo());
  addEventListener("pointerdown", (e) => {
    if (!info.hidden && !info.contains(e.target) && e.target !== skyCanvas) closeInfo();
  });
  const wikiCache = new Map();
  const wikiSummary = (latin) => {
    const base = latin.replace(/ (Caput|Cauda)$/, "");
    if (!wikiCache.has(base)) {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(base.replace(/ /g, "_") + "_(constellation)")}`;
      wikiCache.set(base, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
    }
    return wikiCache.get(base);
  };
  const openInfo = (c, x, y) => {
    info.innerHTML = "";
    const close = document.createElement("button");
    close.id = "constInfoClose";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", closeInfo);
    const h = document.createElement("h3");
    h.textContent = c.name;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [c.en, c.gen && `genitive: ${c.gen}`, `IAU abbreviation: ${c.id}`].filter(Boolean).join(" · ");
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = "Loading description…";
    info.append(close, h, meta, body);
    info.hidden = false;
    const place = () => {
      const w = info.offsetWidth, hh = info.offsetHeight;
      info.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x - w / 2))}px`;
      info.style.top = `${Math.max(12, Math.min(innerHeight - hh - 12, y - hh - 18))}px`;
    };
    place();
    wikiSummary(c.name)
      .then((j) => {
        body.innerHTML = "";
        if (j.thumbnail?.source) {
          const img = document.createElement("img");
          img.src = j.thumbnail.source;
          img.alt = j.title || c.name;
          img.addEventListener("load", place);
          body.append(img);
        }
        const pText = document.createElement("div");
        pText.textContent = j.extract || "No description available.";
        const src = document.createElement("div");
        src.className = "src";
        const a = document.createElement("a");
        a.href = j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(c.name)}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Read more on Wikipedia";
        src.append(a, " · text CC BY-SA 4.0");
        body.append(pText, src);
        place();
      })
      .catch(() => (body.textContent = "Description is unavailable right now."));
  };
  $("skyClose").addEventListener("click", () => {
    if (panel.classList.contains("max")) {
      setSkyMax(false);
      if (fsEl()) exitFs();
    }
    panel.hidden = true;
    constTip.hidden = true;
    closeInfo();
    cmd("skyClose");
  });

  let skyHideTimer = null;
  const skyFadeIn = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        skyCanvas.style.transition = "opacity 0.6s ease";
        skyCanvas.style.opacity = "1";
      }),
    );
  const skyLoad = (m) => {
    switch (m.op) {
      case "begin":
        clearTimeout(skyHideTimer);
        skyCanvas.style.transition = "none";
        skyCanvas.style.opacity = m.silent ? "0.06" : "1";
        skyLoaderTitle.textContent = m.title;
        skyLoaderBar.style.width = "0%";
        skyLoaderStep.textContent = "Starting…";
        skyLoader.classList.remove("done");
        skyLoader.hidden = !m.show;
        break;
      case "title":
        skyLoader.hidden = false;
        skyLoaderTitle.textContent = m.title;
        break;
      case "step":
        skyLoaderBar.style.width = `${m.pct}%`;
        skyLoaderStep.textContent = m.text;
        break;
      case "text":
        skyLoaderStep.textContent = m.text;
        break;
      case "finish":
        if (!m.silent) {
          skyLoader.classList.add("done");
          skyHideTimer = setTimeout(() => (skyLoader.hidden = true), 850);
        }
        skyFadeIn();
        break;
    }
  };

  const placeMark = (el, p) => {
    if (!p) return (el.hidden = true);
    el.style.left = `${p[0]}px`;
    el.style.top = `${p[1]}px`;
    el.hidden = false;
  };

  return function handle(m) {
    switch (m.type) {
      case "loader":
        if (m.pct !== undefined) loaderBar.style.width = `${m.pct}%`;
        loaderStep.textContent = m.label;
        break;
      case "loaderError":
        loaderEl.classList.add("error");
        loaderStep.textContent = m.text;
        if (m.retry) {
          const btn = document.createElement("button");
          btn.textContent = "Try again";
          btn.className = "barBtn";
          btn.onclick = () => location.reload();
          loaderEl.appendChild(btn);
        }
        break;
      case "loaderDone":
        loaderBar.style.width = "100%";
        loaderStep.textContent = "Ready";
        setTimeout(() => {
          loaderEl.classList.add("done");
          setTimeout(() => loaderEl.remove(), 700);
        }, 250);
        break;
      case "toast":
        toast(m.text, m.cls);
        break;
      case "skyOpen":
        panel.hidden = false;
        layoutSky();
        break;
      case "skyLoad":
        skyLoad(m);
        break;
      case "skyText":
        skyTitle.textContent = m.title;
        skyInfo.textContent = m.info;
        break;
      case "skyFrame": {
        placeMark(markSun, m.sun);
        placeMark(markMoon, m.moon);
        btnSun.disabled = !m.sunUp;
        btnMoon.disabled = !m.moonUp;
        btnSun.title = m.sunUp ? "Look at the Sun" : "The Sun is below the horizon";
        btnMoon.title = m.moonUp ? "Look at the Moon" : "The Moon is below the horizon";
        break;
      }
      case "skyCursor":
        skyCanvas.style.cursor = m.value;
        break;
      case "constTip":
        if (!m.c) return (constTip.hidden = true);
        constTip.innerHTML = "";
        constTip.append(m.c.name);
        if (m.c.en) {
          const sm = document.createElement("small");
          sm.textContent = m.c.en;
          constTip.append(sm);
        }
        constTip.style.left = `${m.x + 14}px`;
        constTip.style.top = `${m.y + 12}px`;
        constTip.hidden = false;
        break;
      case "constInfo":
        openInfo(m.c, m.x, m.y);
        break;
      case "soundState":
        sndBtn.textContent = m.on ? "🔊 Sound" : "🔇 Sound";
        break;
      case "torchState":
        torchBtn.style.opacity = m.on ? "1" : "0.45";
        break;
    }
  };
}
