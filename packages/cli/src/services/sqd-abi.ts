import { execSync } from 'node:child_process'

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
 * Simplified version of ABI interface. We only care about when type is
 * `event`, so this interface matches exactly the event item
 */
type RawAbi = RawAbiEvent[]

// TODO: rename to typegen service
export class SqdAbiService {
  // private static SERVICE_URL = 'https://cloud.sqd.dev/chains/api/v1/evm/abi'
  private static SERVICE_URL = 'http://127.0.0.1:3004/evm/abi'

  generateEvmTypes(projectPath: string, contractAddresses: string[], chainId: string): void {
    const outputDir = `${projectPath}/src/contracts/`
    // This is a burner key, it's okay to leak. Once the proxy server is ready, we won't need a key
    const etherscanKey = 'N1NYFQMYX8MKUDHXUQ93TTI9MS496KNC5F'

    for (const address of contractAddresses) {
      const cmd = `npx @subsquid/evm-typegen@latest ${outputDir} ${address} ${etherscanKey ? ` --etherscan-api-key ${etherscanKey}` : ''} ${chainId ? ` --etherscan-chain-id ${chainId}` : ''}`

      execSync(cmd, { stdio: 'inherit' })
    }
  }

  generateSolanaTypes(projectPath: string, programIds: string[]): void {
    const outputDir = `${projectPath}/src/contracts/`

    for (const programId of programIds) {
      execSync(`npx @subsquid/solana-typegen ${outputDir} ${programId}`, {
        stdio: 'inherit',
      })
    }
  }

  async getContractData(contractAddresses: string[], chainid: string) {
    return await Promise.all(contractAddresses.map(async (address) => this.fetchContractData(address, chainid)))
  }

  private async fetchContractData(address: string, chainid: string): Promise<ContractMetadata> {
    try {
      const params = new URLSearchParams({
        chainid,
        address,
        module: 'contract',
        action: 'getsourcecode',
      })

      const url = new URL(SqdAbiService.SERVICE_URL)
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
