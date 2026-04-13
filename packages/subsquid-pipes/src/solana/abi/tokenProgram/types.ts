import { Codec, unit, sum, struct, address, u64, u8, bool, ref, fixedArray } from '@subsquid/borsh';

export type AccountState_Uninitialized = undefined;

export const AccountState_Uninitialized = unit;

export type AccountState_Initialized = undefined;

export const AccountState_Initialized = unit;

export type AccountState_Frozen = undefined;

export const AccountState_Frozen = unit;

export type AccountState =
  | {
      kind: 'Uninitialized';
      value?: AccountState_Uninitialized;
    }
  | {
      kind: 'Initialized';
      value?: AccountState_Initialized;
    }
  | {
      kind: 'Frozen';
      value?: AccountState_Frozen;
    };

export const AccountState: Codec<AccountState> = sum(1, {
  Uninitialized: {
    discriminator: 0,
    value: AccountState_Uninitialized,
  },
  Initialized: {
    discriminator: 1,
    value: AccountState_Initialized,
  },
  Frozen: {
    discriminator: 2,
    value: AccountState_Frozen,
  },
});

export type AuthorityType_MintTokens = undefined;

export const AuthorityType_MintTokens = unit;

export type AuthorityType_FreezeAccount = undefined;

export const AuthorityType_FreezeAccount = unit;

export type AuthorityType_AccountOwner = undefined;

export const AuthorityType_AccountOwner = unit;

export type AuthorityType_CloseAccount = undefined;

export const AuthorityType_CloseAccount = unit;

export type AuthorityType =
  | {
      kind: 'MintTokens';
      value?: AuthorityType_MintTokens;
    }
  | {
      kind: 'FreezeAccount';
      value?: AuthorityType_FreezeAccount;
    }
  | {
      kind: 'AccountOwner';
      value?: AuthorityType_AccountOwner;
    }
  | {
      kind: 'CloseAccount';
      value?: AuthorityType_CloseAccount;
    };

export const AuthorityType: Codec<AuthorityType> = sum(1, {
  MintTokens: {
    discriminator: 0,
    value: AuthorityType_MintTokens,
  },
  FreezeAccount: {
    discriminator: 1,
    value: AuthorityType_FreezeAccount,
  },
  AccountOwner: {
    discriminator: 2,
    value: AuthorityType_AccountOwner,
  },
  CloseAccount: {
    discriminator: 3,
    value: AuthorityType_CloseAccount,
  },
});

export interface MintAccount {
  mintAuthority:
    | {
        kind: 'None';
        value?: undefined;
      }
    | {
        kind: 'Some';
        value: string;
      };
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority:
    | {
        kind: 'None';
        value?: undefined;
      }
    | {
        kind: 'Some';
        value: string;
      };
}

export const MintAccount: Codec<MintAccount> = struct({
  mintAuthority: sum(4, {
    None: {
      discriminator: 0,
      value: unit,
    },
    Some: {
      discriminator: 1,
      value: address,
    },
  }),
  supply: u64,
  decimals: u8,
  isInitialized: bool,
  freezeAuthority: sum(4, {
    None: {
      discriminator: 0,
      value: unit,
    },
    Some: {
      discriminator: 1,
      value: address,
    },
  }),
});

export interface TokenAccount {
  mint: string;
  owner: string;
  amount: bigint;
  delegate:
    | {
        kind: 'None';
        value?: undefined;
      }
    | {
        kind: 'Some';
        value: string;
      };
  state: AccountState;
  isNative:
    | {
        kind: 'None';
        value?: undefined;
      }
    | {
        kind: 'Some';
        value: bigint;
      };
  delegatedAmount: bigint;
  closeAuthority:
    | {
        kind: 'None';
        value?: undefined;
      }
    | {
        kind: 'Some';
        value: string;
      };
}

export const TokenAccount: Codec<TokenAccount> = struct({
  mint: address,
  owner: address,
  amount: u64,
  delegate: sum(4, {
    None: {
      discriminator: 0,
      value: unit,
    },
    Some: {
      discriminator: 1,
      value: address,
    },
  }),
  state: ref(() => AccountState),
  isNative: sum(4, {
    None: {
      discriminator: 0,
      value: unit,
    },
    Some: {
      discriminator: 1,
      value: u64,
    },
  }),
  delegatedAmount: u64,
  closeAuthority: sum(4, {
    None: {
      discriminator: 0,
      value: unit,
    },
    Some: {
      discriminator: 1,
      value: address,
    },
  }),
});

export interface MultisigAccount {
  numOfSignersRequired: number;
  numOfValidSignersRequired: number;
  isInitialized: boolean;
  signers: Array<string>;
}

export const MultisigAccount: Codec<MultisigAccount> = struct({
  numOfSignersRequired: u8,
  numOfValidSignersRequired: u8,
  isInitialized: bool,
  signers: fixedArray(address, 11),
});
