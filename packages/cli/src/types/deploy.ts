export const providers = ['railway'] as const

export type Provider = (typeof providers)[number]
