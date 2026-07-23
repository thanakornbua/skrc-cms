import assert from "node:assert/strict";
import test from "node:test";
import { buildResetEmail } from "./reset-email.js";

const config = {
  portalUrl: "https://competitive.skrc.suankularb.space/portal",
  contactAddress: "skrc@skrc.suankularb.space",
};

test("embeds the code, portal link, and a definitive 1-hour expiry", () => {
  const content = buildResetEmail("483920", config);
  assert.match(content.subject, /Password reset code/);
  for (const part of [content.text, content.html]) {
    assert.ok(part.includes("483920"), "code present");
    assert.ok(part.includes(config.portalUrl), "portal link present");
    assert.ok(part.includes("1 hour"), "definitive expiry present");
    assert.ok(part.includes("1 ชั่วโมง"), "Thai expiry present");
  }
});

test("html keeps the SKRC signature gradient hairline and violet accent", () => {
  const { html } = buildResetEmail("000000", config);
  assert.ok(html.includes("linear-gradient(135deg,#e040fb,#7c3aed 50%,#3b82f6)"));
  assert.ok(html.includes("#7c3aed"));
});
