import { input } from '@inquirer/prompts'

interface ContractWithName {
  contractAddress: string
  contractName: string
}

type InputFn = typeof input

/**
 * Detects duplicate `contractName` values in the array and prompts the user
 * to provide unique names. Mutates the contracts in place.
 */
export async function resolveDuplicateContractNames(
  contracts: ContractWithName[],
  promptFn: InputFn = input,
): Promise<void> {
  const duplicates = findDuplicateNames(contracts)
  if (duplicates.size === 0) return

  const usedNames = new Set(contracts.map((c) => c.contractName))

  for (const [name, indices] of duplicates) {
    for (const idx of indices) {
      const contract = contracts[idx]
      usedNames.delete(contract.contractName)

      const newName = await promptForUniqueName(name, contract.contractAddress, usedNames, promptFn)

      contract.contractName = newName
      usedNames.add(newName)
    }
  }
}

function findDuplicateNames(contracts: Array<{ contractName: string }>): Map<string, number[]> {
  const nameToIndices = new Map<string, number[]>()
  contracts.forEach((c, i) => {
    const indices = nameToIndices.get(c.contractName) ?? []
    indices.push(i)
    nameToIndices.set(c.contractName, indices)
  })
  return new Map(Array.from(nameToIndices.entries()).filter(([, indices]) => indices.length > 1))
}

async function promptForUniqueName(
  originalName: string,
  address: string,
  usedNames: Set<string>,
  promptFn: InputFn,
): Promise<string> {
  const shortAddress = address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-5)}` : address
  const baseDefault = `${originalName}_${address.slice(0, 6)}`
  let defaultName = baseDefault
  let counter = 2
  while (usedNames.has(defaultName)) {
    defaultName = `${baseDefault}_${counter}`
    counter += 1
  }
  return promptFn({
    message: `Contract name "${originalName}" is duplicated. Enter unique name for ${shortAddress}:`,
    default: defaultName,
    validate: (value) => {
      if (!value.trim()) return 'Contract name cannot be empty'
      if (usedNames.has(value)) return `Name "${value}" already in use`
      return true
    },
  })
}
