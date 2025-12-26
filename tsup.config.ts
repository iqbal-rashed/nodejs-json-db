import { defineConfig } from 'tsup';

export default defineConfig([  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    dts: true,
    splitting: false,
    treeshake: true,
    sourcemap: false,
    clean: true,
    minify: true,
    shims: true,
    target: 'node18',
  },{
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: false,
    splitting: false,
    treeshake: true,
    sourcemap: false,
    clean: true,
    minify: true,
    shims: true,
    target: 'node18',
  }]);
