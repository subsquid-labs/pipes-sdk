import { PipeOutputType, Transformer, createDecoder, createTransformer } from '@subsquid/pipes'
import { EvmDecoder, EvmFieldSelection, EvmPortalData, evmPortalSource } from '@subsquid/pipes/evm'

const fields = {
  block: { timestamp: true },
  log: { address: true },
} satisfies EvmFieldSelection

//FIXME STREAMS check if we can automatically inherit EvmPortalData<typeof fields>
function myDecoder(): EvmDecoder<EvmPortalData<typeof fields>, { block_number: number }[]> {
  return createDecoder({
    query: ({ queryBuilder }) => {
      queryBuilder.addFields(fields)
    },
    transform: (data) => {
      return data.map((d) => {
        return {
          block_number: d.header.timestamp,
        }
      })
    },
  })
}

function myDecoderTransformation(): Transformer<PipeOutputType<typeof myDecoder>, { block_number_renamed: number }[]> {
  return createTransformer({
    transform: (data) => {
      return data.map((d) => {
        return {
          block_number_renamed: d.block_number,
        }
      })
    },
  })
}

type Final = PipeOutputType<typeof myDecoderTransformation>

async function cli() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    // logger: 'debug',
    streams: {
      v1: myDecoder().pipe(myDecoderTransformation()),
    },
  })

  for await (const { data } of stream) {
    console.log(data.v1.map((d) => d.block_number_renamed))
  }
}

void cli()
