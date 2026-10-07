# sun-earth-moon

A real-time Sun, Earth and Moon in the browser — WebGPU + three.js TSL.

- The Sun, Earth and Moon in their real positions for the current moment (Astronomy Engine).
- Earth with live satellite cloud maps and settlement lights at night.
- Click Earth to open a sky view from that spot: volumetric clouds from current weather, stars, the Sun and Moon at true relative sizes, grass with grazing bison and rhinos on land, and a jumping mackerel over water.

Live: https://sun-earth-moon-webgpu.pages.dev

Requires a browser with WebGPU (recent Chrome, Edge or Safari).

## Structure

- `public/` — the site as published (static files, no build step).
- `.github/workflows/deploy.yml` — deploys `public/` to Cloudflare Pages on every push to `master`.

## Licenses

The MIT license in this repository covers only the original code of this project.
Third-party assets, data and code keep their own licenses — see **Credits** on the page:

- Sun shaders are ported to TSL from the “Sun” demo by FWDesign (https://fwdapps.net/l/sun/); rights to them belong to FWDesign.
- Earth is based on the three.js `webgpu_tsl_earth` example (Three.js Journey).
- Textures: Solar System Scope (CC BY 4.0), NASA SVS CGI Moon Kit.
- 3D models from Sketchfab (CC BY 4.0): Atlantic Mackerel by 1shxxn, Animated Free Bison by AneesAnimates, Rhino Animation Walk by GremorySaiyan.
- Data: Live Cloud Maps (contains modified EUMETSAT data), Open-Meteo (CC BY 4.0), GeoNames (CC BY 4.0), d3-celestial (BSD-3-Clause), Astronomy Engine (MIT).
- Libraries: three.js (MIT), threejs-grass (Apache-2.0).
