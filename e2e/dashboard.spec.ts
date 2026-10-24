import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The deterministic simulator keeps these tests independent of the exchange
const DEMO = './?demo&seed=7';

async function waitForChart(page: Page) {
  await expect(page.getByText('Загрузка свечей…')).toHaveCount(0);
  await expect(page.getByTestId('chart-legend')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO);
  await expect(page.getByRole('status').filter({ hasText: 'Демо-данные' })).toBeVisible();
});

test('shows markets, chart, order book and trades', async ({ page }) => {
  await waitForChart(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('BTC/USDT');
  await expect(page.locator('.market-row')).not.toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Заявки на продажу' }).getByRole('listitem')).toHaveCount(15);
  await expect(page.getByRole('list', { name: 'Последние сделки' }).getByRole('listitem').first()).toBeVisible();

  // the canvas actually painted candles
  const painted = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let colored = 0;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! > 0) colored++;
    return colored;
  });
  expect(painted).toBeGreaterThan(500);
});

test('switches pair and interval and keeps them in the URL', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Поиск пары' }).fill('sol');
  await page.locator('[data-symbol="SOLUSDT"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SOL/USDT');

  await page.getByRole('group', { name: 'Интервал свечей' }).getByRole('button', { name: '15м' }).click();
  await waitForChart(page);
  await expect(page).toHaveURL(/s=SOLUSDT/);
  await expect(page).toHaveURL(/i=15m/);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SOL/USDT');
  await expect(page.getByRole('button', { name: '15м', pressed: true })).toBeVisible();
});

test('crosshair legend follows the mouse and wheel zooms', async ({ page }) => {
  await waitForChart(page);
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  const legend = page.getByTestId('chart-legend');

  await page.mouse.move(box.x + box.width - 120, box.y + box.height / 2);
  const right = await legend.textContent();
  await page.mouse.move(box.x + 120, box.y + box.height / 2);
  const left = await legend.textContent();
  expect(left).not.toEqual(right);

  // zooming out shows older candles under the same cursor position
  await page.mouse.wheel(0, 600);
  await expect(legend).not.toHaveText(left!);
});

test('switches pairs from the keyboard', async ({ page }) => {
  await page.locator('[data-symbol="BTCUSDT"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('BTC/USDT');
});

test('has no serious accessibility violations', async ({ page }) => {
  await waitForChart(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
