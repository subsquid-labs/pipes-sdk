import axios from 'axios'

export const client = axios.create({
  withCredentials: true,
})

export function getUrl(host: string, path: string) {
  return `${host}${path.startsWith('/') ? path : `/${path}`}`
}
