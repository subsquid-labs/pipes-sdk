import { execSync } from "node:child_process";

export class SqdAbiService {
  generateEvmTypes(
    projectPath: string,
    contractAddresses: string[],
    chainId: string
  ): void {
    const outputDir = `${projectPath}/src/contracts/`;
    const apiKey = process.env["ETHERSCAN_API"];

    console.log(`ETHERSCAN_API: ${apiKey}`);

    for (const address of contractAddresses) {
      const cmd = `npx @subsquid/evm-typegen@latest ${outputDir} ${address}${
        apiKey
          ? ` --etherscan-api-key ${apiKey} --etherscan-chain-id ${chainId}`
          : ""
      }`;
      execSync(cmd, { stdio: "inherit" });
    }
  }

  generateSolanaTypes(projectPath: string, programIds: string[]): void {
    const outputDir = `${projectPath}/src/contracts/`;

    for (const programId of programIds) {
      execSync(`npx @subsquid/solana-typegen ${outputDir} ${programId}`, {
        stdio: "inherit",
      });
    }
  }
}
