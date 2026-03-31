import json
import os
import psycopg2
from datetime import datetime
import traceback

# ==============================
# ENV VARIABLES
# ==============================
DB_HOST = os.environ.get("DB_HOST")
DB_NAME = os.environ.get("DB_NAME")
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")


def get_db_connection():
    return psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )


def lambda_handler(event, context):
    print("🚀 INIT DATABASE STARTED")

    insert_sample_data = event.get("insert_sample_data", True)
    drop_existing = event.get("drop_existing", False)

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # =====================================================
        # DROP TABLES (OPTIONAL - DANGER)
        # =====================================================
        if drop_existing:
            print("⚠️ Dropping existing tables")
            cur.execute("""
                DROP TABLE IF EXISTS order_items CASCADE;
                DROP TABLE IF EXISTS orders CASCADE;
                DROP TABLE IF EXISTS inventory CASCADE;
                DROP TABLE IF EXISTS customers CASCADE;
            """)
            conn.commit()

        # =====================================================
        # CREATE BASE TABLES (SAFE)
        # =====================================================
        print("📦 Creating tables")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS customers (
                customer_id VARCHAR(50) PRIMARY KEY,
                customer_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20),
                address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventory (
                product_id VARCHAR(50) PRIMARY KEY,
                product_name VARCHAR(100) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
                stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id VARCHAR(50) PRIMARY KEY,
                customer_id VARCHAR(50) NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id)
                    REFERENCES customers(customer_id)
                    ON DELETE CASCADE
            );
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id VARCHAR(50) NOT NULL,
                product_id VARCHAR(50) NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id)
                    REFERENCES orders(order_id)
                    ON DELETE CASCADE,
                FOREIGN KEY (product_id)
                    REFERENCES inventory(product_id)
                    ON DELETE CASCADE
            );
        """)

        conn.commit()
        print("✅ Base tables ready")

        # =====================================================
        # SAFE ALTER (ENSURE COLUMNS EXIST)
        # =====================================================
        print("🛠 Ensuring missing columns")

        safe_alters = [
            # customers.updated_at
            """
            DO $
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='customers'
                    AND column_name='updated_at'
                ) THEN
                    ALTER TABLE customers 
                    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $;
            """,

            # customers.phone
            """
            DO $
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='customers'
                    AND column_name='phone'
                ) THEN
                    ALTER TABLE customers ADD COLUMN phone VARCHAR(20);
                END IF;
            END $;
            """,

            # customers.address
            """
            DO $
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='customers'
                    AND column_name='address'
                ) THEN
                    ALTER TABLE customers ADD COLUMN address TEXT;
                END IF;
            END $;
            """,

            # inventory.description
            """
            DO $
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='inventory'
                    AND column_name='description'
                ) THEN
                    ALTER TABLE inventory ADD COLUMN description TEXT;
                END IF;
            END $;
            """,

            # inventory.updated_at
            """
            DO $
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='inventory'
                    AND column_name='updated_at'
                ) THEN
                    ALTER TABLE inventory 
                    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $;
            """,

            # inventory.category
            """
            DO $
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='inventory'
                    AND column_name='category'
                ) THEN
                    ALTER TABLE inventory ADD COLUMN category VARCHAR(50);
                END IF;
            END $;
            """,

            # orders.updated_at
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='orders'
                    AND column_name='updated_at'
                ) THEN
                    ALTER TABLE orders 
                    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
            """,

            # orders.payment_status
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='orders'
                    AND column_name='payment_status'
                ) THEN
                    ALTER TABLE orders ADD COLUMN payment_status VARCHAR(50);
                END IF;
            END $$;
            """,

            # orders.transaction_id
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='orders'
                    AND column_name='transaction_id'
                ) THEN
                    ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(100);
                END IF;
            END $$;
            """
        ]

        for idx, sql in enumerate(safe_alters):
            try:
                cur.execute(sql)
                conn.commit()
                print(f"✅ Column check/add completed ({idx + 1}/{len(safe_alters)})")
            except Exception as e:
                conn.rollback()
                print(f"⚠️ ALTER skipped ({idx + 1}): {e}")

        # =====================================================
        # SAFE INDEX CREATION
        # =====================================================
        print("⚡ Creating indexes")

        safe_indexes = [
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE tablename='orders'
                    AND indexname='idx_orders_customer_id'
                ) THEN
                    CREATE INDEX idx_orders_customer_id
                    ON orders(customer_id);
                END IF;
            END $$;
            """,

            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE tablename='inventory'
                    AND indexname='idx_inventory_category'
                ) THEN
                    CREATE INDEX idx_inventory_category
                    ON inventory(category);
                END IF;
            END $$;
            """,

            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE tablename='customers'
                    AND indexname='idx_customers_email'
                ) THEN
                    CREATE INDEX idx_customers_email
                    ON customers(email);
                END IF;
            END $$;
            """
        ]

        for idx, sql in enumerate(safe_indexes):
            try:
                cur.execute(sql)
                conn.commit()
                print(f"✅ Index check/creation completed ({idx + 1}/{len(safe_indexes)})")
            except Exception as e:
                conn.rollback()
                print(f"⚠️ INDEX skipped ({idx + 1}): {e}")

        # =====================================================
        # SAMPLE DATA
        # =====================================================
        if insert_sample_data:
            print("🌱 Inserting sample data")
            
            # Verify critical columns exist before inserting
            cur.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'inventory'
                ORDER BY ordinal_position;
            """)
            inventory_columns = [row[0] for row in cur.fetchall()]
            print(f"📋 Inventory columns: {', '.join(inventory_columns)}")
            
            insert_samples(cur, conn)

        print("🎉 DATABASE INIT SUCCESS")

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Database initialized successfully",
                "sample_data": insert_sample_data,
                "dropped_existing": drop_existing,
                "timestamp": datetime.utcnow().isoformat()
            })
        }

    except Exception as e:
        conn.rollback()
        print("🔥 FATAL ERROR")
        print(traceback.format_exc())
        return {
            "statusCode": 500,
            "body": json.dumps({
                "message": "Database initialization failed",
                "error": str(e),
                "traceback": traceback.format_exc()
            })
        }

    finally:
        cur.close()
        conn.close()


# =====================================================
# SAMPLE DATA
# =====================================================
def insert_samples(cur, conn):
    """Insert sample data for testing"""
    
    # Check which columns exist in inventory table
    cur.execute("""
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'inventory';
    """)
    inventory_cols = [row[0] for row in cur.fetchall()]
    has_description = 'description' in inventory_cols
    has_category = 'category' in inventory_cols
    
    print(f"🔍 Inventory has description: {has_description}, category: {has_category}")
    
    # Sample customers
    cur.execute("""
        INSERT INTO customers (customer_id, customer_name, email, phone, address)
        VALUES 
            ('CUST001', 'John Doe', 'john@example.com', '+1-555-0101', '123 Main St, New York, NY'),
            ('CUST002', 'Jane Smith', 'jane@example.com', '+1-555-0102', '456 Oak Ave, Los Angeles, CA'),
            ('CUST003', 'Bob Johnson', 'bob@example.com', '+1-555-0103', '789 Pine Rd, Chicago, IL')
        ON CONFLICT (customer_id) DO NOTHING;
    """)

    # Sample inventory - dynamic based on available columns
    if has_description and has_category:
        cur.execute("""
            INSERT INTO inventory (
                product_id, product_name, description, price, stock_quantity, category
            )
            VALUES 
                ('PROD001', 'Laptop Pro', 'High-performance laptop with 16GB RAM', 1200.00, 10, 'Electronics'),
                ('PROD002', 'Wireless Mouse', 'Ergonomic wireless mouse', 25.99, 50, 'Electronics'),
                ('PROD003', 'Mechanical Keyboard', 'RGB mechanical gaming keyboard', 89.99, 30, 'Electronics'),
                ('PROD004', 'USB-C Cable', '2m USB-C charging cable', 12.99, 100, 'Accessories'),
                ('PROD005', 'Laptop Bag', 'Water-resistant laptop backpack', 45.00, 25, 'Accessories')
            ON CONFLICT (product_id) DO NOTHING;
        """)
    elif has_category:
        cur.execute("""
            INSERT INTO inventory (
                product_id, product_name, price, stock_quantity, category
            )
            VALUES 
                ('PROD001', 'Laptop Pro', 1200.00, 10, 'Electronics'),
                ('PROD002', 'Wireless Mouse', 25.99, 50, 'Electronics'),
                ('PROD003', 'Mechanical Keyboard', 89.99, 30, 'Electronics'),
                ('PROD004', 'USB-C Cable', 12.99, 100, 'Accessories'),
                ('PROD005', 'Laptop Bag', 45.00, 25, 'Accessories')
            ON CONFLICT (product_id) DO NOTHING;
        """)
    else:
        cur.execute("""
            INSERT INTO inventory (
                product_id, product_name, price, stock_quantity
            )
            VALUES 
                ('PROD001', 'Laptop Pro', 1200.00, 10),
                ('PROD002', 'Wireless Mouse', 25.99, 50),
                ('PROD003', 'Mechanical Keyboard', 89.99, 30),
                ('PROD004', 'USB-C Cable', 12.99, 100),
                ('PROD005', 'Laptop Bag', 45.00, 25)
            ON CONFLICT (product_id) DO NOTHING;
        """)

    # Sample orders
    cur.execute("""
        INSERT INTO orders (
            order_id, customer_id, total_amount, status, payment_status, transaction_id
        )
        VALUES 
            ('ORD001', 'CUST001', 1225.99, 'completed', 'success', 'TXN-001'),
            ('ORD002', 'CUST002', 115.98, 'pending', 'pending', 'TXN-002')
        ON CONFLICT (order_id) DO NOTHING;
    """)

    # Sample order items
    cur.execute("""
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES 
            ('ORD001', 'PROD001', 1, 1200.00),
            ('ORD001', 'PROD002', 1, 25.99),
            ('ORD002', 'PROD003', 1, 89.99),
            ('ORD002', 'PROD002', 1, 25.99)
        ON CONFLICT DO NOTHING;
    """)

    conn.commit()
    print("✅ Sample data inserted successfully")