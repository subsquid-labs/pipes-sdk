import { execSync } from 'node:child_process'

export class SqdAbiService {
  generateEvmTypes(projectPath: string, contractAddresses: string[], chainId: string): void {
    const outputDir = `${projectPath}/src/contracts/`
    // This is a burner key, it's okay to leak. Once the proxy server is ready, we won't need a key
    const yyy = ''

    for (const address of contractAddresses) {
      const cmd = `npx @subsquid/evm-typegen@latest ${outputDir} ${address}${
        yyy ? ` --etherscan-api-key ${yyy} --etherscan-chain-id ${chainId}` : ''
      }`
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
}
