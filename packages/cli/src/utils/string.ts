import { existsSync } from 'node:fs'

// examples:
// toKebabCase("helloWorld")            -> "hello-world"
// toKebabCase("HelloWorld")            -> "hello-world"
// toKebabCase("hello_world")           -> "hello-world"
// toKebabCase("hello world")           -> "hello-world"
// toKebabCase("someURLValue42")        -> "some-url-value42"
// toKebabCase("  foo---bar__baz  ")    -> "foo-bar-baz"
// toKebabCase("weird@chars!! here")    -> "weird-chars-here"
export function toKebabCase(input: string): string {
  return (
    input
      .trim()
      // turn most separators into spaces
      .replace(/[_\.\s]+/g, ' ')
      // split camelCase / PascalCase / acronym boundaries
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // drop non-alphanumerics (keep spaces/hyphens)
      .replace(/[^a-zA-Z0-9\s-]+/g, '')
      // spaces -> hyphens
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  )
}

type InputType = 'file' | 'json'

export interface GetInputTypeResult {
  type: InputType
  content: string
}

export function getInputType(input: string): GetInputTypeResult {
  // Handle @-prefixed file paths
  if (input.startsWith('@')) {
    const filePath = input.slice(1)
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    return { type: 'file', content: filePath }
  }

  // Try parsing as JSON first
  try {
    JSON.parse(input)
    return { type: 'json', content: input }
  } catch {}

  // Heuristics to detect file paths:
  // - Contains path separators (/ or \)
  // - Has file extension pattern
  const hasPathSeparator = input.includes('/') || input.includes('\\')
  const hasFileExtension = /\.\w+$/.test(input)
  const looksLikeJsonAttempt = input.trim().startsWith('{') || input.trim().startsWith('[')

  // If it looks like a JSON attempt but failed to parse, treat as error
  if (looksLikeJsonAttempt) {
    throw new Error(`Invalid JSON: ${input}`)
  }

  // If it has path indicators, treat as file
  if (hasPathSeparator || hasFileExtension) {
    if (!existsSync(input)) {
      throw new Error(`File not found: ${input}`)
    }
    return { type: 'file', content: input }
  }

  throw new Error(`Invalid input: could not determine if string is a valid JSON or file path: ${input}`)
}