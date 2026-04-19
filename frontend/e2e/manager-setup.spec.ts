import { test, expect } from '@playwright/test'
import { getAdminToken, changePassword, createUser, loginAs } from './helpers/api'

let managerToken: string

test.beforeAll(async () => {
  const adminToken = await getAdminToken()
    .then(t => changePassword(t, 'changeme', 'adminpw1').catch(() => loginAs('admin@lms.local', 'adminpw1')))
  const id = await createUser(await loginAs('admin@lms.local', 'adminpw1'), 'setupmgr@test.lms', 'Setup Manager', 'manager', 'mgrtestpw1')
    .catch(async () => {
      // user already exists
      managerToken = await loginAs('setupmgr@test.lms', 'mgrtestpw1')
      return 0
    })
  if (id) {
    managerToken = await loginAs('setupmgr@test.lms', 'mgrtestpw1')
    // Must change pw on first login
    managerToken = await changePassword(managerToken, 'mgrtestpw1', 'mgrtestpw2')
  }
})

async function loginManagerUI(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByTestId('input-email').fill('setupmgr@test.lms')
  await page.getByTestId('input-password').fill('mgrtestpw2')
  await page.getByTestId('btn-login').click()
  // May need to change password
  if (await page.getByTestId('page-change-password').isVisible()) {
    await page.getByTestId('input-current-password').fill('mgrtestpw1')
    await page.getByTestId('input-new-password').fill('mgrtestpw2')
    await page.getByTestId('input-confirm-password').fill('mgrtestpw2')
    await page.getByTestId('btn-change-password').click()
  }
  await page.getByTestId('tab-manager').click()
  await expect(page.getByTestId('page-setup')).toBeVisible()
}

test.describe('Manager: Setup Tab', () => {
  test('manager sees correct tabs', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('input-email').fill('setupmgr@test.lms')
    await page.getByTestId('input-password').fill('mgrtestpw2')
    await page.getByTestId('btn-login').click()
    if (await page.getByTestId('page-change-password').isVisible()) {
      await page.getByTestId('input-current-password').fill('mgrtestpw1')
      await page.getByTestId('input-new-password').fill('mgrtestpw2')
      await page.getByTestId('input-confirm-password').fill('mgrtestpw2')
      await page.getByTestId('btn-change-password').click()
    }
    await expect(page.getByTestId('tab-fixtures')).toBeVisible()
    await expect(page.getByTestId('tab-manager')).toBeVisible()
    await expect(page.getByTestId('tab-games')).toBeVisible()
    await expect(page.getByTestId('tab-reports')).toBeVisible()
    await expect(page.getByTestId('tab-users')).not.toBeVisible()
  })

  test('add and delete a player', async ({ page }) => {
    await loginManagerUI(page)
    await page.getByTestId('input-player-name').fill('Alice')
    await page.getByTestId('btn-add-player').click()
    await expect(page.locator('[data-testid^="player-row-"]').filter({ hasText: 'Alice' })).toBeVisible()

    const row = page.locator('[data-testid^="player-row-"]').filter({ hasText: 'Alice' })
    const id = (await row.getAttribute('data-testid'))?.replace('player-row-', '')
    await page.getByTestId(`btn-delete-player-${id}`).click()
    await page.getByTestId('btn-confirm-action').click()
    await expect(page.locator('[data-testid^="player-row-"]').filter({ hasText: 'Alice' })).not.toBeVisible()
  })

  test('add a group and teams', async ({ page }) => {
    await loginManagerUI(page)
    await page.getByTestId('input-group-name').fill('Test League')
    await page.getByTestId('btn-add-group').click()
    const groupRow = page.locator('[data-testid^="group-row-"]').filter({ hasText: 'Test League' })
    await expect(groupRow).toBeVisible()

    const groupId = (await groupRow.getAttribute('data-testid'))?.replace('group-row-', '')
    await page.getByTestId(`btn-toggle-group-${groupId}`).click()
    await page.getByTestId(`input-team-name-${groupId}`).fill('Arsenal')
    await page.getByTestId(`btn-add-team-${groupId}`).click()
    await expect(page.getByTestId(`team-list-${groupId}`).getByText('Arsenal')).toBeVisible()
  })
})
