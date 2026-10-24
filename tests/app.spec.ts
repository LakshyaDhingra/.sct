import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('adds existing folders offline and restores projects after restart', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sct-ui-')))
  const folder = join(root, 'Example project')
  const userData = join(root, 'app-data')
  await mkdir(folder)
  await mkdir(userData)
  const launch = () => electron.launch({ args: [join(__dirname, 'electron-entry.cjs'), userData] })
  let application = await launch()

  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await expect(page).toHaveTitle('.sct')
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your projects start here' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.screenshot({ path: test.info().outputPath('projects-empty.png') })
    expect(page.url()).toMatch(/^file:/)
    expect(await application.evaluate(({ app, BrowserWindow }) => app.getAppMetrics().find(
      (metric) => metric.pid === BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
    )?.sandboxed)).toBe(true)
    expect(await page.evaluate(() => ({ process: 'process' in window, require: 'require' in window })))
      .toEqual({ process: false, require: false })
    expect(await page.evaluate(() => Object.keys(window.sct).sort()))
      .toEqual(['addProject', 'listProjects', 'pickDirectory'])

    await page.getByRole('button', { name: 'Add a project', exact: true }).click()
    await application.evaluate(({ dialog }) => {
      Object.assign(dialog, { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) })
    })
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByLabel('Folder path')).toHaveValue('')

    await application.evaluate(({ dialog }, selected) => {
      Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) })
    }, folder)
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByLabel('Folder path')).toHaveValue(folder)
    await expect(page.getByLabel('Project name')).toHaveValue('Example project')
    await page.screenshot({ path: test.info().outputPath('add-project.png') })
    await page.getByLabel('Folder path').fill(join(root, 'missing'))
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('existing folder')
    await page.getByLabel('Folder path').fill(folder)
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Projects' })).toContainText('Example project')
    await expect(page.getByRole('list', { name: 'Projects' })).toContainText(folder)
    await page.screenshot({ path: test.info().outputPath('projects-saved.png') })

    await page.getByRole('button', { name: 'Add a project', exact: true }).click()
    await page.getByLabel('Project name').fill('Duplicate')
    await page.getByLabel('Folder path').fill(folder)
    await page.getByRole('button', { name: 'Add project', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('already')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])

    await application.close()
    application = await launch()
    const restored = await application.firstWindow()
    await expect(restored.getByRole('list', { name: 'Projects' })).toContainText('Example project')
    await expect(restored.getByRole('listitem')).toHaveCount(1)
  } finally {
    await application.close()
    await rm(root, { recursive: true, force: true })
  }
})
