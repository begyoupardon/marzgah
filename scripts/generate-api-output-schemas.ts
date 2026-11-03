/** Generate documentation-only JSON schemas from router handler return types. */
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
  )
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.')
const program = ts.createProgram(parsed.fileNames, parsed.options)
const checker = program.getTypeChecker()

type Schema = Record<string, unknown>
const flags = ts.TypeFlags

function schemaFor(
  type: ts.Type,
  seen = new Set<ts.Type>(),
  depth = 0,
): Schema {
  if (depth > 12 || seen.has(type)) return {}
  if (
    type.flags &
    (flags.Any | flags.Unknown | flags.Never | flags.Void | flags.Undefined)
  )
    return {}
  if (type.flags & flags.Null) return { type: 'null' }
  if (type.flags & flags.StringLiteral)
    return { type: 'string', const: (type as ts.StringLiteralType).value }
  if (type.flags & flags.NumberLiteral)
    return { type: 'number', const: (type as ts.NumberLiteralType).value }
  if (type.flags & flags.BooleanLiteral)
    return { type: 'boolean', const: checker.typeToString(type) === 'true' }
  if (type.flags & flags.StringLike) return { type: 'string' }
  if (type.flags & flags.NumberLike) return { type: 'number' }
  if (type.flags & flags.BooleanLike) return { type: 'boolean' }
  if (type.flags & flags.BigIntLike)
    return { type: 'string', description: 'Integer encoded as a string' }

  if (type.isUnion()) {
    const variants = type.types.filter(
      (item) => !(item.flags & flags.Undefined),
    )
    if (variants.length === 1) return schemaFor(variants[0], seen, depth + 1)
    const values = variants.map((item) => schemaFor(item, seen, depth + 1))
    if (
      values.every(
        (item) => item.type === 'string' && Object.hasOwn(item, 'const'),
      )
    )
      return { type: 'string', enum: values.map((item) => item.const) }
    return { anyOf: values }
  }
  if (type.isIntersection())
    return { allOf: type.types.map((item) => schemaFor(item, seen, depth + 1)) }
  if (checker.isArrayType(type)) {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0]
    return {
      type: 'array',
      items: element ? schemaFor(element, seen, depth + 1) : {},
    }
  }
  if (checker.isTupleType(type)) {
    const elements = checker.getTypeArguments(type as ts.TypeReference)
    return {
      type: 'array',
      prefixItems: elements.map((item) => schemaFor(item, seen, depth + 1)),
      minItems: elements.length,
      maxItems: elements.length,
    }
  }
  if (type.symbol?.name === 'Date')
    return { type: 'string', format: 'date-time' }
  if (type.symbol?.name === 'Uint8Array')
    return { type: 'string', format: 'byte' }

  const nextSeen = new Set(seen)
  nextSeen.add(type)
  const properties: Record<string, Schema> = {}
  const required: string[] = []
  for (const property of checker.getPropertiesOfType(type)) {
    if (property.name.startsWith('__') || property.name === 'then') continue
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    if (!declaration) continue
    properties[property.name] = schemaFor(
      checker.getTypeOfSymbolAtLocation(property, declaration),
      nextSeen,
      depth + 1,
    )
    if (!(property.flags & ts.SymbolFlags.Optional))
      required.push(property.name)
  }
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String)
  return {
    type: 'object',
    ...(Object.keys(properties).length ? { properties } : {}),
    ...(required.length ? { required } : {}),
    ...(index
      ? { additionalProperties: schemaFor(index, nextSeen, depth + 1) }
      : {}),
  }
}

const files = [
  'admin',
  'audit',
  'billing',
  'customer',
  'dashboard',
  'notifications',
  'seller-tools',
  'vpn-users',
  'wallet',
]
const schemas: Record<string, Schema> = {}
for (const file of files) {
  const source = program.getSourceFile(`src/orpc/router/${file}.ts`)
  if (!source) throw new Error(`Missing router source: ${file}`)
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      let expression = declaration.initializer
      while (
        expression &&
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression)
      ) {
        if (expression.expression.name.text === 'handler') {
          const handler = expression.arguments[0]
          const signature =
            handler && checker.getTypeAtLocation(handler).getCallSignatures()[0]
          if (signature) {
            const result = checker.getReturnTypeOfSignature(signature)
            const unwrapped = checker.getAwaitedType(result) ?? result
            schemas[`${file}.${declaration.name.getText(source)}`] =
              schemaFor(unwrapped)
          }
          break
        }
        expression = expression.expression.expression
      }
    }
  }
}

const output = 'src/orpc/output-schemas.generated.json'
if (process.argv.includes('--check')) {
  const existing = JSON.parse(readFileSync(output, 'utf8')) as Record<
    string,
    Schema
  >
  if (JSON.stringify(existing) !== JSON.stringify(schemas)) {
    throw new Error(`${output} is stale; run bun run api:schemas`)
  }
  console.log(`Checked ${Object.keys(schemas).length} response schemas`)
} else {
  writeFileSync(output, JSON.stringify(schemas, null, 2) + '\n')
  console.log(
    `Generated ${Object.keys(schemas).length} response schemas in ${output}`,
  )
}
