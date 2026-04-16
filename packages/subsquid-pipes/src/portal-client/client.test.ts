import { afterEach, describe, expect, it } from 'vitest'

import { type MockPortal, createMockPortal } from '~/testing/index.js'

import { PortalClient } from './client.js'
import type { Query as EvmQuery } from './query/evm.js'

function getQuery(toBlock: number): EvmQuery<{ block: { number: true; hash: true } }> {
  return {
    type: 'evm',
    fromBlock: 1,
    toBlock,
    fields: {
      block: {
        number: true,
        hash: true,
      },
    },
  }
}

async function collectHeads(query: EvmQuery<{ block: { number: true; hash: true } }>, portalUrl: string) {
  const client = new PortalClient({
    url: portalUrl,
    maxBytes: 1,
  })

  const heads = []

  for await (const batch of client.getStream(query)) {
    heads.push(batch.head.finalized)
  }

  return heads
}

describe('PortalClient', () => {
  let mockPortal: MockPortal | undefined

  afterEach(async () => {
    await mockPortal?.close()
  })

  it('should clamp regressed finalized heads to the stream high-water mark', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
        head: { finalized: { number: 10, hash: '0xA' } },
      },
      {
        statusCode: 200,
        data: [{ header: { number: 2, hash: '0x2' } }],
        head: { finalized: { number: 7, hash: '0xB' } },
      },
      {
        statusCode: 200,
        data: [{ header: { number: 3, hash: '0x3' } }],
        head: { finalized: { number: 12, hash: '0xC' } },
      },
    ])

    await expect(collectHeads(getQuery(3), mockPortal.url)).resolves.toEqual([
      { number: 10, hash: '0xA' },
      { number: 10, hash: '0xA' },
      { number: 12, hash: '0xC' },
    ])
  })

  it('should pass through finalized heads when they increase monotonically', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
        head: { finalized: { number: 5, hash: '0x5' } },
      },
      {
        statusCode: 200,
        data: [{ header: { number: 2, hash: '0x2' } }],
        head: { finalized: { number: 10, hash: '0xA' } },
      },
      {
        statusCode: 200,
        data: [{ header: { number: 3, hash: '0x3' } }],
        head: { finalized: { number: 15, hash: '0xF' } },
      },
    ])

    await expect(collectHeads(getQuery(3), mockPortal.url)).resolves.toEqual([
      { number: 5, hash: '0x5' },
      { number: 10, hash: '0xA' },
      { number: 15, hash: '0xF' },
    ])
  })

  it('should initialize the high-water mark when finalized head first appears', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
      },
      {
        statusCode: 200,
        data: [{ header: { number: 2, hash: '0x2' } }],
        head: { finalized: { number: 10, hash: '0xA' } },
      },
    ])

    await expect(collectHeads(getQuery(2), mockPortal.url)).resolves.toEqual([undefined, { number: 10, hash: '0xA' }])
  })

  it('should clamp regressed finalized heads on 204 responses', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
        head: { finalized: { number: 10, hash: '0xA' } },
      },
      {
        statusCode: 204,
        head: { finalized: { number: 7, hash: '0xB' } },
      },
      {
        statusCode: 200,
        data: [{ header: { number: 2, hash: '0x2' } }],
        head: { finalized: { number: 12, hash: '0xC' } },
      },
    ])

    await expect(collectHeads(getQuery(2), mockPortal.url)).resolves.toEqual([
      { number: 10, hash: '0xA' },
      { number: 10, hash: '0xA' },
      { number: 12, hash: '0xC' },
    ])
  })
})
