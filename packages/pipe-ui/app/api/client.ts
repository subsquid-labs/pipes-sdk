import axios from 'axios'

export const client = axios.create()

export function getUrl(host: string, path: string) {
  return `${host}${path.startsWith('/') ? path : `/${path}`}`
}
