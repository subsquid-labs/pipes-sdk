---
name: typescript-biome
description: Use when formatting code, setting up linting, configuring Biome, or enforcing code style in TypeScript projects. Covers Biome configuration, formatting rules, lint rules, and import organization.
---

# Biome Formatting & Linting

Use **Biome** for formatting and linting in all TypeScript projects. Do not use ESLint + Prettier.

## Setup

### Dependencies

```bash
npm install -D @biomejs/biome
```

### Configuration (`biome.json`)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "arrowParentheses": "always"
    }
  },
  "linter": {
    "rules": {
      "complexity": {
        "noBannedTypes": "error",
        "noUselessThisAlias": "error",
        "noUselessTypeConstraint": "error"
      },
      "correctness": {
        "noPrecisionLoss": "error",
        "noUnusedVariables": "off"
      },
      "style": {
        "noNamespace": "error",
        "useAsConstAssertion": "error",
        "useConsistentArrayType": {
          "level": "warn",
          "options": { "syntax": "shorthand" }
        }
      },
      "suspicious": {
        "noDoubleEquals": "error",
        "noExtraNonNullAssertion": "error",
        "noMisleadingInstantiator": "error",
        "noUnsafeDeclarationMerging": "error"
      }
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": {
          "level": "on",
          "options": {
            "groups": [
              [":NODE:", "react"],
              [":PACKAGE:", ":PACKAGE_WITH_PROTOCOL:"],
              ["~/**"]
            ]
          }
        }
      }
    }
  }
}
```

## Code Style Rules

### Formatting

| Setting         | Value         | Rationale                            |
| --------------- | ------------- | ------------------------------------ |
| Indent           | 2 spaces      | Standard for TypeScript/JavaScript   |
| Line width       | 120 chars     | Balances readability and screen usage |
| Quotes           | Single `'`    | Cleaner, less visual noise           |
| Semicolons       | As needed (ASI) | Minimal punctuation                |
| Arrow parens     | Always        | Consistent, easier to add params     |
| Trailing commas  | All           | Cleaner diffs                        |

### Import Organization

Imports must be grouped in this order, separated by blank lines:

```ts
// 1. Node builtins and React
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 2. External packages
import pino from 'pino'
import { Injectable } from '@nestjs/common'

// 3. Internal/local imports
import { UserService } from '~/user/user.service'
import { Config } from '~/config'
```

### Strict Equality

Always use `===` and `!==`. Never use `==` or `!=`.

```ts
// Good
if (value === null) {}
if (typeof x === 'string') {}

// Bad — will error
if (value == null) {}
```

### Array Types

Use shorthand array syntax:

```ts
// Good
const items: string[] = []
const matrix: number[][] = []

// Bad
const items: Array<string> = []
```

Exception: use `Array<>` for complex union types:

```ts
const items: Array<string | number> = []
```

### No Namespaces

Never use TypeScript `namespace`. Use ES modules instead.

```ts
// Bad
namespace Utils {
  export function parse() {}
}

// Good
export function parse() {}
```

### Const Assertions

Use `as const` for literal types:

```ts
// Good
const ROLES = ['admin', 'user', 'viewer'] as const

// Bad
const ROLES = ['admin', 'user', 'viewer']
```

## Package.json Scripts

```json
{
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "check": "biome check --write ."
  }
}
```

## Editor Integration

Add `.vscode/settings.json` for VS Code:

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports.biome": "explicit"
  }
}
```

## Ignoring Files

In `biome.json`:

```json
{
  "files": {
    "ignore": ["dist", "node_modules", "*.gen.ts", "coverage"]
  }
}
```

## Migrating from ESLint + Prettier

```bash
npx @biomejs/biome migrate eslint
npx @biomejs/biome migrate prettier
```

Then remove ESLint and Prettier configs and dependencies.
