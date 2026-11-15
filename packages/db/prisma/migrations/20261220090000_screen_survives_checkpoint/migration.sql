-- A shared computer saves its home after each run by claiming it as suspending and handing it back
-- as running. It never stops, so open screens stay valid; a real suspend or stop revokes them when
-- it reaches suspended or stopped, and a replaced computer when its providerRef changes.
CREATE OR REPLACE FUNCTION revoke_computer_screens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.state IS DISTINCT FROM OLD.state
      AND NOT (OLD.state = 'booting' AND NEW.state = 'running')
      AND NOT (OLD.state IN ('running', 'suspending') AND NEW.state IN ('running', 'suspending')))
    OR NEW."providerRef" IS DISTINCT FROM OLD."providerRef" THEN
    NEW."screenGeneration" := OLD."screenGeneration" + 1;
  END IF;
  RETURN NEW;
END;
$$;
