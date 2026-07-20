import type { BlockRef, PortalBlockPayload, PortalHead, WireResponse } from '../portal-wire.js'

/** A stream request (IB-2) reduced to the fields that select a response. */
export type LedgerRequest = {
  fromBlock: number
  toBlock?: number
  parentBlockHash?: string
}

export type LoggedRequest = LedgerRequest & {
  /** Arrival order, 0-based. */
  seq: number
  /** What the ledger answered with. */
  statusCode: WireResponse['statusCode']
}

/** A transport fault served in place of the derived answer, consumed once (IB-7, FM-10…FM-19). */
export type LedgerFault = {
  statusCode: 429 | 500 | 502 | 503 | 504
  retryAfter?: number | string
}

/**
 * Deliberate wire violations. The portal is trusted for chain integrity (ADR-1), so these exist
 * to prove the SUT's local guards fire rather than to model anything a real portal does.
 */
export type LedgerAdversary = {
  /** Serve this many blocks past `toBlock` (INV-24 over-return). */
  overReturn?: number
  /** Repeat the first block of every 200 response (GAP-29). */
  duplicateBlocks?: boolean
  /** Reverse block order within every 200 response (GAP-29). */
  outOfOrder?: boolean
}

export type ChainLedgerOptions = {
  /** Initial canonical chain, ascending by number. */
  blocks?: PortalBlockPayload[]
  finalized?: BlockRef
  /** Latest head; IB-6 reports its number only. */
  latest?: number
  /** Max blocks per 200 response. Default: every available block in range. */
  batchSize?: number
  /** How many canonical blocks a 409 carries below the fork point (DEF-10). */
  forkWindow?: number
}

/**
 * The chain the simulator holds, and the authority on what any request is answered with.
 *
 * The distinction from a scripted response array is that selection is keyed on the request's
 * anchor (IB-3) rather than on arrival order. An ordinal script has no answer for the re-request
 * a restarted SUT issues from its recovered cursor — it hands out whatever response happens to sit
 * at the next index, so every crash-recovery test has to hand-pad its script and no test can
 * assert what the SUT asked for after coming back. Deriving from the anchor makes the re-request
 * answerable by construction, which is what gates the CT-2 matrix and adversarial histories.
 */
export class ChainLedger {
  #chain: PortalBlockPayload[]
  #finalized: BlockRef | undefined
  #latest: number | undefined
  #batchSize: number
  #forkWindow: number

  #requests: LoggedRequest[] = []
  #faults: LedgerFault[] = []
  #adversary: LedgerAdversary = {}
  /** Every hash the ledger ever held, including branches a fork orphaned. */
  #served = new Map<string, number>()

  constructor(options: ChainLedgerOptions = {}) {
    this.#chain = []
    this.#finalized = options.finalized
    this.#latest = options.latest
    this.#batchSize = options.batchSize ?? Number.POSITIVE_INFINITY
    this.#forkWindow = options.forkWindow ?? 100

    if (options.blocks?.length) {
      this.append(options.blocks)
    }
  }

  /** The canonical chain as currently held, ascending. */
  get chain(): readonly PortalBlockPayload[] {
    return this.#chain
  }

  /** Every request the ledger answered, in arrival order. */
  get requests(): readonly LoggedRequest[] {
    return this.#requests
  }

  get head(): BlockRef | undefined {
    const last = this.#chain.at(-1)

    return last ? { number: last.header.number, hash: last.header.hash } : undefined
  }

  get finalized(): BlockRef | undefined {
    return this.#finalized
  }

  /** Appends blocks to the canonical chain. */
  append(blocks: PortalBlockPayload[]): this {
    for (const block of blocks) {
      this.#chain.push(block)
      this.#served.set(block.header.hash, block.header.number)
    }
    this.#chain.sort((a, b) => a.header.number - b.header.number)

    return this
  }

  /**
   * Reorgs: every block above `at` is replaced by `branch`. The orphaned hashes stay in the served
   * history, so a request anchored on one is answerable — that is exactly the 409 path.
   */
  fork(at: number, branch: PortalBlockPayload[] = []): this {
    this.#chain = this.#chain.filter((b) => b.header.number <= at)

    return this.append(branch)
  }

  /**
   * Sets the reported finalized head. Deliberately not monotonic — a regressing floor is an
   * adversarial input the SUT must clamp (INV-2, INV-12), not something the ledger prevents.
   */
  setFinalized(finalized: BlockRef | undefined): this {
    this.#finalized = finalized

    return this
  }

  setLatest(latest: number | undefined): this {
    this.#latest = latest

    return this
  }

  /** Queues faults served in place of the next answers, one per request (IB-7). */
  injectFaults(...faults: LedgerFault[]): this {
    this.#faults.push(...faults)

    return this
  }

  setAdversary(adversary: LedgerAdversary): this {
    this.#adversary = adversary

    return this
  }

  /** True when the ledger ever held this hash, on the canonical chain or an orphaned branch. */
  hasServed(hash: string): boolean {
    return this.#served.has(hash)
  }

  /** Answers `request` from the held chain and records it. */
  answer(request: LedgerRequest): WireResponse {
    const response = this.#derive(request)
    this.#requests.push({ ...request, seq: this.#requests.length, statusCode: response.statusCode })

    return response
  }

  #derive(request: LedgerRequest): WireResponse {
    const fault = this.#faults.shift()
    if (fault) {
      return fault
    }

    if (this.#isForked(request)) {
      return { statusCode: 409, data: { previousBlocks: this.#canonicalWindow(request.fromBlock) } }
    }

    const to = request.toBlock ?? Number.POSITIVE_INFINITY
    if (request.fromBlock > to) {
      // Range exhausted: 200 with an empty body means "no data upstream", not "at head" (IB-5).
      return { statusCode: 200, data: [], head: this.#head() }
    }

    const inRange = this.#chain.filter((b) => b.header.number >= request.fromBlock && b.header.number <= to)
    let blocks = inRange.slice(0, this.#batchSize)

    if (this.#adversary.overReturn) {
      blocks = [...blocks, ...this.#chain.filter((b) => b.header.number > to).slice(0, this.#adversary.overReturn)]
    }
    if (!blocks.length) {
      return { statusCode: 204, head: this.#head() }
    }

    if (this.#adversary.duplicateBlocks) {
      blocks = [blocks[0], ...blocks]
    }
    if (this.#adversary.outOfOrder) {
      blocks = [...blocks].reverse()
    }

    return { statusCode: 200, data: blocks, head: this.#head() }
  }

  /**
   * The anchor names the block the SUT believes precedes `fromBlock` (IB-3). It is a fork exactly
   * when the canonical chain disagrees at that number.
   */
  #isForked(request: LedgerRequest): boolean {
    if (request.parentBlockHash === undefined) {
      return false
    }

    const anchorNumber = request.fromBlock - 1
    const first = this.#chain[0]
    if (!first || anchorNumber < first.header.number) {
      // Below what the ledger holds — nothing to contradict the anchor with.
      return false
    }

    const anchor = this.#chain.find((b) => b.header.number === anchorNumber)

    return !anchor || anchor.header.hash !== request.parentBlockHash
  }

  /** The canonical ancestry a 409 carries: ascending, ending at the anchor's number (DEF-10). */
  #canonicalWindow(fromBlock: number): BlockRef[] {
    return this.#chain
      .filter((b) => b.header.number <= fromBlock - 1)
      .slice(-this.#forkWindow)
      .map((b) => ({ number: b.header.number, hash: b.header.hash }))
  }

  #head(): PortalHead | undefined {
    const head: PortalHead = {}
    if (this.#finalized) {
      head.finalized = this.#finalized
    }
    if (this.#latest != null) {
      head.latest = { number: this.#latest }
    }

    return head.finalized || head.latest ? head : undefined
  }
}

/** Builds a linear chain of empty blocks over `[from, to]`. */
export function buildChain({
  from,
  to,
  hash = (n) => `0x${n}`,
  timestamp = (n) => n * 1000,
}: {
  from: number
  to: number
  hash?: (n: number) => string
  timestamp?: (n: number) => number
}): PortalBlockPayload[] {
  const blocks: PortalBlockPayload[] = []
  for (let n = from; n <= to; n++) {
    blocks.push({ header: { number: n, hash: hash(n), timestamp: timestamp(n) } })
  }

  return blocks
}
