import { SolanaTemplateIds } from "~/config/templates.js";

export const erc20TransfersTransformer = `
    evmDecoder({
        profiler: { id: "erc20-transfers" },
        range: { from: "latest" },
        events: {
            transfers: commonAbis.erc20.events.Transfer,
        },
    })
`;

export const minimalTemplate = `
    evmDecoder({
        profiler: { id: "minimal" },
        range: { from: "latest" },
        contracts: [],
        events: {},
    })
`;

export const svmTemplates: Record<
  SolanaTemplateIds,
  {
    compositeKey: string;
    transformer: string;
    tableName: string;
    clickhouseTableTemplate?: string;
    postgresTableTemplate?: string;
  }
> = {
  minimal: {
    compositeKey: "custom",
    transformer: minimalTemplate,
    tableName: "minimal",
  },
  "orca-swaps": {
    compositeKey: "transfers",
    transformer: erc20TransfersTransformer,
    tableName: "orca_swaps",
  },
};
