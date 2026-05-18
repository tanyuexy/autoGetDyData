// Helper: load storage state into the current browser context
import { readFileSync } from 'node:fs';

export default async function loadAuth(page, accountName) {
  const storageStatePath = `/Users/xy/code/tool/autoGetDyData/storage/creator-accounts/${accountName}/storageState.json`;
  const state = JSON.parse(readFileSync(storageStatePath, 'utf-8'));

  if (state.cookies && state.cookies.length > 0) {
    await page.context().addCookies(state.cookies);
  }

  await page.goto('https://creator.douyin.com/creator-micro/content/publish', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(5000);

  return { url: page.url(), title: await page.title() };
}
