import { checkbox, input } from '@inquirer/prompts'
import chalk from 'chalk'

import { SqdAbiService } from '~/services/sqd-abi.js'
import type { NetworkType } from '~/types/init.js'
import { promptBlockRange } from '~/utils/block-range-prompt.js'

import type { PromptContext } from './define-template.js'

export function createPromptContext(networkType: NetworkType, network: string): PromptContext {
  return {
    async text(message: string, defaultValue?: string) {
      return input({
        default: defaultValue,
        message: `${message}${defaultValue ? ` ${chalk.dim(`(default: ${defaultValue})`)}` : ''}`,
        validate: (v: string) => (v.trim().length > 0 ? true : 'Value cannot be empty'),
      })
    },
    async checkbox<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T[]> {
      return checkbox<T>({ message, choices, pageSize: 15 })
    },
    async blockRange(_message: string) {
      return promptBlockRange({ networkType, network })
    },
    abiService: new SqdAbiService(),
    network,
  }
}
