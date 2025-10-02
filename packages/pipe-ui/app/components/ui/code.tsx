import React, { memo } from 'react'

import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import theme from 'react-syntax-highlighter/dist/esm/styles/hljs/hybrid'
import { CopyButton } from '~/components/ui/copy-button'
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
