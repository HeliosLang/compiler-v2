import typescript from "@rollup/plugin-typescript"

export default {
  input: ["src/index.ts"], // can be an array or use a glob plugin
  output: {
    dir: "dist",
    format: "esm",
    sourcemap: true,
    preserveModules: true, // keep file structure
    preserveModulesRoot: "src" // drop leading src/ in output
  },
  plugins: [
    typescript({
      tsconfig: "./tsconfig.json", // set "noEmit": false here (for d.ts) or use a separate types pass
      outDir: "dist",
      declarationDir: "dist",
      declaration: true, // usually do types in a separate tsc pass
      noEmitOnError: true,
      noCheck: true
    })
  ],
  external: [/^[^./]/] // treat bare imports as external
}
