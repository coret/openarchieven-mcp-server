import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

// Builds viewer/viewer.html into a single self-contained dist/viewer.html
// (OpenSeadragon + the ext-apps App client inlined). No runtime CDN.
export default defineConfig({
  root: path.join(root, 'viewer'),
  plugins: [viteSingleFile()],
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: false,
    rollupOptions: { input: path.join(root, 'viewer', 'viewer.html') },
    // Inline everything; high limit so OSD assets become data URIs too.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
  },
});
