import { escapeHtml } from './escapeHtml'
import { KEYWORDS } from './keywords'

const DEFAULT_OPTIONS = {
  html: false,
  htmlEscaper: escapeHtml,
  classPrefix: 'sql-hl-',
}

const highlighters = [
  /(?<number>[+-]?(?:\d+\.\d+|\d+|\.\d+)(?:E[+-]?\d+)?)/,

  // Note: Repeating string escapes like 'sql''server' will also work as they are just repeating strings
  /(?<string>['`](?:[^`'\\]|\\.)*['`]|"(?:[^"\\]|\\.)*")/,

  /(?<comment>--[^\n\r]*|#[^\n\r]*|\/\*(?:[^*]|\*(?!\/))*\*\/)/,

  // Future improvement: Comments should be allowed between the function name and the opening parenthesis
  /\b(?<function>\w+)(?=\s*\()/,

  /(?<bracket>[()])/,

  /(?<identifier>\b\w+\b|`(?:[^`\\]|\\.)*`)/,

  /(?<whitespace>\s+)/,

  // Multi-character arithmetic, bitwise, comparison, and compound operators as listed in
  // https://www.w3schools.com/sql/sql_operators.asp, https://www.tutorialspoint.com/sql/sql-operators.htm,
  // https://data-flair.training/blogs/sql-operators/, plus any single character (in particular ,:;.) not matched by
  // the above regexps.
  /(?<special>\^-=|\|\*=|\+=|-=|\*=|\/=|%=|&=|>=|<=|<>|!=|!<|!>|>>|<<|.)/,
]

// Regex of the shape /(?<token1>...)|(?<token2>...)|.../g
const tokenizer = new RegExp(
  [`\\b(?<keyword>${KEYWORDS.join('|')})\\b`, ...highlighters.map((regex) => regex.source)].join('|'),
  'gis',
)

function getSegments(sqlString: string) {
  const segments = Array.from(sqlString.matchAll(tokenizer), (match) => ({
    name: Object.keys(match.groups || {}).find((key) => match.groups?.[key]),
    content: match[0],
  }))
  return segments
}

export function highlight(sqlString: string, options: { html?: boolean } = {}) {
  const fullOptions = Object.assign({}, DEFAULT_OPTIONS, options)
  const segments = getSegments(sqlString)

  return segments
    .map(({ name, content }, index) => {
      if (fullOptions.html) {
        const escapedContent = fullOptions.htmlEscaper(content)

        if (name === 'whitespace') return escapedContent
        else if (
          name === 'string' &&
          segments[index - 1]?.name === 'whitespace' &&
          segments[index - 2]?.content === 'COMMENT'
        ) {
          return `<span class="${fullOptions.classPrefix}comment">${escapedContent}</span>`
        }

        return `<span class="${fullOptions.classPrefix}${name}">${escapedContent}</span>`
      }

      return content
    })
    .join('')
}
