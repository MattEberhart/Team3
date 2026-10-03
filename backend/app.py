import base64
import json
import os
import uuid

import boto3
from botocore.exceptions import ClientError

from agent_runtime import extract_donation, plan_recipes
from repository import Repository


repository = Repository()
s3 = boto3.client("s3")


def response(status: int, body: dict | list):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def body_from(event: dict) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw)


def user_id_from(event: dict) -> str:
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    user_id = claims.get("sub")
    if not user_id:
        raise PermissionError("Authentication is required.")
    return user_id


def claims_from(event: dict) -> dict:
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})


def require_fields(data: dict, *fields: str):
    missing = [field for field in fields if data.get(field) in (None, "")]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")


def public_listing(item: dict) -> dict:
    return {key: value for key, value in item.items() if key not in {"pickupAddress", "latitude", "longitude", "createdBy"}}


def handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")
    route_key = event.get("routeKey") or f"{method} {path}"
    try:
        if route_key == "GET /health":
            return response(200, {"status": "ok", "environment": os.environ.get("ENVIRONMENT", "unknown")})

        if route_key == "GET /listings":
            return response(200, {"items": [public_listing(item) for item in repository.list_available()]})

        if route_key == "GET /listings/{listingId}":
            item = repository.get_listing(event.get("pathParameters", {}).get("listingId", ""))
            return response(200, public_listing(item)) if item else response(404, {"error": "Listing not found."})

        user_id = user_id_from(event)

        if route_key == "GET /me":
            profile = repository.profile(user_id)
            return response(200, profile) if profile else response(404, {"error": "Profile not initialized."})

        if route_key == "POST /me/bootstrap":
            data = body_from(event)
            require_fields(data, "displayName", "accountType")
            if data["accountType"] not in {"recipient", "donor"}:
                raise ValueError("Account type must be recipient or donor.")
            claims = claims_from(event)
            return response(201, repository.bootstrap_user(user_id, claims.get("email", ""), data["displayName"], data["accountType"], data.get("organizationName"), data.get("address"), data.get("latitude"), data.get("longitude")))

        if route_key == "POST /listings":
            data = body_from(event)
            require_fields(data, "organizationId", "title", "quantityAvailable", "unit", "pickupEnd")
            item = repository.create_listing(user_id, data.pop("organizationId"), data)
            return response(201, item)

        if route_key == "POST /reservations":
            data = body_from(event)
            require_fields(data, "listingId", "quantity")
            quantity = float(data["quantity"])
            if quantity <= 0:
                raise ValueError("Quantity must be greater than zero.")
            return response(201, repository.create_reservation(user_id, data["listingId"], quantity))

        if route_key == "GET /me/reservations":
            return response(200, {"items": repository.reservations_for_user(user_id)})

        if route_key == "POST /uploads":
            data = body_from(event)
            require_fields(data, "contentType", "purpose")
            if data["contentType"] not in {"image/jpeg", "image/png", "image/webp", "audio/webm", "audio/mp4"}:
                raise ValueError("Unsupported upload type.")
            prefix = "temporary-audio" if data["purpose"] == "voice" else f"uploads/{user_id}"
            key = f"{prefix}/{uuid.uuid4()}"
            url = s3.generate_presigned_url(
                "put_object",
                Params={"Bucket": os.environ["MEDIA_BUCKET"], "Key": key, "ContentType": data["contentType"]},
                ExpiresIn=300,
            )
            return response(200, {"uploadUrl": url, "objectKey": key, "expiresIn": 300})

        if route_key == "POST /agent/extract":
            data = body_from(event)
            require_fields(data, "organizationId", "shiftNote")
            return response(200, extract_donation(repository, user_id=user_id, organization_id=data["organizationId"], shift_note=data["shiftNote"][:8000]))

        if route_key == "POST /agent/recipes":
            data = body_from(event)
            require_fields(data, "latitude", "longitude")
            return response(200, plan_recipes(repository, user_id=user_id, latitude=float(data["latitude"]), longitude=float(data["longitude"]), max_stops=min(max(int(data.get("maxStops", 2)), 1), 4), max_miles=min(max(float(data.get("maxMiles", 3)), 0.5), 10)))

        return response(404, {"error": "Route not found."})
    except PermissionError as error:
        return response(403, {"error": str(error)})
    except (ValueError, json.JSONDecodeError) as error:
        return response(400, {"error": str(error)})
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"ConditionalCheckFailedException", "TransactionCanceledException"}:
            return response(409, {"error": "That quantity is no longer available."})
        print(json.dumps({"event": "aws_error", "code": error.response.get("Error", {}).get("Code")}))
        return response(500, {"error": "A service error occurred."})
    except Exception as error:
        print(json.dumps({"event": "unhandled_error", "type": type(error).__name__}))
        return response(500, {"error": "An unexpected error occurred."})
