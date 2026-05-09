import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: '.opencode/plugins',
  format: 'esm',
  external: [/^node:/, '@opencode-ai/plugin', 'zod'],
  clean: true,
  minify: false,
  sourcemap: false,
  target: 'node18',
})
