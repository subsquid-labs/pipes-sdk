import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'

// p2tr address derivation needs an ECC backend registered once per process.
bitcoin.initEccLib(ecc)

/** BTC float → satoshi bigint via toFixed(8) string math (gfs @pipeline/btc semantics). */
export function btcToSatoshiBigInt(btc?: number | null): bigint {
  if (btc === null || btc === undefined) return 0n
  if (!Number.isFinite(btc)) throw new Error(`non-finite BTC value: ${btc}`)

  const fixed = btc.toFixed(8)
  const negative = fixed.startsWith('-')
  const [whole, frac] = (negative ? fixed.slice(1) : fixed).split('.')
  const satoshi = BigInt(whole) * 100_000_000n + BigInt(frac)

  return negative ? -satoshi : satoshi
}

/** Unix seconds → JS Date at the first UTC day of that month (timestamp_month columns). */
export function timestampToMonthDate(unixSeconds: number): Date {
  const date = new Date(unixSeconds * 1000)

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export type DecodedScript = {
  type: string | null
  addresses: string[]
  requiredSignatures: number | null
}

const NETWORK = bitcoin.networks.bitcoin

type Attempt = { type: string; build: (output: Buffer) => bitcoin.payments.Payment; sigs: number | null }

const ATTEMPTS: Attempt[] = [
  { type: 'pubkeyhash', build: (output) => bitcoin.payments.p2pkh({ output, network: NETWORK }), sigs: 1 },
  { type: 'scripthash', build: (output) => bitcoin.payments.p2sh({ output, network: NETWORK }), sigs: null },
  { type: 'witness_v0_keyhash', build: (output) => bitcoin.payments.p2wpkh({ output, network: NETWORK }), sigs: 1 },
  {
    type: 'witness_v0_scripthash',
    build: (output) => bitcoin.payments.p2wsh({ output, network: NETWORK }),
    sigs: null,
  },
  { type: 'witness_v1_taproot', build: (output) => bitcoin.payments.p2tr({ output, network: NETWORK }), sigs: 1 },
  { type: 'pubkey', build: (output) => bitcoin.payments.p2pk({ output, network: NETWORK }), sigs: 1 },
  { type: 'multisig', build: (output) => bitcoin.payments.p2ms({ output, network: NETWORK }), sigs: null },
  { type: 'nulldata', build: (output) => bitcoin.payments.embed({ output, network: NETWORK }), sigs: null },
]

/**
 * Classify an output script and extract addresses + required signatures, mainnet only.
 * Mirrors gfs's decodeScript cost profile: sequential payment-parse attempts per script.
 * Never throws — unparseable scripts classify as 'nonstandard'.
 */
export function decodeScript(scriptHex?: string | null): DecodedScript {
  if (!scriptHex) return { type: null, addresses: [], requiredSignatures: null }

  const output = Buffer.from(scriptHex, 'hex')
  if (output.length === 0 || output.toString('hex') !== scriptHex.toLowerCase()) {
    return { type: 'nonstandard', addresses: [], requiredSignatures: null }
  }

  for (const attempt of ATTEMPTS) {
    try {
      const payment = attempt.build(output)

      if (attempt.type === 'multisig') {
        const addresses = (payment.pubkeys ?? []).map((key: Buffer) => key.toString('hex'))

        return { type: 'multisig', addresses, requiredSignatures: payment.m ?? null }
      }
      if (attempt.type === 'nulldata') {
        return { type: 'nulldata', addresses: [], requiredSignatures: null }
      }

      const address = payment.address ?? payment.pubkey?.toString('hex')

      return { type: attempt.type, addresses: address ? [address] : [], requiredSignatures: attempt.sigs }
    } catch {
      // not this script type — try the next
    }
  }

  return { type: 'nonstandard', addresses: [], requiredSignatures: null }
}
