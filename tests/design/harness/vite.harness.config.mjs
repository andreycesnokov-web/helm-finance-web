// Build config for the Accounts test harness.
//
// .mjs, not .js: Vite loads a .js config through esbuild's CJS output, where the
// top-level await below is a syntax error.
//
// Separate from the app's own vite.config.js on purpose: its own entry, its own
// outDir (a temp directory the test creates and deletes), and no HTML template
// from client/. Nothing built here can reach the application bundle — the app
// build does not know this file exists.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..', '..', '..', 'client');

// Resolved from client/node_modules rather than by bare specifier: this config
// lives under tests/, and Node's resolution walks up from HERE, which never
// reaches client/node_modules. The plugin is the one the app itself builds with.
//
// `vite`'s own defineConfig is not imported for the same reason — it is only an
// identity helper for editor types, and a plain object works identically.
const req = createRequire(path.join(CLIENT, 'package.json'));
const { default: react } = await import(pathToFileURL(req.resolve('@vitejs/plugin-react')).href);

export default {
  plugins: [react()],
  // root is client/, not this directory: Rollup resolves bare specifiers
  // (react, react-dom, react-router-dom) from the root's node_modules, and
  // tests/design/harness has none. The entry below stays an absolute path
  // outside the root, which a library build handles.
  root: CLIENT,
  // Bare specifiers are resolved relative to the IMPORTING file, and the harness
  // lives under tests/ where no node_modules holds React. Each package is mapped
  // to its directory in client/node_modules so Vite still resolves the package's
  // own entry points (including subpaths such as react/jsx-runtime), rather than
  // to a single file, which would break those subpaths.
  resolve: {
    alias: [
      { find: /^react$/, replacement: path.join(CLIENT, 'node_modules', 'react') },
      { find: /^react\//, replacement: path.join(CLIENT, 'node_modules', 'react') + '/' },
      { find: /^react-dom$/, replacement: path.join(CLIENT, 'node_modules', 'react-dom') },
      { find: /^react-dom\//, replacement: path.join(CLIENT, 'node_modules', 'react-dom') + '/' },
      { find: /^react-router-dom$/, replacement: path.join(CLIENT, 'node_modules', 'react-router-dom') },
    ],
  },
  // React's source reads process.env.NODE_ENV. The app build substitutes it; a
  // LIB build does not, so the bundle shipped 40 bare `process` references and
  // threw ReferenceError the moment the module evaluated — the harness globals
  // never attached and every scenario reported "__boot is not a function".
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    // A library-style build with one predictable filename, because the scenario
    // pages load it by name rather than through a generated HTML template.
    lib: {
      entry: path.join(HERE, 'accountsHarness.jsx'),
      formats: ['es'],
      fileName: () => 'harness.js',
    },
    // React and the page CSS are bundled in; there is no external to resolve at
    // runtime, and the harness is served from a bare directory.
    rollupOptions: { external: [] },
    cssCodeSplit: false,
    minify: false,
    sourcemap: false,
  },
};
