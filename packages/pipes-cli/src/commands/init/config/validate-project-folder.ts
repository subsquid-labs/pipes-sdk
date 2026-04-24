import path from 'node:path'

/**
 * Validates user input for the project folder prompt.
 * Returns `true` when the value is acceptable, or an error message string otherwise.
 */
export function validateProjectFolder(value: string): true | string {
  if (!value || value.trim().length === 0) {
    return 'Project folder cannot be empty'
  }

  const trimmed = value.trim()

  // Invalid characters: angle brackets, colon, double quote, pipe, question mark, asterisk,
  // or ASCII control characters (0x00-0x1F).
  const invalidChars = /[<>:"|?*\x00-\x1f]/
  if (invalidChars.test(trimmed)) {
    return 'Project folder contains invalid characters (forbidden: <, >, :, ", |, ?, *, ASCII 0-31)'
  }

  // Reserved Windows names.
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
  if (reservedNames.test(trimmed)) {
    return 'Project folder name is reserved (forbidden: CON, PRN, AUX, NUL, COM[1-9], LPT[1-9])'
  }

  try {
    path.resolve(trimmed)
  } catch {
    return 'Invalid path format'
  }

  return true
}
