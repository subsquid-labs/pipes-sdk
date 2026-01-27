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
