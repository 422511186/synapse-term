import { expect, test, type Locator, type Page } from '@playwright/test';

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface ConfirmDialogColors {
  panelBackground: RgbColor;
  headerBackground: RgbColor;
  footerBackground: RgbColor;
  titleColor: RgbColor;
  bodyColor: RgbColor;
  cancelColor: RgbColor;
  confirmBackground: RgbColor;
  confirmColor: RgbColor;
}

function parseCssColor(value: string): RgbColor {
  const rgbMatch = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i,
  );
  if (rgbMatch !== null) {
    return {
      r: Number.parseFloat(rgbMatch[1]),
      g: Number.parseFloat(rgbMatch[2]),
      b: Number.parseFloat(rgbMatch[3]),
      a: rgbMatch[4] === undefined ? 1 : Number.parseFloat(rgbMatch[4]),
    };
  }
  const srgbMatch = value.match(
    /^color\(\s*srgb\s+([-\d.]+%?)\s+([-\d.]+%?)\s+([-\d.]+%?)(?:\s*\/\s*([-\d.]+%?))?\s*\)$/i,
  );
  if (srgbMatch !== null) {
    const channel = (part: string): number => {
      const parsed = Number.parseFloat(part);
      return part.endsWith('%') ? (parsed / 100) * 255 : parsed * 255;
    };
    return {
      r: channel(srgbMatch[1]),
      g: channel(srgbMatch[2]),
      b: channel(srgbMatch[3]),
      a: srgbMatch[4] === undefined ? 1 : Number.parseFloat(srgbMatch[4]),
    };
  }
  const oklabMatch = value.match(
    /^oklab\(\s*([-\d.]+%?)\s+([-\d.]+%?)\s+([-\d.]+%?)(?:\s*\/\s*([-\d.]+%?))?\s*\)$/i,
  );
  if (oklabMatch !== null) {
    const lightness = Number.parseFloat(oklabMatch[1]);
    const oklabA = Number.parseFloat(oklabMatch[2]);
    const oklabB = Number.parseFloat(oklabMatch[3]);
    const lPrime = lightness + 0.3963377774 * oklabA + 0.2158037573 * oklabB;
    const mPrime = lightness - 0.1055613458 * oklabA - 0.0638541728 * oklabB;
    const sPrime = lightness - 0.0894841775 * oklabA - 1.291485548 * oklabB;
    const l = lPrime ** 3;
    const m = mPrime ** 3;
    const s = sPrime ** 3;
    const clamp = (channel: number): number => Math.min(1, Math.max(0, channel));
    return {
      r: clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
      g: clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
      b: clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
      a: oklabMatch[4] === undefined ? 1 : Number.parseFloat(oklabMatch[4]),
    };
  }
  throw new Error(`Unsupported computed color: ${value}`);
}

function compositeOverBackground(foreground: RgbColor, background: RgbColor): RgbColor {
  if (foreground.a >= 1) return foreground;
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function contrastRatio(first: RgbColor, second: RgbColor): number {
  const firstComposite = compositeOverBackground(first, second);
  const luminance = (color: RgbColor): number => {
    const linearize = (channel: number): number => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return linearize(color.r) * 0.2126 + linearize(color.g) * 0.7152 + linearize(color.b) * 0.0722;
  };
  const firstLuminance = luminance(firstComposite);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function openCloseConfirmation(page: Page): Promise<Locator> {
  await page.getByRole('tab').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭当前' }).click();
  const confirmation = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(confirmation).toBeVisible();
  return confirmation;
}

async function setThemeMode(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: /外观/ })
    .click();
  await page.getByLabel(mode === 'light' ? '浅色' : '深色').check();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(mode);
  await page.getByRole('button', { name: '返回工作区' }).click();
}

async function readConfirmDialogColors(confirmation: Locator): Promise<ConfirmDialogColors> {
  const colors = await confirmation.evaluate((root) => {
    const panel = root.firstElementChild;
    const header = panel?.firstElementChild;
    const body = panel?.children[1];
    const footer = panel?.children[2];
    const heading = header?.querySelector('h2');
    const cancel = footer
      ? Array.from(footer.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('取消'),
        )
      : undefined;
    const confirm = footer
      ? Array.from(footer.querySelectorAll('button')).find(
          (button) => !button.textContent?.includes('取消'),
        )
      : undefined;
    const readColor = (element: Element | undefined | null, property: string): string =>
      element === undefined || element === null
        ? ''
        : getComputedStyle(element)[property as keyof CSSStyleDeclaration].toString();
    return {
      panelBackground: readColor(panel, 'backgroundColor'),
      headerBackground: readColor(header, 'backgroundColor'),
      footerBackground: readColor(footer, 'backgroundColor'),
      titleColor: readColor(heading, 'color'),
      bodyColor: readColor(body, 'color'),
      cancelColor: readColor(cancel, 'color'),
      confirmBackground: readColor(confirm, 'backgroundColor'),
      confirmColor: readColor(confirm, 'color'),
    };
  });
  const parse = (value: string): RgbColor => parseCssColor(value);
  return {
    panelBackground: parse(colors.panelBackground),
    headerBackground: parse(colors.headerBackground),
    footerBackground: parse(colors.footerBackground),
    titleColor: parse(colors.titleColor),
    bodyColor: parse(colors.bodyColor),
    cancelColor: parse(colors.cancelColor),
    confirmBackground: parse(colors.confirmBackground),
    confirmColor: parse(colors.confirmColor),
  };
}

function expectReadable(colors: ConfirmDialogColors): void {
  expect(contrastRatio(colors.titleColor, colors.headerBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.bodyColor, colors.panelBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.cancelColor, colors.footerBackground)).toBeGreaterThanOrEqual(4.5);
  expect(colors.confirmBackground.a).toBeGreaterThan(0);
  expect(contrastRatio(colors.confirmColor, colors.confirmBackground)).toBeGreaterThanOrEqual(4.5);
}

test('keeps the close confirmation readable in dark and light themes', async ({ page }) => {
  await page.goto('/?sessions=2');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  const darkConfirmation = await openCloseConfirmation(page);
  expectReadable(await readConfirmDialogColors(darkConfirmation));
  await darkConfirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(darkConfirmation).toHaveCount(0);

  await setThemeMode(page, 'light');
  const lightConfirmation = await openCloseConfirmation(page);
  expectReadable(await readConfirmDialogColors(lightConfirmation));
});

test('keeps up to twenty Sessions reachable through tabs and search', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 640 });
  await page.goto('/?sessions=20&stale=2');

  const tabs = page.getByRole('tablist', { name: '终端会话' });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(20);
  await expect(page.getByRole('button', { name: '新建终端会话' })).toBeVisible();

  await page.getByRole('button', { name: '全部会话' }).click();
  const allSessions = page.getByRole('dialog', { name: '全部会话' });
  await expect(allSessions).toBeVisible();
  const allSessionsBox = await allSessions.boundingBox();
  expect(allSessionsBox).not.toBeNull();
  expect(allSessionsBox!.y).toBeGreaterThan(40);
  expect(allSessionsBox!.y).toBeLessThan(220);
  await expect(allSessions.getByRole('option')).toHaveCount(20);
  await allSessions.getByPlaceholder('搜索会话').fill('session 20');
  await expect(allSessions.getByRole('option', { name: /session 20.*Git Bash/i })).toBeVisible();
  await allSessions.getByRole('option', { name: /session 20.*Git Bash/i }).click();
  await expect(page.getByLabel('session 20 终端')).toBeVisible();

  await page.getByRole('button', { name: '全部会话' }).click();
  const openSessions = page.getByRole('dialog', { name: '全部会话' });
  await openSessions.getByRole('button', { exact: true, name: '关闭 session 20' }).click();
  const closeConfirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(closeConfirm).toBeVisible();
  await closeConfirm.getByRole('button', { name: '关闭终端', exact: true }).click();
  await expect(page.getByRole('tab', { name: /session 20/i })).toHaveCount(0);
});

test('uses default aliases and supports duplicate renames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?sessions=2');

  await page.getByRole('button', { name: '新建终端会话', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建终端会话' });
  const alias = dialog.getByLabel('Session Alias');
  await expect(alias).toHaveValue('终端 1');
  await alias.fill('   ');
  await dialog.getByRole('button', { name: '创建并连接', exact: true }).click();

  const createdTab = page.getByRole('tab', { name: '终端 1 Zsh', exact: true });
  await expect(createdTab).toBeVisible();
  await createdTab.click({ button: 'right' });
  const contextMenu = page.getByRole('menu', { name: '会话操作菜单' });
  await expect(contextMenu).toBeVisible();
  await contextMenu.getByRole('menuitem', { name: '重命名' }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名会话' });
  await expect(renameDialog).toBeVisible();
  await renameDialog.getByLabel('名称').fill('session 1');
  await renameDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'session 1 Git Bash', exact: true }).last(),
  ).toBeVisible();
});

test('closes the all-sessions popover when clicking outside', async ({ page }) => {
  await page.goto('/?sessions=2');
  await page.getByRole('button', { name: '全部会话' }).click();
  const allSessions = page.getByRole('dialog', { name: '全部会话' });
  await expect(allSessions).toBeVisible();

  await page.mouse.click(320, 600);
  await expect(allSessions).toHaveCount(0);
});

test('closes all terminals from the all-sessions popover', async ({ page }) => {
  await page.goto('/?sessions=3');
  await expect(page.getByRole('tab')).toHaveCount(3);

  await page.getByRole('button', { name: '全部会话' }).click();
  const popover = page.getByRole('dialog', { name: '全部会话' });
  await popover.getByRole('button', { name: '关闭全部终端' }).click();
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '全部关闭', exact: true }).click();

  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '快速新建终端会话' })).toBeVisible();
});

test('closes the current tab from the context menu', async ({ page }) => {
  await page.goto('/?sessions=3');
  await page
    .getByRole('tab', { name: 'session 2 Git Bash', exact: true })
    .click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭当前' }).click();
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '关闭终端', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'session 2 Git Bash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('closes left and right tabs from the context menu', async ({ page }) => {
  await page.goto('/?sessions=4');
  await page
    .getByRole('tab', { name: 'session 3 Git Bash', exact: true })
    .click({ button: 'right' });
  let menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭左侧所有' }).click();
  let confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '关闭所选', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'session 1 Git Bash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'session 3 Git Bash', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'session 4 Git Bash', exact: true })).toBeVisible();

  await page
    .getByRole('tab', { name: 'session 3 Git Bash', exact: true })
    .click({ button: 'right' });
  menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭右侧所有' }).click();
  confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '关闭所选', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'session 4 Git Bash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('closes all tabs from the context menu', async ({ page }) => {
  await page.goto('/?sessions=3');
  await page
    .getByRole('tab', { name: 'session 1 Git Bash', exact: true })
    .click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '会话操作菜单' });
  await menu.getByRole('menuitem', { name: '关闭所有' }).click();
  const confirm = page.getByRole('alertdialog', { name: '操作确认' });
  await confirm.getByRole('button', { name: '全部关闭', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
});
