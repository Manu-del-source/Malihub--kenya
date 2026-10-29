import assert from "node:assert/strict";
import test from "node:test";
import { isDisposableEmail } from "@/lib/validations/disposable-email";
import { registerSchema } from "@/lib/validations/auth";

test("identifies known disposable email domains case-insensitively", () => {
  assert.equal(isDisposableEmail("person@mailinator.com"), true);
  assert.equal(isDisposableEmail("person@0-mail.com"), true);
  assert.equal(isDisposableEmail("person@YOPMAIL.COM"), true);
  assert.equal(isDisposableEmail("person@sub.mailinator.com"), true);
  assert.equal(isDisposableEmail("yacibeh412@moblha.com"), true);
});

test("does not classify common legitimate email providers as disposable", () => {
  assert.equal(isDisposableEmail("person@gmail.com"), false);
  assert.equal(isDisposableEmail("person@outlook.com"), false);
  assert.equal(isDisposableEmail("person@yahoo.com"), false);
});

test("registration schema rejects disposable domains before account creation", () => {
  const result = registerSchema.safeParse({
    email: "person@mailinator.com",
    password: "Password1",
    confirmPassword: "Password1",
    agreeToTerms: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues.map((issue) => issue.message).join(" "), /disposable email/i);
  }
});

test("registration schema accepts a normal email address", () => {
  const result = registerSchema.safeParse({
    email: "person@gmail.com",
    password: "Password1",
    confirmPassword: "Password1",
    agreeToTerms: true,
  });

  assert.equal(result.success, true);
});
