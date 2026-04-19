import { test, expect } from '@playwright/test'
import { getAdminToken, changePassword, createUser, loginAs } from './helpers/api'

let adminToken: string

test.beforeAll(async () => {
  // Ensure admin has a known password
  try {
    adminToken = await getAdminToken()
    adminToken = await changePassword(adminToken, 'changeme', 'adminpw1')
  } catch {
    adminToken = await loginAs('admin@lms.local', 'adminpw1')
  }
})

async function loginAdminUI(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByTestId('input-email').fill('admin@lms.local')
  await page.getByTestId('input-password').fill('adminpw1')
  await page.getByTestId('btn-login').click()
  await expect(page.getByTestId('page-users')).toBeVisible()
}

test.describe('Admin: User Management', () => {
  test('admin sees Users tab only', async ({ page }) => {
    await loginAdminUI(page)
    await expect(page.getByTestId('tab-users')).toBeVisible()
    await expect(page.getByTestId('tab-fixtures')).not.toBeVisible()
    await expect(page.getByTestId('tab-games')).not.toBeVisible()
  })

  test('create a manager user', async ({ page }) => {
    await loginAdminUI(page)
    await page.getByTestId('input-user-email').fill('manager@test.lms')
    await page.getByTestId('input-user-name').fill('Test Manager')
    await page.getByTestId('select-user-role').selectOption('manager')
    await page.getByTestId('input-user-password').fill('managerpass1')
    await page.getByTestId('btn-create-user').click()
    await expect(page.locator('[data-testid^="user-row-"]').filter({ hasText: 'Test Manager' })).toBeVisible()
  })

  test('edit a user role', async ({ page }) => {
    await loginAdminUI(page)
    const row = page.locator('[data-testid^="user-row-"]').filter({ hasText: 'Test Manager' })
    const id = (await row.getAttribute('data-testid'))?.replace('user-row-', '')
    await row.getByTestId(`btn-edit-user-${id}`).click()
    await page.getByTestId(`select-edit-role-${id}`).selectOption('games')
    await page.getByTestId(`btn-save-user-${id}`).click()
    await expect(row.getByTestId(`badge-role-${id}`)).toHaveText('games')
  })

  test('delete a user', async ({ page }) => {
    // Create a user to delete
    const userId = await createUser(adminToken, 'todelete@test.lms', 'To Delete', 'reports', 'temppass1')
    await loginAdminUI(page)
    const row = page.getByTestId(`user-row-${userId}`)
    await row.getByTestId(`btn-delete-user-${userId}`).click()
    await expect(page.getByTestId('modal-delete-user')).toBeVisible()
    await page.getByTestId('btn-confirm-delete-user').click()
    await expect(page.getByTestId(`user-row-${userId}`)).not.toBeVisible()
  })

  test('non-admin cannot access /admin/users', async ({ page }) => {
    const mgr = await createUser(adminToken, 'blocked@test.lms', 'Blocked', 'manager', 'blockedpw1')
    const token = await loginAs('blocked@test.lms', 'blockedpw1')
    await page.goto('/login')
    await page.getByTestId('input-email').fill('blocked@test.lms')
    await page.getByTestId('input-password').fill('blockedpw1')
    await page.getByTestId('btn-login').click()
    // Manager should land on fixtures, not users
    await expect(page.getByTestId('tab-fixtures')).toBeVisible()
    await expect(page.getByTestId('tab-users')).not.toBeVisible()
  })
})
