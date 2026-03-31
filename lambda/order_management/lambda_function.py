import json
import os
import boto3
import psycopg2
from datetime import datetime
import uuid

# Environment variables
DB_HOST = os.environ['DB_HOST']
DB_NAME = os.environ['DB_NAME']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
S3_BUCKET = os.environ['S3_BUCKET']
STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']

s3_client = boto3.client('s3')
sfn_client = boto3.client('stepfunctions')

def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body)
    }

def list_customers(event):
    """
    GET /customers
    Returns list of all customers for dropdown
    """
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT customer_id, customer_name, email, phone, address
            FROM customers
            ORDER BY customer_name
        """)
        
        customers = []
        for row in cur.fetchall():
            customers.append({
                'customer_id': row[0],
                'customer_name': row[1],
                'email': row[2],
                'phone': row[3],
                'address': row[4]
            })
        
        return response(200, {'customers': customers})
        
    except Exception as e:
        print(f"Error listing customers: {str(e)}")
        return response(500, {'message': 'Failed to list customers', 'error': str(e)})
    finally:
        cur.close()
        conn.close()

def list_products(event):
    """
    GET /products
    Returns list of all products from inventory for dropdown
    """
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Pertama, cek apakah kolom category ada
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'inventory' 
            AND column_name = 'category'
        """)
        has_category = cur.fetchone() is not None
        
        print(f"Database has category column: {has_category}")
        
        # Get query parameters for filtering
        query_params = event.get('queryStringParameters', {}) or {}
        category_filter = query_params.get('category')
        in_stock_only = query_params.get('in_stock', 'true').lower() == 'true'
        
        # Build query dynamically berdasarkan kolom yang ada
        if has_category:
            query = """
                SELECT product_id, product_name, price, stock_quantity, 
                       COALESCE(description, '') as description,
                       COALESCE(category, '') as category
                FROM inventory
                WHERE 1=1
            """
        else:
            query = """
                SELECT product_id, product_name, price, stock_quantity, 
                       COALESCE(description, '') as description,
                       '' as category
                FROM inventory
                WHERE 1=1
            """
        
        params = []
        
        if in_stock_only:
            query += " AND stock_quantity > 0"
        
        if category_filter and has_category:
            query += " AND category = %s"
            params.append(category_filter)
        
        query += " ORDER BY product_name"
        
        print(f"Executing query: {query}")
        print(f"With params: {params}")
        
        cur.execute(query, params)
        
        products = []
        for row in cur.fetchall():
            product = {
                'product_id': row[0],
                'product_name': row[1],
                'price': float(row[2]),
                'stock_quantity': row[3],
                'description': row[4],
                'category': row[5] if has_category else ''
            }
            products.append(product)
        
        print(f"Found {len(products)} products")
        
        return response(200, {
            'products': products,
            'count': len(products),
            'metadata': {
                'has_category_column': has_category,
                'filters_applied': {
                    'category': category_filter,
                    'in_stock_only': in_stock_only
                }
            }
        })
        
    except Exception as e:
        print(f"Error listing products: {str(e)}")
        import traceback
        traceback.print_exc()
        return response(500, {
            'message': 'Failed to list products', 
            'error': str(e),
            'hint': 'Check if inventory table exists and has required columns'
        })
    finally:
        cur.close()
        conn.close()

def get_product(product_id):
    """
    Get single product details
    """
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT product_id, product_name, price, stock_quantity, description
            FROM inventory
            WHERE product_id = %s AND stock_quantity > 0
        """, (product_id,))
        
        row = cur.fetchone()
        if not row:
            return None
        
        return {
            'product_id': row[0],
            'product_name': row[1],
            'price': float(row[2]),
            'stock_quantity': row[3],
            'description': row[4]
        }
        
    except Exception as e:
        print(f"Error getting product: {str(e)}")
        return None
    finally:
        cur.close()
        conn.close()

def create_order(event):
    body = json.loads(event['body'])
    
    # Validate required fields
    required_fields = ['customer_id', 'items']
    for field in required_fields:
        if field not in body:
            return response(400, {'message': f'Missing required field: {field}'})
    
    # Additional validation
    customer_id = body['customer_id']
    items = body['items']
    
    if not isinstance(customer_id, str) or not customer_id.strip():
        return response(400, {'message': 'customer_id must be a non-empty string'})
    
    if not isinstance(items, list) or len(items) == 0:
        return response(400, {'message': 'items must be a non-empty list'})
    
    # Validate each item
    for i, item in enumerate(items):
        if 'product_id' not in item or 'quantity' not in item:
            return response(400, {'message': f'Item {i} missing product_id or quantity'})
        if item['quantity'] <= 0:
            return response(400, {'message': f'Item {i} quantity must be positive'})
    
    order_id = str(uuid.uuid4())
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        # Calculate total amount
        total_amount = 0
        item_details = []
        for item in items:
            cur.execute("SELECT price, product_name FROM inventory WHERE product_id = %s", (item['product_id'],))
            result = cur.fetchone()
            if not result:
                return response(400, {'message': f"Product {item['product_id']} not found"})
            
            price, product_name = result
            item_total = price * item['quantity']
            total_amount += item_total
            
            # Simpan detail item untuk Step Functions
            item_details.append({
                'productId': item['product_id'],
                'productName': product_name,
                'quantity': item['quantity'],
                'price': float(price)
            })
        
        # Insert order
        cur.execute("""
            INSERT INTO orders (order_id, customer_id, total_amount, status, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (order_id, customer_id, total_amount, 'pending', datetime.now()))
        
        # Insert order items
        for item in items:
            cur.execute("""
                INSERT INTO order_items (order_id, product_id, quantity, price)
                SELECT %s, %s, %s, price FROM inventory WHERE product_id = %s
            """, (order_id, item['product_id'], item['quantity'], item['product_id']))
        
        conn.commit()
        
        # Save order to S3
        s3_key = f"orders/{order_id}.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps({
                'order_id': order_id,
                'customer_id': customer_id,
                'items': items,
                'total_amount': float(total_amount),
                'created_at': datetime.now().isoformat()
            })
        )

        print(f"STATE_MACHINE_ARN: {STATE_MACHINE_ARN}")
        print(f"ARN type check: {'execution' in STATE_MACHINE_ARN}")
        
        # Validasi format ARN
        if 'execution' in STATE_MACHINE_ARN:
            return response(400, {
                'message': 'Invalid State Machine ARN configuration',
                'error': 'ARN appears to be an execution ARN, not a state machine ARN'
            })
        
        # Start Step Functions workflow dengan format camelCase yang diharapkan
        step_functions_input = {
            'orderId': order_id,
            'customerId': customer_id,
            'totalAmount': float(total_amount),
            'items': item_details,  # Format yang sesuai dengan Step Functions
            'timestamp': datetime.now().isoformat()
        }
        
        print(f"Step Functions Input: {json.dumps(step_functions_input, indent=2)}")
        
        execution_name = f"order-{order_id}"
        print(f"Starting execution with name: {execution_name}")

        execution_response = sfn_client.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            name=execution_name,
            input=json.dumps(step_functions_input)
        )
        
        execution_arn = execution_response['executionArn']
        print(f"Execution started: {execution_arn}")
        
        return response(201, {
            'message': 'Order created successfully',
            'order_id': order_id,
            'execution_arn': execution_arn,
            'note': 'Save this execution_arn to check workflow status later'
        })
        
    except Exception as e:
        conn.rollback()
        print(f"Error in create_order: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # Check if it's a Step Functions error
        if "InvalidArn" in str(e) or "stepfunctions" in str(e).lower():
            # If Step Functions fails but order was created, return success with warning
            return response(201, {
                'message': 'Order created but workflow failed to start',
                'order_id': order_id,
                'error': str(e),
                'note': 'Order was saved to database and S3 successfully'
            })
        else:
            # For other errors, return 500
            return response(500, {
                'message': 'Failed to create order',
                'error': str(e)
            })
    finally:
        cur.close()
        conn.close()

def list_orders(event):
    params = event.get('queryStringParameters', {}) or {}
    page = int(params.get('page', 1))
    limit = int(params.get('limit', 10))
    offset = (page - 1) * limit
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT order_id, customer_id, total_amount, status, created_at
            FROM orders
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        
        orders = []
        for row in cur.fetchall():
            orders.append({
                'order_id': row[0],
                'customer_id': row[1],
                'total_amount': float(row[2]),
                'status': row[3],
                'created_at': row[4].isoformat()
            })
        
        cur.execute("SELECT COUNT(*) FROM orders")
        total = cur.fetchone()[0]
        
        return response(200, {
            'orders': orders,
            'pagination': {
                'page': page,
                'limit': limit,
                'total': total,
                'pages': (total + limit - 1) // limit
            }
        })
    finally:
        cur.close()
        conn.close()

def get_order(order_id):
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        cur.execute("""
            SELECT order_id, customer_id, total_amount, status, created_at
            FROM orders
            WHERE order_id = %s
        """, (order_id,))
        
        row = cur.fetchone()
        if not row:
            return response(404, {'message': 'Order not found'})
        
        cur.execute("""
            SELECT product_id, quantity, price
            FROM order_items
            WHERE order_id = %s
        """, (order_id,))
        
        items = []
        for item_row in cur.fetchall():
            items.append({
                'product_id': item_row[0],
                'quantity': item_row[1],
                'price': float(item_row[2])
            })
        
        return response(200, {
            'order_id': row[0],
            'customer_id': row[1],
            'total_amount': float(row[2]),
            'status': row[3],
            'created_at': row[4].isoformat(),
            'items': items
        })
    finally:
        cur.close()
        conn.close()

def update_order(order_id, event):
    body = json.loads(event['body'])
    status = body.get('status')
    
    if not status:
        return response(400, {'message': 'Status is required'})
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        cur.execute("""
            UPDATE orders
            SET status = %s, updated_at = %s
            WHERE order_id = %s
        """, (status, datetime.now(), order_id))
        
        if cur.rowcount == 0:
            return response(404, {'message': 'Order not found'})
        
        conn.commit()
        
        return response(200, {
            'message': 'Order updated successfully',
            'order_id': order_id,
            'status': status
        })
    finally:
        cur.close()
        conn.close()

def delete_order(order_id):
    conn = get_db_connection()
    cur = conn.cursor()
    
    try:
        cur.execute("DELETE FROM order_items WHERE order_id = %s", (order_id,))
        cur.execute("DELETE FROM orders WHERE order_id = %s", (order_id,))
        
        if cur.rowcount == 0:
            return response(404, {'message': 'Order not found'})
        
        conn.commit()
        
        return response(200, {
            'message': 'Order deleted successfully',
            'order_id': order_id
        })
    finally:
        cur.close()
        conn.close()

def construct_execution_arn(order_id):
    """
    Construct execution ARN from order ID
    Format: arn:aws:states:region:account:execution:stateMachineName:executionId
    """
    try:
        # Parse state machine ARN
        # Format: arn:aws:states:region:account:stateMachine:stateMachineName
        parts = STATE_MACHINE_ARN.split(':')
        
        if len(parts) >= 7:
            # Extract components
            region = parts[3]
            account_id = parts[4]
            state_machine_name = parts[6]
            
            # Try different execution name patterns
            possible_names = [
                order_id,                    # just the order ID
                f"order-{order_id}",         # order- prefix
                f"exec-{order_id}",          # exec- prefix
                f"{order_id[:8]}",           # first 8 chars
            ]
            
            for exec_name in possible_names:
                execution_arn = f"arn:aws:states:{region}:{account_id}:execution:{state_machine_name}:{exec_name}"
                print(f"Trying constructed ARN: {execution_arn}")
                
                # Try to verify if it exists
                try:
                    sfn_client.describe_execution(executionArn=execution_arn)
                    print(f"ARN verified: {execution_arn}")
                    return execution_arn
                except:
                    continue
        
        return None
        
    except Exception as e:
        print(f"Error constructing execution ARN: {e}")
        return None

def list_executions(event):
    """
    GET /executions
    List all Step Functions executions
    """
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return response(200, {})
        
        params = event.get('queryStringParameters', {}) or {}
        status_filter = params.get('status', 'ALL')
        max_results = int(params.get('limit', 50))
        
        exec_list_response = sfn_client.list_executions(
            stateMachineArn=STATE_MACHINE_ARN,
            statusFilter=status_filter,
            maxResults=max_results
        )
        
        executions = []
        for exec in exec_list_response.get('executions', []):
            executions.append({
                'execution_arn': exec.get('executionArn'),
                'name': exec.get('name'),
                'status': exec.get('status'),
                'start_date': exec.get('startDate').isoformat() if exec.get('startDate') else None,
                'stop_date': exec.get('stopDate').isoformat() if exec.get('stopDate') else None
            })
        
        return response(200, {
            'executions': executions,
            'count': len(executions),
            'state_machine': STATE_MACHINE_ARN
        })
        
    except Exception as e:
        print(f"Error listing executions: {str(e)}")
        return response(500, {
            'message': 'Failed to list executions',
            'error': str(e)
        })

def get_workflow_status(identifier):
    """
    Get workflow status by either:
    1. Execution ARN (from create_order response)
    2. Order ID (will search for executions)
    """
    print(f"get_workflow_status called with identifier: {identifier}")
    
    try:
        # Check if identifier is execution ARN
        if identifier.startswith('arn:aws:states:') and 'execution:' in identifier:
            execution_arn = identifier
            print(f"Using provided execution ARN: {execution_arn}")
        else:
            # It's an order ID, we need to find the execution
            order_id = identifier
            print(f"Searching for execution for order: {order_id}")
            
            # Method 1: List executions and find by name
            state_machine_arn = STATE_MACHINE_ARN
            print(f"State Machine ARN: {state_machine_arn}")
            
            # Extract state machine name
            state_machine_name = state_machine_arn.split(':')[-1]
            
            # List executions for this state machine
            try:
                executions_response = sfn_client.list_executions(
                    stateMachineArn=state_machine_arn,
                    statusFilter='ALL',  # Include all statuses
                    maxResults=100
                )
                
                print(f"Found {len(executions_response.get('executions', []))} executions total")
                
                # Look for execution with matching name pattern
                execution_arn = None
                for execution in executions_response.get('executions', []):
                    exec_name = execution.get('name', '')
                    exec_arn = execution.get('executionArn', '')
                    
                    # Check if execution name contains order ID
                    if order_id in exec_name:
                        execution_arn = exec_arn
                        print(f"Found matching execution: {execution_arn}")
                        break
                    
                    # Also check if name is exactly the order ID
                    if exec_name == order_id or exec_name == f"order-{order_id}":
                        execution_arn = exec_arn
                        print(f"Found exact matching execution: {execution_arn}")
                        break
                
                if not execution_arn:
                    # Method 2: Try to construct execution ARN
                    print("Trying to construct execution ARN...")
                    execution_arn = construct_execution_arn(order_id)
                    
            except Exception as list_error:
                print(f"Error listing executions: {list_error}")
                # Fall back to constructing ARN
                execution_arn = construct_execution_arn(order_id)
        
        if not execution_arn:
            return response(404, {
                'message': 'Workflow execution not found',
                'identifier': identifier,
                'hint': 'The workflow may not have been started yet or the order ID is incorrect'
            })
        
        # Get execution details
        execution = sfn_client.describe_execution(executionArn=execution_arn)
        
        # Build response data
        result_data = {
            'execution_arn': execution_arn,
            'status': execution['status'],
            'start_date': execution['startDate'].isoformat(),
            'input_identifier': identifier
        }
        
        # Add stop date if available
        if 'stopDate' in execution and execution['stopDate']:
            result_data['stop_date'] = execution['stopDate'].isoformat()
        
        # Add execution name if available
        if 'name' in execution:
            result_data['execution_name'] = execution['name']
        
        # Parse input/output
        if 'input' in execution and execution['input']:
            try:
                result_data['input'] = json.loads(execution['input'])
            except:
                result_data['input_raw'] = execution['input']
        
        if 'output' in execution and execution['output']:
            try:
                result_data['output'] = json.loads(execution['output'])
            except:
                result_data['output_raw'] = execution['output']
        
        return response(200, result_data)
        
    except sfn_client.exceptions.ExecutionDoesNotExist:
        return response(404, {
            'message': 'Workflow execution not found',
            'identifier': identifier,
            'execution_arn': execution_arn if 'execution_arn' in locals() else None,
            'hint': 'The workflow may not have been started or has been deleted'
        })
    except Exception as e:
        print(f"Error getting workflow status: {str(e)}")
        import traceback
        traceback.print_exc()
        return response(500, {
            'message': 'Failed to get workflow status',
            'error': str(e),
            'identifier': identifier
        })

def lambda_handler(event, context):
    print(f"Event received: {json.dumps(event, indent=2)}")
    
    http_method = event.get('httpMethod', '')
    resource = event.get('resource', '')  # Gunakan resource, bukan path!
    
    print(f"DEBUG - Method: {http_method}, Resource: {resource}")
    
    try:
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            print("OPTIONS request - CORS preflight")
            return response(200, {})
        
        # Routing berdasarkan resource pattern
        if resource == '/customers' and http_method == 'GET':
            print("Routing to list_customers")
            return list_customers(event)
        
        elif resource == '/products' and http_method == 'GET':
            print("Routing to list_products")
            return list_products(event)
        
        elif resource == '/orders' and http_method == 'GET':
            print("Routing to list_orders")
            return list_orders(event)
            
        elif resource == '/orders' and http_method == 'POST':
            print("Routing to create_order")
            return create_order(event)
            
        elif resource == '/orders/{id}' and http_method == 'GET':
            print("Routing to get_order")
            if not event.get('pathParameters') or 'id' not in event['pathParameters']:
                return response(400, {'message': 'Order ID is required'})
            order_id = event['pathParameters']['id']
            return get_order(order_id)
            
        elif resource == '/orders/{id}' and http_method == 'PUT':
            print("Routing to update_order")
            if not event.get('pathParameters') or 'id' not in event['pathParameters']:
                return response(400, {'message': 'Order ID is required'})
            order_id = event['pathParameters']['id']
            return update_order(order_id, event)
            
        elif resource == '/orders/{id}' and http_method == 'DELETE':
            print("Routing to delete_order")
            if not event.get('pathParameters') or 'id' not in event['pathParameters']:
                return response(400, {'message': 'Order ID is required'})
            order_id = event['pathParameters']['id']
            return delete_order(order_id)
            
        elif resource == '/status/{id}' and http_method == 'GET':
            print("Routing to get_workflow_status")
            if not event.get('pathParameters') or 'id' not in event['pathParameters']:
                return response(400, {'message': 'Order ID or Execution ARN is required'})
            identifier = event['pathParameters']['id']
            return get_workflow_status(identifier)
        
        elif resource == '/executions' and http_method == 'GET':
            print("Routing to list_executions")
            return list_executions(event)
        
        else:
            print(f"NO ROUTE MATCHED - Method: {http_method}, Resource: {resource}")
            print(f"Available resources: /customers, /products, /orders, /orders/{{id}}, /status/{{id}}, /executions")
            return response(400, {
                'message': 'Invalid request',
                'debug_info': {
                    'method': http_method,
                    'resource': resource,
                    'available_routes': [
                        'GET /customers',
                        'GET /products',
                        'GET /orders',
                        'POST /orders',
                        'GET /orders/{id}',
                        'PUT /orders/{id}',
                        'DELETE /orders/{id}',
                        'GET /status/{id}',
                        'GET /executions'
                    ]
                }
            })
            
    except Exception as e:
        print(f"Error in lambda_handler: {str(e)}")
        import traceback
        traceback.print_exc()
        return response(500, {
            'message': 'Internal server error',
            'error': str(e),
            'traceback': traceback.format_exc()
        })