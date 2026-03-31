import json
import random
import time

def lambda_handler(event, context):
    """
    Simulate payment processing
    """
    try:
        print(f"=== PAYMENT PROCESSING START ===")
        print(f"Event received: {json.dumps(event, indent=2)}")
        
        # Extract data
        order_id = event.get('order_id')
        total_amount = event.get('total_amount', 0)
        
        print(f"Processing payment - Order ID: {order_id}, Amount: {total_amount}")
        
        if not order_id:
            return {
                'paymentStatus': 'error',
                'message': 'Order ID is required',
                'timestamp': int(time.time())
            }
        
        # Simulate payment processing delay
        time.sleep(1)
        
        # Simulate payment success/failure
        payment_success = random.random() < 0.9
        
        current_time = int(time.time())
        order_id_str = str(order_id)
        
        if payment_success:
            payment_status = 'success'
            transaction_id = f"TXN-{order_id_str[:8] if len(order_id_str) >= 8 else order_id_str}-{current_time}"
            message = 'Payment processed successfully'
        else:
            payment_status = 'failed'
            transaction_id = None
            message = 'Payment processing failed'
        
        response = {
            'paymentStatus': payment_status,  # PERHATIKAN: camelCase
            'transaction_id': transaction_id, # snake_case
            'message': message,
            'timestamp': current_time
        }
        
        print(f"=== PAYMENT PROCESSING END ===")
        print(f"Returning response: {json.dumps(response, indent=2)}")
        return response
        
    except Exception as e:
        print(f"Error processing payment: {str(e)}")
        import traceback
        traceback.print_exc()
        
        error_response = {
            'paymentStatus': 'error',  # PERHATIKAN: camelCase
            'message': f'Payment error: {str(e)}',
            'timestamp': int(time.time())
        }
        print(f"Returning error response: {json.dumps(error_response, indent=2)}")
        return error_response