import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * alasql ships three builds. Its default entry (dist/alasql.fs.js) and its
 * unminified browser build both reach for Node and React Native file-system
 * modules to support CSV/XLSX imports, and react-native/index.js is Flow rather
 * than JavaScript, so a bundler cannot parse it.
 *
 * We only ever run in-memory queries, so the dependency is pinned to the
 * browser bundle, which has none of that. The path is absolute for webpack
 * because alasql's `exports` map does not list its dist files, which makes a
 * bare subpath request fail resolution even though the file is right there.
 */
const ALASQL_BROWSER_BUILD = path.join(
  projectRoot,
  'node_modules',
  'alasql',
  'dist',
  'alasql.min.js',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * The routes moved when the app split into two views: everything platform-wide
   * lives under /platform, and one organizer's own pages under /o/<account>.
   *
   * These redirects exist because the old URLs have been shared — a link in a
   * Slack thread should land somewhere sensible rather than on a 404. `/leo` is
   * folded into the platform dashboard because the agent is a drawer now and has
   * no page of its own.
   */
  async redirects() {
    return [
      { source: '/', destination: '/platform', permanent: false },
      { source: '/events', destination: '/platform/events', permanent: false },
      { source: '/events/:id', destination: '/platform/events/:id', permanent: false },
      { source: '/organizers', destination: '/platform/organizers', permanent: false },
      { source: '/organizers/:id', destination: '/o/:id', permanent: false },
      { source: '/audit', destination: '/platform/audit', permanent: false },
      { source: '/leo', destination: '/platform', permanent: false },
    ];
  },

  // Turbopack builds and dev server.
  turbopack: {
    resolveAlias: {
      alasql: './node_modules/alasql/dist/alasql.min.js',
    },
  },

  // Kept for `next build --webpack`, which is still a supported escape hatch.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      alasql: ALASQL_BROWSER_BUILD,
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
