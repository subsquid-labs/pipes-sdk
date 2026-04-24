import type { NetworkType } from '~/types/init.js'

import { getTemplates } from '../templates/registry.js'

export function getTemplatePrompts<N extends NetworkType>(
  networkType: N,
): { name: string; value: string; disabled?: boolean }[] {
  const choices = getTemplates(networkType).map((template) => ({
    name: template.name,
    value: template.id,
    disabled: template.disabled,
  }))

  choices.sort((a, b) => {
    if (a.disabled && !b.disabled) return 1
    if (!a.disabled && b.disabled) return -1
    return 0
  })

  return choices
}
