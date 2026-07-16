'use client'

import { Suspense } from 'react'

import { Dashboard } from '~/dashboard/dashboard'

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  )
}
