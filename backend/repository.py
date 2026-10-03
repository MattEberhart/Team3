import json
import os
import secrets
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_safe(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    return value


class Repository:
    def __init__(self):
        resource = boto3.resource("dynamodb")
        self.client = resource.meta.client
        self.users = resource.Table(os.environ["USERS_TABLE"])
        self.organizations = resource.Table(os.environ["ORGANIZATIONS_TABLE"])
        self.memberships = resource.Table(os.environ["MEMBERSHIPS_TABLE"])
        self.listings = resource.Table(os.environ["LISTINGS_TABLE"])
        self.reservations = resource.Table(os.environ["RESERVATIONS_TABLE"])
        self.agent_runs = resource.Table(os.environ["AGENT_RUNS_TABLE"])

    def memberships_for_user(self, user_id: str) -> list[dict]:
        result = self.memberships.query(
            IndexName="UserIndex", KeyConditionExpression=Key("userId").eq(user_id)
        )
        return json_safe(result.get("Items", []))

    def bootstrap_user(self, user_id: str, email: str, display_name: str, account_type: str, organization_name: str | None = None, address: str | None = None, latitude: float | None = None, longitude: float | None = None) -> dict:
        existing = self.users.get_item(Key={"userId": user_id}, ConsistentRead=True).get("Item")
        if existing:
            return {"user": json_safe(existing), "memberships": self.memberships_for_user(user_id)}
        created_at = now_iso()
        user = {"userId": user_id, "email": email, "displayName": display_name, "accountType": account_type, "createdAt": created_at}
        transaction = [{"Put": {"TableName": self.users.name, "Item": {key: self._serialize(value) for key, value in user.items()}, "ConditionExpression": "attribute_not_exists(userId)"}}]
        organization = None
        memberships = []
        if account_type == "donor":
            if not organization_name:
                raise ValueError("A kitchen or organization name is required.")
            organization_id = str(uuid.uuid4())
            organization = {"organizationId": organization_id, "name": organization_name, "type": "donor", "address": address or "", "createdAt": created_at}
            if latitude is not None and longitude is not None:
                organization.update({"latitude": Decimal(str(latitude)), "longitude": Decimal(str(longitude))})
            membership = {"organizationId": organization_id, "userId": user_id, "role": "owner", "createdAt": created_at}
            memberships = [membership]
            transaction.extend([
                {"Put": {"TableName": self.organizations.name, "Item": {key: self._serialize(value) for key, value in organization.items()}, "ConditionExpression": "attribute_not_exists(organizationId)"}},
                {"Put": {"TableName": self.memberships.name, "Item": {key: self._serialize(value) for key, value in membership.items()}, "ConditionExpression": "attribute_not_exists(organizationId) AND attribute_not_exists(userId)"}},
            ])
        self.client.transact_write_items(TransactItems=transaction)
        return {"user": user, "organization": organization, "memberships": memberships}

    def profile(self, user_id: str) -> dict | None:
        item = self.users.get_item(Key={"userId": user_id}).get("Item")
        if not item:
            return None
        return {"user": json_safe(item), "memberships": self.memberships_for_user(user_id)}

    def require_membership(self, user_id: str, organization_id: str, roles: set[str]) -> dict:
        result = self.memberships.get_item(
            Key={"organizationId": organization_id, "userId": user_id},
            ConsistentRead=True,
        ).get("Item")
        if not result or result.get("role") not in roles:
            raise PermissionError("You do not have permission for this organization.")
        return json_safe(result)

    def get_organization(self, organization_id: str) -> dict | None:
        item = self.organizations.get_item(Key={"organizationId": organization_id}).get("Item")
        return json_safe(item) if item else None

    def list_available(self, limit: int = 50) -> list[dict]:
        result = self.listings.query(
            IndexName="StatusPickupIndex",
            KeyConditionExpression=Key("status").eq("available") & Key("pickupEnd").gte(now_iso()),
            Limit=min(limit, 100),
        )
        return json_safe(result.get("Items", []))

    def get_listing(self, listing_id: str) -> dict | None:
        item = self.listings.get_item(Key={"listingId": listing_id}).get("Item")
        return json_safe(item) if item else None

    def recent_donations(self, organization_id: str, limit: int = 10) -> list[dict]:
        result = self.listings.query(
            IndexName="DonorCreatedIndex",
            KeyConditionExpression=Key("organizationId").eq(organization_id),
            ScanIndexForward=False,
            Limit=min(limit, 25),
        )
        return json_safe(result.get("Items", []))

    def create_listing(self, user_id: str, organization_id: str, data: dict) -> dict:
        self.require_membership(user_id, organization_id, {"owner", "manager", "staff"})
        organization = self.get_organization(organization_id) or {}
        created_at = now_iso()
        item = {
            **data,
            "listingId": str(uuid.uuid4()),
            "organizationId": organization_id,
            "organizationName": organization.get("name", "Local kitchen"),
            "pickupAddress": organization.get("address", ""),
            "createdBy": user_id,
            "createdAt": created_at,
            "updatedAt": created_at,
            "status": "available",
            "quantityAvailable": Decimal(str(data["quantityAvailable"])),
        }
        if "latitude" in organization and "longitude" in organization:
            item.update({"latitude": organization["latitude"], "longitude": organization["longitude"]})
        self.listings.put_item(Item=self._ddb_safe(item), ConditionExpression="attribute_not_exists(listingId)")
        return json_safe(item)

    def create_reservation(self, user_id: str, listing_id: str, quantity: float) -> dict:
        listing = self.get_listing(listing_id) or {}
        reservation_id = str(uuid.uuid4())
        created_at = now_iso()
        quantity_decimal = Decimal(str(quantity))
        item = {
            "reservationId": reservation_id,
            "listingId": listing_id,
            "recipientUserId": user_id,
            "quantity": quantity_decimal,
            "status": "reserved",
            "pickupCode": f"{secrets.randbelow(10000):04d}",
            "createdAt": created_at,
        }
        self.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": self.listings.name,
                        "Key": {"listingId": {"S": listing_id}},
                        "UpdateExpression": "SET quantityAvailable = quantityAvailable - :q, updatedAt = :now",
                        "ConditionExpression": "#status = :available AND quantityAvailable >= :q",
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": {
                            ":q": {"N": str(quantity_decimal)},
                            ":available": {"S": "available"},
                            ":now": {"S": created_at},
                        },
                    }
                },
                {
                    "Put": {
                        "TableName": self.reservations.name,
                        "Item": {key: self._serialize(value) for key, value in item.items()},
                        "ConditionExpression": "attribute_not_exists(reservationId)",
                    }
                },
            ]
        )
        return json_safe({**item, "pickupAddress": listing.get("pickupAddress", ""), "pickupLabel": listing.get("pickupLabel", "")})

    def reservations_for_user(self, user_id: str, limit: int = 50) -> list[dict]:
        result = self.reservations.query(
            IndexName="RecipientIndex",
            KeyConditionExpression=Key("recipientUserId").eq(user_id),
            ScanIndexForward=False,
            Limit=min(limit, 100),
        )
        return json_safe(result.get("Items", []))

    def save_agent_draft(self, user_id: str, organization_id: str, kind: str, payload: dict) -> dict:
        self.require_membership(user_id, organization_id, {"owner", "manager", "staff"})
        created_at = now_iso()
        item = {
            "runId": str(uuid.uuid4()),
            "organizationId": organization_id,
            "userId": user_id,
            "kind": kind,
            "status": "draft",
            "payload": payload,
            "createdAt": created_at,
            "expiresAt": int(time.time()) + 60 * 60 * 24 * 14,
        }
        self.agent_runs.put_item(Item=self._ddb_safe(item))
        return json_safe(item)

    @staticmethod
    def _ddb_safe(value):
        return json.loads(json.dumps(value), parse_float=Decimal)

    @staticmethod
    def _serialize(value):
        from boto3.dynamodb.types import TypeSerializer

        return TypeSerializer().serialize(value)
