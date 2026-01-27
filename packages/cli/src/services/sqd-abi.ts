import { execSync } from 'node:child_process'
import { Address, address as toSvmAddress } from '@solana/addresses'
import { RpcClient } from '@subsquid/rpc-client'
import { fetchIdl } from '@subsquid/solana-typegen/lib/util/fetch.js'
import { toCamelCase } from 'drizzle-orm/casing'
import { getEvmChainId } from '~/commands/init/config/networks.js'
import { NetworkType } from '~/types/init.js'

export interface ContractMetadata {
  contractAddress: string
  contractName: string
  contractEvents: RawAbiEvent[]
}

export interface BaseProxyRes<T> {
  status: string
  message: string
  result: T
}

export interface RawAbiItem {
  name: string
  type: string
}

export type RawAbiEvent = RawAbiItem & {
  inputs: RawAbiItem[]
}

/**
 * Simplified version of the ABI only including the fields
 * we care about
 */
type RawAbi = RawAbiEvent[]

/**
 * Simplified version of instructions only including the fields
 * we care about
 */
export interface SvmInstruction {
  name: string
  description?: string
  accounts: { name: string }[]
  args: { name: string; type: string }[]
}

abstract class AbiService {
  abstract generateTypes(projectPath: string, contractAddresses: string[], chainId?: string): void

  abstract getContractData(contractAddresses: string[], chainId?: string): Promise<ContractMetadata[]>
}

export class SqdAbiService {
  generateTypes(networkType: NetworkType, network: string, projectPath: string, contractAddresses: string[]) {
    return this.getService(networkType).generateTypes(
      projectPath,
      contractAddresses,
      networkType === 'evm' ? getEvmChainId(network) : undefined,
    )
  }

  getContractData(networkType: NetworkType, network: string, contractAddresses: string[]): Promise<ContractMetadata[]> {
    return this.getService(networkType).getContractData(
      contractAddresses,
      networkType === 'evm' ? getEvmChainId(network) : undefined,
    )
  }

  private getService(networkType: NetworkType): AbiService {
    switch (networkType) {
      case 'evm':
        return new EvmAbiService()
      case 'svm':
        return new SvmAbiService()
    }
  }
}

class EvmAbiService extends AbiService {
  // private static SERVICE_URL = 'https://cloud.sqd.dev/chains/api/v1/evm/abi'
  private static SERVICE_URL = 'http://127.0.0.1:3004/evm/abi'

  override generateTypes(projectPath: string, contractAddresses: string[], chainId?: string): void {
    const outputDir = `${projectPath}/src/contracts/`

    for (const address of contractAddresses) {
      const cmd = `npx --yes @subsquid/evm-typegen@latest ${outputDir} ${address} ${chainId ? `--chain-id ${chainId}` : ''}`

      execSync(cmd, { stdio: 'ignore' })
    }
  }

  override getContractData(contractAddresses: string[], chainid?: string) {
    if (!chainid) throw new Error('Missing chain id')

    return Promise.all(contractAddresses.map(async (address) => this.fetchEvmContractData(address, chainid)))
  }

  private async fetchEvmContractData(address: string, chainid: string): Promise<ContractMetadata> {
    try {
      const params = new URLSearchParams({
        chainid,
        address,
        module: 'contract',
        action: 'getsourcecode',
      })

      const url = new URL(EvmAbiService.SERVICE_URL)
      url.search = params.toString()

      const res = await fetch(url)
      const data = (await res.json()) as BaseProxyRes<{ ContractName: string; ABI: string }[]>
      const [contractData] = data.result
      return {
        contractAddress: address,
        contractName: contractData.ContractName,
        contractEvents: this.parseEvents(JSON.parse(contractData.ABI)),
      }
    } catch (e) {
      throw e
      // TODO: handle error
    }
  }

  private parseEvents(abi: RawAbi): RawAbiEvent[] {
    return abi
      .filter((item): item is RawAbiEvent => item.type === 'event')
      .map((item) => ({
        ...item,
        inputs: item.inputs.map((input) => ({
          ...input,
        })),
      }))
  }
}

class SvmAbiService extends AbiService {
  private static SERVICE_URL = 'https://api.mainnet-beta.solana.com'

  override generateTypes(projectPath: string, contractAddresses: string[]): void {
    const outputDir = `${projectPath}/src/contracts/`

    for (const address of contractAddresses) {
      execSync(`npx --yes @subsquid/solana-typegen@latest ${outputDir} ${address}`, {
        stdio: 'ignore',
      })
    }
  }

  override getContractData(contractAddresses: string[]): Promise<ContractMetadata[]> {
    return Promise.all(contractAddresses.map(async (address) => this.fetchSvmContractData(address)))
  }

  private async fetchSvmContractData(address: string) {
    const checksumAddress = toSvmAddress(address)
    const idl = await this.fetchContractIdl(checksumAddress)

    return {
      contractName: toCamelCase(idl?.name || idl.metadata?.name || `contract_${idl.address}`),
      contractAddress: checksumAddress,

      contractEvents: idl.instructions.map((i: SvmInstruction) => ({
        name: toCamelCase(i.name),
        type: 'event',
        inputs: [
          ...i.args
            .map<RawAbiItem>(({ name, type }) => ({
              name: toCamelCase(name),
              type,
            }))
            .filter((a) => typeof a.type !== 'object'),
          ...i.accounts.map<RawAbiItem>(({ name }) => ({
            name: toCamelCase(name),
            type: 'publicKey',
          })),
        ],
      })),
    }
  }

  private async fetchContractIdl(address: Address): Promise<any> {
    const client = new RpcClient({ url: SvmAbiService.SERVICE_URL })
    return await fetchIdl(client, address)
  }
}
