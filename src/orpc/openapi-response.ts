import schemas from './output-schemas.generated.json'

/** Document a handler's inferred JSON result without changing its runtime output type. */
export function outputSpec(name: keyof typeof schemas, publicAccess = false) {
  return <T extends { responses?: Record<string, unknown> }>(
    operation: T,
  ): T => ({
    ...operation,
    ...(publicAccess ? { security: [] } : {}),
    responses: {
      ...operation.responses,
      200: {
        description: 'OK',
        content: { 'application/json': { schema: schemas[name] } },
      },
    },
  })
}
