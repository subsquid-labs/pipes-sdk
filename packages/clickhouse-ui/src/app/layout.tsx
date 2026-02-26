import type { ReactNode } from 'react'

import { Header } from '~/components/header'
import { Providers } from '~/components/providers'

import './globals.css'

export const metadata = {
  title: 'ClickHouse',
  description: '',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="dark">
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  )
}
