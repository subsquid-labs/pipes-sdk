
## Setup

- Clone the repo
- Install dependencies:
    - pnpm install

## Common scripts

Run from the repository root (Turborepo will fan out to packages):

- Build all packages
    - pnpm build
- Dev/watch all packages (if defined)
    - pnpm dev
    - pnpm watch
- Lint all packages
    - pnpm lint
    - pnpm lint:fix

Package-specific scripts (in packages/subsquid-pipes):
- Build package
    - pnpm --filter @sqd-pipes/pipes run build
- Pack tarball (after build)
    - pnpm --filter @sqd-pipes/pipes run pack
- Lint package
    - pnpm --filter @sqd-pipes/pipes run lint
- Run tests
    - pnpm --filter @sqd-pipes/pipes run test