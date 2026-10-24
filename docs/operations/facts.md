# Checks of the live database (`facts`)

Since 24 October 2026 the live database is checked by numbers, never by rows.

- **Role** `mycongregation_facts`: may call the functions of the schema
  `facts` and nothing else. It reads no table and creates nothing; two of the
  checks verify exactly that. No password; the database admits it only from
  inside its own container.
- **Checks**: `facts.after_deploy()` in
  `src/migrations/1916000000000-ProductionFacts.ts`. Each row is a name, a
  number, and whether it is a rule (`expect_zero`) or a figure for reading.
- **After every deploy** the last step of `.github/workflows/deploy.yml` runs
  `scripts/facts.sh --ci`. The log is public, so it shows only `FACTS: OK` or
  the names of the broken rules; a broken rule turns the deploy red. The code
  is already live by then: red means look, not rolled back.
- **By hand**, with the numbers: `ssh myserver facts`.

## Adding a check

1. A new migration that replaces `facts.after_deploy()` with the extra row
   (`CREATE OR REPLACE FUNCTION`, same signature), or adds another function
   with the same grants: `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO
   mycongregation_facts`, `SECURITY DEFINER`, `SET search_path = public,
   pg_temp`, no arguments, read only.
2. Only counts or booleans come out. A rule is a state the code keeps; put
   one in only after the live database has shown 0 for it.
3. A test in `test/db/facts.db-spec.ts`, and a run on the stand:
   `FACTS_LOCAL_DB=congmap bash scripts/facts.sh`.

A one-off question that is not a check yet still goes the old way: a SQL file
under `BEGIN READ ONLY … ROLLBACK`, run by Lionel, numbers only.
