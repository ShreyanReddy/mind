// Critical path 1 (PLAN.md §6.3): create / link / graph — driven through the
// first-run tour (§6.2), which is exactly this flow: three notes, one
// [[link]], then the graph reveal.
import { test, expect } from '@playwright/test'

test('first-run tour: three neurons, one synapse, graph reveal', async ({ page }) => {
  await page.goto('/')

  const tour = page.getByRole('complementary', { name: 'Getting started tour' })
  await expect(tour).toBeVisible()
  await tour.getByRole('button', { name: 'Start' }).click()

  // Create three notes through the tour's own button; title each one.
  for (let i = 1; i <= 3; i++) {
    await expect(tour.getByRole('heading', { name: new RegExp(`${i - 1}/3`) })).toBeVisible()
    await tour.getByRole('button', { name: 'Create a note' }).click()
    await page.getByLabel('Note title').fill(`Neuron ${i}`)
  }

  // Third note created — the tour moves to the link step.
  await expect(tour.getByRole('heading', { name: 'Make your first synapse' })).toBeVisible()

  // Write a wiki-link from the open note (Neuron 3) to Neuron 1.
  await page.getByLabel('Note body').fill('This connects to [[Neuron 1]].')

  await expect(tour.getByRole('heading', { name: 'Your mind is alive' })).toBeVisible()
  await tour.getByRole('button', { name: 'Reveal the graph' }).click()

  // The aha moment: the graph canvas is on screen and the tour closes out.
  await expect(page.locator('.graph-wrap canvas')).toBeVisible()
  await expect(tour.getByRole('heading', { name: 'This is your mind growing' })).toBeVisible()
  await tour.getByRole('button', { name: 'Finish' }).click()
  await expect(tour).toBeHidden()

  // Done flag persists: reload, no tour.
  await page.reload()
  await expect(page.locator('.graph-wrap canvas, .editor-body')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Getting started tour' })).toBeHidden()
})
