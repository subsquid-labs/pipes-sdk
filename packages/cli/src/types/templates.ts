export interface TransformerTemplate {
  name: string
  code: string
  tableName: string
  clickhouseTableTemplate?: string
  drizzleSchema?: string
}
