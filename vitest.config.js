import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Root unit-test config for the monorepo.
// Tests live in apps/**/tests/. Default environment is node; a test that
// needs window/document opts in per-file with a `// @vitest-environment jsdom`
// docblock. import.meta.env is provided by vitest, so modules that read
// import.meta.env.VITE_* get undefined rather than throwing.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['apps/**/tests/**/*.test.{js,jsx}'],
    environment: 'node',
  },
  // App code imports through the '@' alias the Vite configs define; without it
  // here, any test of a module that does so fails to resolve rather than fail
  // to pass. Research is the only app whose tests reach across the alias today.
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'apps/research/src') },
  },
})
