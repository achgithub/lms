import { test, expect } from '@playwright/test'
import { loginAs, changePassword, createUser } from './helpers/api'

test.describe('Reports: role-based access', () => {
  test('reports-only user sees only reports tab', async ({ page }) => {
    let token: string
    try {
      token = await loginAs('reportsonly@test.lms', 'reportspw2')
    } catch {
      const adminToken = await loginAs('admin@lms.local', 'adminpw1')
        .catch(async () => {
          const t = await loginAs('admin@lms.local', 'changeme')
          return changePassword(t, 'changeme', 'adminpw1')
        })
      await createUser(adminToken, 'reportsonly@test.lms', 'Reports User', 'reports', 'reportspw1')
      token = await loginAs('reportsonly@test.lms', 'reportspw1')
      token = await changePassword(token, 'reportspw1', 'reportspw2')
    }

    await page.goto('/login')
    await page.getByTestId('input-email').fill('reportsonly@test.lms')
    await page.getByTestId('input-password').fill('reportspw2')
    await page.getByTestId('btn-login').click()

    if (await page.getByTestId('page-change-password').isVisible()) {
      await page.getByTestId('input-current-password').fill('reportspw1')
      await page.getByTestId('input-new-password').fill('reportspw2')
      await page.getByTestId('input-confirm-password').fill('reportspw2')
      await page.getByTestId('btn-change-password').click()
    }

    await expect(page.getByTestId('page-reports')).toBeVisible()
    await expect(page.getByTestId('tab-reports')).toBeVisible()
    await expect(page.getByTestId('tab-fixtures')).not.toBeVisible()
    await expect(page.getByTestId('tab-manager')).not.toBeVisible()
    await expect(page.getByTestId('tab-games')).not.toBeVisible()
  })

  test('reports-only user cannot navigate to /setup', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('input-email').fill('reportsonly@test.lms')
    await page.getByTestId('input-password').fill('reportspw2')
    await page.getByTestId('btn-login').click()
    if (await page.getByTestId('page-change-password').isVisible()) {
      await page.getByTestId('input-current-password').fill('reportspw1')
      await page.getByTestId('input-new-password').fill('reportspw2')
      await page.getByTestId('input-confirm-password').fill('reportspw2')
      await page.getByTestId('btn-change-password').click()
    }
    await page.goto('/setup')
    // Should redirect away — should not show setup page
    await expect(page.getByTestId('page-setup')).not.toBeVisible()
  })
})
