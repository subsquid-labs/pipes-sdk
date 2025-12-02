import * as p from '@subsquid/evm-codec'
import { event, fun, viewFun, indexed, ContractBase } from '@subsquid/evm-abi'
import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'

export const events = {
    AddLiquidity: event("0x38dc38b96482be64113daffd8d464ebda93e856b70ccfc605e69ccf892ab981e", "AddLiquidity(address,address,uint256,uint256,uint256,uint256,uint256)", {"account": p.address, "token": p.address, "amount": p.uint256, "aumInUsdg": p.uint256, "glpSupply": p.uint256, "usdgAmount": p.uint256, "mintAmount": p.uint256}),
    RemoveLiquidity: event("0x87b9679bb9a4944bafa98c267e7cd4a00ab29fed48afdefae25f0fca5da27940", "RemoveLiquidity(address,address,uint256,uint256,uint256,uint256,uint256)", {"account": p.address, "token": p.address, "glpAmount": p.uint256, "aumInUsdg": p.uint256, "glpSupply": p.uint256, "usdgAmount": p.uint256, "amountOut": p.uint256}),
}

export const functions = {
    BASIS_POINTS_DIVISOR: viewFun("0x126082cf", "BASIS_POINTS_DIVISOR()", {}, p.uint256),
    GLP_PRECISION: viewFun("0x662f1c68", "GLP_PRECISION()", {}, p.uint256),
    MAX_COOLDOWN_DURATION: viewFun("0x1e9049cf", "MAX_COOLDOWN_DURATION()", {}, p.uint256),
    PRICE_PRECISION: viewFun("0x95082d25", "PRICE_PRECISION()", {}, p.uint256),
    USDG_DECIMALS: viewFun("0x870d917c", "USDG_DECIMALS()", {}, p.uint256),
    addLiquidity: fun("0x1ece366a", "addLiquidity(address,uint256,uint256,uint256)", {"_token": p.address, "_amount": p.uint256, "_minUsdg": p.uint256, "_minGlp": p.uint256}, p.uint256),
    addLiquidityForAccount: fun("0x17eb2a15", "addLiquidityForAccount(address,address,address,uint256,uint256,uint256)", {"_fundingAccount": p.address, "_account": p.address, "_token": p.address, "_amount": p.uint256, "_minUsdg": p.uint256, "_minGlp": p.uint256}, p.uint256),
    aumAddition: viewFun("0x196b68cb", "aumAddition()", {}, p.uint256),
    aumDeduction: viewFun("0xb172bb0c", "aumDeduction()", {}, p.uint256),
    cooldownDuration: viewFun("0x35269315", "cooldownDuration()", {}, p.uint256),
    getAum: viewFun("0x03391476", "getAum(bool)", {"maximise": p.bool}, p.uint256),
    getAumInUsdg: viewFun("0x68a0a3e0", "getAumInUsdg(bool)", {"maximise": p.bool}, p.uint256),
    getAums: viewFun("0xed0d1c04", "getAums()", {}, p.array(p.uint256)),
    getGlobalShortAveragePrice: viewFun("0x440d828a", "getGlobalShortAveragePrice(address)", {"_token": p.address}, p.uint256),
    getGlobalShortDelta: viewFun("0xa1acd3d5", "getGlobalShortDelta(address,uint256,uint256)", {"_token": p.address, "_price": p.uint256, "_size": p.uint256}, {"_0": p.uint256, "_1": p.bool}),
    getPrice: viewFun("0xe245b5af", "getPrice(bool)", {"_maximise": p.bool}, p.uint256),
    glp: viewFun("0x78a207ee", "glp()", {}, p.address),
    gov: viewFun("0x12d43a51", "gov()", {}, p.address),
    inPrivateMode: viewFun("0x070eacee", "inPrivateMode()", {}, p.bool),
    isHandler: viewFun("0x46ea87af", "isHandler(address)", {"_0": p.address}, p.bool),
    lastAddedAt: viewFun("0x8b770e11", "lastAddedAt(address)", {"_0": p.address}, p.uint256),
    removeLiquidity: fun("0x8fed0b2c", "removeLiquidity(address,uint256,uint256,address)", {"_tokenOut": p.address, "_glpAmount": p.uint256, "_minOut": p.uint256, "_receiver": p.address}, p.uint256),
    removeLiquidityForAccount: fun("0x71d597ad", "removeLiquidityForAccount(address,address,uint256,uint256,address)", {"_account": p.address, "_tokenOut": p.address, "_glpAmount": p.uint256, "_minOut": p.uint256, "_receiver": p.address}, p.uint256),
    setAumAdjustment: fun("0x9116c4ae", "setAumAdjustment(uint256,uint256)", {"_aumAddition": p.uint256, "_aumDeduction": p.uint256}, ),
    setCooldownDuration: fun("0x966be075", "setCooldownDuration(uint256)", {"_cooldownDuration": p.uint256}, ),
    setGov: fun("0xcfad57a2", "setGov(address)", {"_gov": p.address}, ),
    setHandler: fun("0x9cb7de4b", "setHandler(address,bool)", {"_handler": p.address, "_isActive": p.bool}, ),
    setInPrivateMode: fun("0x6a86da19", "setInPrivateMode(bool)", {"_inPrivateMode": p.bool}, ),
    setShortsTracker: fun("0xd34ee093", "setShortsTracker(address)", {"_shortsTracker": p.address}, ),
    setShortsTrackerAveragePriceWeight: fun("0x4f5f6b5e", "setShortsTrackerAveragePriceWeight(uint256)", {"_shortsTrackerAveragePriceWeight": p.uint256}, ),
    shortsTracker: viewFun("0x657bc5d0", "shortsTracker()", {}, p.address),
    shortsTrackerAveragePriceWeight: viewFun("0x64e6617f", "shortsTrackerAveragePriceWeight()", {}, p.uint256),
    usdg: viewFun("0xf5b91b7b", "usdg()", {}, p.address),
    vault: viewFun("0xfbfa77cf", "vault()", {}, p.address),
}

export class Contract extends ContractBase {

    BASIS_POINTS_DIVISOR() {
        return this.eth_call(functions.BASIS_POINTS_DIVISOR, {})
    }

    GLP_PRECISION() {
        return this.eth_call(functions.GLP_PRECISION, {})
    }

    MAX_COOLDOWN_DURATION() {
        return this.eth_call(functions.MAX_COOLDOWN_DURATION, {})
    }

    PRICE_PRECISION() {
        return this.eth_call(functions.PRICE_PRECISION, {})
    }

    USDG_DECIMALS() {
        return this.eth_call(functions.USDG_DECIMALS, {})
    }

    aumAddition() {
        return this.eth_call(functions.aumAddition, {})
    }

    aumDeduction() {
        return this.eth_call(functions.aumDeduction, {})
    }

    cooldownDuration() {
        return this.eth_call(functions.cooldownDuration, {})
    }

    getAum(maximise: GetAumParams["maximise"]) {
        return this.eth_call(functions.getAum, {maximise})
    }

    getAumInUsdg(maximise: GetAumInUsdgParams["maximise"]) {
        return this.eth_call(functions.getAumInUsdg, {maximise})
    }

    getAums() {
        return this.eth_call(functions.getAums, {})
    }

    getGlobalShortAveragePrice(_token: GetGlobalShortAveragePriceParams["_token"]) {
        return this.eth_call(functions.getGlobalShortAveragePrice, {_token})
    }

    getGlobalShortDelta(_token: GetGlobalShortDeltaParams["_token"], _price: GetGlobalShortDeltaParams["_price"], _size: GetGlobalShortDeltaParams["_size"]) {
        return this.eth_call(functions.getGlobalShortDelta, {_token, _price, _size})
    }

    getPrice(_maximise: GetPriceParams["_maximise"]) {
        return this.eth_call(functions.getPrice, {_maximise})
    }

    glp() {
        return this.eth_call(functions.glp, {})
    }

    gov() {
        return this.eth_call(functions.gov, {})
    }

    inPrivateMode() {
        return this.eth_call(functions.inPrivateMode, {})
    }

    isHandler(_0: IsHandlerParams["_0"]) {
        return this.eth_call(functions.isHandler, {_0})
    }

    lastAddedAt(_0: LastAddedAtParams["_0"]) {
        return this.eth_call(functions.lastAddedAt, {_0})
    }

    shortsTracker() {
        return this.eth_call(functions.shortsTracker, {})
    }

    shortsTrackerAveragePriceWeight() {
        return this.eth_call(functions.shortsTrackerAveragePriceWeight, {})
    }

    usdg() {
        return this.eth_call(functions.usdg, {})
    }

    vault() {
        return this.eth_call(functions.vault, {})
    }
}

/// Event types
export type AddLiquidityEventArgs = EParams<typeof events.AddLiquidity>
export type RemoveLiquidityEventArgs = EParams<typeof events.RemoveLiquidity>

/// Function types
export type BASIS_POINTS_DIVISORParams = FunctionArguments<typeof functions.BASIS_POINTS_DIVISOR>
export type BASIS_POINTS_DIVISORReturn = FunctionReturn<typeof functions.BASIS_POINTS_DIVISOR>

export type GLP_PRECISIONParams = FunctionArguments<typeof functions.GLP_PRECISION>
export type GLP_PRECISIONReturn = FunctionReturn<typeof functions.GLP_PRECISION>

export type MAX_COOLDOWN_DURATIONParams = FunctionArguments<typeof functions.MAX_COOLDOWN_DURATION>
export type MAX_COOLDOWN_DURATIONReturn = FunctionReturn<typeof functions.MAX_COOLDOWN_DURATION>

export type PRICE_PRECISIONParams = FunctionArguments<typeof functions.PRICE_PRECISION>
export type PRICE_PRECISIONReturn = FunctionReturn<typeof functions.PRICE_PRECISION>

export type USDG_DECIMALSParams = FunctionArguments<typeof functions.USDG_DECIMALS>
export type USDG_DECIMALSReturn = FunctionReturn<typeof functions.USDG_DECIMALS>

export type AddLiquidityParams = FunctionArguments<typeof functions.addLiquidity>
export type AddLiquidityReturn = FunctionReturn<typeof functions.addLiquidity>

export type AddLiquidityForAccountParams = FunctionArguments<typeof functions.addLiquidityForAccount>
export type AddLiquidityForAccountReturn = FunctionReturn<typeof functions.addLiquidityForAccount>

export type AumAdditionParams = FunctionArguments<typeof functions.aumAddition>
export type AumAdditionReturn = FunctionReturn<typeof functions.aumAddition>

export type AumDeductionParams = FunctionArguments<typeof functions.aumDeduction>
export type AumDeductionReturn = FunctionReturn<typeof functions.aumDeduction>

export type CooldownDurationParams = FunctionArguments<typeof functions.cooldownDuration>
export type CooldownDurationReturn = FunctionReturn<typeof functions.cooldownDuration>

export type GetAumParams = FunctionArguments<typeof functions.getAum>
export type GetAumReturn = FunctionReturn<typeof functions.getAum>

export type GetAumInUsdgParams = FunctionArguments<typeof functions.getAumInUsdg>
export type GetAumInUsdgReturn = FunctionReturn<typeof functions.getAumInUsdg>

export type GetAumsParams = FunctionArguments<typeof functions.getAums>
export type GetAumsReturn = FunctionReturn<typeof functions.getAums>

export type GetGlobalShortAveragePriceParams = FunctionArguments<typeof functions.getGlobalShortAveragePrice>
export type GetGlobalShortAveragePriceReturn = FunctionReturn<typeof functions.getGlobalShortAveragePrice>

export type GetGlobalShortDeltaParams = FunctionArguments<typeof functions.getGlobalShortDelta>
export type GetGlobalShortDeltaReturn = FunctionReturn<typeof functions.getGlobalShortDelta>

export type GetPriceParams = FunctionArguments<typeof functions.getPrice>
export type GetPriceReturn = FunctionReturn<typeof functions.getPrice>

export type GlpParams = FunctionArguments<typeof functions.glp>
export type GlpReturn = FunctionReturn<typeof functions.glp>

export type GovParams = FunctionArguments<typeof functions.gov>
export type GovReturn = FunctionReturn<typeof functions.gov>

export type InPrivateModeParams = FunctionArguments<typeof functions.inPrivateMode>
export type InPrivateModeReturn = FunctionReturn<typeof functions.inPrivateMode>

export type IsHandlerParams = FunctionArguments<typeof functions.isHandler>
export type IsHandlerReturn = FunctionReturn<typeof functions.isHandler>

export type LastAddedAtParams = FunctionArguments<typeof functions.lastAddedAt>
export type LastAddedAtReturn = FunctionReturn<typeof functions.lastAddedAt>

export type RemoveLiquidityParams = FunctionArguments<typeof functions.removeLiquidity>
export type RemoveLiquidityReturn = FunctionReturn<typeof functions.removeLiquidity>

export type RemoveLiquidityForAccountParams = FunctionArguments<typeof functions.removeLiquidityForAccount>
export type RemoveLiquidityForAccountReturn = FunctionReturn<typeof functions.removeLiquidityForAccount>

export type SetAumAdjustmentParams = FunctionArguments<typeof functions.setAumAdjustment>
export type SetAumAdjustmentReturn = FunctionReturn<typeof functions.setAumAdjustment>

export type SetCooldownDurationParams = FunctionArguments<typeof functions.setCooldownDuration>
export type SetCooldownDurationReturn = FunctionReturn<typeof functions.setCooldownDuration>

export type SetGovParams = FunctionArguments<typeof functions.setGov>
export type SetGovReturn = FunctionReturn<typeof functions.setGov>

export type SetHandlerParams = FunctionArguments<typeof functions.setHandler>
export type SetHandlerReturn = FunctionReturn<typeof functions.setHandler>

export type SetInPrivateModeParams = FunctionArguments<typeof functions.setInPrivateMode>
export type SetInPrivateModeReturn = FunctionReturn<typeof functions.setInPrivateMode>

export type SetShortsTrackerParams = FunctionArguments<typeof functions.setShortsTracker>
export type SetShortsTrackerReturn = FunctionReturn<typeof functions.setShortsTracker>

export type SetShortsTrackerAveragePriceWeightParams = FunctionArguments<typeof functions.setShortsTrackerAveragePriceWeight>
export type SetShortsTrackerAveragePriceWeightReturn = FunctionReturn<typeof functions.setShortsTrackerAveragePriceWeight>

export type ShortsTrackerParams = FunctionArguments<typeof functions.shortsTracker>
export type ShortsTrackerReturn = FunctionReturn<typeof functions.shortsTracker>

export type ShortsTrackerAveragePriceWeightParams = FunctionArguments<typeof functions.shortsTrackerAveragePriceWeight>
export type ShortsTrackerAveragePriceWeightReturn = FunctionReturn<typeof functions.shortsTrackerAveragePriceWeight>

export type UsdgParams = FunctionArguments<typeof functions.usdg>
export type UsdgReturn = FunctionReturn<typeof functions.usdg>

export type VaultParams = FunctionArguments<typeof functions.vault>
export type VaultReturn = FunctionReturn<typeof functions.vault>

