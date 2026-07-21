import { readFileSync } from "node:fs";

export interface StaffEntry {
  username: string;
  name: string;
  role: "admin" | "committee";
  tempPassword: string;
}

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

export function loadStaffList(path: string): StaffEntry[] {
  const lines = readFileSync(path, "utf-8").replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
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
