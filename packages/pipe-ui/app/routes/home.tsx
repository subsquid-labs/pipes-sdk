import { Dashboard } from '~/dashboard/dashboard'
import type { Route } from './+types/home'

export function meta({}: Route.MetaArgs) {
  return [{ title: 'Pipe' }]
}

export default function Home() {
  return <Dashboard />
}
