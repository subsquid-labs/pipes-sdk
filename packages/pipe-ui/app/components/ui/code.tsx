'use client'

import React, { memo } from 'react'

import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import { CopyButton } from '~/components/ui/copy-button'

const theme: Record<string, React.CSSProperties> = {
  'hljs': { background: 'transparent', color: 'rgba(255,255,255,0.4)' },
  'hljs-string': { color: '#7ec89e' },
  'hljs-number': { color: '#6eb3d4' },
  'hljs-literal': { color: '#6eb3d4' },
  'hljs-keyword': { color: '#7ec89e' },
  'hljs-attr': { color: '#9d8abf' },
  'hljs-punctuation': { color: 'rgba(255,255,255,0.3)' },
  'hljs-comment': { color: 'rgba(255,255,255,0.2)' },
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
    <div className={cn('relative border rounded-md p-1 text-xs', className)}>
      {!hideCopyButton ? <CopyButton className="absolute right-0 top-0.5" content={children} /> : null}
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
