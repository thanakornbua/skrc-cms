import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDeleteUserAttributesCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand,
  AliasExistsException,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UserNotFoundException,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

const cognito = new CognitoIdentityProviderClient({ region: config.awsRegion });

export type ManagedUserRole = "admin" | "committee" | "competitor";

export interface ManagedUser {
  sub: string;
  username: string;
  email: string;
  name: string;
  status: string;
  enabled: boolean;
  role: ManagedUserRole;
  competitorId: string | null;
  createdAt: string | null;
  lastModifiedAt: string | null;
}

interface CognitoUserWithGroups extends ManagedUser {
  groups: string[];
}

function attribute(user: { Attributes?: Array<{ Name?: string; Value?: string }> }, name: string): string {
  return user.Attributes?.find((item) => item.Name === name)?.Value ?? "";
}

function userFromCognito(
  user: {
    Username?: string;
    Attributes?: Array<{ Name?: string; Value?: string }>;
    UserStatus?: string;
    Enabled?: boolean;
    UserCreateDate?: Date;
    UserLastModifiedDate?: Date;
  },
  groups: string[]
): CognitoUserWithGroups | null {
  const sub = attribute(user, "sub");
  const username = user.Username;
  if (!sub || !username) return null;
  const role: ManagedUserRole = groups.includes("admin")
    ? "admin"
    : groups.includes("committee")
      ? "committee"
      : "competitor";
  return {
    sub,
    username,
    email: attribute(user, "email"),
    name: attribute(user, "name"),
    status: user.UserStatus ?? "UNKNOWN",
    enabled: user.Enabled ?? true,
    role,
    competitorId: attribute(user, "custom:competitorId") || null,
    createdAt: user.UserCreateDate?.toISOString() ?? null,
    lastModifiedAt: user.UserLastModifiedDate?.toISOString() ?? null,
    groups,
  };
}

async function listAllUsers(): Promise<Array<NonNullable<ReturnType<typeof userFromCognito>>>> {
  const users: Array<{
    Username?: string;
    Attributes?: Array<{ Name?: string; Value?: string }>;
    UserStatus?: string;
    Enabled?: boolean;
    UserCreateDate?: Date;
    UserLastModifiedDate?: Date;
  }> = [];
  let paginationToken: string | undefined;
  do {
    const page = await cognito.send(new ListUsersCommand({
      UserPoolId: config.cognitoUserPoolId,
      PaginationToken: paginationToken,
      Limit: 60,
    }));
    users.push(...(page.Users ?? []));
    paginationToken = page.PaginationToken;
  } while (paginationToken);

  const groupsByUsername = new Map<string, string[]>();
  for (const groupName of ["admin", "committee"] as const) {
    let groupToken: string | undefined;
    do {
      const page = await cognito.send(new ListUsersInGroupCommand({
        UserPoolId: config.cognitoUserPoolId,
        GroupName: groupName,
        NextToken: groupToken,
        Limit: 60,
      }));
      for (const user of page.Users ?? []) {
        if (!user.Username) continue;
        const groups = groupsByUsername.get(user.Username) ?? [];
        groups.push(groupName);
        groupsByUsername.set(user.Username, groups);
      }
      groupToken = page.NextToken;
    } while (groupToken);
  }

  return users
    .map((user) => userFromCognito(user, groupsByUsername.get(user.Username ?? "") ?? []))
    .filter((user): user is NonNullable<typeof user> => Boolean(user))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function publicUser(user: CognitoUserWithGroups): ManagedUser {
  const { groups: _groups, ...result } = user;
  return result;
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  return (await listAllUsers()).map(publicUser);
}

async function findUserBySub(sub: string): Promise<CognitoUserWithGroups> {
  const user = (await listAllUsers()).find((item) => item.sub === sub);
  if (!user) throw new ApiError(404, "AUTH_USER_NOT_FOUND", "User account no longer exists");
  return user;
}

function mapCognitoWriteError(error: unknown): never {
  if (error instanceof UsernameExistsException || error instanceof AliasExistsException) {
    throw new ApiError(409, "USER_EXISTS", "A user with this email already exists");
  }
  if (error instanceof UserNotFoundException) {
    throw new ApiError(404, "AUTH_USER_NOT_FOUND", "User account no longer exists");
  }
  throw error;
}

export async function createManagedUser(input: {
  email: string;
  name: string;
  temporaryPassword: string;
  role: ManagedUserRole;
  competitorId: string | null;
}): Promise<ManagedUser> {
  let created;
  try {
    created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: config.cognitoUserPoolId,
      Username: input.email,
      TemporaryPassword: input.temporaryPassword,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: input.email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: input.name },
        ...(input.competitorId
          ? [{ Name: "custom:competitorId", Value: input.competitorId }]
          : []),
      ],
    }));
    if (input.role !== "competitor") {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: config.cognitoUserPoolId,
        Username: input.email,
        GroupName: input.role,
      }));
    }
  } catch (error) {
    // AdminCreateUser and group assignment are separate Cognito operations. If
    // the second operation fails, remove the just-created account so a user
    // cannot be left without the role the admin was shown as creating.
    if (created?.User?.Username) {
      await cognito.send(new AdminDeleteUserCommand({
        UserPoolId: config.cognitoUserPoolId,
        Username: created.User.Username,
      })).catch(() => undefined);
    }
    mapCognitoWriteError(error);
  }

  if (!created?.User) throw new ApiError(500, "INTERNAL_ERROR", "Cognito did not return the created user");
  const user = userFromCognito(created.User, input.role === "competitor" ? [] : [input.role]);
  if (!user) throw new ApiError(500, "INTERNAL_ERROR", "Cognito returned an incomplete user record");
  return publicUser(user);
}

export async function resetManagedUserPassword(sub: string): Promise<ManagedUser> {
  const user = await findUserBySub(sub);
  // Password delivery is intentionally delegated to Cognito; no password or
  // reset code crosses this API or is stored by the application.
  const { requestPasswordReset } = await import("../auth/admin.js");
  await requestPasswordReset(user.username, "the user");
  return publicUser(user);
}

async function assertAdminContinuity(user: CognitoUserWithGroups, nextRole: ManagedUserRole, nextEnabled: boolean): Promise<void> {
  if (user.role !== "admin" || (nextRole === "admin" && nextEnabled)) return;
  const enabledAdmins = (await listAllUsers()).filter((item) => item.role === "admin" && item.enabled);
  if (enabledAdmins.length <= 1) {
    throw new ApiError(409, "LAST_ADMIN", "The last enabled administrator cannot be disabled or assigned another role");
  }
}

export async function updateManagedUser(
  sub: string,
  input: { email: string; name: string; role: ManagedUserRole; competitorId: string | null; enabled: boolean },
  actorSub: string
): Promise<ManagedUser> {
  const user = await findUserBySub(sub);
  if (sub === actorSub && (input.role !== "admin" || !input.enabled)) {
    throw new ApiError(409, "SELF_LOCKOUT", "You cannot disable or remove the admin role from your own account");
  }
  await assertAdminContinuity(user, input.role, input.enabled);

  try {
    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: config.cognitoUserPoolId,
      Username: user.username,
      UserAttributes: [
        { Name: "email", Value: input.email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: input.name },
        ...(input.competitorId
          ? [{ Name: "custom:competitorId", Value: input.competitorId }]
          : []),
      ],
    }));
    if (!input.competitorId && user.competitorId) {
      await cognito.send(new AdminDeleteUserAttributesCommand({
        UserPoolId: config.cognitoUserPoolId,
        Username: user.username,
        UserAttributeNames: ["custom:competitorId"],
      }));
    }

    // Add the new privileged role first, then remove stale groups. This avoids
    // leaving the account role-less if Cognito rejects the group addition.
    if (input.role !== "competitor" && !user.groups.includes(input.role)) {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: config.cognitoUserPoolId,
        Username: user.username,
        GroupName: input.role,
      }));
    }
    for (const currentGroup of user.groups) {
      if (currentGroup === input.role) continue;
      await cognito.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: config.cognitoUserPoolId,
        Username: user.username,
        GroupName: currentGroup,
      }));
    }

    if (input.enabled !== user.enabled) {
      const Command = input.enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
      await cognito.send(new Command({
        UserPoolId: config.cognitoUserPoolId,
        Username: user.username,
      }));
    }
  } catch (error) {
    mapCognitoWriteError(error);
  }

  return {
    ...publicUser(user),
    email: input.email,
    name: input.name,
    role: input.role,
    competitorId: input.competitorId,
    enabled: input.enabled,
    lastModifiedAt: new Date().toISOString(),
  };
}

export async function stampCompetitorId(
  sub: string,
  competitorId: string
): Promise<void> {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: config.cognitoUserPoolId,
      Username: sub,
      UserAttributes: [{ Name: "custom:competitorId", Value: competitorId }],
    })
  );
}
