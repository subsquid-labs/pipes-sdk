import { describe, expect, it } from 'vitest'
import { generateImportStatement, mergeImports, splitImportsAndCode, parseNamedImports } from './merge-imports.js'

describe('parseImports', () => {
  it('should parse side-effect imports', () => {
    const content = 'import "./styles.css";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namedImports: [],
      from: './styles.css',
      typeOnly: false,
      sideEffect: true,
    })
    expect(result.code).toBe('')
  })

  it('should parse default imports', () => {
    const content = 'import Pipes from "@subsquid/pipes";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      defaultImport: 'Pipes',
      namedImports: [],
      from: '@subsquid/pipes',
      typeOnly: false,
    })
    expect(result.code).toBe('')
  })

  it('should parse named imports', () => {
    const content = 'import { evmDecoder, evmPortalSource } from "@subsquid/pipes/evm";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namedImports: ['evmDecoder', 'evmPortalSource'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    })
    expect(result.code).toBe('')
  })

  it('should parse named imports with aliases', () => {
    const content = 'import { evmDecoder as decoder, evmPortalSource } from "@subsquid/pipes/evm";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namedImports: ['evmDecoder as decoder', 'evmPortalSource'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    })
  })

  it('should parse namespace imports', () => {
    const content = 'import * as Pipes from "@subsquid/pipes";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namespaceImport: 'Pipes',
      namedImports: [],
      from: '@subsquid/pipes',
      typeOnly: false,
    })
  })

  it('should parse type imports', () => {
    const content = 'import type { PortalRange } from "@subsquid/pipes";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: true,
    })
  })

  it('should parse default with named imports', () => {
    const content = 'import Pipes, { PortalRange } from "@subsquid/pipes";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      defaultImport: 'Pipes',
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: false,
    })
  })

  it('should parse multiline imports', () => {
    const content = `import {
      evmDecoder,
      evmPortalSource,
      commonAbis
    } from "@subsquid/pipes/evm";`
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namedImports: ['evmDecoder', 'evmPortalSource', 'commonAbis'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    })
  })

  it('should parse multiple imports from different modules', () => {
    const content = `import Pipes from "@subsquid/pipes";
import { evmDecoder } from "@subsquid/pipes/evm";
import lodash from "lodash";`
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(3)
    expect(result.imports[0]).toEqual({
      defaultImport: 'Pipes',
      namedImports: [],
      from: '@subsquid/pipes',
      typeOnly: false,
    })
    expect(result.imports[1]).toEqual({
      namedImports: ['evmDecoder'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    })
    expect(result.imports[2]).toEqual({
      defaultImport: 'lodash',
      namedImports: [],
      from: 'lodash',
      typeOnly: false,
    })
  })

  it('should extract code without imports', () => {
    const content = `import { evmDecoder } from "@subsquid/pipes/evm";

const stream = evmDecoder({
  range: { from: 'latest' },
});`
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.code.trim()).toBe(`const stream = evmDecoder({
  range: { from: 'latest' },
});`)
  })

  it('should handle imports with semicolons and without', () => {
    const content = `import Pipes from "@subsquid/pipes"
import { evmDecoder } from "@subsquid/pipes/evm";`
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(2)
  })

  it('should handle named imports with namespace alias', () => {
    const content = 'import { a, b, c } as ns from "module";'
    const result = splitImportsAndCode(content)

    expect(result.imports).toHaveLength(1)
    expect(result.imports[0]).toEqual({
      namespaceImport: 'ns',
      namedImports: [],
      from: 'module',
      typeOnly: false,
    })
  })

  it('should not treat import with from as side-effect', () => {
    const content = 'import "./styles.css" from "other";'
    const result = splitImportsAndCode(content)

    // Should not be parsed as side-effect since it has 'from'
    expect(result.imports.some((imp) => imp.sideEffect && imp.from === './styles.css')).toBe(false)
  })
})

describe('parseNamedImports', () => {
  it('should parse simple named imports', () => {
    const result = parseNamedImports('evmDecoder, evmPortalSource')
    expect(result).toEqual(['evmDecoder', 'evmPortalSource'])
  })

  it('should parse named imports with aliases', () => {
    const result = parseNamedImports('evmDecoder as decoder, evmPortalSource')
    expect(result).toEqual(['evmDecoder as decoder', 'evmPortalSource'])
  })

  it('should handle whitespace', () => {
    const result = parseNamedImports('  evmDecoder  ,  evmPortalSource  ')
    expect(result).toEqual(['evmDecoder', 'evmPortalSource'])
  })

  it('should handle empty string', () => {
    const result = parseNamedImports('')
    expect(result).toEqual([])
  })

  it('should filter out empty entries', () => {
    const result = parseNamedImports('evmDecoder, , evmPortalSource,')
    expect(result).toEqual(['evmDecoder', 'evmPortalSource'])
  })

  it('should handle single import', () => {
    const result = parseNamedImports('evmDecoder')
    expect(result).toEqual(['evmDecoder'])
  })

  it('should handle multiple aliases', () => {
    const result = parseNamedImports('a as b, c as d, e')
    expect(result).toEqual(['a as b', 'c as d', 'e'])
  })
})

describe('mergeImports', () => {
  it('should merge imports from the same module', () => {
    const imports = [
      {
        namedImports: ['evmDecoder'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
      {
        namedImports: ['evmPortalSource'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      namedImports: ['evmDecoder', 'evmPortalSource'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    })
  })

  it('should deduplicate named imports', () => {
    const imports = [
      {
        namedImports: ['evmDecoder'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
      {
        namedImports: ['evmDecoder', 'evmPortalSource'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result[0]!.namedImports).toEqual(['evmDecoder', 'evmPortalSource'])
  })

  it('should merge default and named imports', () => {
    const imports = [
      {
        defaultImport: 'Pipes',
        namedImports: [],
        from: '@subsquid/pipes',
        typeOnly: false,
      },
      {
        namedImports: ['PortalRange'],
        from: '@subsquid/pipes',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result[0]).toEqual({
      defaultImport: 'Pipes',
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: false,
    })
  })

  it('should handle namespace imports', () => {
    const imports = [
      {
        namespaceImport: 'Pipes',
        namedImports: [],
        from: '@subsquid/pipes',
        typeOnly: false,
      },
      {
        namedImports: ['PortalRange'],
        from: '@subsquid/pipes',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result[0]).toEqual({
      namespaceImport: 'Pipes',
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: false,
    })
  })

  it('should handle type-only imports', () => {
    const imports = [
      {
        namedImports: ['PortalRange'],
        from: '@subsquid/pipes',
        typeOnly: true,
      },
      {
        namedImports: ['Transformer'],
        from: '@subsquid/pipes',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result[0]).toEqual({
      namedImports: ['PortalRange', 'Transformer'],
      from: '@subsquid/pipes',
      typeOnly: true,
    })
  })

  it('should handle side-effect imports', () => {
    const imports = [
      {
        namedImports: [],
        from: './styles.css',
        typeOnly: false,
        sideEffect: true,
      },
      {
        namedImports: ['evmDecoder'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      namedImports: [],
      from: './styles.css',
      typeOnly: false,
      sideEffect: true,
    })
    expect(result[1]).toEqual({
      namedImports: ['evmDecoder'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    })
  })

  it('should deduplicate side-effect imports', () => {
    const imports = [
      {
        namedImports: [],
        from: './styles.css',
        typeOnly: false,
        sideEffect: true,
      },
      {
        namedImports: [],
        from: './styles.css',
        typeOnly: false,
        sideEffect: true,
      },
    ]

    const result = mergeImports(imports)

    expect(result).toHaveLength(1)
    expect(result[0]!.from).toBe('./styles.css')
  })

  it('should sort named imports alphabetically', () => {
    const imports = [
      {
        namedImports: ['zebra', 'alpha'],
        from: 'module',
        typeOnly: false,
      },
      {
        namedImports: ['beta'],
        from: 'module',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result[0]!.namedImports).toEqual(['alpha', 'beta', 'zebra'])
  })

  it('should handle multiple different modules', () => {
    const imports = [
      {
        namedImports: ['evmDecoder'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
      {
        namedImports: ['lodash'],
        from: 'lodash',
        typeOnly: false,
      },
      {
        namedImports: ['evmPortalSource'],
        from: '@subsquid/pipes/evm',
        typeOnly: false,
      },
    ]

    const result = mergeImports(imports)

    expect(result).toHaveLength(2)
    expect(result.find((imp) => imp.from === '@subsquid/pipes/evm')!.namedImports).toEqual([
      'evmDecoder',
      'evmPortalSource',
    ])
    expect(result.find((imp) => imp.from === 'lodash')!.namedImports).toEqual(['lodash'])
  })
})

describe('generateImportStatement', () => {
  it('should generate side-effect import', () => {
    const imp = {
      namedImports: [],
      from: './styles.css',
      typeOnly: false,
      sideEffect: true,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import "./styles.css";')
  })

  it('should generate default import', () => {
    const imp = {
      defaultImport: 'Pipes',
      namedImports: [],
      from: '@subsquid/pipes',
      typeOnly: false,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import Pipes from "@subsquid/pipes";')
  })

  it('should generate named import', () => {
    const imp = {
      namedImports: ['evmDecoder', 'evmPortalSource'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import { evmDecoder, evmPortalSource } from "@subsquid/pipes/evm";')
  })

  it('should generate namespace import', () => {
    const imp = {
      namespaceImport: 'Pipes',
      namedImports: [],
      from: '@subsquid/pipes',
      typeOnly: false,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import * as Pipes from "@subsquid/pipes";')
  })

  it('should generate type import', () => {
    const imp = {
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: true,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import type { PortalRange } from "@subsquid/pipes";')
  })

  it('should generate combined default and named import', () => {
    const imp = {
      defaultImport: 'Pipes',
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: false,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import Pipes, { PortalRange } from "@subsquid/pipes";')
  })

  it('should return empty string for empty imports', () => {
    const imp = {
      namedImports: [],
      from: '@subsquid/pipes',
      typeOnly: false,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('')
  })

  it('should generate type import with default', () => {
    const imp = {
      defaultImport: 'Pipes',
      namedImports: ['PortalRange'],
      from: '@subsquid/pipes',
      typeOnly: true,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import type Pipes, { PortalRange } from "@subsquid/pipes";')
  })

  it('should preserve aliases in named imports', () => {
    const imp = {
      namedImports: ['evmDecoder as decoder', 'evmPortalSource'],
      from: '@subsquid/pipes/evm',
      typeOnly: false,
    }

    const result = generateImportStatement(imp)

    expect(result).toBe('import { evmDecoder as decoder, evmPortalSource } from "@subsquid/pipes/evm";')
  })
})
