import json
import os
import psycopg2
import boto3
from datetime import datetime

# Environment variables
DB_HOST = os.environ.get('DB_HOST')
DB_NAME = os.environ.get('DB_NAME')
DB_USER = os.environ.get('DB_USER')
DB_PASSWORD = os.environ.get('DB_PASSWORD')

eventbridge = boto3.client('events')

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

def lambda_handler(event, context):
    print(f"=== INVENTORY UPDATE START ===")
    print(f"Event received: {json.dumps(event, indent=2)}")
    
    # Extract data - handle nested structure
    order_id = event.get('order_id')
    transaction_id = None
    items = []
    
    # Try to get from event directly
    if 'orderId' in event:
        order_id = event['orderId']
        transaction_id = event.get('transaction_id')
        items = event.get('items', [])
    elif 'order_id' in event:
        order_id = event['order_id']
        transaction_id = event.get('transaction_id')
        items = event.get('items', [])
    
    print(f"Extracted - order_id: {order_id}, transaction_id: {transaction_id}, items count: {len(items)}")
    
    if not order_id:
        return {
            'inventoryStatus': 'failed',
            'message': 'Order ID is required'
        }

    order_id = str(order_id)
    
    # If items are empty, fetch from database
    if not items:
        try:
            print(f"Fetching items from database for order_id: {order_id}")
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                SELECT oi.product_id, oi.quantity, i.product_name, i.price
                FROM order_items oi
                JOIN inventory i ON oi.product_id = i.product_id
                WHERE oi.order_id = %s
            """, (order_id,))
            
            items = []
            for row in cur.fetchall():
                items.append({
                    'productId': row[0],
                    'productName': row[2],
                    'quantity': row[1],
                    'price': float(row[3])
                })
            
            cur.close()
            conn.close()
            
            print(f"Fetched {len(items)} items from database")
            
            if not items:
                return {
                    'inventoryStatus': 'failed',
                    'message': 'No items found for this order'
                }
        except Exception as e:
            print(f"Error fetching order items: {str(e)}")
            return {
                'inventoryStatus': 'failed',
                'message': f'Error fetching items: {str(e)}'
            }
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        updated_products = []
        low_stock_alerts = []
        
        for item in items:
            product_id = str(item.get('productId', '') or '').strip()
            quantity = int(item.get('quantity', 0))
            
            if not product_id:
                print(f"Product ID not found for item: {item}")
                continue
            
            # Check current stock
            cur.execute("""
                SELECT stock_quantity, product_name
                FROM inventory
                WHERE product_id = %s
                FOR UPDATE
            """, (product_id,))
            
            result = cur.fetchone()
            if not result:
                print(f"Product {product_id} not found in inventory")
                continue
            
            current_stock, product_name = result
            
            # Check if sufficient stock
            if current_stock < quantity:
                conn.rollback()
                error_msg = f'Insufficient stock for product {product_name}. Available: {current_stock}, Requested: {quantity}'
                print(error_msg)
                return {
                    'inventoryStatus': 'failed',
                    'message': error_msg
                }
            
            # Update inventory
            new_stock = current_stock - quantity
            cur.execute("""
                UPDATE inventory
                SET stock_quantity = %s,
                    updated_at = %s
                WHERE product_id = %s
            """, (new_stock, datetime.now(), product_id))
            
            updated_products.append({
                'product_id': product_id,
                'product_name': product_name,
                'previous_stock': current_stock,
                'new_stock': new_stock,
                'quantity_sold': quantity
            })
            
            # Check for low stock
            if new_stock <= 10:
                low_stock_alerts.append({
                    'product_id': product_id,
                    'product_name': product_name,
                    'current_stock': new_stock
                })
        
        # Update order status
        cur.execute("""
            UPDATE orders
            SET status = 'processing', updated_at = %s
            WHERE order_id = %s
        """, (datetime.now(), str(order_id)))
        
        conn.commit()
        
        # Send low stock events
        if low_stock_alerts:
            for alert in low_stock_alerts:
                try:
                    eventbridge.put_events(
                        Entries=[{
                            'Source': 'order.system',
                            'DetailType': 'LowStock',
                            'Detail': json.dumps({
                                'product_id': alert['product_id'],
                                'product_name': alert['product_name'],
                                'current_stock': alert['current_stock'],
                                'timestamp': datetime.now().isoformat()
                            })
                        }]
                    )
                except Exception as e:
                    print(f"Error sending low stock event: {str(e)}")
        
        print(f"Inventory updated successfully for order {order_id}")
        
        return {
            'inventoryStatus': 'success',
            'message': 'Inventory updated successfully',
            'updated_products': updated_products,
            'low_stock_alerts': low_stock_alerts
        }
        
    except Exception as e:
        conn.rollback()
        print(f"Error updating inventory: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'inventoryStatus': 'failed',
            'message': f'Inventory update error: {str(e)}'
        }
    finally:
        cur.close()
        conn.close()