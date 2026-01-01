export const chainTypes = [
  { name: 'EVM', value: 'evm' },
  { name: 'SVM', value: 'svm' },
] as const

export type NetworkType = (typeof chainTypes)[number]['value']
