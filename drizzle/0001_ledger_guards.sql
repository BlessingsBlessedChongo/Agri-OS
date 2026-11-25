-- Ledger and audit guarantees enforced by the database itself, so no code path can get around them.

-- 1. Every journal entry must balance (debits = credits). Checked at COMMIT, after all lines of the entry exist.
CREATE OR REPLACE FUNCTION agrios_check_entry_balanced() RETURNS trigger AS $$
DECLARE
  total bigint;
BEGIN
  SELECT COALESCE(SUM(amount_ngwee), 0) INTO total FROM ledger_lines WHERE entry_id = NEW.entry_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (off by % ngwee)', NEW.entry_id, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_lines_balanced
  AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION agrios_check_entry_balanced();
--> statement-breakpoint

-- 2. The ledger and the audit trail are append-only. Only an explicit maintenance session (deleting an expired
--    sandbox, or the "insider" tamper demo) may change them, by setting agrios.maintenance = 'on' for its transaction.
CREATE OR REPLACE FUNCTION agrios_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('agrios.maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION agrios_append_only();
--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION agrios_append_only();
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION agrios_append_only();
