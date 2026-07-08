export * from './abi/common.js'
export * from './evm-decoder.js'
// The RPC-fallback EVM source. The RPC stack is loaded lazily (dynamic import) the first time an
// `rpc` source is read, so a Portal-only consumer never pulls the optional evm-rpc / evm-normalization
// peers *at runtime*. Note the exported RPC-config *types* (e.g. `EvmFallbackSourceConfig`'s
// `rpc: Rpc`) do reference @subsquid/evm-rpc and are preserved in the emitted .d.ts, so a TS consumer
// that references those types needs the peer installed for typechecking; Portal-only usage that never
// touches them does not. (A separate subpath could fully TS-decouple them if that becomes a goal.)
export * from './evm-fallback.js'
export * from './evm-portal-source.js'
export * from './evm-query-builder.js'
export * from './evm-rpc-latency-watcher.js'
export * from './factory.js'
