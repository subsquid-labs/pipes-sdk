export const clickhouseUtilsTemplate = `export type SnakeCase<S extends string> =
  S extends \`\${infer H}\${infer T}\`
    ? \`\${H extends Lowercase<H> ? H : \`_\${Lowercase<H>}\`}\${SnakeCase<T>}\`
    : S

export type SnakeTopKeys<T> =
  T extends object
    ? { [K in keyof T as K extends string ? SnakeCase<K> : K]: T[K] }
    : T

export const toSnakeKeys = <T extends Record<string, any>>(obj: T): SnakeTopKeys<T> => {
  const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => \`_\${m.toLowerCase()}\`)
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnake(k), v])) as SnakeTopKeys<T>
}

export const toSnakeKeysArray = <T extends Record<string, any>>(
  obj: T[],
): SnakeTopKeys<T>[] => {
  return obj.map((o) => toSnakeKeys(o))
}

// Clickhouse JSONEachRow format uses toJSON to convert BigInts to strings
;(BigInt.prototype as any).toJSON = function () {
return this.toString()
}

`
