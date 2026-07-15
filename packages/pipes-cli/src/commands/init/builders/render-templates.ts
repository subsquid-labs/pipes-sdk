import type { Config, NetworkType } from '~/types/init.js'

import type { ConfiguredTemplate, TemplateArtifacts, TemplateContext } from '../templates/template.js'

export interface RenderedTemplate<N extends NetworkType = NetworkType> {
  template: ConfiguredTemplate<N, unknown>['template']
  params: unknown
  artifacts: TemplateArtifacts
}

/**
 * Renders every configured template exactly once. Rendering is pure, but the
 * artifacts feed several consumers (index.ts assembly, target code, migration
 * files, schema files) — one pass keeps them all working from the same result.
 */
export function renderTemplates<N extends NetworkType>(config: Config<N>): RenderedTemplate<N>[] {
  const ctx: TemplateContext<N> = {
    network: config.defaultNetwork,
    projectPath: '',
    networkType: config.networkType,
  }

  return config.templates.map(({ template, params }) => ({
    template,
    params,
    artifacts: template.render(params, ctx),
  }))
}
