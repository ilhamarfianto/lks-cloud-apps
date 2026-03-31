# 📦 Order Input – AWS Step Functions

This document describes the **JSON input format** used to start an **AWS Step Functions** workflow for an **Order Management System**.

The JSON payload is provided when calling **StartExecution** and will be processed by multiple states such as **Lambda**, **Choice**, and other workflow steps.

---

## 🧾 Sample JSON Input

```json
{
  "orderId": 1001,
  "customerId": 123,
  "items": [
    {
      "productName": "Laptop Pro",
      "quantity": 1,
      "price": 999.99
    },
    {
      "productName": "Wireless Headphones",
      "quantity": 2,
      "price": 199.99
    }
  ],
  "totalAmount": 1399.97,
  "timestamp": "2024-01-15T10:30:00Z"
}
