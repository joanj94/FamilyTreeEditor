import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/**
 * The layering rule is enforced here rather than left to review.
 *
 * `layout/` never imports from `render/` or `editor/`, and `render/` never mutates the document.
 * That separation is what turns a layout fault -- easily misreported as a data error -- into an
 * ordinary unit test that needs no browser and no DOM. A single convenience import from
 * `layout/` into `render/` is all it takes to lose that, and it is the kind of change that looks
 * harmless in a diff.
 */
const layering = [
  {
    files: ['src/layout/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/editor/**', '**/storage/**', '**/gedcom/**'],
              message:
                'layout/ is a pure function from document to coordinates. It may import from model/ only - keeping it free of the DOM is what makes the seven geometric invariants testable without a browser.',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message:
                'layout/ must contain no React. It computes coordinates and nothing else.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/render/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/editor/**'],
              message:
                'render/ reads the ViewModel and decides nothing. Commands and state belong to editor/, which may import render/ but not the other way round.',
            },
            {
              group: ['**/model/ops*'],
              message:
                'render/ must never mutate the document. Raise an event and let editor/ dispatch a command.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/gedcom/**/*.{ts,tsx}', 'src/model/**/*.{ts,tsx}', 'src/storage/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'react/*',
                'react-dom/*',
                '**/render/**',
                '**/editor/**',
              ],
              message:
                'Parsing, the document model and persistence stay independent of the UI, so each can be tested and reused without one.',
            },
          ],
        },
      ],
    },
  },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'pnpm-lock.yaml'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* Unused arguments are often deliberate in a port -- keeping a parameter that the Python
         original had documents the signature. An underscore says "on purpose". */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /* The immutability convention, inherited from the companion pipeline's frozen dataclasses. */
      'prefer-const': 'error',
      'no-param-reassign': ['error', { props: true }],

      /* Never silently cope: an empty catch, or one that swallows the cause, turns a recoverable
         parse error into a blank screen. */
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  ...layering,

  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  {
    files: ['*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
