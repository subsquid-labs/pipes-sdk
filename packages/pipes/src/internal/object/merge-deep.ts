export function mergeDeep<T extends object, U extends object>(obj1: T, obj2: U): T & U {
  const result: any = { ...obj1 }
  for (const key in obj2) {
    if (
      // biome-ignore lint/suspicious/noPrototypeBuiltins: <explanation>
      obj2.hasOwnProperty(key) &&
      typeof obj2[key] === 'object' &&
      obj2[key] !== null &&
      typeof result[key] === 'object' &&
      result[key] !== null
    ) {
      result[key] = mergeDeep(result[key], obj2[key])
    } else {
      result[key] = obj2[key]
    }
  }
  return result
}
