import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD } from '../playwright.config';

async function login(page: Page, who: 'student' | 'teacher' | 'admin') {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(`${who}@automatalab.test`);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test.describe('authentication and roles', () => {
  test('protected pages redirect to login; wrong passwords are rejected', async ({ page }) => {
    await page.goto('/courses');
    await expect(page).toHaveURL(/\/login$/);
    await page.locator('input[name="email"]').fill('student@automatalab.test');
    await page.locator('input[name="password"]').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  });

  test('the demo buttons sign in with one click', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Try as admin' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Try as teacher' }).click();
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(page.getByText('Dr. Tara Teacher').first()).toBeVisible();
  });

  test('a student cannot open the admin area, an admin can', async ({ page }) => {
    await login(page, 'student');
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page.getByText('You do not have access to this page.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, 'admin'); // an explicit sign-out forgets the previous user's page
    await page.getByRole('link', { name: 'Users', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'teacher@automatalab.test' })).toBeVisible();
  });
});

test.describe('automata editor', () => {
  test('loads an example, simulates it and draws a new state', async ({ page }) => {
    await login(page, 'student');
    await page.getByRole('link', { name: 'Automata editor', exact: true }).click();
    await page.getByLabel('Load an example').selectOption('dfa-div3');
    await expect(page.getByLabel(/^State r0, initial, accepting$/)).toBeVisible();

    await page.locator('#sim-input').fill('1001'); // 9 is divisible by 3
    await page.getByRole('button', { name: 'Step through' }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByTestId('sim-result')).toContainText('Accepted');

    await page.locator('#sim-input').fill('101'); // 5 is not
    // Changing the input restarts the run at step 0; play it to the end.
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByTestId('sim-result')).toContainText('Rejected', { timeout: 10_000 });

    // Draw: the State tool adds q0 where the canvas is clicked.
    await page.getByRole('button', { name: 'Add state (S)' }).click();
    await page.locator('.react-flow__pane').click({ position: { x: 120, y: 420 } });
    await expect(page.getByLabel(/^State q0$/)).toBeVisible();
    await page.getByRole('tab', { name: /Check/ }).click();
    await expect(page.getByText('Unreachable state: q0.')).toBeVisible();
  });
});

test.describe('assignment grading', () => {
  test('a student gets a counterexample, fixes the answer and earns full marks', async ({ page }) => {
    await login(page, 'student');
    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await page.getByRole('link', { name: /Theory of Computation/ }).click();
    await page.getByRole('link', { name: /Homework 1/ }).click();
    await page.getByRole('button', { name: /4\. Regular expression/ }).click();

    await page.locator('#answer-regex').fill('(0|1)*1');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByTestId('counterexample')).toHaveText('1');
    await expect(page.getByTestId('grade-feedback')).toContainText('Exact');

    await page.locator('#answer-regex').fill('(0+1)*01'); // written differently from the reference
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByTestId('grade-score')).toHaveText('5 / 5');
    await expect(page.getByTestId('assignment-score')).toHaveText('5 / 40');
  });

  test('the teacher sees the submissions and can adjust a grade', async ({ page }) => {
    await login(page, 'teacher');
    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await page.getByRole('link', { name: /Theory of Computation/ }).click();
    await page.getByRole('link', { name: /Homework 1/ }).click();
    await page.getByRole('tab', { name: 'Submissions and grades' }).click();
    await page.getByRole('button', { name: /Riya Rahman, Minimize the DFA: 9 of 15/ }).click();
    await expect(page.getByTestId('grade-feedback')).toContainText('not minimal');
    await page.getByLabel(/Final score/).fill('12');
    await page.getByLabel('Note to the student').fill('Good, but merge equivalent states.');
    await page.getByRole('button', { name: 'Save grade' }).click();
    await page.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('button', { name: /Riya Rahman, Minimize the DFA: 12 of 15/ })).toBeVisible();
  });
});

test.describe('practice and labs', () => {
  test('practice problems give instant feedback', async ({ page }) => {
    await login(page, 'student');
    await page.getByRole('link', { name: 'Practice', exact: true }).click();
    await page.getByRole('link', { name: /Strings of even length/ }).click();
    await page.locator('#answer-regex').fill('(a|b)*');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByTestId('counterexample')).toHaveText('a');
    await page.locator('#answer-regex').fill('(aa|ab|ba|bb)*');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByTestId('grade-score')).toHaveText('10 / 10');
  });

  test('regex and grammar labs decide membership', async ({ page }) => {
    await login(page, 'student');
    await page.getByRole('link', { name: 'Regular expressions' }).click();
    await page.getByLabel('Regular expression', { exact: true }).fill('(ab)*');
    await page.getByLabel('Test string').fill('abab');
    await expect(page.getByTestId('regex-match')).toContainText('Match.');
    await page.getByLabel('Test string').fill('aba');
    await expect(page.getByTestId('regex-match')).toContainText('No match.');

    await page.getByRole('link', { name: 'Grammars' }).click();
    await page.getByLabel('Test string').fill('aaabbb');
    await expect(page.getByTestId('cfg-result')).toContainText('Generated.');
    await page.getByLabel('Test string').fill('aab');
    await expect(page.getByTestId('cfg-result')).toContainText('Not generated.');
  });
});
