import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectMock = vi.fn()
const inputMock = vi.fn()
const getTemplateMock = vi.fn()

vi.mock('@inquirer/prompts', () => ({
  select: (...args: unknown[]) => selectMock(...args),
  input: (...args: unknown[]) => inputMock(...args),
}))

vi.mock('../templates/registry.js', () => ({
  getTemplate: (...args: unknown[]) => getTemplateMock(...args),
  templateRegistry: { evm: {}, svm: {} },
}))

vi.mock('./templates.js', () => ({
  getTemplatePrompts: () => [{ name: 'Fake A', value: 'fakeA' }],
}))

import { SKIP_TEMPLATE_VALUE, templatePromptLoop } from './template-prompt-loop.js'

function fakeTemplate(id: string, withPrompt = false) {
  return {
    id,
    name: id,
    networkType: 'evm',
    render: () => ({ transformer: '', postgresSchema: '', clickhouseTable: '', decoderIds: [] }),
    ...(withPrompt ? { prompt: async () => ({ answer: 'ok' }) } : {}),
  }
}

describe('templatePromptLoop', () => {
  beforeEach(() => {
    selectMock.mockReset()
    inputMock.mockReset()
    getTemplateMock.mockReset()
  })

  it('collects a single template and stops when the user declines more', async () => {
    const tpl = fakeTemplate('fakeA')
    getTemplateMock.mockReturnValue(tpl)
    selectMock
      .mockResolvedValueOnce('fakeA') // pick template
      .mockResolvedValueOnce('no') // add more? no

    const result = await templatePromptLoop('evm', 'ethereum-mainnet')

    expect(result).toHaveLength(1)
    expect(result[0]!.template.id).toBe('fakeA')
  })

  it('accumulates multiple templates before the user stops', async () => {
    const tpl = fakeTemplate('fakeA')
    getTemplateMock.mockReturnValue(tpl)
    selectMock
      .mockResolvedValueOnce('fakeA') // template 1
      .mockResolvedValueOnce('yes') // add more? yes
      .mockResolvedValueOnce('fakeA') // template 2
      .mockResolvedValueOnce('no') // add more? no

    const result = await templatePromptLoop('evm', 'ethereum-mainnet')

    expect(result).toHaveLength(2)
  })

  it('stops when the skip sentinel is chosen after at least one template', async () => {
    const tpl = fakeTemplate('fakeA')
    getTemplateMock.mockReturnValue(tpl)
    selectMock
      .mockResolvedValueOnce('fakeA') // template 1
      .mockResolvedValueOnce('yes') // add more? yes
      .mockResolvedValueOnce(SKIP_TEMPLATE_VALUE) // skip — exits immediately

    const result = await templatePromptLoop('evm', 'ethereum-mainnet')

    expect(result).toHaveLength(1)
  })

  it('invokes the template prompt when the template defines one', async () => {
    const tpl = fakeTemplate('fakeA', true)
    getTemplateMock.mockReturnValue(tpl)
    selectMock
      .mockResolvedValueOnce('fakeA') // template 1
      .mockResolvedValueOnce('no') // add more? no

    const result = await templatePromptLoop('evm', 'ethereum-mainnet')

    expect(result[0]!.params).toEqual({ answer: 'ok' })
  })
})
