# Pipes CLI

CLI tool for scaffolding Subsquid Pipes projects with pre-configured templates.

## Usage

```bash
# Interactive mode
pipes init

# JSON config mode
pipes init --config '{"projectFolder":"./my-project","networkType":"evm",...}'
```

## Project Structure

```
src/
├── commands/
│   └── init/
│       ├── builders/           # Code generation builders
│       │   ├── schema-builder/ # Database schema generation
│       │   ├── target-builder/ # Database target configuration
│       │   └── transformer-builder/ # Data transformer generation
│       ├── config/
│       │   ├── networks.ts     # Network configurations (EVM/SVM)
│       │   ├── targets.ts      # Available targets (ClickHouse, PostgreSQL)
│       │   └── templates.ts    # Template registry
│       ├── templates/
│       │   ├── config-files/   # Project scaffolding files
│       │   └── pipes/
│       │       ├── evm/         # EVM templates
│       │       └── svm/         # SVM templates
│       ├── init.handler.ts     # Main initialization logic
│       └── init.prompt.ts      # Interactive prompts
├── services/
│   └── sqd-abi.ts              # ABI fetching and typegen
├── types/
│   └── init.ts                 # Core types (Config, NetworkType, Target)
└── utils/                      # Helper utilities
```

## Available Options

### Network Types
- **EVM**: Ethereum Virtual Machine compatible chains
- **SVM**: Solana Virtual Machine compatible chains

### Targets
- **ClickHouse**: Fast columnar database
- **PostgreSQL**: Traditional relational database

### Package Managers
- pnpm
- yarn
- npm
- bun

### Networks

#### EVM Networks (150+)
Major networks include: Ethereum, Arbitrum, Base, BSC, Polygon, Optimism, Avalanche, zkSync, Monad, HyperEVM, and many more. See `src/commands/init/config/networks.ts` for the complete list.

#### SVM Networks
- Solana (mainnet/devnet)
- Eclipse (mainnet/testnet)
- SOON (mainnet/testnet/devnet)
- svmBNB (mainnet/testnet)

### EVM Templates
- **custom**: Bring your own contracts with ABI-based typegen
- **erc20Transfers**: Track ERC20 token transfers
- **uniswapV3Swaps**: Track Uniswap V3 swap events

### SVM Templates
- **custom**: Bring your own programs with IDL-based typegen
- **tokenBalances**: Track SPL token balance changes

## Adding New Templates

Templates are defined with the `defineTemplate` helper (`src/commands/init/templates/define-template.ts`).

```
src/commands/init/templates/pipes/{evm|svm}/your-template-name/
├── template.config.ts         # Required: defineTemplate(...) call
├── templates/                 # Required: render sources
│   ├── transformer.ts         # Transformer code (static string or Mustache render fn)
│   ├── pg-table.ts            # PostgreSQL/Drizzle schema
│   └── clickhouse-table.sql.ts# ClickHouse schema
└── src/                       # Optional: files copied into the project (copySrc)
```

```ts
import { z } from 'zod'

import { defineTemplate } from '../../../define-template.js'

const ParamsSchema = z.object({
  deployments: z
    .array(z.object({ address: z.string(), range: z.object({ from: z.string(), to: z.string().optional() }) }))
    .describe('Deployments to track'),
})

export const yourTemplate = defineTemplate({
  id: 'yourTemplateName',            // unique camelCase id (the config templateId)
  name: 'Your Template Name',        // display name in the picker
  networkType: 'evm',                // 'evm' or 'svm'
  paramsSchema: ParamsSchema,        // optional; exposed via `pipes init --schema`
  async prompt(ctx) {
    // Interactive parameter collection. ctx provides:
    //   text / confirm / checkbox — inquirer wrappers
    //   blockRange(message, { contractAddresses? }) — range prompt (offers the
    //     deployment block when addresses are supplied on EVM)
    //   abiService — cached ABI/IDL fetcher shared across the whole init run
    const address = (await ctx.text('Contract address')).trim()
    const range = await ctx.blockRange('Block range', { contractAddresses: [address] })
    return { deployments: [{ address, range }] }
  },
  render(params) {
    return {
      transformer: '...',            // code merged into src/index.ts
      postgresSchema: '...',
      clickhouseTable: '...',
      decoderIds: ['yourTemplateName'], // keys added to the stream's outputs record
    }
  },
  async postSetup(params, ctx) {
    // optional: runs after scaffolding, e.g. typegen via ctx.abiService
  },
})
```

Register it in `src/commands/init/templates/pipes/{evm|svm}/index.ts` and the CLI picks it up everywhere: the interactive picker, `--config` validation, and `--schema` output.

## JSON Configuration

The config hierarchy is contract-first: a contract is an ABI-level entity (name + tracked
events) with one or more deployments; each deployment is an address plus its own block range.
`defaultNetwork` is the project-wide network — when per-deployment networks land, deployments
will be able to override it additively.

```json
{
  "projectFolder": "./my-project",
  "networkType": "evm",
  "defaultNetwork": "ethereum-mainnet",
  "target": "postgresql",
  "packageManager": "pnpm",
  "templates": [
    {
      "templateId": "custom",
      "params": {
        "contracts": [
          {
            "contractName": "MyToken",
            "contractEvents": [{ "name": "Transfer", "type": "event", "inputs": [] }],
            "deployments": [
              { "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "range": { "from": "12,369,621" } }
            ]
          }
        ]
      }
    },
    {
      "templateId": "erc20Transfers",
      "params": {
        "deployments": [
          { "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "range": { "from": "latest" } }
        ]
      }
    }
  ]
}
```

Print the full JSON schema with `pipes init --schema`.
