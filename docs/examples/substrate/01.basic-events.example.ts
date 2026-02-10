import { substratePortalSource } from '@subsquid/pipes/substrate'
import { SubstrateQueryBuilder } from '@subsquid/pipes/substrate'

// Example: Index Balances.Transfer events from a Substrate chain
async function main() {
  const stream = substratePortalSource({
    portal: 'https://portal.sqd.dev/datasets/bittensor',
    query: new SubstrateQueryBuilder()
      .addFields({
        block: { number: true, hash: true, timestamp: true },
        event: { name: true, args: true, extrinsicIndex: true },
      })
      .addEvent({
        range: { from: 0, to: 1000 },
        request: { name: ['Balances.Transfer'] },
      }),
  })

  for await (const { data, ctx } of stream) {
    for (const block of data.blocks) {
      console.log(`Block ${block.header.number}`)
      
      for (const event of block.events) {
        console.log(`  Event: ${event.name}`)
        console.log(`  Args:`, event.args)
      }
    }
  }
}

// Uncomment to run:
void main()
