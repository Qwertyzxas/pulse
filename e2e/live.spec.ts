import { expect, test } from '@playwright/test';

// Talks to the real exchange, so it is opt-in: LIVE=1 npx playwright test live
test.skip(!process.env.LIVE, 'set LIVE=1 to run against Binance');

test('streams real market data from Binance', async ({ page }) => {
  await page.goto('./?s=BTCUSDT&i=1m');
  await expect(page.getByRole('status').filter({ hasText: 'Live · Binance' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.market-row')).not.toHaveCount(0);
  await expect(page.getByTestId('chart-legend')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('list', { name: 'Заявки на продажу' }).getByRole('listitem').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Последние сделки' }).getByRole('listitem').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/live.png' });
});
