// Checks if the error is related to a missing table in the database
// TODO implement auto migration

export function isTableNotFoundError(err: any, name: string) {
  return err.message?.includes(`no such table: ${name}`)
}
