# Production migration source provenance

This report records where the production migration SQL could be recovered from.
The definitive deployed copies are the files in `remote-migrations/`, extracted
read-only from `supabase_migrations.schema_migrations` and hash-verified.

## Production migrations after CapDent V22

Production has 32 migrations after `20260727012628`.

- None of their exact deployed identities or bodies exists in the reachable or
  unreachable history of the mobile `dms_clinic` repository.
- The three device-token repair migrations have no Git source located.
- Fifteen administrative/gallery migrations come from the separate
  `mkraja826/micirql-dms` lineage:
  - thirteen were introduced around commit `3c113e3`;
  - gallery controls around `558f777`;
  - gallery export support around `a182fee`.
- Their repository timestamps differ from production. Twelve are whitespace-only
  equivalents. Two contain optional `AS` aliases. The production unified-audit
  function orders by `occurred_at`; the portal source orders by positional column
  6. This appears semantically equivalent but must be regression tested.
- The final fourteen AI migrations and five deployed `capdent-ai*` Edge Functions
  have no committed SQL/function source on any current `micirql-dms` branch.
  They are portal-owned operational deployments; the recovered production SQL is
  presently the only exact versioned copy.

## Earlier repository alignment

Production migration identities differ widely from local filenames. Content-based
comparison found exact deployed SQL under renamed timestamps for nineteen tracked
migrations, including the clinic field/RPC work, pricing foundation, V18 hardening,
V21 notification/chart migrations, and related activation work. Other early local
files have same-purpose counterparts with different contents, while several July
4–7 production migrations have no tracked source.

This is why the old `supabase/migrations/` directory must not be renamed or
repaired in place. The canonical baseline must be constructed and replayed in an
isolated environment first.
