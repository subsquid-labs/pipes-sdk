/**
 *  JSON.stringify with BigInt support.
 */
export function jsonStringify(value: any, space?: string | number) {
  return JSON.stringify(
    value,
    (key, val) => {
      if (typeof val === 'bigint') return val.toString(10) + 'n'

      return val
    },
    space,
  )
}

/**
 * JSON.parse with BigInt support.
 */
export function jsonParse(json: any) {
  return JSON.parse(json, (key, val) => {
    if (typeof val === 'string' && val.endsWith('n')) {
      if (!val.match(/^[0-9]+n$/)) {
        return val
      }

      return BigInt(val.slice(0, -1))
    }
    return val
  })
}
