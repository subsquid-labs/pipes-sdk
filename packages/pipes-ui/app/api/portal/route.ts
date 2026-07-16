import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const host = request.nextUrl.searchParams.get('host')

  if (!host) {
    return NextResponse.json({ error: 'Missing host parameter' }, { status: 400 })
  }

  const targetUrl = `${host}/status`

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json(null, { status: 502 })
  }
}
