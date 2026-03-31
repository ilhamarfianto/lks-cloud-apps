// Configuration - Will be loaded from storage
let API_ENDPOINT = '';
let API_KEY = '';
let AWS_REGION = 'us-east-1';
let DEBUG_MODE = true;

let currentPage = 1;

// Storage keys
const STORAGE_KEYS = {
    API_ENDPOINT: 'lks_api_endpoint',
    API_KEY: 'lks_api_key',
    AWS_REGION: 'lks_aws_region',
    DEBUG_MODE: 'lks_debug_mode'
};

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    console.log('=== DOM Content Loaded ===');
    
    await loadConfiguration();
    checkConfiguration();
    
    // Initialize Bootstrap components
    initializeBootstrapComponents();
    
    // Load initial data
    setTimeout(() => {
        console.log('Starting initial data load...');
        loadDashboard();
        setupCreateOrderForm();
    }, 100);
});

// Initialize Bootstrap components
function initializeBootstrapComponents() {
    // Initialize tabs
    const triggerTabList = [].slice.call(document.querySelectorAll('#mainTabs button'));
    triggerTabList.forEach(function (triggerEl) {
        const tabTrigger = new bootstrap.Tab(triggerEl);
        triggerEl.addEventListener('click', function (event) {
            event.preventDefault();
            tabTrigger.show();
            
            // Load data when switching to specific tabs
            const tabId = triggerEl.getAttribute('data-bs-target');
            if (tabId === '#orders') {
                loadOrders();
            } else if (tabId === '#dashboard') {
                loadDashboard();
            } else if (tabId === '#monitor') {
                updateMonitor();
            }
        });
    });
}

// Load configuration from storage
async function loadConfiguration() {
    try {
        console.log('Loading configuration from storage...');
        
        const endpointResult = await getFromStorage(STORAGE_KEYS.API_ENDPOINT);
        if (endpointResult) {
            API_ENDPOINT = endpointResult;
        }

        const keyResult = await getFromStorage(STORAGE_KEYS.API_KEY);
        if (keyResult) {
            API_KEY = keyResult;
        }

        const regionResult = await getFromStorage(STORAGE_KEYS.AWS_REGION);
        if (regionResult) {
            AWS_REGION = regionResult;
        }

        const debugResult = await getFromStorage(STORAGE_KEYS.DEBUG_MODE);
        if (debugResult) {
            DEBUG_MODE = debugResult === 'true';
        }

        console.log('Configuration loaded:', {
            API_ENDPOINT: API_ENDPOINT || 'not set',
            API_KEY: API_KEY ? '***configured***' : 'not set',
            AWS_REGION,
            DEBUG_MODE
        });
    } catch (error) {
        console.error('Error loading configuration:', error);
    }
}

// Simple localStorage wrapper
function getFromStorage(key) {
    return localStorage.getItem(key);
}

function setToStorage(key, value) {
    localStorage.setItem(key, value);
}

function deleteFromStorage(key) {
    localStorage.removeItem(key);
}

// Check if configuration is complete
function checkConfiguration() {
    console.log('Checking configuration...', {
        hasEndpoint: !!API_ENDPOINT,
        hasKey: !!API_KEY
    });
    
    if (!API_ENDPOINT || !API_KEY) {
        console.log('Configuration incomplete, showing warning');
        showConfigurationWarning();
    } else {
        console.log('Configuration is complete');
    }
}

// Show configuration warning
function showConfigurationWarning() {
    // Remove existing warning if any
    const existingWarning = document.getElementById('config-warning-toast');
    if (existingWarning) {
        existingWarning.remove();
    }
    
    showToast('⚠️ Please configure your API settings to use the application.', 'warning');
    
    // Show settings modal automatically if no config
    if (!API_ENDPOINT && !API_KEY) {
        setTimeout(() => {
            showSettings();
        }, 2000);
    }
}

// API Helper
async function apiCall(endpoint, method = 'GET', body = null) {
    console.log(`=== API CALL START: ${method} ${endpoint} ===`);
    
    // Check if API is configured
    if (!API_ENDPOINT) {
        const error = new Error('API Endpoint not configured');
        console.error('API Error:', error);
        showToast('❌ API Endpoint not configured. Please go to Settings.', 'error');
        throw error;
    }
    
    if (!API_KEY) {
        const error = new Error('API Key not configured');
        console.error('API Error:', error);
        showToast('❌ API Key not configured. Please go to Settings.', 'error');
        throw error;
    }

    const startTime = Date.now();
    
    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                'Accept': 'application/json'
            },
            mode: 'cors'
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        // Clean up endpoint URL
        const baseUrl = API_ENDPOINT.replace(/\/$/, '');
        const url = `${baseUrl}${endpoint}`;
        
        console.log('Request URL:', url);
        console.log('Request Options:', options);
        
        const response = await fetch(url, options);
        const responseTime = Date.now() - startTime;
        
        console.log('Response Status:', response.status);
        console.log('Response Headers:', Object.fromEntries(response.headers.entries()));
        
        // Update API response time in UI
        const responseTimeEl = document.getElementById('api-response-time');
        if (responseTimeEl) {
            responseTimeEl.textContent = `${responseTime}ms`;
        }
        
        if (!response.ok) {
            let errorMessage = `HTTP error! status: ${response.status}`;
            let errorDetails = '';
            try {
                const errorText = await response.text();
                console.error('Response Error Text:', errorText);
                
                // Try to parse as JSON
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.message || errorJson.error || errorMessage;
                    if (errorJson.error) {
                        errorDetails = `Details: ${errorJson.error}`;
                    }
                } catch (e) {
                    // If not JSON, use raw text
                    errorMessage = errorText || errorMessage;
                }
            } catch (e) {
                console.error('Error reading error response:', e);
            }
            
            const fullError = errorDetails ? `${errorMessage} (${errorDetails})` : errorMessage;
            throw new Error(fullError);
        }
        
        const responseText = await response.text();
        console.log('Response Text:', responseText);
        
        let data;
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch (e) {
            console.error('Error parsing JSON:', e);
            throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}`);
        }
        
        console.log('Parsed Response Data:', data);
        logActivity(`API ${method} ${endpoint} - Success (${responseTime}ms)`);
        
        return data;
    } catch (error) {
        console.error('API Call Failed:', error);
        
        // Log to activity
        const shortMessage = error.message.length > 50 
            ? error.message.substring(0, 50) + '...' 
            : error.message;
        logActivity(`API ${method} ${endpoint} - Failed: ${shortMessage}`, 'error');
        
        // Show user-friendly error
        let userMessage = error.message;
        if (error.message.includes('Failed to fetch')) {
            userMessage = 'Network error. Check your API endpoint and CORS settings.';
        } else if (error.message.includes('403')) {
            userMessage = 'Access denied. Check your API key.';
        } else if (error.message.includes('Invalid JSON')) {
            userMessage = 'Invalid response from server.';
        }
        
        showToast('❌ ' + userMessage, 'error');
        throw error;
    } finally {
        console.log(`=== API CALL END: ${method} ${endpoint} ===`);
    }
}

// Dashboard
async function loadDashboard() {
    console.log('Loading dashboard...');
    
    try {
        // Show loading state
        const tableBody = document.getElementById('recent-orders-table');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center"><div class="spinner-border spinner-border-sm"></div> Loading...</td></tr>';
        }
        
        // Load orders for dashboard
        const data = await apiCall('/orders?limit=100');
        console.log('Dashboard data received:', data);
        
        // Calculate stats from API response
        const orders = data.orders || [];
        console.log(`Found ${orders.length} orders`);
        
        const totalOrders = data.pagination?.total || orders.length;
        const totalRevenue = orders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
        const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'delivered').length;
        const pendingOrders = orders.filter(o => o.status === 'pending').length;
        
        console.log('Stats calculated:', {
            totalOrders,
            totalRevenue,
            pendingOrders,
            completedOrders
        });
        
        // Update stats
        const totalOrdersEl = document.getElementById('total-orders');
        const totalRevenueEl = document.getElementById('total-revenue');
        const pendingOrdersEl = document.getElementById('pending-orders');
        const completedOrdersEl = document.getElementById('completed-orders');
        
        if (totalOrdersEl) {
            totalOrdersEl.textContent = totalOrders;
        }
        
        if (totalRevenueEl) {
            totalRevenueEl.textContent = `$${totalRevenue.toFixed(2)}`;
        }
        
        if (pendingOrdersEl) {
            pendingOrdersEl.textContent = pendingOrders;
        }
        
        if (completedOrdersEl) {
            completedOrdersEl.textContent = completedOrders;
        }
        
        // Recent orders (last 5)
        const recentOrders = orders.slice(0, 5);
        console.log('Recent orders to display:', recentOrders);
        
        if (recentOrders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No orders found</td></tr>';
            console.log('No orders found');
        } else {
            const rowsHTML = recentOrders.map(order => {
                return `
                    <tr>
                        <td><code>${order.order_id || 'N/A'}</code></td>
                        <td>${order.customer_id || 'Customer'}</td>
                        <td>${order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}</td>
                        <td><span class="badge ${getStatusColor(order.status)}">${order.status || 'unknown'}</span></td>
                        <td>$${(order.total_amount || 0).toFixed(2)}</td>
                    </tr>
                `;
            }).join('');
            
            tableBody.innerHTML = rowsHTML;
        }
        
        console.log('Dashboard loaded successfully');
        showToast('✓ Dashboard updated', 'success');
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
        const tableBody = document.getElementById('recent-orders-table');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error: ' + error.message + '</td></tr>';
        }
    }
}

// Orders
async function loadOrders() {
    console.log('Loading orders...');
    
    try {
        // Show loading state
        const tableBody = document.getElementById('orders-table');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner-border spinner-border-sm"></div> Loading orders...</td></tr>';
        }
        
        const data = await apiCall(`/orders?page=${currentPage}&limit=10`);
        console.log('Orders data received:', data);
        
        const orders = data.orders || [];
        console.log(`Found ${orders.length} orders`);
        
        if (orders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center">No orders found</td></tr>';
        } else {
            tableBody.innerHTML = orders.map(order => `
                <tr>
                    <td><code>${order.order_id || 'N/A'}</code></td>
                    <td>${order.customer_id || 'Customer'}</td>
                    <td>${order.customer_id ? `${order.customer_id}@customer.com` : 'N/A'}</td>
                    <td>${order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}</td>
                    <td><span class="badge ${getStatusColor(order.status)}">${order.status || 'unknown'}</span></td>
                    <td>$${(order.total_amount || 0).toFixed(2)}</td>
                    <td>
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-info" onclick="viewOrder('${order.order_id}')" title="View Details">
                                <i class="bi bi-eye"></i>
                            </button>
                            <button class="btn btn-warning" onclick="updateOrderStatus('${order.order_id}')" title="Update Status">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-danger" onclick="deleteOrder('${order.order_id}')" title="Delete Order">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
        
        // Update pagination
        const pagination = data.pagination || {};
        document.getElementById('current-page').textContent = pagination.page || currentPage;
        
        console.log('Orders loaded successfully');
        showToast('✓ Orders updated', 'success');
        
    } catch (error) {
        console.error('Error loading orders:', error);
        const tableBody = document.getElementById('orders-table');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error: ' + error.message + '</td></tr>';
        }
    }
}

// View Order Details
async function viewOrder(orderId) {
    console.log('Viewing order:', orderId);
    
    try {
        const order = await apiCall(`/orders/${orderId}`);
        console.log('Order details received:', order);
        
        // Format items display
        let itemsHtml = '';
        if (order.items && order.items.length > 0) {
            itemsHtml = `
                <div class="mt-4">
                    <h6>Order Items</h6>
                    <div class="table-responsive">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Product ID</th>
                                    <th>Quantity</th>
                                    <th>Price</th>
                                    <th>Subtotal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${order.items.map(item => `
                                    <tr>
                                        <td>${item.product_id || 'N/A'}</td>
                                        <td>${item.quantity || 0}</td>
                                        <td>$${(item.price || 0).toFixed(2)}</td>
                                        <td>$${((item.quantity || 0) * (item.price || 0)).toFixed(2)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        // Check workflow status if execution_arn exists
        let workflowHtml = '';
        if (order.execution_arn) {
            try {
                const workflowStatus = await apiCall(`/status/${order.execution_arn}`);
                workflowHtml = `
                    <div class="mt-4">
                        <h6>Workflow Status</h6>
                        <div class="alert ${getWorkflowStatusColor(workflowStatus.status)}">
                            <strong>Status:</strong> ${workflowStatus.status}<br>
                            <strong>Started:</strong> ${new Date(workflowStatus.start_date).toLocaleString()}<br>
                            ${workflowStatus.stop_date ? `<strong>Stopped:</strong> ${new Date(workflowStatus.stop_date).toLocaleString()}` : ''}
                        </div>
                    </div>
                `;
            } catch (workflowError) {
                console.log('Could not fetch workflow status:', workflowError);
            }
        }
        
        const content = `
            <div class="row">
                <div class="col-md-6 mb-3">
                    <p class="fw-bold mb-1">Order ID:</p>
                    <p><code>${order.order_id || orderId}</code></p>
                </div>
                <div class="col-md-6 mb-3">
                    <p class="fw-bold mb-1">Status:</p>
                    <span class="badge ${getStatusColor(order.status)} fs-6">${order.status || 'unknown'}</span>
                </div>
                <div class="col-md-6 mb-3">
                    <p class="fw-bold mb-1">Customer ID:</p>
                    <p>${order.customer_id || 'N/A'}</p>
                </div>
                <div class="col-md-6 mb-3">
                    <p class="fw-bold mb-1">Total Amount:</p>
                    <p class="h4 text-primary">$${(order.total_amount || 0).toFixed(2)}</p>
                </div>
                <div class="col-md-6 mb-3">
                    <p class="fw-bold mb-1">Created At:</p>
                    <p>${order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}</p>
                </div>
                <div class="col-md-6 mb-3">
                    <p class="fw-bold mb-1">Updated At:</p>
                    <p>${order.updated_at ? new Date(order.updated_at).toLocaleString() : 'N/A'}</p>
                </div>
            </div>
            ${itemsHtml}
            ${workflowHtml}
            <div class="mt-4">
                <button class="btn btn-primary" onclick="checkWorkflowStatus('${order.order_id}')">
                    <i class="bi bi-lightning-charge me-2"></i>Check Workflow Status
                </button>
            </div>
        `;
        
        document.getElementById('order-detail-content').innerHTML = content;
        const modal = new bootstrap.Modal(document.getElementById('order-detail-modal'));
        modal.show();
        
        console.log('Order details displayed');
        
    } catch (error) {
        console.error('Error viewing order:', error);
        showToast('❌ Error loading order: ' + error.message, 'error');
    }
}

// Check workflow status
// Di fungsi checkWorkflowStatus, tambahkan:
// Fungsi untuk menampilkan modal workflow dengan benar
async function checkWorkflowStatus(orderId) {
    console.log('Checking workflow status for order:', orderId);
    
    try {
        // Tampilkan loading state
        document.getElementById('order-detail-content').innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
                    <span class="visually-hidden">Loading workflow status...</span>
                </div>
                <p class="mt-3 text-muted">Loading workflow status for order: ${orderId}</p>
            </div>
        `;
        
        // Tampilkan modal
        const modalElement = document.getElementById('order-detail-modal');
        const modal = new bootstrap.Modal(modalElement, {
            backdrop: true,  // Enable backdrop
            keyboard: true,  // Allow ESC to close
            focus: true      // Focus on modal when shown
        });
        
        // Update modal title
        document.querySelector('#order-detail-modal .modal-title').textContent = 'Workflow Status';
        
        // Show modal
        modal.show();
        
        // Get workflow status
        const workflowStatus = await apiCall(`/status/${orderId}`);
        console.log('Workflow status:', workflowStatus);
        
        // Determine status color and icon
        let statusIcon = 'bi-question-circle';
        let statusColor = 'secondary';
        
        switch(workflowStatus.status.toUpperCase()) {
            case 'RUNNING':
                statusIcon = 'bi-play-circle';
                statusColor = 'info';
                break;
            case 'SUCCEEDED':
                statusIcon = 'bi-check-circle';
                statusColor = 'success';
                break;
            case 'FAILED':
                statusIcon = 'bi-x-circle';
                statusColor = 'danger';
                break;
            case 'TIMED_OUT':
                statusIcon = 'bi-clock-history';
                statusColor = 'warning';
                break;
            case 'ABORTED':
                statusIcon = 'bi-stop-circle';
                statusColor = 'dark';
                break;
        }
        
        // Build content
        let content = `
            <div class="alert alert-${statusColor}">
                <h5><i class="bi ${statusIcon} me-2"></i>Workflow Status</h5>
                <div class="row mt-3">
                    <div class="col-md-6">
                        <p><strong>Order ID:</strong><br><code>${orderId}</code></p>
                        <p><strong>Status:</strong><br><span class="badge bg-${statusColor}">${workflowStatus.status}</span></p>
                        <p><strong>Execution Name:</strong><br><code class="small">${workflowStatus.execution_name || 'N/A'}</code></p>
                    </div>
                    <div class="col-md-6">
                        <p><strong>Started:</strong><br>${new Date(workflowStatus.start_date).toLocaleString()}</p>
                        ${workflowStatus.stop_date ? `<p><strong>Stopped:</strong><br>${new Date(workflowStatus.stop_date).toLocaleString()}</p>` : ''}
                        <p><strong>Execution ARN:</strong><br><small><code class="text-muted">${workflowStatus.execution_arn}</code></small></p>
                    </div>
                </div>
            </div>
        `;
        
        // Add input/output if available
        if (workflowStatus.input) {
            content += `
                <div class="mt-3">
                    <h6><i class="bi bi-arrow-right-circle me-2"></i>Workflow Input</h6>
                    <pre>${JSON.stringify(workflowStatus.input, null, 2)}</pre>
                </div>
            `;
        }
        
        if (workflowStatus.output) {
            content += `
                <div class="mt-3">
                    <h6><i class="bi bi-arrow-left-circle me-2"></i>Workflow Output</h6>
                    <pre>${JSON.stringify(workflowStatus.output, null, 2)}</pre>
                </div>
            `;
        }
        
        // Add actions
        content += `
            <div class="mt-4 pt-3 border-top">
                <div class="d-flex justify-content-between">
                    <button class="btn btn-outline-secondary" onclick="closeCurrentModal()">
                        <i class="bi bi-x-circle me-1"></i>Close
                    </button>
                    <div>
                        <button class="btn btn-outline-info me-2" onclick="listAllExecutions()">
                            <i class="bi bi-list me-1"></i>View All Executions
                        </button>
                        <button class="btn btn-primary" onclick="refreshWorkflowStatus('${orderId}')">
                            <i class="bi bi-arrow-clockwise me-1"></i>Refresh
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Update modal content
        document.getElementById('order-detail-content').innerHTML = content;
        
    } catch (error) {
        console.error('Error checking workflow status:', error);
        
        document.getElementById('order-detail-content').innerHTML = `
            <div class="alert alert-danger">
                <h5><i class="bi bi-exclamation-triangle me-2"></i>Error Loading Workflow Status</h5>
                <p class="mt-3">${error.message}</p>
                <div class="mt-4">
                    <button class="btn btn-outline-danger" onclick="closeCurrentModal()">
                        <i class="bi bi-x-circle me-1"></i>Close
                    </button>
                    <button class="btn btn-info ms-2" onclick="listAllExecutions()">
                        <i class="bi bi-list me-1"></i>View All Executions
                    </button>
                </div>
            </div>
        `;
    }
}

// Fungsi untuk menutup modal saat ini
function closeCurrentModal() {
    const modalElement = document.getElementById('order-detail-modal');
    const modal = bootstrap.Modal.getInstance(modalElement);
    if (modal) {
        modal.hide();
    }
}

// Fungsi untuk menutup modal
function closeWorkflowModal() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('order-detail-modal'));
    if (modal) {
        modal.hide();
    }
}

// Fungsi untuk refresh workflow status
async function refreshWorkflowStatus(orderId) {
    await checkWorkflowStatus(orderId);
}

// Fungsi baru untuk melihat semua executions
// Fungsi baru untuk melihat semua executions
// Fungsi untuk melihat semua executions
// Fungsi untuk melihat semua executions
async function listAllExecutions() {
    try {
        showToast('📋 Loading all executions...', 'info');
        
        // Tampilkan pesan bahwa fitur ini belum tersedia
        let content = `
            <div class="alert alert-warning">
                <h5><i class="bi bi-exclamation-triangle me-2"></i>Feature Not Available</h5>
                <p class="mt-3">
                    The "View All Executions" feature requires additional configuration on the backend.
                </p>
                <p class="mb-0">
                    <small class="text-muted">
                        To enable this feature, you need to:<br>
                        1. Add CORS configuration for /executions endpoint in API Gateway<br>
                        2. Deploy the updated API<br>
                        3. Configure the Lambda function to handle /executions route
                    </small>
                </p>
            </div>
            
            <div class="card mt-4">
                <div class="card-body">
                    <h6><i class="bi bi-lightbulb me-2"></i>Alternative Solution</h6>
                    <p>You can check individual workflow status by:</p>
                    <ol class="small">
                        <li>Click the <i class="bi bi-lightning-charge text-info"></i> button next to any order</li>
                        <li>Or go to AWS Console > Step Functions</li>
                        <li>Look for state machine: <code>lks-stepfunctions-order-workflow</code></li>
                    </ol>
                </div>
            </div>
            
            <div class="mt-4">
                <button class="btn btn-outline-secondary" onclick="closeCurrentModal()">
                    <i class="bi bi-x-circle me-1"></i>Close
                </button>
                <button class="btn btn-outline-primary ms-2" onclick="showSettings()">
                    <i class="bi bi-gear me-1"></i>Check API Settings
                </button>
            </div>
        `;
        
        document.getElementById('order-detail-content').innerHTML = content;
        document.querySelector('#order-detail-modal .modal-title').textContent = 'Executions List';
        
    } catch (error) {
        console.error('Error:', error);
        
        document.getElementById('order-detail-content').innerHTML = `
            <div class="alert alert-danger">
                <h5><i class="bi bi-exclamation-triangle me-2"></i>Configuration Required</h5>
                <p class="mt-3">The /executions endpoint is not configured.</p>
                <div class="mt-4">
                    <button class="btn btn-outline-danger" onclick="closeCurrentModal()">
                        <i class="bi bi-x-circle me-1"></i>Close
                    </button>
                    <button class="btn btn-info ms-2" onclick="showSettings()">
                        <i class="bi bi-gear me-1"></i>API Settings
                    </button>
                </div>
            </div>
        `;
    }
}

// Add event listeners for modal
document.addEventListener('DOMContentLoaded', function() {
    const orderDetailModal = document.getElementById('order-detail-modal');
    
    if (orderDetailModal) {
        // Clean up when modal is hidden
        orderDetailModal.addEventListener('hidden.bs.modal', function() {
            // Clear content
            document.getElementById('order-detail-content').innerHTML = 'Loading...';
            // Reset title
            document.querySelector('#order-detail-modal .modal-title').textContent = 'Order Details';
            // Ensure backdrop is removed
            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(backdrop => backdrop.remove());
            // Reset body class
            document.body.classList.remove('modal-open');
            document.body.style.paddingRight = '';
        });
        
        // When modal is shown
        orderDetailModal.addEventListener('shown.bs.modal', function() {
            // Focus on close button for accessibility
            const closeBtn = this.querySelector('.btn-close');
            if (closeBtn) {
                closeBtn.focus();
            }
        });
    }
});

// Update Order Status
async function updateOrderStatus(orderId) {
    const currentStatus = prompt('Current status is: [current]\n\nEnter new status:\n- pending\n- processing\n- completed\n- cancelled\n\nEnter new status:'.replace('[current]', 'unknown'));
    if (!currentStatus) return;
    
    console.log(`Updating order ${orderId} status to ${currentStatus}`);
    
    try {
        await apiCall(`/orders/${orderId}`, 'PUT', { status: currentStatus });
        showToast('✓ Order status updated successfully', 'success');
        loadOrders();
        loadDashboard();
    } catch (error) {
        console.error('Error updating order:', error);
        showToast('❌ Failed to update order: ' + error.message, 'error');
    }
}

// Delete Order
async function deleteOrder(orderId) {
    if (!confirm(`Are you sure you want to delete order ${orderId}? This action cannot be undone.`)) return;
    
    console.log(`Deleting order: ${orderId}`);
    
    try {
        await apiCall(`/orders/${orderId}`, 'DELETE');
        showToast('✓ Order deleted successfully', 'success');
        loadOrders();
        loadDashboard();
    } catch (error) {
        console.error('Error deleting order:', error);
        showToast('❌ Failed to delete order: ' + error.message, 'error');
    }
}

// Change Page
function changePage(delta) {
    console.log(`Changing page by ${delta}, current: ${currentPage}`);
    const newPage = currentPage + delta;
    if (newPage < 1) return;
    
    currentPage = newPage;
    loadOrders();
}

// Setup Create Order Form
async function setupCreateOrderForm() {
    console.log('Setting up create order form...');
    
    try {
        // Load customers and products
        await loadCustomers();
        await loadProducts();
        
        // Add event listener for total calculation
        document.addEventListener('input', function(e) {
            if (e.target.classList.contains('quantity-input') || e.target.classList.contains('product-select')) {
                calculateTotal();
            }
        });
        
    } catch (error) {
        console.error('Error setting up create order form:', error);
        showToast('❌ Error loading form data: ' + error.message, 'error');
    }
}

async function loadCustomers() {
    console.log('Loading customers...');
    
    try {
        const data = await apiCall('/customers');
        console.log('Customers loaded:', data);
        
        const customers = data.customers || [];
        const customerSelect = document.getElementById('customer-select');
        
        if (!customerSelect) {
            console.error('Customer select element not found');
            return;
        }
        
        // Clear existing options
        customerSelect.innerHTML = '<option value="">Select Customer</option>';
        
        // Add customer options
        customers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.customer_id;
            option.textContent = `${customer.customer_name} (${customer.customer_id})`;
            option.dataset.email = customer.email;
            option.dataset.phone = customer.phone;
            customerSelect.appendChild(option);
        });
        
        console.log(`Loaded ${customers.length} customers`);
        
    } catch (error) {
        console.error('Error loading customers:', error);
        showToast('❌ Error loading customers: ' + error.message, 'error');
    }
}

async function loadProducts() {
    console.log('Loading products...');
    
    try {
        // Show loading state
        const productSelects = document.querySelectorAll('.product-select');
        productSelects.forEach(select => {
            if (select) {
                select.innerHTML = '<option value="">Loading products...</option>';
                select.disabled = true;
            }
        });
        
        const data = await apiCall('/products');
        console.log('Products loaded:', data);
        
        const products = data.products || [];
        
        if (products.length === 0) {
            console.warn('No products found in database');
            showToast('⚠️ No products found in inventory. Please add products first.', 'warning');
            
            // Create a placeholder for testing
            window.products = {
                'PROD001': {
                    product_id: 'PROD001',
                    product_name: 'Laptop Pro',
                    price: 1200.00,
                    stock_quantity: 10,
                    description: 'High-performance laptop',
                    category: 'Electronics'
                },
                'PROD002': {
                    product_id: 'PROD002',
                    product_name: 'Wireless Mouse',
                    price: 25.99,
                    stock_quantity: 50,
                    description: 'Ergonomic wireless mouse',
                    category: 'Electronics'
                }
            };
        } else {
            // Store products globally for quick access
            window.products = products.reduce((acc, product) => {
                acc[product.product_id] = product;
                return acc;
            }, {});
        }
        
        // Update product selects
        updateProductSelects();
        
        console.log(`Loaded ${products.length} products`);
        showToast(`✓ Loaded ${products.length} products`, 'success');
        
    } catch (error) {
        console.error('Error loading products:', error);
        
        // Create mock data for development
        console.log('Creating mock products for development...');
        window.products = {
            'PROD001': {
                product_id: 'PROD001',
                product_name: 'Laptop Pro',
                price: 1200.00,
                stock_quantity: 10,
                description: 'High-performance laptop with 16GB RAM',
                category: 'Electronics'
            },
            'PROD002': {
                product_id: 'PROD002',
                product_name: 'Wireless Mouse',
                price: 25.99,
                stock_quantity: 50,
                description: 'Ergonomic wireless mouse',
                category: 'Electronics'
            },
            'PROD003': {
                product_id: 'PROD003',
                product_name: 'Mechanical Keyboard',
                price: 89.99,
                stock_quantity: 30,
                description: 'RGB mechanical gaming keyboard',
                category: 'Electronics'
            },
            'PROD004': {
                product_id: 'PROD004',
                product_name: 'USB-C Cable',
                price: 12.99,
                stock_quantity: 100,
                description: '2m USB-C charging cable',
                category: 'Accessories'
            }
        };
        
        updateProductSelects();
        
        showToast('⚠️ Using mock product data. Check API endpoint.', 'warning');
    }
}

function updateProductSelects() {
    const productSelects = document.querySelectorAll('.product-select');
    
    productSelects.forEach(select => {
        // Clear existing options
        select.innerHTML = '<option value="">Select Product</option>';
        
        // Add product options
        Object.values(window.products || {}).forEach(product => {
            const option = document.createElement('option');
            option.value = product.product_id;
            option.textContent = `${product.product_name} - $${product.price.toFixed(2)} (Stock: ${product.stock_quantity})`;
            option.dataset.price = product.price;
            option.dataset.stock = product.stock_quantity;
            select.appendChild(option);
        });
    });
}

function addOrderItem() {
    console.log('Adding order item');
    const itemsContainer = document.getElementById('order-items');
    
    if (!itemsContainer) {
        console.error('Order items container not found');
        showToast('❌ Form error: Cannot add item', 'error');
        return;
    }
    
    const itemIndex = itemsContainer.children.length;
    const newItem = document.createElement('div');
    newItem.className = 'order-item mb-3 p-3 border rounded';
    newItem.innerHTML = `
        <div class="row g-3">
            <div class="col-md-5">
                <label class="form-label">Product</label>
                <select class="form-select product-select" required onchange="updateProductPrice(this)">
                    <option value="">Select Product</option>
                </select>
                <small class="form-text text-muted product-stock"></small>
            </div>
            <div class="col-md-3">
                <label class="form-label">Quantity</label>
                <input type="number" class="form-control quantity-input" 
                       min="1" value="1" required oninput="validateQuantity(this)">
                <small class="form-text text-muted quantity-error text-danger"></small>
            </div>
            <div class="col-md-3">
                <label class="form-label">Price</label>
                <div class="input-group">
                    <span class="input-group-text">$</span>
                    <input type="text" class="form-control price-input" readonly 
                           value="0.00">
                </div>
                <small class="form-text text-muted">Auto-calculated</small>
            </div>
            <div class="col-md-1 d-flex align-items-end">
                ${itemIndex > 0 ? `
                    <button type="button" class="btn btn-danger w-100" onclick="removeOrderItem(this)" title="Remove Item">
                        <i class="bi bi-trash"></i>
                    </button>
                ` : `
                    <button type="button" class="btn btn-outline-secondary w-100" disabled>
                        <i class="bi bi-grip-vertical"></i>
                    </button>
                `}
            </div>
        </div>
        <div class="row mt-2">
            <div class="col-12">
                <small class="form-text text-muted product-description"></small>
            </div>
        </div>
    `;
    
    itemsContainer.appendChild(newItem);
    
    // Populate product select for this new item
    const productSelect = newItem.querySelector('.product-select');
    if (productSelect && window.products) {
        updateProductSelect(productSelect);
    }
    
    calculateTotal();
}

function updateProductSelect(selectElement) {
    // Clear existing options
    selectElement.innerHTML = '<option value="">Select Product</option>';
    
    // Add product options
    Object.values(window.products || {}).forEach(product => {
        const option = document.createElement('option');
        option.value = product.product_id;
        option.textContent = `${product.product_name} - $${product.price.toFixed(2)}`;
        option.dataset.price = product.price;
        option.dataset.stock = product.stock_quantity;
        option.dataset.description = product.description || '';
        selectElement.appendChild(option);
    });
}

function updateProductPrice(selectElement) {
    const itemDiv = selectElement.closest('.order-item');
    const priceInput = itemDiv.querySelector('.price-input');
    const stockSpan = itemDiv.querySelector('.product-stock');
    const descriptionSpan = itemDiv.querySelector('.product-description');
    const quantityInput = itemDiv.querySelector('.quantity-input');
    
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    
    if (selectedOption && selectedOption.value) {
        const price = selectedOption.dataset.price || '0';
        const stock = selectedOption.dataset.stock || '0';
        const description = selectedOption.dataset.description || '';
        
        priceInput.value = parseFloat(price).toFixed(2);
        stockSpan.textContent = `Stock available: ${stock}`;
        stockSpan.className = parseInt(stock) > 10 ? 'form-text text-muted text-success' : 
                              parseInt(stock) > 0 ? 'form-text text-muted text-warning' : 
                              'form-text text-muted text-danger';
        
        descriptionSpan.textContent = description;
        
        // Update quantity validation
        validateQuantity(quantityInput);
    } else {
        priceInput.value = '0.00';
        stockSpan.textContent = '';
        descriptionSpan.textContent = '';
    }
    
    calculateTotal();
}

function validateQuantity(inputElement) {
    const itemDiv = inputElement.closest('.order-item');
    const productSelect = itemDiv.querySelector('.product-select');
    const errorSpan = itemDiv.querySelector('.quantity-error');
    
    const quantity = parseInt(inputElement.value) || 0;
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const stock = selectedOption ? parseInt(selectedOption.dataset.stock || 0) : 0;
    
    if (quantity <= 0) {
        errorSpan.textContent = 'Quantity must be at least 1';
        inputElement.classList.add('is-invalid');
        return false;
    } else if (selectedOption && quantity > stock) {
        errorSpan.textContent = `Only ${stock} items in stock`;
        inputElement.classList.add('is-invalid');
        return false;
    } else {
        errorSpan.textContent = '';
        inputElement.classList.remove('is-invalid');
        return true;
    }
}

function removeOrderItem(button) {
    const itemDiv = button.closest('.order-item');
    if (itemDiv) {
        itemDiv.remove();
        calculateTotal();
    }
}

async function fetchProductPrice(productId, itemElement) {
    if (!productId) return;
    
    console.log('Fetching price for product:', productId);
    
    try {
        // Note: You don't have a GET /products endpoint
        // We'll use a simulated price based on product ID
        // In real implementation, you would call your API
        
        // For demo, generate a mock price
        const mockPrice = Math.floor(Math.random() * 100) + 10; // $10-$110
        
        const priceDisplay = itemElement.querySelector('.price-display');
        priceDisplay.value = `$${mockPrice.toFixed(2)}`;
        priceDisplay.setAttribute('data-price', mockPrice);
        
        // Also update hidden price input for calculation
        let priceInput = itemElement.querySelector('.price-input');
        if (!priceInput) {
            priceInput = document.createElement('input');
            priceInput.type = 'hidden';
            priceInput.className = 'price-input';
            priceInput.value = mockPrice;
            itemElement.appendChild(priceInput);
        } else {
            priceInput.value = mockPrice;
        }
        
        calculateTotal();
        
    } catch (error) {
        console.error('Error fetching product price:', error);
        const priceDisplay = itemElement.querySelector('.price-display');
        priceDisplay.value = 'Error fetching price';
        priceDisplay.style.color = 'red';
    }
}

function calculateTotal() {
    let total = 0;
    let isValid = true;
    const items = document.querySelectorAll('.order-item');
    
    items.forEach(item => {
        const quantity = parseInt(item.querySelector('.quantity-input').value) || 0;
        const priceInput = item.querySelector('.price-input');
        const price = priceInput ? parseFloat(priceInput.value) : 0;
        
        total += quantity * price;
        
        // Validate this item
        if (!validateQuantity(item.querySelector('.quantity-input'))) {
            isValid = false;
        }
    });
    
    const totalElement = document.getElementById('order-total');
    if (totalElement) {
        totalElement.textContent = total.toFixed(2);
    }
    
    // Update order button state
    const submitButton = document.querySelector('#create-order-form button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = !isValid || items.length === 0;
    }
    
    return isValid;
}

// Create Order
async function createOrder(event) {
    event.preventDefault();
    console.log('Creating order...');
    
    // Validate form
    if (!calculateTotal()) {
        showToast('❌ Please fix validation errors before submitting', 'error');
        return;
    }
    
    const customerSelect = document.getElementById('customer-select');
    if (!customerSelect || !customerSelect.value) {
        showToast('❌ Please select a customer', 'error');
        customerSelect?.focus();
        return;
    }
    
    const customerId = customerSelect.value;
    
    // Collect items
    const items = [];
    const orderItems = document.querySelectorAll('.order-item');
    
    for (const item of orderItems) {
        const productSelect = item.querySelector('.product-select');
        const quantityInput = item.querySelector('.quantity-input');
        
        if (!productSelect || !productSelect.value) {
            showToast('❌ Please select a product for all items', 'error');
            return;
        }
        
        if (!quantityInput || !quantityInput.value || parseInt(quantityInput.value) <= 0) {
            showToast('❌ Please enter valid quantity for all items', 'error');
            return;
        }
        
        const quantity = parseInt(quantityInput.value);
        
        // Validasi stock
        const selectedOption = productSelect.options[productSelect.selectedIndex];
        const stock = selectedOption ? parseInt(selectedOption.dataset.stock || 0) : 0;
        
        if (quantity > stock) {
            showToast(`❌ Not enough stock for ${selectedOption.textContent}. Available: ${stock}`, 'error');
            return;
        }
        
        items.push({
            product_id: productSelect.value,
            quantity: quantity
        });
    }
    
    if (items.length === 0) {
        showToast('❌ Please add at least one item', 'error');
        return;
    }
    
    try {
        // Create order payload
        const orderPayload = {
            customer_id: customerId,
            items: items
        };
        
        console.log('Order payload:', orderPayload);
        
        // Show loading
        const submitButton = document.querySelector('#create-order-form button[type="submit"]');
        const originalButtonText = submitButton?.innerHTML;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Creating...';
        }
        
        const result = await apiCall('/orders', 'POST', orderPayload);
        console.log('Order created:', result);
        
        // Show success message
        showToast(`
            <div>
                <strong>✓ Order Created Successfully!</strong><br>
                <small>
                    Order ID: ${result.order_id}<br>
                    Total: $${result.total_amount}<br>
                    Status: ${result.status}<br>
                    <button class="btn btn-sm btn-info mt-2" onclick="checkWorkflowStatus('${result.order_id}')">
                        <i class="bi bi-lightning-charge"></i> Check Workflow Status
                    </button>
                </small>
            </div>
        `, 'success', 10000);
        
        // Reset form dengan cara yang lebih aman
        resetCreateOrderForm();
        
        // Switch to orders tab and refresh
        showTab('orders');
        setTimeout(() => {
            loadOrders();
            loadDashboard();
        }, 1000);
        
    } catch (error) {
        console.error('Error creating order:', error);
        showToast('❌ Failed to create order: ' + error.message, 'error');
    } finally {
        // Reset button state
        const submitButton = document.querySelector('#create-order-form button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="bi bi-check-circle me-2"></i>Create Order';
        }
    }
}

function resetCreateOrderForm() {
    console.log('Resetting create order form...');
    
    try {
        // Reset customer select
        const customerSelect = document.getElementById('customer-select');
        if (customerSelect) {
            customerSelect.selectedIndex = 0;
        }
        
        // Reset customer details
        const customerDetails = document.getElementById('customer-details');
        if (customerDetails) {
            customerDetails.innerHTML = '<p class="mb-1">Select a customer to see details</p>';
        }
        
        // Reset order items - keep only first item
        const itemsContainer = document.getElementById('order-items');
        if (itemsContainer) {
            // Remove all but first item
            while (itemsContainer.children.length > 1) {
                itemsContainer.removeChild(itemsContainer.lastChild);
            }
            
            // Reset first item
            const firstItem = itemsContainer.querySelector('.order-item');
            if (firstItem) {
                const productSelect = firstItem.querySelector('.product-select');
                const quantityInput = firstItem.querySelector('.quantity-input');
                const priceInput = firstItem.querySelector('.price-input');
                const stockSpan = firstItem.querySelector('.product-stock');
                const descSpan = firstItem.querySelector('.product-description');
                
                if (productSelect) productSelect.selectedIndex = 0;
                if (quantityInput) quantityInput.value = 1;
                if (priceInput) priceInput.value = '0.00';
                if (stockSpan) stockSpan.textContent = '';
                if (descSpan) descSpan.textContent = '';
            }
        }
        
        // Reset total
        const totalElement = document.getElementById('order-total');
        if (totalElement) {
            totalElement.textContent = '0.00';
        }
        
        // Reset any error messages
        const errorSpans = document.querySelectorAll('.quantity-error');
        errorSpans.forEach(span => {
            span.textContent = '';
        });
        
        const invalidInputs = document.querySelectorAll('.is-invalid');
        invalidInputs.forEach(input => {
            input.classList.remove('is-invalid');
        });
        
        console.log('Form reset successfully');
        
    } catch (error) {
        console.error('Error resetting form:', error);
    }
}

function showTab(tabName) {
    console.log('Showing tab:', tabName);
    
    try {
        // Use Bootstrap's tab system
        const tabElement = document.querySelector(`[data-bs-target="#${tabName}"]`);
        if (tabElement) {
            const tab = new bootstrap.Tab(tabElement);
            tab.show();
        }
        
        // Load data when switching to specific tabs
        if (tabName === 'orders') {
            console.log('Loading orders...');
            setTimeout(() => loadOrders(), 100);
        } else if (tabName === 'dashboard') {
            console.log('Loading dashboard...');
            setTimeout(() => loadDashboard(), 100);
        } else if (tabName === 'create') {
            console.log('Refreshing create form...');
            setTimeout(() => {
                if (typeof refreshCreateForm === 'function') {
                    refreshCreateForm();
                }
            }, 100);
        }
        
    } catch (error) {
        console.error('Error showing tab:', error);
    }
}

function refreshCreateForm() {
    console.log('Refreshing create form data...');
    showToast('🔄 Refreshing customer and product data...', 'info');
    
    // Reset form first
    resetCreateOrderForm();
    
    // Reload data
    setTimeout(() => {
        if (typeof loadCustomers === 'function') loadCustomers();
        if (typeof loadProducts === 'function') loadProducts();
    }, 500);
}

// Monitor Tab Functions
async function updateMonitor() {
    console.log('Updating monitor...');
    
    try {
        // Test API connection
        const startTime = Date.now();
        await apiCall('/orders?limit=1');
        const responseTime = Date.now() - startTime;
        
        // Update response time
        const responseTimeEl = document.getElementById('api-response-time');
        if (responseTimeEl) {
            responseTimeEl.textContent = `${responseTime}ms`;
            if (responseTime < 500) {
                responseTimeEl.className = 'mb-0 text-success';
            } else if (responseTime < 1000) {
                responseTimeEl.className = 'mb-0 text-warning';
            } else {
                responseTimeEl.className = 'mb-0 text-danger';
            }
        }
        
        // Log activity
        logActivity(`System check - API responding (${responseTime}ms)`, 'success');
        
        // Update alert count
        updateAlertCount();
        
    } catch (error) {
        console.error('Monitor update failed:', error);
        const responseTimeEl = document.getElementById('api-response-time');
        if (responseTimeEl) {
            responseTimeEl.textContent = 'Error';
            responseTimeEl.className = 'mb-0 text-danger';
        }
        
        logActivity(`System check failed: ${error.message}`, 'error');
        updateAlertCount(1);
    }
}

function updateAlertCount(count = 0) {
    const alertCountEl = document.getElementById('alert-count');
    if (alertCountEl) {
        alertCountEl.textContent = count;
        if (count > 0) {
            alertCountEl.parentElement.querySelector('p').innerHTML = 
                '<strong>Alerts</strong> <span class="badge bg-danger">' + count + '</span>';
        } else {
            alertCountEl.parentElement.querySelector('p').innerHTML = 'Alerts';
        }
    }
}

function refreshCreateForm() {
    console.log('Refreshing create form data...');
    showToast('🔄 Refreshing customer and product data...', 'info');
    
    loadCustomers();
    loadProducts();
}

// Reports
function generateReport(type) {
    console.log(`Generating ${type} report`);
    
    let reportContent = '';
    let filename = '';
    
    switch(type) {
        case 'daily':
            reportContent = generateDailyReport();
            filename = `daily-report-${new Date().toISOString().split('T')[0]}.txt`;
            break;
        case 'inventory':
            reportContent = generateInventoryReport();
            filename = `inventory-report-${new Date().toISOString().split('T')[0]}.txt`;
            break;
    }
    
    // Create and download file
    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast(`✓ ${type} report downloaded`, 'success');
    logActivity(`Report generated: ${type}`);
}

function generateDailyReport() {
    const now = new Date();
    return `
DAILY ORDER REPORT
===================
Generated: ${now.toLocaleString()}

System Status: Operational
Total Orders: ${document.getElementById('total-orders').textContent}
Total Revenue: ${document.getElementById('total-revenue').textContent}
Pending Orders: ${document.getElementById('pending-orders').textContent}
Completed Orders: ${document.getElementById('completed-orders').textContent}

API Endpoint: ${API_ENDPOINT}
Region: ${AWS_REGION}
Generated By: LKS Order Management System
    `;
}

function generateInventoryReport() {
    return `
INVENTORY STATUS REPORT
=======================
Generated: ${new Date().toLocaleString()}

NOTE: This is a placeholder report.
In a real implementation, this would fetch inventory data from your database.

To implement:
1. Create an inventory table in your database
2. Add GET /inventory endpoint to your API
3. Update this function to fetch real data

Current Implementation:
- Orders are stored in PostgreSQL RDS
- Order details in order_items table
- Total calculated from inventory prices

Next Steps:
- Add inventory management endpoints
- Implement stock tracking
- Add low stock alerts
    `;
}

// Utilities
function getStatusColor(status) {
    if (!status) return 'bg-secondary';
    
    const statusLower = status.toLowerCase();
    const colors = {
        'pending': 'bg-warning',
        'processing': 'bg-info',
        'completed': 'bg-success',
        'cancelled': 'bg-danger',
        'failed': 'bg-danger',
        'shipped': 'bg-primary',
        'delivered': 'bg-success'
    };
    
    return colors[statusLower] || 'bg-secondary';
}

// Update getWorkflowStatusColor function
function getWorkflowStatusColor(status) {
    if (!status) return 'alert-secondary';
    
    const statusUpper = status.toUpperCase();
    if (statusUpper === 'RUNNING') return 'alert-info';
    if (statusUpper === 'SUCCEEDED') return 'alert-success';
    if (statusUpper === 'FAILED') return 'alert-danger';
    if (statusUpper === 'TIMED_OUT') return 'alert-warning';
    if (statusUpper === 'ABORTED') return 'alert-dark';
    return 'alert-secondary';
}

function showToast(message, type = 'info', duration = 5000) {
    console.log(`Toast: ${type} - ${message}`);
    
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.toast');
    existingToasts.forEach(toast => toast.remove());
    
    // Create toast
    const toastId = 'toast-' + Date.now();
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${type} border-0`;
    toast.id = toastId;
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    document.getElementById('toast-container').appendChild(toast);
    
    // Initialize and show toast
    const bsToast = new bootstrap.Toast(toast, {
        autohide: true,
        delay: duration
    });
    bsToast.show();
}

function logActivity(message, type = 'info') {
    const log = document.getElementById('activity-log');
    if (!log) return;
    
    const time = new Date().toLocaleTimeString();
    
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
        <div class="bg-light p-3 rounded">
            <small class="text-muted">${time}</small>
            <p class="mb-0 ${type === 'error' ? 'text-danger' : type === 'success' ? 'text-success' : ''}">
                ${message}
            </p>
        </div>
    `;
    
    log.insertBefore(item, log.firstChild);
    
    // Keep only last 20 items
    while (log.children.length > 20) {
        log.removeChild(log.lastChild);
    }
}

function refreshData() {
    console.log('Refreshing all data...');
    showToast('🔄 Refreshing data...', 'info');
    
    loadDashboard();
    loadOrders();
    updateMonitor();
    
    // Show dashboard tab
    const dashboardTab = document.getElementById('dashboard-tab');
    if (dashboardTab) {
        const tab = new bootstrap.Tab(dashboardTab);
        tab.show();
    }
}

// Settings Management
async function showSettings() {
    console.log('Showing settings...');
    
    // Load current settings into form
    try {
        document.getElementById('settings-api-endpoint').value = API_ENDPOINT || '';
        document.getElementById('settings-api-key').value = API_KEY || '';
        document.getElementById('settings-aws-region').value = AWS_REGION || 'us-east-1';
        document.getElementById('settings-debug-mode').checked = DEBUG_MODE || false;
        
        updateConfigStatus();
    } catch (error) {
        console.error('Error loading settings:', error);
    }
    
    const modal = new bootstrap.Modal(document.getElementById('settings-modal'));
    modal.show();
}

function updateConfigStatus() {
    const statusEl = document.getElementById('config-status');
    if (!statusEl) return;
    
    const endpoint = document.getElementById('settings-api-endpoint').value;
    const key = document.getElementById('settings-api-key').value;
    
    if (endpoint && key) {
        statusEl.textContent = 'Configured ✓';
        statusEl.className = 'fw-bold text-success';
    } else {
        statusEl.textContent = 'Not Configured';
        statusEl.className = 'fw-bold text-danger';
    }
}

function toggleApiKeyVisibility() {
    const input = document.getElementById('settings-api-key');
    const btn = document.getElementById('toggle-api-key-btn');
    
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<i class="bi bi-eye"></i>';
    }
}

async function testApiConnection() {
    console.log('Testing API connection...');
    
    const endpoint = document.getElementById('settings-api-endpoint').value.trim();
    const key = document.getElementById('settings-api-key').value.trim();
    
    if (!endpoint) {
        document.getElementById('api-endpoint-error').textContent = 'Required';
        return;
    }
    
    if (!key) {
        document.getElementById('api-key-error').textContent = 'Required';
        return;
    }
    
    const btn = document.getElementById('test-connection-btn');
    const resultDiv = document.getElementById('connection-test-result');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Testing...';
    
    try {
        const startTime = Date.now();
        
        const url = endpoint.replace(/\/$/, '') + '/orders?limit=1';
        console.log('Testing URL:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key
            },
            mode: 'cors'
        });
        
        const responseTime = Date.now() - startTime;
        
        resultDiv.classList.remove('d-none');
        
        if (response.ok) {
            const data = await response.json();
            resultDiv.className = 'alert alert-success mt-2';
            resultDiv.innerHTML = `
                <div class="d-flex">
                    <i class="bi bi-check-circle fs-5 me-3"></i>
                    <div>
                        <p class="mb-1"><strong>✓ Connection Successful!</strong></p>
                        <p class="mb-0 small">Response time: ${responseTime}ms</p>
                        <p class="mb-0 small">Status: ${response.status}</p>
                        <p class="mb-0 small">Found ${data.orders?.length || 0} orders</p>
                    </div>
                </div>
            `;
            console.log('Connection test successful:', data);
        } else {
            const errorText = await response.text();
            resultDiv.className = 'alert alert-danger mt-2';
            resultDiv.innerHTML = `
                <div class="d-flex">
                    <i class="bi bi-x-circle fs-5 me-3"></i>
                    <div>
                        <p class="mb-1"><strong>✗ Connection Failed</strong></p>
                        <p class="mb-0 small">Status: ${response.status}</p>
                        <p class="mb-0 small">${errorText.substring(0, 100)}</p>
                    </div>
                </div>
            `;
            console.error('Connection test failed:', response.status, errorText);
        }
    } catch (error) {
        resultDiv.classList.remove('d-none');
        resultDiv.className = 'alert alert-danger mt-2';
        resultDiv.innerHTML = `
            <div class="d-flex">
                <i class="bi bi-x-circle fs-5 me-3"></i>
                <div>
                    <p class="mb-1"><strong>✗ Connection Error</strong></p>
                    <p class="mb-0 small">${error.message}</p>
                </div>
            </div>
        `;
        console.error('Connection test error:', error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-plug me-2"></i>Test API Connection';
    }
}

async function saveSettings() {
    console.log('Saving settings...');
    
    const endpoint = document.getElementById('settings-api-endpoint').value.trim();
    const key = document.getElementById('settings-api-key').value.trim();
    const region = document.getElementById('settings-aws-region').value;
    const debug = document.getElementById('settings-debug-mode').checked;
    
    // Clear previous errors
    document.getElementById('api-endpoint-error').textContent = '';
    document.getElementById('api-key-error').textContent = '';
    
    // Validation
    let hasError = false;
    
    if (!endpoint) {
        document.getElementById('api-endpoint-error').textContent = 'Required';
        hasError = true;
    } else if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        document.getElementById('api-endpoint-error').textContent = 'Must start with http:// or https://';
        hasError = true;
    }
    
    if (!key) {
        document.getElementById('api-key-error').textContent = 'Required';
        hasError = true;
    }
    
    if (hasError) {
        showToast('❌ Please fix the validation errors', 'error');
        return;
    }
    
    try {
        // Save to storage
        setToStorage(STORAGE_KEYS.API_ENDPOINT, endpoint);
        setToStorage(STORAGE_KEYS.API_KEY, key);
        setToStorage(STORAGE_KEYS.AWS_REGION, region);
        setToStorage(STORAGE_KEYS.DEBUG_MODE, debug.toString());
        
        // Update global variables
        API_ENDPOINT = endpoint;
        API_KEY = key;
        AWS_REGION = region;
        DEBUG_MODE = debug;
        
        console.log('Settings saved:', { endpoint, key: '***', region, debug });
        
        showToast('✓ Settings saved successfully!', 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('settings-modal'));
        if (modal) {
            modal.hide();
        }
        
        // Refresh all data
        setTimeout(() => {
            refreshData();
        }, 1000);
        
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('❌ Failed to save settings: ' + error.message, 'error');
    }
}

async function clearAllSettings() {
    if (!confirm('Are you sure you want to clear all settings? This will reset the application.')) {
        return;
    }
    
    console.log('Clearing all settings...');
    
    try {
        deleteFromStorage(STORAGE_KEYS.API_ENDPOINT);
        deleteFromStorage(STORAGE_KEYS.API_KEY);
        deleteFromStorage(STORAGE_KEYS.AWS_REGION);
        deleteFromStorage(STORAGE_KEYS.DEBUG_MODE);
        
        // Reset global variables
        API_ENDPOINT = '';
        API_KEY = '';
        AWS_REGION = 'us-east-1';
        DEBUG_MODE = false;
        
        // Clear form
        document.getElementById('settings-api-endpoint').value = '';
        document.getElementById('settings-api-key').value = '';
        document.getElementById('settings-aws-region').value = 'us-east-1';
        document.getElementById('settings-debug-mode').checked = false;
        
        updateConfigStatus();
        
        showToast('✓ All settings cleared', 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('settings-modal'));
        if (modal) {
            modal.hide();
        }
        
        // Show configuration warning
        setTimeout(() => {
            showConfigurationWarning();
        }, 1000);
        
    } catch (error) {
        console.error('Error clearing settings:', error);
        showToast('❌ Failed to clear settings: ' + error.message, 'error');
    }
}

// Make functions available globally
window.showTab = showTab;
window.refreshData = refreshData;
window.showSettings = showSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.testApiConnection = testApiConnection;
window.clearAllSettings = clearAllSettings;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.viewOrder = viewOrder;
window.updateOrderStatus = updateOrderStatus;
window.deleteOrder = deleteOrder;
window.checkWorkflowStatus = checkWorkflowStatus;
window.changePage = changePage;
window.addOrderItem = addOrderItem;
window.removeOrderItem = removeOrderItem;
window.createOrder = createOrder;
window.generateReport = generateReport;

console.log('app.js loaded successfully - Configured for your API');