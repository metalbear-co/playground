import { expect, test } from "@playwright/test";

test("fetches the account and logs in through the portal", async ({ page, request }) => {
  const accountUrl = process.env.ACCOUNT_URL;
  expect(accountUrl, "ACCOUNT_URL").toBeTruthy();

  const accountResponse = await request.get(`${accountUrl}/v2/account`, {
    headers: { "x-mirrord-session": "" },
  });
  expect(accountResponse.ok()).toBeTruthy();
  const account = await accountResponse.json();
  expect(account.username).toBeTruthy();
  expect(account.email).toBeTruthy();

  await page.goto("/");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD || "demo-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toContainText(`Signed in as ${account.username}`);
});
