const charCodeMap: Record<number, string> = {
  34: '&quot;', // "
  38: '&amp;', // &
  39: '&#39;', // '
  60: '&lt;', // <
  62: '&gt;', // >
}

export function escapeHtml(str: string) {
  let html = ''
  let lastIndex = 0

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    const replacement = charCodeMap[code]
    if (!replacement) continue

    if (lastIndex !== i) {
      html += str.substring(lastIndex, i)
    }

    lastIndex = i + 1
    html += replacement
  }

  return html + str.substring(lastIndex)
}
