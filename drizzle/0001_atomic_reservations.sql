CREATE TRIGGER reservations_validate_inventory
BEFORE INSERT ON reservations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.quantity <= 0 THEN RAISE(ABORT, 'invalid_quantity')
    WHEN NOT EXISTS (
      SELECT 1 FROM listings
      WHERE id = NEW.listing_id
        AND status = 'active'
        AND pickup_end > unixepoch()
        AND available_quantity >= NEW.quantity
    ) THEN RAISE(ABORT, 'insufficient_inventory')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER reservations_decrement_inventory
AFTER INSERT ON reservations
FOR EACH ROW
BEGIN
  UPDATE listings
  SET available_quantity = available_quantity - NEW.quantity,
      status = CASE WHEN available_quantity - NEW.quantity = 0 THEN 'completed' ELSE status END
  WHERE id = NEW.listing_id;
END;
--> statement-breakpoint
CREATE TRIGGER reservations_restore_inventory
AFTER UPDATE OF status ON reservations
FOR EACH ROW
WHEN OLD.status = 'active' AND NEW.status = 'cancelled'
BEGIN
  UPDATE listings
  SET available_quantity = available_quantity + OLD.quantity,
      status = CASE WHEN pickup_end > unixepoch() THEN 'active' ELSE status END
  WHERE id = OLD.listing_id;
END;
--> statement-breakpoint
PRAGMA optimize;
