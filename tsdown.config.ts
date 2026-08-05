import { defineConfig } from "tsdown"

export default defineConfig({
    entry: ["src/index.ts"],
    root: "src",
    outDir: "dist",
    format: ["esm"],
    platform: "node",
    fixedExtension: false,
    sourcemap: true,
    clean: true,
    dts: false,
    nodeProtocol: "strip",
    deps: {
        neverBundle: true,
    },
})
