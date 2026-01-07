# Pipes CLI

CLI tool for scaffolding Subsquid Pipes projects with pre-configured templates.

## Usage

```bash
# Initialize a new project
pipes init

# Or with JSON config
pipes init --config '{"projectFolder":"./my-project","chainType":"evm",...}'
```

## Adding New Templates

### EVM Templates

1. **Create template directory** in `src/template/pipes/evm/your-template-name/`:
   - `transformer.ts` - Main transformer code
   - `clickhouse-table.sql` - ClickHouse table schema
   - `pg-table.ts` - Drizzle ORM schema

2. **Register in `src/template/pipes/evm/transformer-templates.ts`**:
```ts
'your-template-name': (() => {
  const parsed = parser.parseTemplateFile('your-template-name/transformer.ts')
  const drizzleSchema = parser.readTemplateFile('your-template-name/pg-table.ts')
  return {
    compositeKey: 'yourKey',
    tableName: 'your_table_name',
    transformer: parsed.code,
    imports: parsed.imports,
    variableName: parsed.variableName,
    clickhouseTableTemplate: parser.readTemplateFile('your-template-name/clickhouse-table.sql'),
    drizzleSchema,
    drizzleTableName: parser.extractVariableName(drizzleSchema),
  }
})(),
```

3. **Add to `src/config/templates.ts`**:
```ts
export const evmTemplateOptions = [
  // ... existing templates
  {
    name: 'Your Template Name',
    id: 'your-template-name',
  },
]
```

### SVM Templates

Follow the same steps but use `src/template/pipes/svm/` directory and update `svmTemplates` in `src/template/pipes/svm/transformer-templates.ts` and `svmTemplateOptions` in `src/config/templates.ts`.

### Template Requirements

- **transformer.ts**: Must export a const variable (used as `variableName`)
- **clickhouse-table.sql**: SQL CREATE TABLE statement
- **pg-table.ts**: Drizzle ORM table definition with exports

