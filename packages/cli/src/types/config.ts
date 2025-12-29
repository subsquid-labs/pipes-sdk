import {
  EvmTemplateIds,
  SolanaTemplateIds,
  templateOptions,
} from "~/config/templates.js";
import type { NetworkType } from "./network.js";
import { Sink } from "./sink.js";
import { NetworkTemplate } from "~/template/index.js";

export interface Config<N extends NetworkType> {
  projectFolder: string;
  chainType: N;
  network: string; // slug from networks
  templates: NetworkTemplate<N>; // ids from templates
  contractAddresses: string[];
  sink: Sink; // id from sinks
}
