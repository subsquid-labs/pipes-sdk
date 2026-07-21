import { createContext, useContext } from 'react'

type ServerContextValue = {
  serverIndex: number
}

export const ServerContext = createContext<ServerContextValue>({
  serverIndex: 0,
})

export function useServerIndex() {
  return useContext(ServerContext)
}
