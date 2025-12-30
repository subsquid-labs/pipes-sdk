import { SolanaTemplateIds } from "~/config/templates.js";
import { TransformerTemplate } from "~/types/templates.js";

export const erc20TransfersTransformer = `
    evmDecoder({
        profiler: { id: "erc20-transfers" },
        range: { from: "latest" },
        events: {
            transfers: commonAbis.erc20.events.Transfer,
        },
    })
`;

export const svmTemplates: Record<
  SolanaTemplateIds,
  TransformerTemplate
> = {
  custom: {
    compositeKey: "custom",
    transformer: `solanaInstructionDecoder({
        range: { from: "latest" },
        programId: [],
        instructions: {},
    })`,
    tableName: "customContract",
    drizzleTableName: "customContract",
  },
  "orca-swaps": {
    compositeKey: "transfers",
    transformer: erc20TransfersTransformer,
    tableName: "orca_swaps",
  },
};
