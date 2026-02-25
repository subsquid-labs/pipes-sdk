export class ConfigService {
  private readonly baseUrl: string

  constructor() {
    const baseUrl = process.env['PIPES_CONFIG_API_URL'] ?? 'https://pipes-starter-ui-3yl1.vercel.app/api/config'

    if (!baseUrl) {
      throw new Error(
        'Missing config API base URL. Pass { baseUrl } or set PIPES_CONFIG_API_URL (or PIPES_CONFIG_BASE_URL).',
      )
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  /**
   * Fetch the raw config JSON string for a config hash.
   *
   * Expected server endpoint: GET {baseUrl}/{configHash}
   */
  async getConfigJsonByHash(configHash: string): Promise<string> {
    const hash = configHash.trim()

    if (!hash) {
      throw new Error('Missing config hash')
    }

    const url = new URL(`${this.baseUrl}/${encodeURIComponent(hash)}`)
    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (!res.ok) {
      const body = await res.text()

      if (res.status === 404) {
        throw new Error(`Config not found for hash: ${hash}`)
      }

      throw new Error(
        `Failed to fetch config for hash ${hash} (${res.status} ${res.statusText})${body ? `: ${body}` : ''}`,
      )
    }

    const jsonText = await res.text()

    try {
      JSON.parse(jsonText)
    } catch {
      throw new Error('Config API returned invalid JSON')
    }

    return jsonText
  }
}
