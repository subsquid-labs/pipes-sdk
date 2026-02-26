import axios from 'axios'

export const client = axios.create({
  withCredentials: true,
})
