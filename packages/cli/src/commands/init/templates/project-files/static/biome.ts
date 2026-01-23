export const biomeConfigTemplate = JSON.stringify(
  {
    $schema: 'https://biomejs.dev/schemas/2.3.11/schema.json',
    files: {
      ignoreUnknown: true,
      includes: ['**/*.ts', '**/*.json', '!**/node_modules/**', '!**/dist/**'],
    },
    vcs: {
      enabled: true,
      clientKind: 'git',
      useIgnoreFile: true,
    },
    formatter: {
      enabled: true,
      indentStyle: 'space',
      indentWidth: 2,
      lineWidth: 120,
    },
    linter: {
      enabled: true,
      rules: {
        recommended: true,
      },
    },
    javascript: {
      formatter: {
        quoteStyle: 'single',
        semicolons: 'asNeeded',
      },
    },
  },
  null,
  2,
)
