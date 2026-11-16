import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD } from '../playwright.config';

async function login(page: Page, who: 'student' | 'teacher') {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(`${who}@automatalab.test`);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

/** Drawing helpers that use the canvas exactly as a person would. */
function canvasTools(page: Page, scope = page.locator('body')) {
  const state = (label: string) => scope.getByLabel(new RegExp(`^State ${label}(,|$)`));
  return {
    state,
    async addStates(points: Array<[number, number]>) {
      await scope.getByRole('button', { name: 'Add state (S)' }).click();
      for (const [x, y] of points) await scope.locator('.react-flow__pane').click({ position: { x, y } });
    },
    async addTransition(from: string, to: string, label: string) {
      await scope.getByRole('button', { name: 'Add transition (T)' }).click();
      await state(from).click();
      await state(to).click();
      const labelDialog = page.getByRole('dialog', { name: /New transition/ });
      await labelDialog.getByLabel('Transition label').fill(label);
      await labelDialog.getByRole('button', { name: 'Add transition', exact: true }).click();
      await expect(labelDialog).toHaveCount(0);
    },
    async markAccepting(label: string) {
      await scope.getByRole('button', { name: 'Select and move (V)' }).click();
      await state(label).dblclick();
      await expect(scope.getByLabel(new RegExp(`^State ${label}.*accepting$`))).toBeVisible();
    },
  };
}

test.describe('question authoring', () => {
  test('a teacher writes an assignment, tries it, publishes it, and a student answers it', async ({ page }) => {
    await login(page, 'teacher');
    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await page.getByRole('link', { name: /Theory of Computation/ }).click();

    // New assignment (starts as a draft).
    await page.getByRole('button', { name: 'New assignment' }).click();
    await page.getByPlaceholder('Homework 1: Regular languages').fill('Quiz: authored in the UI');
    await page.getByPlaceholder('unlimited').fill('3');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { name: /Quiz: authored in the UI/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled(); // no questions yet

    // Question 1: regular expression with a regex reference.
    await page.getByRole('button', { name: 'Add question' }).click();
    const dialog = page.getByRole('dialog', { name: 'New question' });
    await dialog.getByLabel('Question type').selectOption('regex');
    await dialog.getByLabel('Title').fill('Even number of a');
    await dialog.getByLabel('Problem statement').fill('Write a regular expression over {a, b} for strings with an even number of a.');
    await dialog.getByLabel('Input alphabet').fill('a, b');
    await dialog.getByLabel('Reference regular expression').fill('(b*ab*a)*b*');
    await dialog.getByLabel('Additional test strings (optional)').fill('+ aa\n- a');
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await expect(page.getByRole('heading', { name: '1. Even number of a' })).toBeVisible();

    // A broken reference is refused with an explanation, and the dialog stays open.
    await page.getByRole('button', { name: 'Add question' }).click();
    await dialog.getByLabel('Question type').selectOption('regex');
    await dialog.getByLabel('Title').fill('Broken');
    await dialog.getByLabel('Reference regular expression').fill('(a|b');
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await expect(dialog.getByRole('alert')).toContainText('cannot be graded');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Question 2: DFA construction with a reference automaton drawn on the embedded canvas.
    await page.getByRole('button', { name: 'Add question' }).click();
    await dialog.getByLabel('Title').fill('Ends in 1');
    await dialog.getByLabel('Problem statement').fill('Construct a DFA over {0, 1} for strings ending in 1.');
    const ref = canvasTools(page, dialog);
    await ref.addStates([[150, 160], [380, 160]]);
    await ref.addTransition('q0', 'q0', '0');
    await ref.addTransition('q0', 'q1', '1');
    await ref.addTransition('q1', 'q1', '1');
    await ref.addTransition('q1', 'q0', '0');
    await ref.markAccepting('q1');
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await expect(page.getByRole('heading', { name: '2. Ends in 1' })).toBeVisible();
    await expect(page.getByText('reference automaton (2 states)')).toBeVisible();

    // Try question 1 as a student would (dry run).
    await page.getByRole('button', { name: 'Try it' }).first().click();
    const tryDialog = page.getByRole('dialog', { name: /Try it/ });
    await tryDialog.locator('#answer-regex').fill('(aa)*');
    await tryDialog.getByRole('button', { name: 'Grade this answer' }).click();
    await expect(tryDialog.getByTestId('counterexample')).toHaveText('b');
    await tryDialog.locator('#answer-regex').fill('b*(ab*ab*)*');
    await tryDialog.getByRole('button', { name: 'Grade this answer' }).click();
    await expect(tryDialog.getByTestId('grade-score')).toHaveText('10 / 10');
    await tryDialog.getByRole('button', { name: 'Close' }).last().click();

    // Edit question 1: change the marks.
    await page.getByRole('button', { name: 'Edit' }).nth(1).click();
    const edit = page.getByRole('dialog', { name: 'Edit question' });
    await expect(edit.getByLabel('Reference regular expression')).toHaveValue('(b*ab*a)*b*');
    await edit.getByLabel('Marks').fill('4');
    await edit.getByRole('button', { name: 'Save question' }).click();
    await expect(page.getByText('4 marks', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published', { exact: true })).toBeVisible();

    // The student now sees it and answers both questions.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await login(page, 'student');
    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await page.getByRole('link', { name: /Theory of Computation/ }).click();
    await page.getByRole('link', { name: /Quiz: authored in the UI/ }).click();
    await expect(page.getByText('3 attempts per question')).toBeVisible();

    await page.locator('#answer-regex').fill('(b|ab*a)*');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByTestId('grade-score')).toHaveText('4 / 4');
    await expect(page.getByText('2 attempts left')).toBeVisible();

    await page.getByRole('button', { name: /2\. Ends in 1/ }).click();
    const answer = canvasTools(page);
    await answer.addStates([[150, 200], [400, 200]]);
    await answer.addTransition('q0', 'q0', '0');
    await answer.addTransition('q0', 'q1', '1');
    await answer.addTransition('q1', 'q1', '1'); // δ(q1, 0) is still missing: wrong language
    await answer.markAccepting('q1');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByTestId('counterexample')).toHaveText('101');
    await answer.addTransition('q1', 'q0', '0');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByTestId('grade-score')).toHaveText('10 / 10');
    await expect(page.getByTestId('assignment-score')).toHaveText('14 / 14');
  });
});

test.describe('pushdown automata and Turing machines', () => {
  test('a PDA drawn in the browser is simulated and graded (bounded testing)', async ({ page }) => {
    await login(page, 'student');
    await page.goto('/practice/pda-anbn');
    const c = canvasTools(page);
    await c.addStates([[120, 220], [330, 220], [540, 220]]);
    await c.addTransition('q0', 'q0', 'a, ε → A');
    await c.addTransition('q0', 'q1', 'ε, ε → ε');
    await c.addTransition('q1', 'q1', 'b, A → ε');
    await c.addTransition('q1', 'q2', 'ε, Z → Z');
    await c.markAccepting('q2');

    // Step through a run in the built-in simulator: the stack must be shown.
    await page.getByRole('button', { name: 'Try a string' }).click();
    await page.locator('#sim-input').fill('aabb');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByTestId('sim-result')).toContainText('Accepted', { timeout: 15_000 });
    await expect(page.getByLabel('Stack, top first')).toBeVisible();

    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByTestId('grade-score')).toHaveText('10 / 10');
    await expect(page.getByTestId('grade-feedback')).toContainText('Bounded testing');
    await expect(page.getByTestId('grade-feedback')).toContainText('not a proof');
  });

  test('a malformed PDA label is refused with an explanation', async ({ page }) => {
    await login(page, 'student');
    await page.goto('/practice/pda-anbn');
    const c = canvasTools(page);
    await c.addStates([[150, 220]]);
    await page.getByRole('button', { name: 'Add transition (T)' }).click();
    await c.state('q0').click();
    await c.state('q0').click();
    const labelDialog = page.getByRole('dialog', { name: /New transition/ });
    await labelDialog.getByLabel('Transition label').fill('a');
    await labelDialog.getByRole('button', { name: 'Add transition', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /New transition/ })).toContainText('read, pop → push');
  });

  test('a Turing machine drawn in the browser is simulated and graded', async ({ page }) => {
    await login(page, 'student');
    await page.goto('/practice/tm-anbn');
    const c = canvasTools(page);
    // q0..q3 in a row, q4 (accept) below.
    await c.addStates([[110, 130], [300, 130], [490, 130], [110, 330], [300, 330]]);
    await c.addTransition('q0', 'q1', 'a → X, R');
    await c.addTransition('q0', 'q3', 'Y → Y, R');
    await c.addTransition('q0', 'q4', '_ → _, S');
    await c.addTransition('q1', 'q1', 'a → a, R ; Y → Y, R');
    await c.addTransition('q1', 'q2', 'b → Y, L');
    await c.addTransition('q2', 'q2', 'a → a, L ; Y → Y, L');
    await c.addTransition('q2', 'q0', 'X → X, R');
    await c.addTransition('q3', 'q3', 'Y → Y, R');
    await c.addTransition('q3', 'q4', '_ → _, S');
    await c.markAccepting('q4');

    await page.getByRole('button', { name: 'Try a string' }).click();
    await page.locator('#sim-input').fill('ab');
    await page.getByRole('button', { name: 'Step through' }).click();
    await expect(page.getByLabel('Tape', { exact: true })).toBeVisible();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByTestId('sim-result')).toContainText('Accepted');

    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByTestId('grade-score')).toHaveText('10 / 10');
    await expect(page.getByTestId('grade-feedback')).toContainText('Bounded testing');
  });
});
