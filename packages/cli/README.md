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
│       │   ├── sink-builder/   # Database sink configuration
│       │   └── transformer-builder/ # Data transformer generation
│       ├── config/
│       │   ├── networks.ts     # Network configurations (EVM/SVM)
│       │   ├── sinks.ts        # Available sinks (ClickHouse, PostgreSQL, Memory)
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
│   └── init.ts                 # Core types and PipeTemplateMeta class
└── utils/                      # Helper utilities
```

## Available Options

### Network Types
- **EVM**: Ethereum Virtual Machine compatible chains
- **SVM**: Solana Virtual Machine compatible chains

### Sinks
- **ClickHouse**: Fast columnar database
- **PostgreSQL**: Traditional relational database  
- **Memory**: In-memory sink (testing)

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

## Adding New Templates

Templates are defined using the `PipeTemplateMeta` abstract class which provides a structured way to create reusable pipeline configurations.

### Step 1: Create Template Directory Structure

```
src/commands/init/templates/pipes/{evm|svm}/your-template-name/
├── template.config.ts         # Required: Template configuration class
├── templates/                 # Required: Template files
│   ├── transformer.ts         # Required: Transformer logic
│   ├── pg-table.ts           # Required: PostgreSQL/Drizzle schema
│   └── clickhouse-table.sql  # Required: ClickHouse schema
└── src/                       # Optional: Additional source files (contracts, utilities)
```

### Step 2: Implement Template Config Class

Create `template.config.ts` extending `PipeTemplateMeta`:

```ts
import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

// 1. Define parameter schema (optional)
const YourTemplateParamsSchema = z.object({
  contractAddresses: z.array(z.string())
    .default(['0x...'])
    .describe('Array of contract addresses to track'),
  someOption: z.string()
    .default('value')
    .describe('Description shown in prompt'),
})

type YourTemplateParams = z.infer<typeof YourTemplateParamsSchema>

// 2. Create template reader
const templateReader = new TemplateReader(
  getTemplateDirname('evm'), // or 'svm'
  'your-template-name'
)

// 3. Implement template class
class YourTemplate extends PipeTemplateMeta<'evm', typeof YourTemplateParamsSchema> {
  // Required properties
  templateId = 'yourTemplateName'      // Unique identifier (camelCase)
  templateName = 'Your Template Name'  // Display name
  networkType = 'evm' as const         // 'evm' or 'svm'

  // Optional: Parameter schema
  override paramsSchema = YourTemplateParamsSchema
  override defaultParams = { contractAddresses: ['0x...'], someOption: 'value' }
  
  // Optional: Disable template in TUI
  override disabled = false

  // Required: Render transformer code
  override renderTransformers() {
    // Option 1: Use template reader for static templates
    return templateReader.readTransformer()
    
    // Option 2: Use custom render function for dynamic templates
    return renderTransformer(this.getParams())
  }

  // Required: Render PostgreSQL schema
  override renderPostgresSchemas() {
    return templateReader.readPgTable()
  }

  // Required: Render ClickHouse schema
  override renderClickhouseTables() {
    return templateReader.readClickhouseTable()
  }

  // Optional: Custom parameter collection
  override async collectParamsCustom(network: string) {
    // Implement complex interactive prompts
    // Example: Use SqdAbiService to fetch contract data
    // Set params using this.setParams({ ... })
  }

  // Optional: Post-setup hook
  override async postSetup(network: string, projectPath: string) {
    // Run after project scaffolding (e.g., typegen)
  }
}

// 4. Export instance
export const yourTemplate = new YourTemplate()
```

### Step 3: Create Template Files

#### `templates/transformer.ts`
For static templates:
```ts
export const transformer = `
const myPipe = evmDecoder({
  range: { from: 'latest' },
  // ... transformer configuration
})`
```

For dynamic templates (using params):
```ts
import Mustache from 'mustache'
import type { YourTemplateParams } from '../template.config.js'

const template = `
const myPipe = evmDecoder({
  contracts: [
    {{#contractAddresses}}
    '{{{.}}}',
    {{/contractAddresses}}
  ],
})`

export function renderTransformer(params: YourTemplateParams) {
  return Mustache.render(template, params)
}
```

#### `templates/pg-table.ts`
```ts
export const pgTableTemplate = `
import { pgTable, text, bigint, index } from 'drizzle-orm/pg-core'

export const myTable = pgTable('my_table', {
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  // ... table definition
}, (table) => ({
  blockNumberIdx: index('my_table_block_number_idx').on(table.blockNumber),
}))`
```

#### `templates/clickhouse-table.sql`
For static SQL:
```sql
CREATE TABLE IF NOT EXISTS my_table (
  block_number UInt64,
  -- ... column definitions
) ENGINE = MergeTree()
ORDER BY (block_number)
```

For dynamic SQL (TypeScript file):
```ts
import Mustache from 'mustache'

const template = `
CREATE TABLE IF NOT EXISTS {{tableName}} (
  -- ... columns
)`

export function renderClickhouse(params: YourParams) {
  return Mustache.render(template, params)
}
```

### Step 4: Register Template

Add to `src/commands/init/templates/pipes/{evm|svm}/index.ts`:

```ts
import { yourTemplate } from './your-template-name/template.config.js'

export const evmTemplates = {
  custom,
  erc20Transfers,
  yourTemplate,  // Add here
} as const satisfies Record<string, PipeTemplateMeta<'evm', any>>
```

That's it! The CLI automatically:
- Discovers templates from the registry
- Shows them in interactive prompts
- Handles parameter collection via schema or custom logic
- Generates code using your render methods
- Runs post-setup hooks if defined

### Template Methods Reference

#### Required Methods
- `renderTransformers()`: Returns transformer code string
- `renderPostgresSchemas()`: Returns Drizzle ORM schema string
- `renderClickhouseTables()`: Returns ClickHouse SQL string

#### Optional Hooks
- `collectParamsCustom(network)`: Custom interactive parameter collection
- `postSetup(network, projectPath)`: Post-scaffolding setup (e.g., typegen)

#### Utility Methods
- `setParams(params)`: Set and validate template parameters
- `getParams()`: Get current parameters (throws if not set)
- `promptParams(network)`: Trigger parameter collection (automatic in CLI)

### Advanced Features

#### Custom Parameter Collection
Override `collectParamsCustom` for complex workflows:

```ts
override async collectParamsCustom(network: string) {
  const abiService = new SqdAbiService()
  
  // Fetch contract metadata
  const addresses = await input({ message: 'Contract addresses (comma-separated):' })
  const metadata = await abiService.getContractData('evm', network, addresses.split(','))
  
  // Interactive event selection
  const events = await checkbox({
    message: 'Select events to track:',
    choices: metadata.contractEvents.map(e => ({ name: e.name, value: e }))
  })
  
  this.setParams({ contracts: metadata, events })
}
```

#### Post-Setup Hooks
Run operations after project creation:

```ts
override async postSetup(network: string, projectPath: string) {
  const abiService = new SqdAbiService()
  
  // Generate TypeScript types from ABIs
  await abiService.generateTypes(
    'evm',
    network,
    projectPath,
    this.getParams().contracts.map(c => c.address)
  )
}
```

#### Dynamic Rendering
Use Mustache templates for parameter-based code generation:

```ts
import Mustache from 'mustache'

const template = `
export const transformer = evmDecoder({
  contracts: [
    {{#addresses}}
    '{{{.}}}',
    {{/addresses}}
  ],
  events: {
    {{#events}}
    {{name}}: contract.events.{{name}},
    {{/events}}
  },
})`

override renderTransformers() {
  return Mustache.render(template, this.getParams())
}
```

## JSON Configuration

```json
{
  "projectFolder": "./my-project",
  "networkType": "evm",
  "network": "ethereum-mainnet",
  "sink": "postgresql",
  "packageManager": "pnpm",
  "templates": [
    {
      "templateId": "erc20Transfers",
      "params": {
        "contractAddresses": ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"]
      }
    }
  ]
}
```

