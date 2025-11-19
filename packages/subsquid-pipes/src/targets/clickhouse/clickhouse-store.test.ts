import { createClient } from '@clickhouse/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ClickhouseStore } from '~/targets/clickhouse/clickhouse-store.js'

const client = createClient({
  url: process.env['TEST_CLICKHOUSE_URL'] || 'http://localhost:10123',
  username: process.env['TEST_CLICKHOUSE_USERNAME'] || 'default',
  password: process.env['TEST_CLICKHOUSE_PASSWORD'] || 'default',
})

describe('Clickhouse store', () => {
  afterEach(async () => {
    await client.close()
  })

  it('should work with uint128/uint256 ', async () => {
    const store = new ClickhouseStore(client)

    await store.query({ query: `DROP TABLE IF EXISTS big_numbers` })
    await store.query({
      query: `
        CREATE TABLE big_numbers
        (
            id        UInt64,
            date      Date,
            value128  UInt128,
            value256  UInt256,
            sign      Int8   -- 1 = insert, -1 = delete/cancel
        )
        ENGINE = CollapsingMergeTree(sign)
        ORDER BY (id);
    `,
    })

    await store.insert({
      table: 'big_numbers',
      values: [
        {
          id: 1,
          date: '2024-01-01',
          value128: '340282366920938463463374607431768211455', // max UInt128
          value256: '115792089237316195423570985008687907853269984665640564039457584007913129639935', // max UInt256
          sign: 1,
        },
      ],
      format: 'JSONEachRow',
    })

    const res = await store.removeAllRows({
      tables: 'big_numbers',
      where: 'id = {id:UInt64}',
      params: { id: 1 },
    })

    expect(res).toMatchInlineSnapshot(`
      [
        {
          "count": 1,
          "table": "big_numbers",
        },
      ]
    `)

    const select = await store.query({
      query: `SELECT * FROM big_numbers FINAL`,
    })
    const rows = await select.json()
    expect(rows.data).toHaveLength(0)
  })
})
