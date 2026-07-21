import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { loadStaffList } from "./staff-roster.js";

const argv = process.argv.slice(2);
const confirmIndex = argv.indexOf("--confirm");
const confirmToken = confirmIndex >= 0 ? argv[confirmIndex + 1] : undefined;
const execute = argv.includes("--execute");
if (execute && confirmToken !== "RESET-STAFF") throw new Error("Execution requires --confirm RESET-STAFF");

const positional = argv.filter((arg, i) => !arg.startsWith("--") && i !== confirmIndex + 1);
const STAFF_LIST_PATH = positional[0] ?? "../roster.csv";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
if (!USER_POOL_ID) throw new Error("COGNITO_USER_POOL_ID env var is required (run ops/create-auth.ts first)");

const cognito = new CognitoIdentityProviderClient({ region: REGION });

async function listGroupUsernames(groupName: string): Promise<string[]> {
  const usernames: string[] = [];
  let token: string | undefined;
  do {
    const page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: groupName, NextToken: token }));
    for (const user of page.Users ?? []) if (user.Username) usernames.push(user.Username);
    token = page.NextToken;
  } while (token);
  return usernames;
}

async function main(): Promise<void> {
  const staff = loadStaffList(STAFF_LIST_PATH);

  // Clean slate: every existing admin/committee account is removed first, not just
  // the ones still present in roster.csv — a staff member dropped from the roster
  // must lose access, not linger as an orphaned Cognito user.
  const existing = [...new Set([...(await listGroupUsernames("admin")), ...(await listGroupUsernames("committee"))])];
  console.log(`${execute ? "Deleting" : "Would delete"} ${existing.length} existing admin/committee account(s)...`);
  for (const username of existing) {
    console.log(`  ${username}`);
    if (execute) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  }

  console.log(`${execute ? "Creating" : "Would create"} ${staff.length} staff account(s) from ${STAFF_LIST_PATH}...`);
  for (const entry of staff) {
    console.log(`  ${entry.username}: group "${entry.role}"`);
    if (execute) {
      await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: entry.username,
        UserAttributes: [
          { Name: "email", Value: entry.username },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: entry.name },
        ],
        TemporaryPassword: entry.tempPassword,
        MessageAction: "SUPPRESS",
      }));
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: entry.username, GroupName: entry.role }));
    }
  }

  console.log(execute ? "Done." : "Preview only — rerun with --execute --confirm RESET-STAFF to apply.");
}

main().catch((err) => {
  console.error("reset-staff failed:", err);
  process.exit(1);
});
