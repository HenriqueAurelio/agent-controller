import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared'),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preloads cannot use ESM or require third-party modules.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [
      react(),
      {
        // The packaged app loads nothing from outside itself. The dev server needs inline
        // scripts and a websocket, so the policy only goes into the build.
        name: 'content-security-policy',
        transformIndexHtml(html, context) {
          const policy =
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; " +
            "connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; " +
            "form-action 'none'";
          return html.replace(
            '<!--csp-->',
            context.server
              ? ''
              : `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
          );
        },
      },
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Monaco gets a page of its own, shown in an iframe (see DiffView.tsx).
          diff: resolve(__dirname, 'src/renderer/diff.html'),
        },
      },
    },
  },
});
