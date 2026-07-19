import { readFileSync } from "node:fs";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";

const REGION = process.env.AWS_REGION ?? "ap-southeast-7";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const cliArgs = process.argv.slice(2);
const VALIDATE_ONLY = cliArgs.includes("--validate-only");
const STAFF_LIST_PATH = cliArgs.find((arg) => !arg.startsWith("--")) ?? "../roster.csv";

interface StaffEntry {
  username: string;
  name: string;
  role: "admin" | "committee";
  tempPassword: string;
}

const cognito = new CognitoIdentityProviderClient({ region: REGION });

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value.trim()); value = "";
    } else value += char;
  }
  if (quoted) throw new Error("Unclosed quote in CSV row");
  values.push(value.trim());
  return values;
}

function loadStaffList(path: string): StaffEntry[] {
  const lines = readFileSync(path, "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("roster.csv must contain a header and at least one staff row");
  const header = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
  const required = ["role", "name", "surname", "email", "temp_pwd"];
  const index = Object.fromEntries(required.map((column) => [column, header.indexOf(column)]));
  for (const column of required) {
    if (index[column] < 0) throw new Error(`roster.csv is missing required column "${column}"`);
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const staff = lines.slice(1).map((line, rowIndex): StaffEntry => {
    const row = parseCsvLine(line);
    const rowNumber = rowIndex + 2;
    const rawRole = (row[index.role] ?? "").toLowerCase();
    const role = rawRole === "comittee" ? "committee" : rawRole;
    const username = (row[index.email] ?? "").toLowerCase();
    const tempPassword = row[index.temp_pwd] ?? "";
    const fullName = [row[index.name], row[index.surname]].filter(Boolean).join(" ").trim();
    if (role !== "admin" && role !== "committee") errors.push(`row ${rowNumber}: role must be admin or committee`);
    if (!/^\S+@\S+\.\S+$/.test(username)) errors.push(`row ${rowNumber}: invalid email`);
    if (!fullName) errors.push(`row ${rowNumber}: name is required`);
    if (tempPassword.length < 8) errors.push(`row ${rowNumber}: temp_pwd must be at least 8 characters`);
    if (seen.has(username)) errors.push(`row ${rowNumber}: duplicate email`);
    seen.add(username);
    return { username, name: fullName, role: role as StaffEntry["role"], tempPassword };
  });
  if (errors.length) throw new Error(`roster.csv validation failed before any Cognito writes:\n${errors.join("\n")}`);
  return staff;
}

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
