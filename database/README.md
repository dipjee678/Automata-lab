# Database

| File | Purpose |
| --- | --- |
| `schema.sql` | Tables, constraints, indexes, helper functions and Row Level Security policies. Run once in the Supabase SQL editor. Safe to re-run. |
| `reset.sql` | Drops every Automata Lab table. **Destroys all data** – development only. |

Demo data is not SQL: because users live in Supabase Auth, the seed creates them
through the Auth admin API. After configuring `backend/.env`, run:

```bash
npm run seed
```

## Entity overview

```
auth.users 1─1 profiles ─┬─< courses ─┬─< assignments ─< questions
                         │            └─< enrollments >─ profiles (students)
                         ├─< submissions >─ questions        submissions 1─1 grades
                         ├─< automata
                         └─< practice_history
```

All foreign keys cascade on delete, so removing a course removes its
assignments, questions, submissions and grades; removing a user removes
everything they own.

## JSON documents

`questions.given`, `questions.reference`, `submissions.answer` and
`automata.data` are JSONB in the format defined by the Zod schemas in
[`shared/src/index.ts`](../shared/src/index.ts). An automaton looks like:

```json
{
  "type": "DFA",
  "states": [
    { "id": "s0", "label": "q0", "x": 80, "y": 220, "initial": true, "accepting": true },
    { "id": "s1", "label": "q1", "x": 250, "y": 220 }
  ],
  "transitions": [
    { "id": "t0", "from": "s0", "to": "s1", "symbol": "1" },
    { "id": "t1", "from": "s1", "to": "s0", "symbol": "1" }
  ]
}
```

PDA transitions add `pop` and `push`; Turing machine transitions add `write`
and `move` (`L`, `R` or `S`). The empty string ε is stored as `""`.

## Row Level Security summary

| Table | Student | Teacher (own courses) | Admin |
| --- | --- | --- | --- |
| profiles | own row; may edit own name only | students of own courses (read) | all |
| courses | enrolled courses (read) | full | full |
| enrollments | own (read, leave) | full | full |
| assignments | published, enrolled (read) | full | full |
| questions | **no access** – use view `questions_public` (no solutions) | full | full |
| submissions | own (read) | read | read |
| grades | own (read) | read, adjust | read, adjust |
| automata | own (full) | own (full) | own (full) |
| practice_history | own (read) | own (read) | own (read) |

Submissions, grades and practice history are written only by the backend
(service role), because grading must happen server-side where the reference
solutions are.
