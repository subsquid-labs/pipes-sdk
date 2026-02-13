import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getInputType } from './string.js'

describe('inputType', () => {
  let tmpRoot: string
  let tmpJsonFile: string
  let tmpFileNoExt: string
  let tmpNestedPath: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'input-type-'))
    tmpJsonFile = path.join(tmpRoot, 'test-file.json')
    tmpFileNoExt = path.join(tmpRoot, 'test-file-no-ext')
    tmpNestedPath = path.join(tmpRoot, 'subdir', 'nested.json')

    await writeFile(tmpJsonFile, '{"test": true}')
    await writeFile(tmpFileNoExt, 'content')
    await mkdir(path.join(tmpRoot, 'subdir'), { recursive: true })
    await writeFile(tmpNestedPath, '{"nested": true}')
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  describe('@-prefixed file paths', () => {
    it('should return file type with path content (no @ prefix)', () => {
      const result = getInputType(`@${tmpJsonFile}`)
      expect(result).toEqual({ type: 'file', content: tmpJsonFile })
    })

    it('should throw error for @-prefixed path that does not exist', () => {
      expect(() => getInputType('@/nonexistent/path/file.json')).toThrow('File not found: /nonexistent/path/file.json')
    })

    it('should handle @-prefixed path without extension, content has no @', () => {
      const result = getInputType(`@${tmpFileNoExt}`)
      expect(result).toEqual({ type: 'file', content: tmpFileNoExt })
    })
  })

  describe('valid JSON strings', () => {
    it('should return "json" for valid JSON object', () => {
      const result = getInputType('{"key": "value"}')
      expect(result).toEqual({ type: 'json', content: '{"key": "value"}' })
    })

    it('should return "json" for valid JSON array', () => {
      const result = getInputType('[1, 2, 3]')
      expect(result).toEqual({ type: 'json', content: '[1, 2, 3]' })
    })

    it('should return "json" for valid JSON with nested objects', () => {
      const result = getInputType('{"a": {"b": "c"}}')
      expect(result).toEqual({ type: 'json', content: '{"a": {"b": "c"}}' })
    })

    it('should return "json" for valid JSON string', () => {
      const result = getInputType('"just a string"')
      expect(result).toEqual({ type: 'json', content: '"just a string"' })
    })

    it('should return "json" for valid JSON number', () => {
      const result = getInputType('42')
      expect(result).toEqual({ type: 'json', content: '42' })
    })

    it('should return "json" for valid JSON boolean', () => {
      const result = getInputType('true')
      expect(result).toEqual({ type: 'json', content: 'true' })
    })

    it('should return "json" for valid JSON null', () => {
      const result = getInputType('null')
      expect(result).toEqual({ type: 'json', content: 'null' })
    })
  })

  describe('invalid JSON-like strings', () => {
    it('should throw error for invalid JSON starting with {', () => {
      expect(() => getInputType('{invalid json')).toThrow('Invalid JSON')
    })

    it('should throw error for invalid JSON starting with [', () => {
      expect(() => getInputType('[invalid, json')).toThrow('Invalid JSON')
    })

    it('should throw error for invalid JSON with trailing comma', () => {
      expect(() => getInputType('{"key": "value",}')).toThrow('Invalid JSON')
    })

    it('should throw error for invalid JSON with single quotes', () => {
      expect(() => getInputType("{'key': 'value'}")).toThrow('Invalid JSON')
    })
  })

  describe('file paths with path separators', () => {
    it('should return "file" for path with forward slash', () => {
      const result = getInputType(tmpJsonFile)
      expect(result).toEqual({ type: 'file', content: tmpJsonFile })
    })

    it('should return "file" for nested path within tmp dir', () => {
      const result = getInputType(tmpNestedPath)
      expect(result).toEqual({ type: 'file', content: tmpNestedPath })
    })

    it('should throw error for path separator but non-existent file', () => {
      expect(() => getInputType(path.join(tmpRoot, 'nonexistent', 'file.ts'))).toThrow('File not found')
    })
  })

  describe('file paths with extensions', () => {
    it('should return "file" for path with .json extension', () => {
      const result = getInputType(tmpJsonFile)
      expect(result).toEqual({ type: 'file', content: tmpJsonFile })
    })

    it('should throw error for extension but non-existent file', () => {
      expect(() => getInputType(path.join(tmpRoot, 'config.json'))).toThrow('File not found')
    })
  })

  describe('unmatched strings', () => {
    it('should throw error for plain string without JSON or file indicators', () => {
      expect(() => getInputType('just-a-plain-string')).toThrow(
        'Invalid input: could not determine if string is a valid JSON or file path',
      )
    })

    it('should throw error for string that looks like neither JSON nor file', () => {
      expect(() => getInputType('random text here')).toThrow(
        'Invalid input: could not determine if string is a valid JSON or file path',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle JSON with whitespace', () => {
      const result = getInputType('  {"key": "value"}  ')
      expect(result).toEqual({ type: 'json', content: '  {"key": "value"}  ' })
    })

    it('should handle file path with no extension but exists', () => {
      const result = getInputType(tmpFileNoExt)
      expect(result).toEqual({ type: 'file', content: tmpFileNoExt })
    })

    it('should throw error for empty string', () => {
      expect(() => getInputType('')).toThrow('Invalid input')
    })

    it('should handle complex JSON', () => {
      const complexJson = JSON.stringify({
        nested: { data: [1, 2, 3] },
        array: ['a', 'b', 'c'],
        bool: true,
        null: null,
      })
      const result = getInputType(complexJson)
      expect(result).toEqual({ type: 'json', content: complexJson })
    })
  })
})
