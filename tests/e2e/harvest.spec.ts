import { expect, test } from '@playwright/test'

test('a visitor runs the guided harvest and the books balance', async ({ page }) => {
  await page.goto('/demo')
  await page.getByRole('button', { name: 'Run the harvest' }).click()
  await expect(page.getByText(/Reconciled with Zamtel Money/)).toBeVisible({ timeout: 220_000 })
  await expect(page.getByText(/every hash verified/)).toBeVisible()
  // Mary's phone shows her payment.
  await expect(page.getByLabel(/Mary Banda's phone/)).toContainText('paid to your Zamtel Money')
})

test('the feature phone works from the keyboard like a real handset', async ({ page }) => {
  await page.goto('/farmer')
  const phone = page.getByLabel(/phone\. Type digits/)
  await phone.focus()
  for (const key of '*384*123#') await page.keyboard.press(key)
  await page.keyboard.press('Enter')
  await expect(phone).toContainText('1. Buyer offers')
  await page.keyboard.press('4')
  await page.keyboard.press('Enter')
  await expect(phone).toContainText('Trade record')
  await page.keyboard.press('Escape')
  await expect(phone).toContainText('Menu')
})

test('a tampered audit trail is caught', async ({ page }) => {
  await page.goto('/demo')
  await page.getByRole('button', { name: 'Run the harvest' }).click()
  await expect(page.getByText(/Reconciled with Zamtel Money/)).toBeVisible({ timeout: 220_000 })
  await page.goto('/audit')
  await page.getByRole('button', { name: /Change a payment in the database/ }).click()
  await page.getByRole('button', { name: 'Verify every hash' }).click()
  await expect(page.getByText('Tampered')).toBeVisible()
  await page.getByRole('button', { name: /Put it back/ }).click()
  await page.getByRole('button', { name: 'Verify every hash' }).click()
  await expect(page.getByText('Intact')).toBeVisible()
})
