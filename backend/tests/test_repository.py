import unittest
from decimal import Decimal

from repository import Repository


class RepositorySerializationTests(unittest.TestCase):
    def test_transaction_values_use_low_level_attribute_format(self):
        self.assertEqual(Repository._serialize("user-123"), {"S": "user-123"})
        self.assertEqual(Repository._serialize(Decimal("2.5")), {"N": "2.5"})

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
