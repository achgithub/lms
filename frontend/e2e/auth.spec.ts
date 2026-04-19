import { test, expect } from '@playwright/test'
import { getAdminToken, changePassword, loginAs } from './helpers/api'

test.describe('Authentication', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('page-login')).toBeVisible()
    await expect(page.getByTestId('input-email')).toBeVisible()
    await expect(page.getByTestId('input-password')).toBeVisible()
    await expect(page.getByTestId('btn-login')).toBeVisible()
  })

  test('shows error on bad credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('input-email').fill('nobody@example.com')
    await page.getByTestId('input-password').fill('wrongpassword')
    await page.getByTestId('btn-login').click()
    await expect(page.getByTestId('login-error')).toBeVisible()
  })

  test('admin login redirects to change-password on first login', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('input-email').fill('admin@lms.local')
    await page.getByTestId('input-password').fill('changeme')
    await page.getByTestId('btn-login').click()
    await expect(page.getByTestId('page-change-password')).toBeVisible()
  })

  test('force change password flow', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('input-email').fill('admin@lms.local')
    await page.getByTestId('input-password').fill('changeme')
    await page.getByTestId('btn-login').click()
    await expect(page.getByTestId('page-change-password')).toBeVisible()

    await page.getByTestId('input-current-password').fill('changeme')
    await page.getByTestId('input-new-password').fill('newpassword1')
    await page.getByTestId('input-confirm-password').fill('newpassword1')
    await page.getByTestId('btn-change-password').click()

    // Should land on admin page after pw change
    await expect(page.getByTestId('app-shell')).toBeVisible()

    // Reset for other tests: change back
    const token = await loginAs('admin@lms.local', 'newpassword1')
    await changePassword(token, 'newpassword1', 'changeme')
  })

  test('logout clears session', async ({ page }) => {
    // Login as admin (via API first to get past force-change if needed)
    let token = await getAdminToken()
    try {
      token = await changePassword(token, 'changeme', 'testpw99')
      token = await changePassword(token, 'testpw99', 'changeme')
    } catch { /* already changed */ }

    await page.goto('/login')
    await page.getByTestId('input-email').fill('admin@lms.local')
    await page.getByTestId('input-password').fill('changeme')
    await page.getByTestId('btn-login').click()

    // May land on change-password if not yet done
    if (await page.getByTestId('page-change-password').isVisible()) {
      await page.getByTestId('input-current-password').fill('changeme')
      await page.getByTestId('input-new-password').fill('changeme2')
      await page.getByTestId('input-confirm-password').fill('changeme2')
      await page.getByTestId('btn-change-password').click()
    }

    await expect(page.getByTestId('app-shell')).toBeVisible()
    await page.getByTestId('btn-logout').click()
    await expect(page.getByTestId('page-login')).toBeVisible()
  })
})
