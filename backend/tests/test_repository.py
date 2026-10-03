import unittest
from decimal import Decimal

from repository import Repository


class RepositorySerializationTests(unittest.TestCase):
    def test_transaction_values_use_low_level_attribute_format(self):
        self.assertEqual(Repository._serialize("user-123"), {"S": "user-123"})
        self.assertEqual(Repository._serialize(Decimal("2.5")), {"N": "2.5"})


if __name__ == "__main__":
    unittest.main()
