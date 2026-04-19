import { test, expect } from '@playwright/test'
import { loginAs, changePassword, createUser } from './helpers/api'

// Note: these tests require FOOTBALL_API_KEY to be set.
// If not set, the competitions endpoint returns 503 and the test is skipped.

test.describe('Fixtures Tab', () => {
  async function loginManager(page: import('@playwright/test').Page) {
    let email = 'fixturemgr@test.lms'
    let pw = 'fixturepw2'
    try {
      await loginAs(email, pw)
    } catch {
      const adminToken = await loginAs('admin@lms.local', 'adminpw1')
        .catch(async () => {
          const t = await loginAs('admin@lms.local', 'changeme')
          return changePassword(t, 'changeme', 'adminpw1')
        })
      await createUser(adminToken, email, 'Fixture Manager', 'manager', 'fixturepw1')
      const t = await loginAs(email, 'fixturepw1')
      await changePassword(t, 'fixturepw1', pw)
    }
    await page.goto('/login')
    await page.getByTestId('input-email').fill(email)
    await page.getByTestId('input-password').fill(pw)
    await page.getByTestId('btn-login').click()
    if (await page.getByTestId('page-change-password').isVisible()) {
      await page.getByTestId('input-current-password').fill('fixturepw1')
      await page.getByTestId('input-new-password').fill(pw)
      await page.getByTestId('input-confirm-password').fill(pw)
      await page.getByTestId('btn-change-password').click()
    }
    await expect(page.getByTestId('page-fixtures')).toBeVisible()
  }

  test('fixtures tab renders', async ({ page }) => {
    await loginManager(page)
    await expect(page.getByTestId('select-competition')).toBeVisible()
    await expect(page.getByTestId('btn-preview-fixtures')).toBeVisible()
  })

  test('preview button disabled until competition selected', async ({ page }) => {
    await loginManager(page)
    await expect(page.getByTestId('btn-preview-fixtures')).toBeDisabled()
  })

  test('shows error if API key not configured', async ({ page }) => {
    await loginManager(page)
    // If the competition dropdown shows error, that means no API key
    const errorEl = page.getByTestId('fixtures-error')
    const isError = await errorEl.isVisible()
    if (isError) {
      await expect(errorEl).toContainText('FOOTBALL_API_KEY')
      test.skip() // Skip the rest if no API key
    }
  })
})
