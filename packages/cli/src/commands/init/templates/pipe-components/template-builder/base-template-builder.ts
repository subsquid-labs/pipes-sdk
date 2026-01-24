import { Config, NetworkType, WithContractMetadata } from "~/types/init.js";

export interface BuiltTransformerTemplate {
  templateId: string
  code: string
}

export interface TemplateValues {
  network: string
  deduplicatedImports: string[]
  transformerTemplates: BuiltTransformerTemplate[]
  sinkTemplate: string
  envTemplate: string
}

export interface TransformerTemplateBuilder {
  templateId: string
  code: string
}

export abstract class BaseTemplateBuilder {
  constructor(protected config: WithContractMetadata<Config<NetworkType>>) {}

  // TODO: move deduplication logic to this function
  abstract renderTemplate(templateValues: TemplateValues): string

  abstract getTransformerTemplates(): Promise<TransformerTemplateBuilder[]>

  abstract getNetworkImports(): string[]
}