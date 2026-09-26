import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Resolved as an absolute path on purpose: alasql's `exports` map does not list
// its dist files, so a bare subpath request ("alasql/dist/alasql.min.js") is
// refused by Node's resolver even though the file is right there.
const alasqlBrowserBuild = path.join(
  projectRoot,
  'node_modules',
  'alasql',
  'dist',
  'alasql.min.js',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // alasql ships three builds. The default entry (dist/alasql.fs.js) and the
    // unminified browser build both reach for Node and React Native file-system
    // modules for their CSV/XLSX import helpers, which webpack then tries to
    // parse — react-native/index.js is Flow, so it fails outright.
    //
    // We only ever run in-memory queries, so pin the dependency to the browser
    // bundle, which has none of that, and stub the rest for good measure.
    config.resolve.alias = {
      ...config.resolve.alias,
      alasql: alasqlBrowserBuild,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
      net: false,
      tls: false,
      child_process: false,
      'react-native': false,
      'react-native-fs': false,
      'react-native-fetch-blob': false,
    };
    return config;
  },
};

export default nextConfig;
