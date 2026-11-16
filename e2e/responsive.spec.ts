import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD } from '../playwright.config';

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
] as const;

async function login(page: Page, who: 'student' | 'teacher') {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(`${who}@automatalab.test`);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

/** The page itself must never scroll sideways (wide tables scroll inside their own box). */
async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector('main') ?? document.documentElement;
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, scroller.scrollWidth - scroller.clientWidth);
  });
  expect(overflow, `${where} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test.describe(`${size.name} layout (${size.width}×${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('student pages fit the screen and stay usable', async ({ page }, info) => {
      const shot = (name: string) => page.screenshot({ path: info.outputPath(`${size.name}-${name}.png`) });
      await login(page, 'student');
      await expectNoSidewaysScroll(page, 'dashboard');
      await shot('dashboard');

      // Navigation lives behind a menu button on small screens.
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('link', { name: 'Automata editor', exact: true }).click();
      await page.getByLabel('Load an example').selectOption('dfa-div3');
      await expect(page.getByLabel(/^State r0, initial, accepting$/)).toBeVisible();
      await page.locator('#sim-input').fill('110');
      await page.getByRole('button', { name: 'Run' }).click();
      await expect(page.getByTestId('sim-result')).toContainText('Accepted', { timeout: 10_000 });
      await expectNoSidewaysScroll(page, 'editor');
      await shot('editor');

      // Drawing by touch-sized taps still works.
      await page.getByRole('button', { name: 'New' }).click();
      await page.getByRole('button', { name: 'Add state (S)' }).click();
      const pane = page.locator('.react-flow__pane');
      const box = (await pane.boundingBox())!;
      await pane.click({ position: { x: box.width / 2, y: box.height / 2 } });
      await expect(page.getByLabel(/^State q0, initial$/)).toBeVisible();

      for (const path of ['/algorithms', '/regex', '/grammar', '/practice', '/practice/dfa-even-zeros', '/courses']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectNoSidewaysScroll(page, path);
        await shot(path.replace(/\W+/g, '-'));
      }

      await page.getByRole('link', { name: /Theory of Computation/ }).click();
      await page.getByRole('link', { name: /Homework 1/ }).click();
      await expect(page.getByRole('button', { name: 'Submit answer' })).toBeVisible();
      await expectNoSidewaysScroll(page, 'assignment (student)');
      await shot('assignment');
    });

    test('teacher pages and dialogs fit the screen', async ({ page }, info) => {
      const shot = (name: string) => page.screenshot({ path: info.outputPath(`${size.name}-${name}.png`) });
      await login(page, 'teacher');
      await page.goto('/courses');
      await page.getByRole('link', { name: /Theory of Computation/ }).click();
      await page.getByRole('tab', { name: 'Analytics' }).click();
      await expect(page.getByText('Class average')).toBeVisible();
      await expectNoSidewaysScroll(page, 'analytics');
      await shot('analytics');

      await page.getByRole('tab', { name: /Assignments/ }).click();
      await page.getByRole('link', { name: /Homework 1/ }).click();
      await expectNoSidewaysScroll(page, 'assignment (teacher)');
      await page.getByRole('tab', { name: 'Submissions and grades' }).click();
      await expect(page.getByRole('columnheader', { name: 'Student' })).toBeVisible();
      await expectNoSidewaysScroll(page, 'submissions');
      await shot('submissions');

      await page.getByRole('tab', { name: /Questions/ }).click();
      await page.getByRole('button', { name: 'Add question' }).click();
      const dialog = page.getByRole('dialog', { name: 'New question' });
      await expect(dialog.getByLabel('Title')).toBeVisible();
      const d = (await dialog.boundingBox())!;
      expect(d.x, 'dialog starts inside the screen').toBeGreaterThanOrEqual(0);
      expect(d.x + d.width, 'dialog ends inside the screen').toBeLessThanOrEqual(size.width + 1);
      await shot('question-dialog');
      // The primary action must be reachable without scrolling the page.
      await expect(dialog.getByRole('button', { name: 'Add question' })).toBeInViewport();
    });
  });
}
