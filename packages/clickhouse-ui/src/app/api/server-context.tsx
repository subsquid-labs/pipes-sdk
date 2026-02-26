'use client'

import { createContext, useContext, useState } from 'react'

type ServerContextValue = {
  serverIndex: number
  setServerIndex: (index: number) => void
}

const ServerContext = createContext<ServerContextValue>({
  serverIndex: 0,
  setServerIndex: () => {},
})

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const [serverIndex, setServerIndex] = useState(0)
  return <ServerContext.Provider value={{ serverIndex, setServerIndex }}>{children}</ServerContext.Provider>
}

export function useServerIndex() {
  return useContext(ServerContext)
}
