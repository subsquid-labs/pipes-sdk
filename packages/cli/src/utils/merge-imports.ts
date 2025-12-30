import { readFileSync } from "fs";

// Utility to parse and merge imports
interface ParsedImport {
  defaultImport?: string;
  namedImports: string[];
  namespaceImport?: string;
  from: string;
  typeOnly: boolean;
  sideEffect?: boolean;
}

export function parseImports(content: string): {
  imports: ParsedImport[];
  code: string;
} {
  const imports: ParsedImport[] = [];

  // Match side-effect imports: import "module" or import 'module'
  const sideEffectRegex = /import\s+['"]([^'"]+)['"];?/g;
  let match;
  const importLines: number[] = [];

  while ((match = sideEffectRegex.exec(content)) !== null) {
    const afterMatch = content.substring(match.index! + match[0].length).trim();
    // Only treat as side-effect if it's not followed by 'from' (which would be a regular import)
    if (!afterMatch.startsWith('from')) {
      const from = match[1]!;
      imports.push({
        namedImports: [],
        from,
        typeOnly: false,
        sideEffect: true,
      });
      importLines.push(match.index!);
    }
  }

  // Match import statements (handles default, named, namespace, type imports)
  const importRegex =
    /import\s+(?:(type\s+)?(?:(?:\*\s+as\s+(\w+))|(\w+)|(?:\{([^}]+)\})|(?:\{([^}]+)\}\s+as\s+(\w+))|(?:(\w+)\s*,\s*\{([^}]+)\})))\s+from\s+['"]([^'"]+)['"];?/g;

  while ((match = importRegex.exec(content)) !== null) {
    const [
      fullMatch,
      typeOnly,
      namespaceImport,
      defaultImport,
      namedImports1,
      namedImports2,
      namedAsAlias,
      defaultWithNamedDefault,
      defaultWithNamedNamed,
      from,
    ] = match;

    const parsed: ParsedImport = {
      namedImports: [],
      from: from!,
      typeOnly: Boolean(typeOnly),
    };

    if (namespaceImport) {
      parsed.namespaceImport = namespaceImport;
    } else if (defaultImport && !defaultWithNamedDefault) {
      parsed.defaultImport = defaultImport;
    } else if (defaultWithNamedDefault) {
      parsed.defaultImport = defaultWithNamedDefault;
      parsed.namedImports = parseNamedImports(defaultWithNamedNamed!);
    } else if (namedImports1) {
      parsed.namedImports = parseNamedImports(namedImports1);
    } else if (namedImports2) {
      parsed.namedImports = parseNamedImports(namedImports2);
      if (namedAsAlias) {
        // Handle `import { ... } as alias` - treat as namespace
        parsed.namespaceImport = namedAsAlias;
        parsed.namedImports = [];
      }
    }

    imports.push(parsed);
    importLines.push(match.index!);
  }

  // Remove import lines from code
  const lines = content.split("\n");
  const codeLines = lines.filter((_, index) => {
    const lineStart =
      lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
    return !importLines.some((importStart) => {
      const importEnd = content.indexOf("\n", importStart);
      return (
        lineStart >= importStart &&
        lineStart <= (importEnd === -1 ? content.length : importEnd)
      );
    });
  });

  return { imports, code: codeLines.join("\n").trim() };
}

function parseNamedImports(namedStr: string): string[] {
  return namedStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Handle `import { a as b }`
      const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/);
      return asMatch ? `${asMatch[1]} as ${asMatch[2]}` : s;
    });
}

export function mergeImports(imports: ParsedImport[]): ParsedImport[] {
  const merged = new Map<string, ParsedImport>();
  const sideEffectImports = new Map<string, ParsedImport>();

  for (const imp of imports) {
    if (imp.sideEffect) {
      // Side-effect imports are standalone, just deduplicate by module path
      if (!sideEffectImports.has(imp.from)) {
        sideEffectImports.set(imp.from, { ...imp });
      }
      continue;
    }

    const key = imp.from;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...imp });
    } else {
      // Merge named imports
      const namedSet = new Set(existing.namedImports);
      imp.namedImports.forEach((n) => namedSet.add(n));
      existing.namedImports = Array.from(namedSet).sort();

      // Handle default/namespace conflicts
      if (imp.defaultImport && !existing.defaultImport) {
        existing.defaultImport = imp.defaultImport;
      }
      if (imp.namespaceImport && !existing.namespaceImport) {
        existing.namespaceImport = imp.namespaceImport;
      }

      // Type-only takes precedence if mixed
      if (imp.typeOnly) {
        existing.typeOnly = true;
      }
    }
  }

  // Combine regular and side-effect imports, side-effects first
  return [...Array.from(sideEffectImports.values()), ...Array.from(merged.values())];
}

export function generateImportStatement(imp: ParsedImport): string {
  // Handle side-effect imports
  if (imp.sideEffect) {
    return `import "${imp.from}";`;
  }

  const parts: string[] = [];

  if (imp.typeOnly) {
    parts.push("import type");
  } else {
    parts.push("import");
  }

  const importParts: string[] = [];

  if (imp.defaultImport) {
    importParts.push(imp.defaultImport);
  }

  if (imp.namedImports.length > 0) {
    importParts.push(`{ ${imp.namedImports.join(", ")} }`);
  }

  if (imp.namespaceImport) {
    importParts.push(`* as ${imp.namespaceImport}`);
  }

  if (importParts.length === 0) {
    return "";
  }

  return `${parts.join(" ")} ${importParts.join(", ")} from "${imp.from}";`;
}