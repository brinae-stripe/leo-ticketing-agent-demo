import coreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * Flat config, required from ESLint 9 onwards.
 *
 * eslint-config-next 16 ships a native flat config array, so it is imported
 * directly rather than through the FlatCompat shim — running it through the
 * compat layer fails outright, because the shim tries to JSON-serialise a
 * plugin object that contains circular references.
 *
 * Same rule set as the .eslintrc this replaces (next/core-web-vitals only), so
 * the upgrade did not quietly change what is enforced.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      '.tmp-verify/**',
      'out/**',
      // Plain Node utilities, not part of the app bundle.
      'scripts/**',
    ],
  },
  ...coreWebVitals,
  {
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
