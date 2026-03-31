import json
import os
import boto3
from datetime import datetime

# ==============================
# AWS CLIENT
# ==============================
sns_client = boto3.client("sns")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN")


def lambda_handler(event, context):
    """
    Send notifications via SNS
    Event source: AWS Step Functions
    """

    print("📩 Incoming event:")
    print(json.dumps(event, indent=2))

    try:
        # ==============================
        # COMMON FIELDS
        # ==============================
        order_id = event.get("order_id", "UNKNOWN")
        notification_type = event.get("notification_type", "system_error")
        error_message = event.get("error_message", "-")
        amount = event.get("amount", 0)
        transaction_id = event.get("transaction_id", "N/A")

        # ==============================
        # BUILD MESSAGE
        # ==============================
        if notification_type == "order_confirmation":
            subject = f"Order Confirmation - {order_id}"
            message = f"""
Order Confirmation

Order ID      : {order_id}
Status        : Confirmed
Payment       : Success
Transaction ID: {transaction_id}
Amount        : ${amount}

Your order has been successfully processed.
Thank you for your purchase!
"""

        elif notification_type == "payment_failed":
            subject = f"Payment Failed - {order_id}"
            message = f"""
Payment Processing Failed

Order ID : {order_id}
Status   : Payment Failed
Amount   : ${amount}

Reason:
{error_message}

Please try again or contact support.
"""

        elif notification_type == "order_shipped":
            subject = f"Order Shipped - {order_id}"
            message = f"""
Order Shipped

Order ID : {order_id}
Status   : Shipped

Your order is on the way.
Thank you for shopping with us!
"""

        elif notification_type == "low_stock":
            subject = "Low Stock Alert"
            low_stock_items = event.get("low_stock_items", [])
            message = f"""
Low Stock Alert

The following items are running low:

{json.dumps(low_stock_items, indent=2)}

Please restock as soon as possible.
"""

        elif notification_type == "system_error":
            subject = f"System Error - {order_id}"
            message = f"""
System Error Notification

Order ID : {order_id}
Error    : {error_message}

Timestamp: {datetime.utcnow().isoformat()}

Immediate investigation is required.
"""

        else:
            subject = "Order Management Notification"
            message = json.dumps(event, indent=2)

        # ==============================
        # SEND SNS
        # ==============================
        response = sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=subject,
            Message=message.strip()
        )

        print("✅ SNS message sent:", response["MessageId"])

        return {
            "status": "success",
            "order_id": order_id,
            "notification_type": notification_type,
            "message_id": response["MessageId"],
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        print("❌ Error sending notification:", str(e))

        # IMPORTANT:
        # Jangan raise exception supaya Step Function tidak FAILED total
        return {
            "status": "error",
            "order_id": order_id if "order_id" in locals() else None,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }
        conn.close()