import unittest
from decimal import Decimal
from types import SimpleNamespace

from repository import Repository


class RepositorySerializationTests(unittest.TestCase):
    def test_transaction_values_use_low_level_attribute_format(self):
        self.assertEqual(Repository._serialize("user-123"), {"S": "user-123"})
        self.assertEqual(Repository._serialize(Decimal("2.5")), {"N": "2.5"})

    def test_bulk_reservation_uses_one_transaction_for_every_listing(self):
        repository = Repository.__new__(Repository)
        repository.listings = SimpleNamespace(name="Listings")
        repository.reservations = SimpleNamespace(name="Reservations")
        calls = []
        repository.client = SimpleNamespace(transact_write_items=lambda **kwargs: calls.append(kwargs))
        repository.get_listing = lambda listing_id: {
            "listingId": listing_id,
            "title": f"Ingredient {listing_id}",
            "status": "available",
            "pickupAddress": "Private until reserved",
            "pickupLabel": "8–9 PM",
        }

        result = repository.create_bulk_reservation("recipient-1", [
            {"listingId": "one", "quantity": 2},
            {"listingId": "two", "quantity": 3},
        ])

        self.assertEqual(len(calls), 1)
        self.assertEqual(len(calls[0]["TransactItems"]), 4)
        self.assertEqual(len(result["reservations"]), 2)
        self.assertEqual(result["reservations"][0]["bundleId"], result["reservations"][1]["bundleId"])

    def test_ddb_safe_preserves_decimals_and_converts_nested_floats(self):
        value = {
            "quantityAvailable": Decimal("12"),
            "coordinates": [35.2271, -80.8431],
        }

        self.assertEqual(
            Repository._ddb_safe(value),
            {
                "quantityAvailable": Decimal("12"),
                "coordinates": [Decimal("35.2271"), Decimal("-80.8431")],
            },
        )


if __name__ == "__main__":
    unittest.main()
