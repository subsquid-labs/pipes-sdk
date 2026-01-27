import type { NetworkType } from '~/types/init.js'
import { TemplateId, templates } from '../builders/transformer-builder/index.js'

export function getTemplatePrompts<N extends NetworkType>(networkType: N): { name: string; value: TemplateId<N> }[] {
  const choices: { name: string; value: TemplateId<N>; disabled?: boolean }[] = Object.entries(
    templates[networkType],
  ).map(([id, option]) => ({
    name: option.templateName,
    value: option.templateId as TemplateId<N>,
    disabled: option.disabled,
  }))

  choices.sort((a, b) => {
    if (a.disabled && !b.disabled) return 1
    if (!a.disabled && b.disabled) return -1
    return 0
  })

  return choices
}
