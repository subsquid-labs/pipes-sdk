'use client'

import React, { memo } from 'react'

import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import { CopyButton } from '~/components/ui/copy-button'

const theme: Record<string, React.CSSProperties> = {
  'hljs': { background: 'transparent', color: 'rgba(255,255,255,0.85)' },
  'hljs-string': { color: '#a5d6a7' },
  'hljs-number': { color: '#90caf9' },
  'hljs-literal': { color: '#90caf9' },
  'hljs-keyword': { color: '#c792ea' },
  'hljs-built_in': { color: '#82aaff' },
  'hljs-type': { color: '#ffcb6b' },
  'hljs-function': { color: '#82aaff' },
  'hljs-title': { color: '#82aaff' },
  'hljs-attr': { color: '#89ddff' },
  'hljs-params': { color: 'rgba(255,255,255,0.85)' },
  'hljs-punctuation': { color: 'rgba(255,255,255,0.5)' },
  'hljs-comment': { color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  'hljs-variable': { color: '#f07178' },
  'hljs-property': { color: '#89ddff' },
}
import { cn } from '~/lib/utils'

export type Lang = 'typescript' | 'bash' | 'json'

SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('json', json)

export const Code = memo(function Code({
  children,
  language,
  className,
  hideCopyButton,
  showLineNumbers = false,
  wrapLongLines = false,
  wrapLines = false,
}: {
  children?: string
  language: Lang
  className?: string
  hideCopyButton?: boolean
  showLineNumbers?: boolean
  wrapLongLines?: boolean
  wrapLines?: boolean
}) {
  return (
    <div className={cn('relative border rounded-md p-3 text-xs', className)}>
      {!hideCopyButton ? <CopyButton className="absolute right-1 top-1" content={children} /> : null}
      <SyntaxHighlighter
        wrapLongLines={wrapLongLines}
        wrapLines={wrapLines}
        showLineNumbers={showLineNumbers}
        language={language}
        customStyle={{ background: 'transparent' }}
        style={theme}
      >
        {children || ''}
      </SyntaxHighlighter>
    </div>
  )
})
