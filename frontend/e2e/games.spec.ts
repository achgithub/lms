import { test, expect } from '@playwright/test'
import { loginAs, changePassword, createUser, createGroup, createTeam, createPlayer, createGame } from './helpers/api'

let managerToken: string
let gameId: number

test.beforeAll(async () => {
  // Setup: get or create a manager with known credentials
  try {
    managerToken = await loginAs('gamemgr@test.lms', 'gamemgrpw2')
  } catch {
    const adminToken = await loginAs('admin@lms.local', 'adminpw1')
      .catch(async () => {
        const t = await loginAs('admin@lms.local', 'changeme')
        return changePassword(t, 'changeme', 'adminpw1')
      })
    await createUser(adminToken, 'gamemgr@test.lms', 'Game Manager', 'manager', 'gamemgrpw1')
    const t = await loginAs('gamemgr@test.lms', 'gamemgrpw1')
    managerToken = await changePassword(t, 'gamemgrpw1', 'gamemgrpw2')
  }

  // Seed a group, teams, players, game
  const groupId = await createGroup(managerToken, 'Test League E2E')
  await createTeam(managerToken, groupId, 'Arsenal')
  await createTeam(managerToken, groupId, 'Chelsea')
  await createTeam(managerToken, groupId, 'Liverpool')
  await createPlayer(managerToken, 'Alice')
  await createPlayer(managerToken, 'Bob')
  gameId = await createGame(managerToken, {
    name: 'E2E Test Game',
    groupId,
    playerNames: ['Alice', 'Bob'],
    pickMode: 'manager',
  })
})

async function loginManager(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByTestId('input-email').fill('gamemgr@test.lms')
  await page.getByTestId('input-password').fill('gamemgrpw2')
  await page.getByTestId('btn-login').click()
  if (await page.getByTestId('page-change-password').isVisible()) {
    await page.getByTestId('input-current-password').fill('gamemgrpw1')
    await page.getByTestId('input-new-password').fill('gamemgrpw2')
    await page.getByTestId('input-confirm-password').fill('gamemgrpw2')
    await page.getByTestId('btn-change-password').click()
  }
}

test.describe('Games: full round lifecycle', () => {
  test('game appears in list', async ({ page }) => {
    await loginManager(page)
    await page.getByTestId('tab-games').click()
    await expect(page.getByTestId(`game-card-${gameId}`)).toBeVisible()
  })

  test('open game detail', async ({ page }) => {
    await loginManager(page)
    await page.goto(`/games/${gameId}`)
    await expect(page.getByTestId('page-game-detail')).toBeVisible()
    await expect(page.getByTestId('badge-game-status')).toHaveText('active')
    await expect(page.getByTestId('open-round-panel')).toBeVisible()
  })

  test('participants listed', async ({ page }) => {
    await loginManager(page)
    await page.goto(`/games/${gameId}`)
    await expect(page.getByTestId('participants-list')).toContainText('Alice')
    await expect(page.getByTestId('participants-list')).toContainText('Bob')
  })

  test('hold-to-reveal shows pick dropdowns', async ({ page }) => {
    await loginManager(page)
    await page.goto(`/games/${gameId}`)
    // Picks should be masked initially
    await expect(page.getByTestId('picks-table')).toBeVisible()

    // Hold the reveal button
    const revealBtn = page.getByTestId('btn-reveal-picks')
    await revealBtn.dispatchEvent('mousedown')
    // Dropdowns should now be visible
    await expect(page.locator('[data-testid^="select-pick-"]').first()).toBeVisible()
    await revealBtn.dispatchEvent('mouseup')
  })

  test('save picks', async ({ page }) => {
    await loginManager(page)
    await page.goto(`/games/${gameId}`)
    const revealBtn = page.getByTestId('btn-reveal-picks')
    await revealBtn.dispatchEvent('mousedown')

    await page.locator('[data-testid^="select-pick-Alice"]').selectOption({ index: 1 })
    await page.locator('[data-testid^="select-pick-Bob"]').selectOption({ index: 2 })
    await revealBtn.dispatchEvent('mouseup')

    await page.getByTestId('btn-save-picks').click()
    await expect(page.getByTestId('game-message')).toContainText('saved')
  })

  test('finalize picks', async ({ page }) => {
    await loginManager(page)
    await page.goto(`/games/${gameId}`)
    await page.getByTestId('btn-finalize-picks').click()
    await expect(page.getByTestId('game-message')).toContainText('finalis')
    await expect(page.getByTestId('results-panel')).toBeVisible()
  })

  test('enter results and close round', async ({ page }) => {
    await loginManager(page)
    await page.goto(`/games/${gameId}`)

    // Enter win for Alice's team and loss for Bob's team
    const resultRows = page.locator('[data-testid^="result-row-"]')
    const firstRow = resultRows.first()
    await firstRow.locator('[data-testid^="btn-result-win-"]').click()
    const secondRow = resultRows.nth(1)
    await secondRow.locator('[data-testid^="btn-result-loss-"]').click()

    await page.getByTestId('btn-save-results').click()
    await page.getByTestId('btn-close-round').click()
    await expect(page.getByTestId('closed-rounds-panel')).toBeVisible()
  })

  test('reports tab shows game', async ({ page }) => {
    await loginManager(page)
    await page.getByTestId('tab-reports').click()
    await page.getByTestId('select-report-game').selectOption({ label: /E2E Test Game/ })
    await expect(page.getByTestId('report-content')).toBeVisible()
    await expect(page.getByTestId('report-round-1')).toBeVisible()
  })
})
