import { createContext, useContext } from 'react'

type ServerContextValue = {
  serverIndex: number
  setServerIndex: (index: number) => void
}

export const ServerContext = createContext<ServerContextValue>({
  serverIndex: 0,
  setServerIndex: () => {},
})

export function useServerIndex() {
  return useContext(ServerContext)
}
