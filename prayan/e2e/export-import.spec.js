// Critical path 2 (PLAN.md §6.3): export / import — the offline transfer
// loop. Exports a bundle from one browser profile, asserts the
// secret-stripping invariant on the real downloaded artifact, then imports
// it into a completely fresh profile.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function skipTour(page) {
  const skip = page.getByRole('button', { name: 'Skip tour' })
  await skip.click()
  await expect(page.getByRole('complementary', { name: 'Getting started tour' })).toBeHidden()
}

test('export a mind bundle, verify it, import it into a fresh vault', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('/')
  await skipTour(page)

  // Grow something worth transferring.
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByLabel('Note title').fill('My Exported Thought')
  await page.getByLabel('Note body').fill('The answer is 42.')

  // Export from the Marketplace's offline transfer card.
  await page.getByRole('navigation', { name: 'Views' }).getByLabel('Marketplace').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export mind bundle' }).click()
  const download = await downloadPromise
  const bundlePath = testInfo.outputPath('mind-bundle.json')
  await download.saveAs(bundlePath)

  // The real artifact honors the wire format and the secrets invariant.
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  expect(bundle.format).toBe('prayan-mind/1')
  expect(bundle.notes.some((n) => n.title === 'My Exported Thought')).toBe(true)
  expect(bundle.persona.keys).toBeUndefined()
  expect(bundle.persona.apiKey).toBeUndefined()

  // Fresh profile = fresh vault. Import the bundle there.
  const context = await browser.newContext()
  const page2 = await context.newPage()
  await page2.goto('/')
  await skipTour(page2)
  await expect(page2.getByText('My Exported Thought')).toBeHidden()

  await page2.getByRole('navigation', { name: 'Views' }).getByLabel('Marketplace').click()
  page2.on('dialog', (d) => d.accept()) // "importing replaces your vault" confirm
  const fileChooserPromise = page2.waitForEvent('filechooser')
  await page2.getByRole('button', { name: 'Import a mind…' }).click()
  await (await fileChooserPromise).setFiles(bundlePath)

  // The imported neuron is in the fresh vault's sidebar.
  await page2.getByRole('navigation', { name: 'Views' }).getByLabel('Notes').click()
  await expect(page2.getByText('My Exported Thought')).toBeVisible()
  await context.close()
})
