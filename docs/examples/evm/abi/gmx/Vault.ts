import * as p from '@subsquid/evm-codec'
import { event, fun, viewFun, indexed, ContractBase } from '@subsquid/evm-abi'
import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'

export const events = {
    BuyUSDG: event("0xab4c77c74cd32c85f35416cf03e7ce9e2d4387f7b7f2c1f4bf53daaecf8ea72d", "BuyUSDG(address,address,uint256,uint256,uint256)", {"account": p.address, "token": p.address, "tokenAmount": p.uint256, "usdgAmount": p.uint256, "feeBasisPoints": p.uint256}),
    ClosePosition: event("0x73af1d417d82c240fdb6d319b34ad884487c6bf2845d98980cc52ad9171cb455", "ClosePosition(bytes32,uint256,uint256,uint256,uint256,uint256,int256)", {"key": p.bytes32, "size": p.uint256, "collateral": p.uint256, "averagePrice": p.uint256, "entryFundingRate": p.uint256, "reserveAmount": p.uint256, "realisedPnl": p.int256}),
    CollectMarginFees: event("0x5d0c0019d3d45fadeb74eff9d2c9924d146d000ac6bcf3c28bf0ac3c9baa011a", "CollectMarginFees(address,uint256,uint256)", {"token": p.address, "feeUsd": p.uint256, "feeTokens": p.uint256}),
    CollectSwapFees: event("0x47cd9dda0e50ce30bcaaacd0488452b596221c07ac402a581cfae4d3933cac2b", "CollectSwapFees(address,uint256,uint256)", {"token": p.address, "feeUsd": p.uint256, "feeTokens": p.uint256}),
    DecreaseGuaranteedUsd: event("0x34e07158b9db50df5613e591c44ea2ebc82834eff4a4dc3a46e000e608261d68", "DecreaseGuaranteedUsd(address,uint256)", {"token": p.address, "amount": p.uint256}),
    DecreasePoolAmount: event("0x112726233fbeaeed0f5b1dba5cb0b2b81883dee49fb35ff99fd98ed9f6d31eb0", "DecreasePoolAmount(address,uint256)", {"token": p.address, "amount": p.uint256}),
    DecreasePosition: event("0x93d75d64d1f84fc6f430a64fc578bdd4c1e090e90ea2d51773e626d19de56d30", "DecreasePosition(bytes32,address,address,address,uint256,uint256,bool,uint256,uint256)", {"key": p.bytes32, "account": p.address, "collateralToken": p.address, "indexToken": p.address, "collateralDelta": p.uint256, "sizeDelta": p.uint256, "isLong": p.bool, "price": p.uint256, "fee": p.uint256}),
    DecreaseReservedAmount: event("0x533cb5ed32be6a90284e96b5747a1bfc2d38fdb5768a6b5f67ff7d62144ed67b", "DecreaseReservedAmount(address,uint256)", {"token": p.address, "amount": p.uint256}),
    DecreaseUsdgAmount: event("0xe1e812596aac93a06ecc4ca627014d18e30f5c33b825160cc9d5c0ba61e45227", "DecreaseUsdgAmount(address,uint256)", {"token": p.address, "amount": p.uint256}),
    DirectPoolDeposit: event("0xa5a389190ebf6170a133bda5c769b77f4d6715b8aa172ec0ddf8473d0b4944bd", "DirectPoolDeposit(address,uint256)", {"token": p.address, "amount": p.uint256}),
    IncreaseGuaranteedUsd: event("0xd9d4761f75e0d0103b5cbeab941eeb443d7a56a35b5baf2a0787c03f03f4e474", "IncreaseGuaranteedUsd(address,uint256)", {"token": p.address, "amount": p.uint256}),
    IncreasePoolAmount: event("0x976177fbe09a15e5e43f848844963a42b41ef919ef17ff21a17a5421de8f4737", "IncreasePoolAmount(address,uint256)", {"token": p.address, "amount": p.uint256}),
    IncreasePosition: event("0x2fe68525253654c21998f35787a8d0f361905ef647c854092430ab65f2f15022", "IncreasePosition(bytes32,address,address,address,uint256,uint256,bool,uint256,uint256)", {"key": p.bytes32, "account": p.address, "collateralToken": p.address, "indexToken": p.address, "collateralDelta": p.uint256, "sizeDelta": p.uint256, "isLong": p.bool, "price": p.uint256, "fee": p.uint256}),
    IncreaseReservedAmount: event("0xaa5649d82f5462be9d19b0f2b31a59b2259950a6076550bac9f3a1c07db9f66d", "IncreaseReservedAmount(address,uint256)", {"token": p.address, "amount": p.uint256}),
    IncreaseUsdgAmount: event("0x64243679a443432e2293343b77d411ff6144370404618f00ca0d2025d9ca9882", "IncreaseUsdgAmount(address,uint256)", {"token": p.address, "amount": p.uint256}),
    LiquidatePosition: event("0x2e1f85a64a2f22cf2f0c42584e7c919ed4abe8d53675cff0f62bf1e95a1c676f", "LiquidatePosition(bytes32,address,address,address,bool,uint256,uint256,uint256,int256,uint256)", {"key": p.bytes32, "account": p.address, "collateralToken": p.address, "indexToken": p.address, "isLong": p.bool, "size": p.uint256, "collateral": p.uint256, "reserveAmount": p.uint256, "realisedPnl": p.int256, "markPrice": p.uint256}),
    SellUSDG: event("0xd732b7828fa6cee72c285eac756fc66a7477e3dc22e22e7c432f1c265d40b483", "SellUSDG(address,address,uint256,uint256,uint256)", {"account": p.address, "token": p.address, "usdgAmount": p.uint256, "tokenAmount": p.uint256, "feeBasisPoints": p.uint256}),
    Swap: event("0x0874b2d545cb271cdbda4e093020c452328b24af12382ed62c4d00f5c26709db", "Swap(address,address,address,uint256,uint256,uint256,uint256)", {"account": p.address, "tokenIn": p.address, "tokenOut": p.address, "amountIn": p.uint256, "amountOut": p.uint256, "amountOutAfterFees": p.uint256, "feeBasisPoints": p.uint256}),
    UpdateFundingRate: event("0xa146fc154e1913322e9817d49f0d5c37466c24326e15de10e739a948be815eab", "UpdateFundingRate(address,uint256)", {"token": p.address, "fundingRate": p.uint256}),
    UpdatePnl: event("0x3ff41bdde87755b687ae83d0221a232b6be51a803330ed9661c1b5d0105e0d8a", "UpdatePnl(bytes32,bool,uint256)", {"key": p.bytes32, "hasProfit": p.bool, "delta": p.uint256}),
    UpdatePosition: event("0x25e8a331a7394a9f09862048843323b00bdbada258f524f5ce624a45bf00aabb", "UpdatePosition(bytes32,uint256,uint256,uint256,uint256,uint256,int256)", {"key": p.bytes32, "size": p.uint256, "collateral": p.uint256, "averagePrice": p.uint256, "entryFundingRate": p.uint256, "reserveAmount": p.uint256, "realisedPnl": p.int256}),
}

export const functions = {
    BASIS_POINTS_DIVISOR: viewFun("0x126082cf", "BASIS_POINTS_DIVISOR()", {}, p.uint256),
    FUNDING_RATE_PRECISION: viewFun("0x6be6026b", "FUNDING_RATE_PRECISION()", {}, p.uint256),
    MAX_FEE_BASIS_POINTS: viewFun("0x4befe2ca", "MAX_FEE_BASIS_POINTS()", {}, p.uint256),
    MAX_FUNDING_RATE_FACTOR: viewFun("0x8a39735a", "MAX_FUNDING_RATE_FACTOR()", {}, p.uint256),
    MAX_LIQUIDATION_FEE_USD: viewFun("0x07c58752", "MAX_LIQUIDATION_FEE_USD()", {}, p.uint256),
    MIN_FUNDING_RATE_INTERVAL: viewFun("0xfce28c10", "MIN_FUNDING_RATE_INTERVAL()", {}, p.uint256),
    MIN_LEVERAGE: viewFun("0x34c1557d", "MIN_LEVERAGE()", {}, p.uint256),
    PRICE_PRECISION: viewFun("0x95082d25", "PRICE_PRECISION()", {}, p.uint256),
    USDG_DECIMALS: viewFun("0x870d917c", "USDG_DECIMALS()", {}, p.uint256),
    addRouter: fun("0x24ca984e", "addRouter(address)", {"_router": p.address}, ),
    adjustForDecimals: viewFun("0x42152873", "adjustForDecimals(uint256,address,address)", {"_amount": p.uint256, "_tokenDiv": p.address, "_tokenMul": p.address}, p.uint256),
    allWhitelistedTokens: viewFun("0xe468baf0", "allWhitelistedTokens(uint256)", {"_0": p.uint256}, p.address),
    allWhitelistedTokensLength: viewFun("0x0842b076", "allWhitelistedTokensLength()", {}, p.uint256),
    approvedRouters: viewFun("0x60922199", "approvedRouters(address,address)", {"_0": p.address, "_1": p.address}, p.bool),
    bufferAmounts: viewFun("0x4a993ee9", "bufferAmounts(address)", {"_0": p.address}, p.uint256),
    buyUSDG: fun("0x817bb857", "buyUSDG(address,address)", {"_token": p.address, "_receiver": p.address}, p.uint256),
    clearTokenConfig: fun("0xe67f59a7", "clearTokenConfig(address)", {"_token": p.address}, ),
    cumulativeFundingRates: viewFun("0xc65bc7b1", "cumulativeFundingRates(address)", {"_0": p.address}, p.uint256),
    decreasePosition: fun("0x82a08490", "decreasePosition(address,address,address,uint256,uint256,bool,address)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_collateralDelta": p.uint256, "_sizeDelta": p.uint256, "_isLong": p.bool, "_receiver": p.address}, p.uint256),
    directPoolDeposit: fun("0x5f7bc119", "directPoolDeposit(address)", {"_token": p.address}, ),
    errorController: viewFun("0x48f35cbb", "errorController()", {}, p.address),
    errors: viewFun("0xfed1a606", "errors(uint256)", {"_0": p.uint256}, p.string),
    feeReserves: viewFun("0x1ce9cb8f", "feeReserves(address)", {"_0": p.address}, p.uint256),
    fundingInterval: viewFun("0x9849e412", "fundingInterval()", {}, p.uint256),
    fundingRateFactor: viewFun("0xc4f718bf", "fundingRateFactor()", {}, p.uint256),
    getDelta: viewFun("0x5c07eaab", "getDelta(address,uint256,uint256,bool,uint256)", {"_indexToken": p.address, "_size": p.uint256, "_averagePrice": p.uint256, "_isLong": p.bool, "_lastIncreasedTime": p.uint256}, {"_0": p.bool, "_1": p.uint256}),
    getFeeBasisPoints: viewFun("0xc7e074c3", "getFeeBasisPoints(address,uint256,uint256,uint256,bool)", {"_token": p.address, "_usdgDelta": p.uint256, "_feeBasisPoints": p.uint256, "_taxBasisPoints": p.uint256, "_increment": p.bool}, p.uint256),
    getFundingFee: viewFun("0xcc5b8144", "getFundingFee(address,uint256,uint256)", {"_token": p.address, "_size": p.uint256, "_entryFundingRate": p.uint256}, p.uint256),
    getGlobalShortDelta: viewFun("0xb364accb", "getGlobalShortDelta(address)", {"_token": p.address}, {"_0": p.bool, "_1": p.uint256}),
    getMaxPrice: viewFun("0xe124e6d2", "getMaxPrice(address)", {"_token": p.address}, p.uint256),
    getMinPrice: viewFun("0x81a612d6", "getMinPrice(address)", {"_token": p.address}, p.uint256),
    getNextAveragePrice: viewFun("0xdb97495f", "getNextAveragePrice(address,uint256,uint256,bool,uint256,uint256,uint256)", {"_indexToken": p.address, "_size": p.uint256, "_averagePrice": p.uint256, "_isLong": p.bool, "_nextPrice": p.uint256, "_sizeDelta": p.uint256, "_lastIncreasedTime": p.uint256}, p.uint256),
    getNextFundingRate: viewFun("0xa93acac2", "getNextFundingRate(address)", {"_token": p.address}, p.uint256),
    getNextGlobalShortAveragePrice: viewFun("0x9d7432ca", "getNextGlobalShortAveragePrice(address,uint256,uint256)", {"_indexToken": p.address, "_nextPrice": p.uint256, "_sizeDelta": p.uint256}, p.uint256),
    getPosition: viewFun("0x4a3f088d", "getPosition(address,address,address,bool)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_isLong": p.bool}, {"_0": p.uint256, "_1": p.uint256, "_2": p.uint256, "_3": p.uint256, "_4": p.uint256, "_5": p.uint256, "_6": p.bool, "_7": p.uint256}),
    getPositionDelta: viewFun("0x45a6f370", "getPositionDelta(address,address,address,bool)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_isLong": p.bool}, {"_0": p.bool, "_1": p.uint256}),
    getPositionFee: viewFun("0x17bbf25c", "getPositionFee(uint256)", {"_sizeDelta": p.uint256}, p.uint256),
    getPositionKey: viewFun("0x2d4b0576", "getPositionKey(address,address,address,bool)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_isLong": p.bool}, p.bytes32),
    getPositionLeverage: viewFun("0x51723e82", "getPositionLeverage(address,address,address,bool)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_isLong": p.bool}, p.uint256),
    getRedemptionAmount: viewFun("0x2c668ec1", "getRedemptionAmount(address,uint256)", {"_token": p.address, "_usdgAmount": p.uint256}, p.uint256),
    getRedemptionCollateral: viewFun("0xb136ca49", "getRedemptionCollateral(address)", {"_token": p.address}, p.uint256),
    getRedemptionCollateralUsd: viewFun("0x29ff9615", "getRedemptionCollateralUsd(address)", {"_token": p.address}, p.uint256),
    getTargetUsdgAmount: viewFun("0x3a05dcc1", "getTargetUsdgAmount(address)", {"_token": p.address}, p.uint256),
    getUtilisation: viewFun("0x04fef1db", "getUtilisation(address)", {"_token": p.address}, p.uint256),
    globalShortAveragePrices: viewFun("0x62749803", "globalShortAveragePrices(address)", {"_0": p.address}, p.uint256),
    globalShortSizes: viewFun("0x8a78daa8", "globalShortSizes(address)", {"_0": p.address}, p.uint256),
    gov: viewFun("0x12d43a51", "gov()", {}, p.address),
    guaranteedUsd: viewFun("0xf07456ce", "guaranteedUsd(address)", {"_0": p.address}, p.uint256),
    hasDynamicFees: viewFun("0x9f392eb3", "hasDynamicFees()", {}, p.bool),
    inManagerMode: viewFun("0x9060b1ca", "inManagerMode()", {}, p.bool),
    inPrivateLiquidationMode: viewFun("0x181e210e", "inPrivateLiquidationMode()", {}, p.bool),
    includeAmmPrice: viewFun("0xab08c1c6", "includeAmmPrice()", {}, p.bool),
    increasePosition: fun("0x48d91abf", "increasePosition(address,address,address,uint256,bool)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_sizeDelta": p.uint256, "_isLong": p.bool}, ),
    initialize: fun("0x728cdbca", "initialize(address,address,address,uint256,uint256,uint256)", {"_router": p.address, "_usdg": p.address, "_priceFeed": p.address, "_liquidationFeeUsd": p.uint256, "_fundingRateFactor": p.uint256, "_stableFundingRateFactor": p.uint256}, ),
    isInitialized: viewFun("0x392e53cd", "isInitialized()", {}, p.bool),
    isLeverageEnabled: viewFun("0x3e72a262", "isLeverageEnabled()", {}, p.bool),
    isLiquidator: viewFun("0x529a356f", "isLiquidator(address)", {"_0": p.address}, p.bool),
    isManager: viewFun("0xf3ae2415", "isManager(address)", {"_0": p.address}, p.bool),
    isSwapEnabled: viewFun("0x351a964d", "isSwapEnabled()", {}, p.bool),
    lastFundingTimes: viewFun("0xd8f897c3", "lastFundingTimes(address)", {"_0": p.address}, p.uint256),
    liquidatePosition: fun("0xde2ea948", "liquidatePosition(address,address,address,bool,address)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_isLong": p.bool, "_feeReceiver": p.address}, ),
    liquidationFeeUsd: viewFun("0x174d2694", "liquidationFeeUsd()", {}, p.uint256),
    marginFeeBasisPoints: viewFun("0x318bc689", "marginFeeBasisPoints()", {}, p.uint256),
    maxGasPrice: viewFun("0x3de39c11", "maxGasPrice()", {}, p.uint256),
    maxLeverage: viewFun("0xae3302c2", "maxLeverage()", {}, p.uint256),
    maxUsdgAmounts: viewFun("0xad1e4f8d", "maxUsdgAmounts(address)", {"_0": p.address}, p.uint256),
    minProfitBasisPoints: viewFun("0x88b1fbdf", "minProfitBasisPoints(address)", {"_0": p.address}, p.uint256),
    minProfitTime: viewFun("0xd9ac4225", "minProfitTime()", {}, p.uint256),
    mintBurnFeeBasisPoints: viewFun("0x4d47b304", "mintBurnFeeBasisPoints()", {}, p.uint256),
    poolAmounts: viewFun("0x52f55eed", "poolAmounts(address)", {"_0": p.address}, p.uint256),
    positions: viewFun("0x514ea4bf", "positions(bytes32)", {"_0": p.bytes32}, {"size": p.uint256, "collateral": p.uint256, "averagePrice": p.uint256, "entryFundingRate": p.uint256, "reserveAmount": p.uint256, "realisedPnl": p.int256, "lastIncreasedTime": p.uint256}),
    priceFeed: viewFun("0x741bef1a", "priceFeed()", {}, p.address),
    removeRouter: fun("0x6ae0b154", "removeRouter(address)", {"_router": p.address}, ),
    reservedAmounts: viewFun("0xc3c7b9e9", "reservedAmounts(address)", {"_0": p.address}, p.uint256),
    router: viewFun("0xf887ea40", "router()", {}, p.address),
    sellUSDG: fun("0x711e6190", "sellUSDG(address,address)", {"_token": p.address, "_receiver": p.address}, p.uint256),
    setBufferAmount: fun("0x8585f4d2", "setBufferAmount(address,uint256)", {"_token": p.address, "_amount": p.uint256}, ),
    setError: fun("0x28e67be5", "setError(uint256,string)", {"_errorCode": p.uint256, "_error": p.string}, ),
    setErrorController: fun("0x8f7b8404", "setErrorController(address)", {"_errorController": p.address}, ),
    setFees: fun("0x40eb3802", "setFees(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)", {"_taxBasisPoints": p.uint256, "_stableTaxBasisPoints": p.uint256, "_mintBurnFeeBasisPoints": p.uint256, "_swapFeeBasisPoints": p.uint256, "_stableSwapFeeBasisPoints": p.uint256, "_marginFeeBasisPoints": p.uint256, "_liquidationFeeUsd": p.uint256, "_minProfitTime": p.uint256, "_hasDynamicFees": p.bool}, ),
    setFundingRate: fun("0x8a27d468", "setFundingRate(uint256,uint256,uint256)", {"_fundingInterval": p.uint256, "_fundingRateFactor": p.uint256, "_stableFundingRateFactor": p.uint256}, ),
    setGov: fun("0xcfad57a2", "setGov(address)", {"_gov": p.address}, ),
    setInManagerMode: fun("0x24b0c04d", "setInManagerMode(bool)", {"_inManagerMode": p.bool}, ),
    setInPrivateLiquidationMode: fun("0xf07bbf77", "setInPrivateLiquidationMode(bool)", {"_inPrivateLiquidationMode": p.bool}, ),
    setIsLeverageEnabled: fun("0x7c2eb9f7", "setIsLeverageEnabled(bool)", {"_isLeverageEnabled": p.bool}, ),
    setIsSwapEnabled: fun("0x30455ede", "setIsSwapEnabled(bool)", {"_isSwapEnabled": p.bool}, ),
    setLiquidator: fun("0x4453a374", "setLiquidator(address,bool)", {"_liquidator": p.address, "_isActive": p.bool}, ),
    setManager: fun("0xa5e90eee", "setManager(address,bool)", {"_manager": p.address, "_isManager": p.bool}, ),
    setMaxGasPrice: fun("0xd2fa635e", "setMaxGasPrice(uint256)", {"_maxGasPrice": p.uint256}, ),
    setMaxLeverage: fun("0xd3127e63", "setMaxLeverage(uint256)", {"_maxLeverage": p.uint256}, ),
    setPriceFeed: fun("0x724e78da", "setPriceFeed(address)", {"_priceFeed": p.address}, ),
    setTokenConfig: fun("0x3c5a6e35", "setTokenConfig(address,uint256,uint256,uint256,uint256,bool,bool)", {"_token": p.address, "_tokenDecimals": p.uint256, "_tokenWeight": p.uint256, "_minProfitBps": p.uint256, "_maxUsdgAmount": p.uint256, "_isStable": p.bool, "_isShortable": p.bool}, ),
    setUsdgAmount: fun("0xd66b000d", "setUsdgAmount(address,uint256)", {"_token": p.address, "_amount": p.uint256}, ),
    shortableTokens: viewFun("0xdb3555fb", "shortableTokens(address)", {"_0": p.address}, p.bool),
    stableFundingRateFactor: viewFun("0x134ca63b", "stableFundingRateFactor()", {}, p.uint256),
    stableSwapFeeBasisPoints: viewFun("0xdf73a267", "stableSwapFeeBasisPoints()", {}, p.uint256),
    stableTaxBasisPoints: viewFun("0x10eb56c2", "stableTaxBasisPoints()", {}, p.uint256),
    stableTokens: viewFun("0x42b60b03", "stableTokens(address)", {"_0": p.address}, p.bool),
    swap: fun("0x93316212", "swap(address,address,address)", {"_tokenIn": p.address, "_tokenOut": p.address, "_receiver": p.address}, p.uint256),
    swapFeeBasisPoints: viewFun("0xa22f2392", "swapFeeBasisPoints()", {}, p.uint256),
    taxBasisPoints: viewFun("0x7a210a2b", "taxBasisPoints()", {}, p.uint256),
    tokenBalances: viewFun("0x523fba7f", "tokenBalances(address)", {"_0": p.address}, p.uint256),
    tokenDecimals: viewFun("0x8ee573ac", "tokenDecimals(address)", {"_0": p.address}, p.uint256),
    tokenToUsdMin: viewFun("0x0a48d5a9", "tokenToUsdMin(address,uint256)", {"_token": p.address, "_tokenAmount": p.uint256}, p.uint256),
    tokenWeights: viewFun("0xab2f3ad4", "tokenWeights(address)", {"_0": p.address}, p.uint256),
    totalTokenWeights: viewFun("0xdc8f5fac", "totalTokenWeights()", {}, p.uint256),
    updateCumulativeFundingRate: fun("0x13f1e736", "updateCumulativeFundingRate(address)", {"_token": p.address}, ),
    upgradeVault: fun("0xcea0c328", "upgradeVault(address,address,uint256)", {"_newVault": p.address, "_token": p.address, "_amount": p.uint256}, ),
    usdToToken: viewFun("0xfa12dbc0", "usdToToken(address,uint256,uint256)", {"_token": p.address, "_usdAmount": p.uint256, "_price": p.uint256}, p.uint256),
    usdToTokenMax: viewFun("0xa42ab3d2", "usdToTokenMax(address,uint256)", {"_token": p.address, "_usdAmount": p.uint256}, p.uint256),
    usdToTokenMin: viewFun("0x9899cd02", "usdToTokenMin(address,uint256)", {"_token": p.address, "_usdAmount": p.uint256}, p.uint256),
    usdg: viewFun("0xf5b91b7b", "usdg()", {}, p.address),
    usdgAmounts: viewFun("0x1aa4ace5", "usdgAmounts(address)", {"_0": p.address}, p.uint256),
    useSwapPricing: viewFun("0xb06423f3", "useSwapPricing()", {}, p.bool),
    validateLiquidation: viewFun("0xd54d5a9f", "validateLiquidation(address,address,address,bool,bool)", {"_account": p.address, "_collateralToken": p.address, "_indexToken": p.address, "_isLong": p.bool, "_raise": p.bool}, {"_0": p.uint256, "_1": p.uint256}),
    whitelistedTokenCount: viewFun("0x62287a32", "whitelistedTokenCount()", {}, p.uint256),
    whitelistedTokens: viewFun("0xdaf9c210", "whitelistedTokens(address)", {"_0": p.address}, p.bool),
    withdrawFees: fun("0xf2555278", "withdrawFees(address,address)", {"_token": p.address, "_receiver": p.address}, p.uint256),
}

export class Contract extends ContractBase {

    BASIS_POINTS_DIVISOR() {
        return this.eth_call(functions.BASIS_POINTS_DIVISOR, {})
    }

    FUNDING_RATE_PRECISION() {
        return this.eth_call(functions.FUNDING_RATE_PRECISION, {})
    }

    MAX_FEE_BASIS_POINTS() {
        return this.eth_call(functions.MAX_FEE_BASIS_POINTS, {})
    }

    MAX_FUNDING_RATE_FACTOR() {
        return this.eth_call(functions.MAX_FUNDING_RATE_FACTOR, {})
    }

    MAX_LIQUIDATION_FEE_USD() {
        return this.eth_call(functions.MAX_LIQUIDATION_FEE_USD, {})
    }

    MIN_FUNDING_RATE_INTERVAL() {
        return this.eth_call(functions.MIN_FUNDING_RATE_INTERVAL, {})
    }

    MIN_LEVERAGE() {
        return this.eth_call(functions.MIN_LEVERAGE, {})
    }

    PRICE_PRECISION() {
        return this.eth_call(functions.PRICE_PRECISION, {})
    }

    USDG_DECIMALS() {
        return this.eth_call(functions.USDG_DECIMALS, {})
    }

    adjustForDecimals(_amount: AdjustForDecimalsParams["_amount"], _tokenDiv: AdjustForDecimalsParams["_tokenDiv"], _tokenMul: AdjustForDecimalsParams["_tokenMul"]) {
        return this.eth_call(functions.adjustForDecimals, {_amount, _tokenDiv, _tokenMul})
    }

    allWhitelistedTokens(_0: AllWhitelistedTokensParams["_0"]) {
        return this.eth_call(functions.allWhitelistedTokens, {_0})
    }

    allWhitelistedTokensLength() {
        return this.eth_call(functions.allWhitelistedTokensLength, {})
    }

    approvedRouters(_0: ApprovedRoutersParams["_0"], _1: ApprovedRoutersParams["_1"]) {
        return this.eth_call(functions.approvedRouters, {_0, _1})
    }

    bufferAmounts(_0: BufferAmountsParams["_0"]) {
        return this.eth_call(functions.bufferAmounts, {_0})
    }

    cumulativeFundingRates(_0: CumulativeFundingRatesParams["_0"]) {
        return this.eth_call(functions.cumulativeFundingRates, {_0})
    }

    errorController() {
        return this.eth_call(functions.errorController, {})
    }

    errors(_0: ErrorsParams["_0"]) {
        return this.eth_call(functions.errors, {_0})
    }

    feeReserves(_0: FeeReservesParams["_0"]) {
        return this.eth_call(functions.feeReserves, {_0})
    }

    fundingInterval() {
        return this.eth_call(functions.fundingInterval, {})
    }

    fundingRateFactor() {
        return this.eth_call(functions.fundingRateFactor, {})
    }

    getDelta(_indexToken: GetDeltaParams["_indexToken"], _size: GetDeltaParams["_size"], _averagePrice: GetDeltaParams["_averagePrice"], _isLong: GetDeltaParams["_isLong"], _lastIncreasedTime: GetDeltaParams["_lastIncreasedTime"]) {
        return this.eth_call(functions.getDelta, {_indexToken, _size, _averagePrice, _isLong, _lastIncreasedTime})
    }

    getFeeBasisPoints(_token: GetFeeBasisPointsParams["_token"], _usdgDelta: GetFeeBasisPointsParams["_usdgDelta"], _feeBasisPoints: GetFeeBasisPointsParams["_feeBasisPoints"], _taxBasisPoints: GetFeeBasisPointsParams["_taxBasisPoints"], _increment: GetFeeBasisPointsParams["_increment"]) {
        return this.eth_call(functions.getFeeBasisPoints, {_token, _usdgDelta, _feeBasisPoints, _taxBasisPoints, _increment})
    }

    getFundingFee(_token: GetFundingFeeParams["_token"], _size: GetFundingFeeParams["_size"], _entryFundingRate: GetFundingFeeParams["_entryFundingRate"]) {
        return this.eth_call(functions.getFundingFee, {_token, _size, _entryFundingRate})
    }

    getGlobalShortDelta(_token: GetGlobalShortDeltaParams["_token"]) {
        return this.eth_call(functions.getGlobalShortDelta, {_token})
    }

    getMaxPrice(_token: GetMaxPriceParams["_token"]) {
        return this.eth_call(functions.getMaxPrice, {_token})
    }

    getMinPrice(_token: GetMinPriceParams["_token"]) {
        return this.eth_call(functions.getMinPrice, {_token})
    }

    getNextAveragePrice(_indexToken: GetNextAveragePriceParams["_indexToken"], _size: GetNextAveragePriceParams["_size"], _averagePrice: GetNextAveragePriceParams["_averagePrice"], _isLong: GetNextAveragePriceParams["_isLong"], _nextPrice: GetNextAveragePriceParams["_nextPrice"], _sizeDelta: GetNextAveragePriceParams["_sizeDelta"], _lastIncreasedTime: GetNextAveragePriceParams["_lastIncreasedTime"]) {
        return this.eth_call(functions.getNextAveragePrice, {_indexToken, _size, _averagePrice, _isLong, _nextPrice, _sizeDelta, _lastIncreasedTime})
    }

    getNextFundingRate(_token: GetNextFundingRateParams["_token"]) {
        return this.eth_call(functions.getNextFundingRate, {_token})
    }

    getNextGlobalShortAveragePrice(_indexToken: GetNextGlobalShortAveragePriceParams["_indexToken"], _nextPrice: GetNextGlobalShortAveragePriceParams["_nextPrice"], _sizeDelta: GetNextGlobalShortAveragePriceParams["_sizeDelta"]) {
        return this.eth_call(functions.getNextGlobalShortAveragePrice, {_indexToken, _nextPrice, _sizeDelta})
    }

    getPosition(_account: GetPositionParams["_account"], _collateralToken: GetPositionParams["_collateralToken"], _indexToken: GetPositionParams["_indexToken"], _isLong: GetPositionParams["_isLong"]) {
        return this.eth_call(functions.getPosition, {_account, _collateralToken, _indexToken, _isLong})
    }

    getPositionDelta(_account: GetPositionDeltaParams["_account"], _collateralToken: GetPositionDeltaParams["_collateralToken"], _indexToken: GetPositionDeltaParams["_indexToken"], _isLong: GetPositionDeltaParams["_isLong"]) {
        return this.eth_call(functions.getPositionDelta, {_account, _collateralToken, _indexToken, _isLong})
    }

    getPositionFee(_sizeDelta: GetPositionFeeParams["_sizeDelta"]) {
        return this.eth_call(functions.getPositionFee, {_sizeDelta})
    }

    getPositionKey(_account: GetPositionKeyParams["_account"], _collateralToken: GetPositionKeyParams["_collateralToken"], _indexToken: GetPositionKeyParams["_indexToken"], _isLong: GetPositionKeyParams["_isLong"]) {
        return this.eth_call(functions.getPositionKey, {_account, _collateralToken, _indexToken, _isLong})
    }

    getPositionLeverage(_account: GetPositionLeverageParams["_account"], _collateralToken: GetPositionLeverageParams["_collateralToken"], _indexToken: GetPositionLeverageParams["_indexToken"], _isLong: GetPositionLeverageParams["_isLong"]) {
        return this.eth_call(functions.getPositionLeverage, {_account, _collateralToken, _indexToken, _isLong})
    }

    getRedemptionAmount(_token: GetRedemptionAmountParams["_token"], _usdgAmount: GetRedemptionAmountParams["_usdgAmount"]) {
        return this.eth_call(functions.getRedemptionAmount, {_token, _usdgAmount})
    }

    getRedemptionCollateral(_token: GetRedemptionCollateralParams["_token"]) {
        return this.eth_call(functions.getRedemptionCollateral, {_token})
    }

    getRedemptionCollateralUsd(_token: GetRedemptionCollateralUsdParams["_token"]) {
        return this.eth_call(functions.getRedemptionCollateralUsd, {_token})
    }

    getTargetUsdgAmount(_token: GetTargetUsdgAmountParams["_token"]) {
        return this.eth_call(functions.getTargetUsdgAmount, {_token})
    }

    getUtilisation(_token: GetUtilisationParams["_token"]) {
        return this.eth_call(functions.getUtilisation, {_token})
    }

    globalShortAveragePrices(_0: GlobalShortAveragePricesParams["_0"]) {
        return this.eth_call(functions.globalShortAveragePrices, {_0})
    }

    globalShortSizes(_0: GlobalShortSizesParams["_0"]) {
        return this.eth_call(functions.globalShortSizes, {_0})
    }

    gov() {
        return this.eth_call(functions.gov, {})
    }

    guaranteedUsd(_0: GuaranteedUsdParams["_0"]) {
        return this.eth_call(functions.guaranteedUsd, {_0})
    }

    hasDynamicFees() {
        return this.eth_call(functions.hasDynamicFees, {})
    }

    inManagerMode() {
        return this.eth_call(functions.inManagerMode, {})
    }

    inPrivateLiquidationMode() {
        return this.eth_call(functions.inPrivateLiquidationMode, {})
    }

    includeAmmPrice() {
        return this.eth_call(functions.includeAmmPrice, {})
    }

    isInitialized() {
        return this.eth_call(functions.isInitialized, {})
    }

    isLeverageEnabled() {
        return this.eth_call(functions.isLeverageEnabled, {})
    }

    isLiquidator(_0: IsLiquidatorParams["_0"]) {
        return this.eth_call(functions.isLiquidator, {_0})
    }

    isManager(_0: IsManagerParams["_0"]) {
        return this.eth_call(functions.isManager, {_0})
    }

    isSwapEnabled() {
        return this.eth_call(functions.isSwapEnabled, {})
    }

    lastFundingTimes(_0: LastFundingTimesParams["_0"]) {
        return this.eth_call(functions.lastFundingTimes, {_0})
    }

    liquidationFeeUsd() {
        return this.eth_call(functions.liquidationFeeUsd, {})
    }

    marginFeeBasisPoints() {
        return this.eth_call(functions.marginFeeBasisPoints, {})
    }

    maxGasPrice() {
        return this.eth_call(functions.maxGasPrice, {})
    }

    maxLeverage() {
        return this.eth_call(functions.maxLeverage, {})
    }

    maxUsdgAmounts(_0: MaxUsdgAmountsParams["_0"]) {
        return this.eth_call(functions.maxUsdgAmounts, {_0})
    }

    minProfitBasisPoints(_0: MinProfitBasisPointsParams["_0"]) {
        return this.eth_call(functions.minProfitBasisPoints, {_0})
    }

    minProfitTime() {
        return this.eth_call(functions.minProfitTime, {})
    }

    mintBurnFeeBasisPoints() {
        return this.eth_call(functions.mintBurnFeeBasisPoints, {})
    }

    poolAmounts(_0: PoolAmountsParams["_0"]) {
        return this.eth_call(functions.poolAmounts, {_0})
    }

    positions(_0: PositionsParams["_0"]) {
        return this.eth_call(functions.positions, {_0})
    }

    priceFeed() {
        return this.eth_call(functions.priceFeed, {})
    }

    reservedAmounts(_0: ReservedAmountsParams["_0"]) {
        return this.eth_call(functions.reservedAmounts, {_0})
    }

    router() {
        return this.eth_call(functions.router, {})
    }

    shortableTokens(_0: ShortableTokensParams["_0"]) {
        return this.eth_call(functions.shortableTokens, {_0})
    }

    stableFundingRateFactor() {
        return this.eth_call(functions.stableFundingRateFactor, {})
    }

    stableSwapFeeBasisPoints() {
        return this.eth_call(functions.stableSwapFeeBasisPoints, {})
    }

    stableTaxBasisPoints() {
        return this.eth_call(functions.stableTaxBasisPoints, {})
    }

    stableTokens(_0: StableTokensParams["_0"]) {
        return this.eth_call(functions.stableTokens, {_0})
    }

    swapFeeBasisPoints() {
        return this.eth_call(functions.swapFeeBasisPoints, {})
    }

    taxBasisPoints() {
        return this.eth_call(functions.taxBasisPoints, {})
    }

    tokenBalances(_0: TokenBalancesParams["_0"]) {
        return this.eth_call(functions.tokenBalances, {_0})
    }

    tokenDecimals(_0: TokenDecimalsParams["_0"]) {
        return this.eth_call(functions.tokenDecimals, {_0})
    }

    tokenToUsdMin(_token: TokenToUsdMinParams["_token"], _tokenAmount: TokenToUsdMinParams["_tokenAmount"]) {
        return this.eth_call(functions.tokenToUsdMin, {_token, _tokenAmount})
    }

    tokenWeights(_0: TokenWeightsParams["_0"]) {
        return this.eth_call(functions.tokenWeights, {_0})
    }

    totalTokenWeights() {
        return this.eth_call(functions.totalTokenWeights, {})
    }

    usdToToken(_token: UsdToTokenParams["_token"], _usdAmount: UsdToTokenParams["_usdAmount"], _price: UsdToTokenParams["_price"]) {
        return this.eth_call(functions.usdToToken, {_token, _usdAmount, _price})
    }

    usdToTokenMax(_token: UsdToTokenMaxParams["_token"], _usdAmount: UsdToTokenMaxParams["_usdAmount"]) {
        return this.eth_call(functions.usdToTokenMax, {_token, _usdAmount})
    }

    usdToTokenMin(_token: UsdToTokenMinParams["_token"], _usdAmount: UsdToTokenMinParams["_usdAmount"]) {
        return this.eth_call(functions.usdToTokenMin, {_token, _usdAmount})
    }

    usdg() {
        return this.eth_call(functions.usdg, {})
    }

    usdgAmounts(_0: UsdgAmountsParams["_0"]) {
        return this.eth_call(functions.usdgAmounts, {_0})
    }

    useSwapPricing() {
        return this.eth_call(functions.useSwapPricing, {})
    }

    validateLiquidation(_account: ValidateLiquidationParams["_account"], _collateralToken: ValidateLiquidationParams["_collateralToken"], _indexToken: ValidateLiquidationParams["_indexToken"], _isLong: ValidateLiquidationParams["_isLong"], _raise: ValidateLiquidationParams["_raise"]) {
        return this.eth_call(functions.validateLiquidation, {_account, _collateralToken, _indexToken, _isLong, _raise})
    }

    whitelistedTokenCount() {
        return this.eth_call(functions.whitelistedTokenCount, {})
    }

    whitelistedTokens(_0: WhitelistedTokensParams["_0"]) {
        return this.eth_call(functions.whitelistedTokens, {_0})
    }
}

/// Event types
export type BuyUSDGEventArgs = EParams<typeof events.BuyUSDG>
export type ClosePositionEventArgs = EParams<typeof events.ClosePosition>
export type CollectMarginFeesEventArgs = EParams<typeof events.CollectMarginFees>
export type CollectSwapFeesEventArgs = EParams<typeof events.CollectSwapFees>
export type DecreaseGuaranteedUsdEventArgs = EParams<typeof events.DecreaseGuaranteedUsd>
export type DecreasePoolAmountEventArgs = EParams<typeof events.DecreasePoolAmount>
export type DecreasePositionEventArgs = EParams<typeof events.DecreasePosition>
export type DecreaseReservedAmountEventArgs = EParams<typeof events.DecreaseReservedAmount>
export type DecreaseUsdgAmountEventArgs = EParams<typeof events.DecreaseUsdgAmount>
export type DirectPoolDepositEventArgs = EParams<typeof events.DirectPoolDeposit>
export type IncreaseGuaranteedUsdEventArgs = EParams<typeof events.IncreaseGuaranteedUsd>
export type IncreasePoolAmountEventArgs = EParams<typeof events.IncreasePoolAmount>
export type IncreasePositionEventArgs = EParams<typeof events.IncreasePosition>
export type IncreaseReservedAmountEventArgs = EParams<typeof events.IncreaseReservedAmount>
export type IncreaseUsdgAmountEventArgs = EParams<typeof events.IncreaseUsdgAmount>
export type LiquidatePositionEventArgs = EParams<typeof events.LiquidatePosition>
export type SellUSDGEventArgs = EParams<typeof events.SellUSDG>
export type SwapEventArgs = EParams<typeof events.Swap>
export type UpdateFundingRateEventArgs = EParams<typeof events.UpdateFundingRate>
export type UpdatePnlEventArgs = EParams<typeof events.UpdatePnl>
export type UpdatePositionEventArgs = EParams<typeof events.UpdatePosition>

/// Function types
export type BASIS_POINTS_DIVISORParams = FunctionArguments<typeof functions.BASIS_POINTS_DIVISOR>
export type BASIS_POINTS_DIVISORReturn = FunctionReturn<typeof functions.BASIS_POINTS_DIVISOR>

export type FUNDING_RATE_PRECISIONParams = FunctionArguments<typeof functions.FUNDING_RATE_PRECISION>
export type FUNDING_RATE_PRECISIONReturn = FunctionReturn<typeof functions.FUNDING_RATE_PRECISION>

export type MAX_FEE_BASIS_POINTSParams = FunctionArguments<typeof functions.MAX_FEE_BASIS_POINTS>
export type MAX_FEE_BASIS_POINTSReturn = FunctionReturn<typeof functions.MAX_FEE_BASIS_POINTS>

export type MAX_FUNDING_RATE_FACTORParams = FunctionArguments<typeof functions.MAX_FUNDING_RATE_FACTOR>
export type MAX_FUNDING_RATE_FACTORReturn = FunctionReturn<typeof functions.MAX_FUNDING_RATE_FACTOR>

export type MAX_LIQUIDATION_FEE_USDParams = FunctionArguments<typeof functions.MAX_LIQUIDATION_FEE_USD>
export type MAX_LIQUIDATION_FEE_USDReturn = FunctionReturn<typeof functions.MAX_LIQUIDATION_FEE_USD>

export type MIN_FUNDING_RATE_INTERVALParams = FunctionArguments<typeof functions.MIN_FUNDING_RATE_INTERVAL>
export type MIN_FUNDING_RATE_INTERVALReturn = FunctionReturn<typeof functions.MIN_FUNDING_RATE_INTERVAL>

export type MIN_LEVERAGEParams = FunctionArguments<typeof functions.MIN_LEVERAGE>
export type MIN_LEVERAGEReturn = FunctionReturn<typeof functions.MIN_LEVERAGE>

export type PRICE_PRECISIONParams = FunctionArguments<typeof functions.PRICE_PRECISION>
export type PRICE_PRECISIONReturn = FunctionReturn<typeof functions.PRICE_PRECISION>

export type USDG_DECIMALSParams = FunctionArguments<typeof functions.USDG_DECIMALS>
export type USDG_DECIMALSReturn = FunctionReturn<typeof functions.USDG_DECIMALS>

export type AddRouterParams = FunctionArguments<typeof functions.addRouter>
export type AddRouterReturn = FunctionReturn<typeof functions.addRouter>

export type AdjustForDecimalsParams = FunctionArguments<typeof functions.adjustForDecimals>
export type AdjustForDecimalsReturn = FunctionReturn<typeof functions.adjustForDecimals>

export type AllWhitelistedTokensParams = FunctionArguments<typeof functions.allWhitelistedTokens>
export type AllWhitelistedTokensReturn = FunctionReturn<typeof functions.allWhitelistedTokens>

export type AllWhitelistedTokensLengthParams = FunctionArguments<typeof functions.allWhitelistedTokensLength>
export type AllWhitelistedTokensLengthReturn = FunctionReturn<typeof functions.allWhitelistedTokensLength>

export type ApprovedRoutersParams = FunctionArguments<typeof functions.approvedRouters>
export type ApprovedRoutersReturn = FunctionReturn<typeof functions.approvedRouters>

export type BufferAmountsParams = FunctionArguments<typeof functions.bufferAmounts>
export type BufferAmountsReturn = FunctionReturn<typeof functions.bufferAmounts>

export type BuyUSDGParams = FunctionArguments<typeof functions.buyUSDG>
export type BuyUSDGReturn = FunctionReturn<typeof functions.buyUSDG>

export type ClearTokenConfigParams = FunctionArguments<typeof functions.clearTokenConfig>
export type ClearTokenConfigReturn = FunctionReturn<typeof functions.clearTokenConfig>

export type CumulativeFundingRatesParams = FunctionArguments<typeof functions.cumulativeFundingRates>
export type CumulativeFundingRatesReturn = FunctionReturn<typeof functions.cumulativeFundingRates>

export type DecreasePositionParams = FunctionArguments<typeof functions.decreasePosition>
export type DecreasePositionReturn = FunctionReturn<typeof functions.decreasePosition>

export type DirectPoolDepositParams = FunctionArguments<typeof functions.directPoolDeposit>
export type DirectPoolDepositReturn = FunctionReturn<typeof functions.directPoolDeposit>

export type ErrorControllerParams = FunctionArguments<typeof functions.errorController>
export type ErrorControllerReturn = FunctionReturn<typeof functions.errorController>

export type ErrorsParams = FunctionArguments<typeof functions.errors>
export type ErrorsReturn = FunctionReturn<typeof functions.errors>

export type FeeReservesParams = FunctionArguments<typeof functions.feeReserves>
export type FeeReservesReturn = FunctionReturn<typeof functions.feeReserves>

export type FundingIntervalParams = FunctionArguments<typeof functions.fundingInterval>
export type FundingIntervalReturn = FunctionReturn<typeof functions.fundingInterval>

export type FundingRateFactorParams = FunctionArguments<typeof functions.fundingRateFactor>
export type FundingRateFactorReturn = FunctionReturn<typeof functions.fundingRateFactor>

export type GetDeltaParams = FunctionArguments<typeof functions.getDelta>
export type GetDeltaReturn = FunctionReturn<typeof functions.getDelta>

export type GetFeeBasisPointsParams = FunctionArguments<typeof functions.getFeeBasisPoints>
export type GetFeeBasisPointsReturn = FunctionReturn<typeof functions.getFeeBasisPoints>

export type GetFundingFeeParams = FunctionArguments<typeof functions.getFundingFee>
export type GetFundingFeeReturn = FunctionReturn<typeof functions.getFundingFee>

export type GetGlobalShortDeltaParams = FunctionArguments<typeof functions.getGlobalShortDelta>
export type GetGlobalShortDeltaReturn = FunctionReturn<typeof functions.getGlobalShortDelta>

export type GetMaxPriceParams = FunctionArguments<typeof functions.getMaxPrice>
export type GetMaxPriceReturn = FunctionReturn<typeof functions.getMaxPrice>

export type GetMinPriceParams = FunctionArguments<typeof functions.getMinPrice>
export type GetMinPriceReturn = FunctionReturn<typeof functions.getMinPrice>

export type GetNextAveragePriceParams = FunctionArguments<typeof functions.getNextAveragePrice>
export type GetNextAveragePriceReturn = FunctionReturn<typeof functions.getNextAveragePrice>

export type GetNextFundingRateParams = FunctionArguments<typeof functions.getNextFundingRate>
export type GetNextFundingRateReturn = FunctionReturn<typeof functions.getNextFundingRate>

export type GetNextGlobalShortAveragePriceParams = FunctionArguments<typeof functions.getNextGlobalShortAveragePrice>
export type GetNextGlobalShortAveragePriceReturn = FunctionReturn<typeof functions.getNextGlobalShortAveragePrice>

export type GetPositionParams = FunctionArguments<typeof functions.getPosition>
export type GetPositionReturn = FunctionReturn<typeof functions.getPosition>

export type GetPositionDeltaParams = FunctionArguments<typeof functions.getPositionDelta>
export type GetPositionDeltaReturn = FunctionReturn<typeof functions.getPositionDelta>

export type GetPositionFeeParams = FunctionArguments<typeof functions.getPositionFee>
export type GetPositionFeeReturn = FunctionReturn<typeof functions.getPositionFee>

export type GetPositionKeyParams = FunctionArguments<typeof functions.getPositionKey>
export type GetPositionKeyReturn = FunctionReturn<typeof functions.getPositionKey>

export type GetPositionLeverageParams = FunctionArguments<typeof functions.getPositionLeverage>
export type GetPositionLeverageReturn = FunctionReturn<typeof functions.getPositionLeverage>

export type GetRedemptionAmountParams = FunctionArguments<typeof functions.getRedemptionAmount>
export type GetRedemptionAmountReturn = FunctionReturn<typeof functions.getRedemptionAmount>

export type GetRedemptionCollateralParams = FunctionArguments<typeof functions.getRedemptionCollateral>
export type GetRedemptionCollateralReturn = FunctionReturn<typeof functions.getRedemptionCollateral>

export type GetRedemptionCollateralUsdParams = FunctionArguments<typeof functions.getRedemptionCollateralUsd>
export type GetRedemptionCollateralUsdReturn = FunctionReturn<typeof functions.getRedemptionCollateralUsd>

export type GetTargetUsdgAmountParams = FunctionArguments<typeof functions.getTargetUsdgAmount>
export type GetTargetUsdgAmountReturn = FunctionReturn<typeof functions.getTargetUsdgAmount>

export type GetUtilisationParams = FunctionArguments<typeof functions.getUtilisation>
export type GetUtilisationReturn = FunctionReturn<typeof functions.getUtilisation>

export type GlobalShortAveragePricesParams = FunctionArguments<typeof functions.globalShortAveragePrices>
export type GlobalShortAveragePricesReturn = FunctionReturn<typeof functions.globalShortAveragePrices>

export type GlobalShortSizesParams = FunctionArguments<typeof functions.globalShortSizes>
export type GlobalShortSizesReturn = FunctionReturn<typeof functions.globalShortSizes>

export type GovParams = FunctionArguments<typeof functions.gov>
export type GovReturn = FunctionReturn<typeof functions.gov>

export type GuaranteedUsdParams = FunctionArguments<typeof functions.guaranteedUsd>
export type GuaranteedUsdReturn = FunctionReturn<typeof functions.guaranteedUsd>

export type HasDynamicFeesParams = FunctionArguments<typeof functions.hasDynamicFees>
export type HasDynamicFeesReturn = FunctionReturn<typeof functions.hasDynamicFees>

export type InManagerModeParams = FunctionArguments<typeof functions.inManagerMode>
export type InManagerModeReturn = FunctionReturn<typeof functions.inManagerMode>

export type InPrivateLiquidationModeParams = FunctionArguments<typeof functions.inPrivateLiquidationMode>
export type InPrivateLiquidationModeReturn = FunctionReturn<typeof functions.inPrivateLiquidationMode>

export type IncludeAmmPriceParams = FunctionArguments<typeof functions.includeAmmPrice>
export type IncludeAmmPriceReturn = FunctionReturn<typeof functions.includeAmmPrice>

export type IncreasePositionParams = FunctionArguments<typeof functions.increasePosition>
export type IncreasePositionReturn = FunctionReturn<typeof functions.increasePosition>

export type InitializeParams = FunctionArguments<typeof functions.initialize>
export type InitializeReturn = FunctionReturn<typeof functions.initialize>

export type IsInitializedParams = FunctionArguments<typeof functions.isInitialized>
export type IsInitializedReturn = FunctionReturn<typeof functions.isInitialized>

export type IsLeverageEnabledParams = FunctionArguments<typeof functions.isLeverageEnabled>
export type IsLeverageEnabledReturn = FunctionReturn<typeof functions.isLeverageEnabled>

export type IsLiquidatorParams = FunctionArguments<typeof functions.isLiquidator>
export type IsLiquidatorReturn = FunctionReturn<typeof functions.isLiquidator>

export type IsManagerParams = FunctionArguments<typeof functions.isManager>
export type IsManagerReturn = FunctionReturn<typeof functions.isManager>

export type IsSwapEnabledParams = FunctionArguments<typeof functions.isSwapEnabled>
export type IsSwapEnabledReturn = FunctionReturn<typeof functions.isSwapEnabled>

export type LastFundingTimesParams = FunctionArguments<typeof functions.lastFundingTimes>
export type LastFundingTimesReturn = FunctionReturn<typeof functions.lastFundingTimes>

export type LiquidatePositionParams = FunctionArguments<typeof functions.liquidatePosition>
export type LiquidatePositionReturn = FunctionReturn<typeof functions.liquidatePosition>

export type LiquidationFeeUsdParams = FunctionArguments<typeof functions.liquidationFeeUsd>
export type LiquidationFeeUsdReturn = FunctionReturn<typeof functions.liquidationFeeUsd>

export type MarginFeeBasisPointsParams = FunctionArguments<typeof functions.marginFeeBasisPoints>
export type MarginFeeBasisPointsReturn = FunctionReturn<typeof functions.marginFeeBasisPoints>

export type MaxGasPriceParams = FunctionArguments<typeof functions.maxGasPrice>
export type MaxGasPriceReturn = FunctionReturn<typeof functions.maxGasPrice>

export type MaxLeverageParams = FunctionArguments<typeof functions.maxLeverage>
export type MaxLeverageReturn = FunctionReturn<typeof functions.maxLeverage>

export type MaxUsdgAmountsParams = FunctionArguments<typeof functions.maxUsdgAmounts>
export type MaxUsdgAmountsReturn = FunctionReturn<typeof functions.maxUsdgAmounts>

export type MinProfitBasisPointsParams = FunctionArguments<typeof functions.minProfitBasisPoints>
export type MinProfitBasisPointsReturn = FunctionReturn<typeof functions.minProfitBasisPoints>

export type MinProfitTimeParams = FunctionArguments<typeof functions.minProfitTime>
export type MinProfitTimeReturn = FunctionReturn<typeof functions.minProfitTime>

export type MintBurnFeeBasisPointsParams = FunctionArguments<typeof functions.mintBurnFeeBasisPoints>
export type MintBurnFeeBasisPointsReturn = FunctionReturn<typeof functions.mintBurnFeeBasisPoints>

export type PoolAmountsParams = FunctionArguments<typeof functions.poolAmounts>
export type PoolAmountsReturn = FunctionReturn<typeof functions.poolAmounts>

export type PositionsParams = FunctionArguments<typeof functions.positions>
export type PositionsReturn = FunctionReturn<typeof functions.positions>

export type PriceFeedParams = FunctionArguments<typeof functions.priceFeed>
export type PriceFeedReturn = FunctionReturn<typeof functions.priceFeed>

export type RemoveRouterParams = FunctionArguments<typeof functions.removeRouter>
export type RemoveRouterReturn = FunctionReturn<typeof functions.removeRouter>

export type ReservedAmountsParams = FunctionArguments<typeof functions.reservedAmounts>
export type ReservedAmountsReturn = FunctionReturn<typeof functions.reservedAmounts>

export type RouterParams = FunctionArguments<typeof functions.router>
export type RouterReturn = FunctionReturn<typeof functions.router>

export type SellUSDGParams = FunctionArguments<typeof functions.sellUSDG>
export type SellUSDGReturn = FunctionReturn<typeof functions.sellUSDG>

export type SetBufferAmountParams = FunctionArguments<typeof functions.setBufferAmount>
export type SetBufferAmountReturn = FunctionReturn<typeof functions.setBufferAmount>

export type SetErrorParams = FunctionArguments<typeof functions.setError>
export type SetErrorReturn = FunctionReturn<typeof functions.setError>

export type SetErrorControllerParams = FunctionArguments<typeof functions.setErrorController>
export type SetErrorControllerReturn = FunctionReturn<typeof functions.setErrorController>

export type SetFeesParams = FunctionArguments<typeof functions.setFees>
export type SetFeesReturn = FunctionReturn<typeof functions.setFees>

export type SetFundingRateParams = FunctionArguments<typeof functions.setFundingRate>
export type SetFundingRateReturn = FunctionReturn<typeof functions.setFundingRate>

export type SetGovParams = FunctionArguments<typeof functions.setGov>
export type SetGovReturn = FunctionReturn<typeof functions.setGov>

export type SetInManagerModeParams = FunctionArguments<typeof functions.setInManagerMode>
export type SetInManagerModeReturn = FunctionReturn<typeof functions.setInManagerMode>

export type SetInPrivateLiquidationModeParams = FunctionArguments<typeof functions.setInPrivateLiquidationMode>
export type SetInPrivateLiquidationModeReturn = FunctionReturn<typeof functions.setInPrivateLiquidationMode>

export type SetIsLeverageEnabledParams = FunctionArguments<typeof functions.setIsLeverageEnabled>
export type SetIsLeverageEnabledReturn = FunctionReturn<typeof functions.setIsLeverageEnabled>

export type SetIsSwapEnabledParams = FunctionArguments<typeof functions.setIsSwapEnabled>
export type SetIsSwapEnabledReturn = FunctionReturn<typeof functions.setIsSwapEnabled>

export type SetLiquidatorParams = FunctionArguments<typeof functions.setLiquidator>
export type SetLiquidatorReturn = FunctionReturn<typeof functions.setLiquidator>

export type SetManagerParams = FunctionArguments<typeof functions.setManager>
export type SetManagerReturn = FunctionReturn<typeof functions.setManager>

export type SetMaxGasPriceParams = FunctionArguments<typeof functions.setMaxGasPrice>
export type SetMaxGasPriceReturn = FunctionReturn<typeof functions.setMaxGasPrice>

export type SetMaxLeverageParams = FunctionArguments<typeof functions.setMaxLeverage>
export type SetMaxLeverageReturn = FunctionReturn<typeof functions.setMaxLeverage>

export type SetPriceFeedParams = FunctionArguments<typeof functions.setPriceFeed>
export type SetPriceFeedReturn = FunctionReturn<typeof functions.setPriceFeed>

export type SetTokenConfigParams = FunctionArguments<typeof functions.setTokenConfig>
export type SetTokenConfigReturn = FunctionReturn<typeof functions.setTokenConfig>

export type SetUsdgAmountParams = FunctionArguments<typeof functions.setUsdgAmount>
export type SetUsdgAmountReturn = FunctionReturn<typeof functions.setUsdgAmount>

export type ShortableTokensParams = FunctionArguments<typeof functions.shortableTokens>
export type ShortableTokensReturn = FunctionReturn<typeof functions.shortableTokens>

export type StableFundingRateFactorParams = FunctionArguments<typeof functions.stableFundingRateFactor>
export type StableFundingRateFactorReturn = FunctionReturn<typeof functions.stableFundingRateFactor>

export type StableSwapFeeBasisPointsParams = FunctionArguments<typeof functions.stableSwapFeeBasisPoints>
export type StableSwapFeeBasisPointsReturn = FunctionReturn<typeof functions.stableSwapFeeBasisPoints>

export type StableTaxBasisPointsParams = FunctionArguments<typeof functions.stableTaxBasisPoints>
export type StableTaxBasisPointsReturn = FunctionReturn<typeof functions.stableTaxBasisPoints>

export type StableTokensParams = FunctionArguments<typeof functions.stableTokens>
export type StableTokensReturn = FunctionReturn<typeof functions.stableTokens>

export type SwapParams = FunctionArguments<typeof functions.swap>
export type SwapReturn = FunctionReturn<typeof functions.swap>

export type SwapFeeBasisPointsParams = FunctionArguments<typeof functions.swapFeeBasisPoints>
export type SwapFeeBasisPointsReturn = FunctionReturn<typeof functions.swapFeeBasisPoints>

export type TaxBasisPointsParams = FunctionArguments<typeof functions.taxBasisPoints>
export type TaxBasisPointsReturn = FunctionReturn<typeof functions.taxBasisPoints>

export type TokenBalancesParams = FunctionArguments<typeof functions.tokenBalances>
export type TokenBalancesReturn = FunctionReturn<typeof functions.tokenBalances>

export type TokenDecimalsParams = FunctionArguments<typeof functions.tokenDecimals>
export type TokenDecimalsReturn = FunctionReturn<typeof functions.tokenDecimals>

export type TokenToUsdMinParams = FunctionArguments<typeof functions.tokenToUsdMin>
export type TokenToUsdMinReturn = FunctionReturn<typeof functions.tokenToUsdMin>

export type TokenWeightsParams = FunctionArguments<typeof functions.tokenWeights>
export type TokenWeightsReturn = FunctionReturn<typeof functions.tokenWeights>

export type TotalTokenWeightsParams = FunctionArguments<typeof functions.totalTokenWeights>
export type TotalTokenWeightsReturn = FunctionReturn<typeof functions.totalTokenWeights>

export type UpdateCumulativeFundingRateParams = FunctionArguments<typeof functions.updateCumulativeFundingRate>
export type UpdateCumulativeFundingRateReturn = FunctionReturn<typeof functions.updateCumulativeFundingRate>

export type UpgradeVaultParams = FunctionArguments<typeof functions.upgradeVault>
export type UpgradeVaultReturn = FunctionReturn<typeof functions.upgradeVault>

export type UsdToTokenParams = FunctionArguments<typeof functions.usdToToken>
export type UsdToTokenReturn = FunctionReturn<typeof functions.usdToToken>

export type UsdToTokenMaxParams = FunctionArguments<typeof functions.usdToTokenMax>
export type UsdToTokenMaxReturn = FunctionReturn<typeof functions.usdToTokenMax>

export type UsdToTokenMinParams = FunctionArguments<typeof functions.usdToTokenMin>
export type UsdToTokenMinReturn = FunctionReturn<typeof functions.usdToTokenMin>

export type UsdgParams = FunctionArguments<typeof functions.usdg>
export type UsdgReturn = FunctionReturn<typeof functions.usdg>

export type UsdgAmountsParams = FunctionArguments<typeof functions.usdgAmounts>
export type UsdgAmountsReturn = FunctionReturn<typeof functions.usdgAmounts>

export type UseSwapPricingParams = FunctionArguments<typeof functions.useSwapPricing>
export type UseSwapPricingReturn = FunctionReturn<typeof functions.useSwapPricing>

export type ValidateLiquidationParams = FunctionArguments<typeof functions.validateLiquidation>
export type ValidateLiquidationReturn = FunctionReturn<typeof functions.validateLiquidation>

export type WhitelistedTokenCountParams = FunctionArguments<typeof functions.whitelistedTokenCount>
export type WhitelistedTokenCountReturn = FunctionReturn<typeof functions.whitelistedTokenCount>

export type WhitelistedTokensParams = FunctionArguments<typeof functions.whitelistedTokens>
export type WhitelistedTokensReturn = FunctionReturn<typeof functions.whitelistedTokens>

export type WithdrawFeesParams = FunctionArguments<typeof functions.withdrawFees>
export type WithdrawFeesReturn = FunctionReturn<typeof functions.withdrawFees>

