export interface TransformerTemplate {
  compositeKey: string
  transformer: string
  imports?: string[]
  variableName?: string
  tableName: string
  clickhouseTableTemplate?: string
  drizzleTableName?: string
  drizzleSchema?: string
}
