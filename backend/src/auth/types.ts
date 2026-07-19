export type Role = "admin" | "committee" | "competitor";

export interface AuthedUser {
  sub: string;
  username: string;
  role: Role;
  competitorId: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
  }
}
