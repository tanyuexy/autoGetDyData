export type PersistenceDriver = "mongo";

export function getPersistenceDriver(): PersistenceDriver {
  return "mongo";
}

export function isMongoPersistenceEnabled(): boolean {
  return true;
}
