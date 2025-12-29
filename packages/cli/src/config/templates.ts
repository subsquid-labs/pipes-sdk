import { NetworkType } from "~/types/network.js";

const minimal = {
  name: "Minimal",
  id: "minimal",
} as const;

export const evmTemplateOptions = [
  minimal,
  {
    name: "Erc20 Transfers",
    id: "erc20-transfers",
  },
] as const;

export type EvmTemplateIds = (typeof evmTemplateOptions)[number]["id"];

export const svmTemplateOptions = [
  minimal,
  {
    name: "Orca Swaps",
    id: "orca-swaps",
  },
] as const;

export type SolanaTemplateIds = (typeof svmTemplateOptions)[number]["id"];

export const templateOptions = {
  evm: evmTemplateOptions,
  svm: svmTemplateOptions,
} as const satisfies Record<
  NetworkType,
  typeof evmTemplateOptions | typeof svmTemplateOptions
>;
