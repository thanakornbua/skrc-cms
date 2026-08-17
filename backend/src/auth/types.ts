export type Role = "admin" | "committee" | "competitor";

export interface AuthedUser {
  sub: string;
  username: string;
  /** Name to show in audit records, so a trail reads "Somchai" not a UUID. */
  displayName: string;
  role: Role;
  competitorId: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
  }
}

/**
 * Who performed an action, for the audit trail. The id is the stable key; the
 * name is denormalised at write time so the record still reads correctly if the
 * account is later renamed or removed — the same reason applied penalties
 * snapshot their label and value.
 */
export interface Actor {
  id: string;
  name: string;
}

export function actorOf(user: AuthedUser): Actor {
  return { id: user.username, name: user.displayName };
}
