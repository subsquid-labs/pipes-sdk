import { Transformer, createDecoder, createTransformer, output } from '@subsquid/pipes'
import { EvmDecoder, EvmFieldSelection, EvmPortalData, evmPortalSource } from '@subsquid/pipes/evm'

const fields = {
  block: { timestamp: true },
  log: { address: true, transactionHash: true },
} as const satisfies EvmFieldSelection

//FIXME STREAMS check if we can automatically inherit EvmPortalData<typeof fields>
function myDecoder(): EvmDecoder<EvmPortalData<typeof fields>, { block_number: number }[]> {
  return createDecoder({
    query: ({ queryBuilder }) => {
      queryBuilder.addFields(fields)
      queryBuilder.addFields({
        block: { stateRoot: true, number: true },
        log: { address: true },
        transaction: {
          hash: true,
          sighash: false,
        },
      })
    },
    transform: (data) => {
      return data.map((d) => {
        return {
          block_number: d.header.timestamp,
          d,
        }
      })
    },
  })
}

type MyDecoderOut = output<typeof myDecoder>

function myTransformation(): Transformer<MyDecoderOut, { block_number_renamed: number }[]> {
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

type MyTransformationOut = output<typeof myTransformation> // { block_number_renamed: number }[]

const streams = {
  v1: myDecoder(),
  v2: myDecoder().pipe(myTransformation()),
}

type FullOutputs = output<typeof streams> // { v1: V1, v2: V2 }

function wholePipeTransform(): Transformer<FullOutputs, FullOutputs> {
  return createTransformer({
    transform: (data) => data,
  })
}

async function cli() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    streams,
  }).pipe(wholePipeTransform())

  for await (const { data } of stream) {
    console.log(data.v1.map((d) => d.block_number))
    console.log(data.v2.map((d) => d.block_number_renamed))
  }
}

void cli()
