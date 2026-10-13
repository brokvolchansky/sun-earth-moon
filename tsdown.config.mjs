import path from "node:path";
import { defineConfig } from "tsdown";

const release = process.env.RELEASE === "1";
const threeWebgpu = path.resolve("node_modules/three/build/three.webgpu.js");

export default defineConfig({
  entry: { "build/page": "src/page.js", "build/worker-entry": "src/worker-entry.js" },
  outDir: "dist",
  clean: true,
  copy: [{ from: "public/**/*", flatten: false }, { from: "src/index.html" }],
  format: "esm",
  platform: "browser",
  target: "es2022",
  dts: false,
  minify: release ? { compress: false, mangle: true, codegen: { removeWhitespace: true } } : false,
  sourcemap: !release,
  deps: { alwaysBundle: [/./], onlyBundle: false },
  outputOptions: { chunkFileNames: "build/chunks/[name]-[hash].js" },
  plugins: [
    {
      name: "three-webgpu",
      resolveId(id) {
        if (id === "three") return threeWebgpu;
      },
    },
  ],
});
