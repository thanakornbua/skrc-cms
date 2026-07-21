import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { loadStaffList, type StaffEntry } from "./staff-roster.js";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const cliArgs = process.argv.slice(2);
const VALIDATE_ONLY = cliArgs.includes("--validate-only");
const STAFF_LIST_PATH = cliArgs.find((arg) => !arg.startsWith("--")) ?? "../roster.csv";

const cognito = new CognitoIdentityProviderClient({ region: REGION });

async function userExists(username: string): Promise<boolean> {
  try {
    await cognito.send(
      new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
    );
    return true;
  } catch (err) {
    if (err instanceof UserNotFoundException) return false;
    throw err;
  }
}

async function bootstrapOne(entry: StaffEntry): Promise<void> {
  if (await userExists(entry.username)) {
    console.log(`  ${entry.username}: already exists — skipping (never overwritten).`);
    return;
  }

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: entry.username,
      UserAttributes: [
        { Name: "email", Value: entry.username },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: entry.name },
      ],
      TemporaryPassword: entry.tempPassword,
      MessageAction: "SUPPRESS",
    })
  );

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: entry.username,
      GroupName: entry.role,
    })
  );

  console.log(`  ${entry.username}: created in group "${entry.role}".`);
}

async function main(): Promise<void> {
  const staff = loadStaffList(STAFF_LIST_PATH);
  if (VALIDATE_ONLY) {
    console.log(`Validated ${staff.length} staff row(s) from ${STAFF_LIST_PATH}; no Cognito writes made.`);
    return;
  }
  if (!USER_POOL_ID) {
    throw new Error("COGNITO_USER_POOL_ID env var is required (run ops/create-auth.ts first)");
  }

  console.log(`Bootstrapping ${staff.length} staff account(s) from ${STAFF_LIST_PATH}...`);

  for (const entry of staff) {
    await bootstrapOne(entry);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("bootstrap-staff failed:", err);
  process.exit(1);
});
