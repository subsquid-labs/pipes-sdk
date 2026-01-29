import { AsyncLocalStorage } from 'node:async_hooks'

type Store = {
  id: string
}
const asyncLocalStorage = new AsyncLocalStorage<Store>()

export function useContext(): Store | undefined {
  return asyncLocalStorage.getStore()
}

function anyUserFunction() {
  const store = useContext()
  console.log(`Current context ID: ${store?.id}`)
}

function runner() {}
