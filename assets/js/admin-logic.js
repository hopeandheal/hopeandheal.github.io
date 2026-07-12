/**
 * assets/js/admin-logic.js — Enhanced Clinic Dashboard Logic
 *
 * Handles:
 * 1. Authentication & Session Security (JWT)
 * 2. Real-time data fetching from Google Sheets API
 * 3. Dashboard metrics calculation
 * 4. Manual appointment entry (WhatsApp/Manual sync)
 * 5. Audit log visualization
 */

const API_BASE = window.location.hostname === 'localhost' ? `${window.location.protocol}//${window.location.host}` : '';

document.addEventListener('DOMContentLoaded', () => {

    // Image Preview Sync
    document.getElementById('p-image')?.addEventListener('input', (e) => updateImagePreview(e.target.value));

    // Image Upload Handling
    document.getElementById('p-upload-input')?.addEventListener('change', handleImageUpload);

    // Tab Switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-tab');
            const pane = document.getElementById(`tab-${target}`);
            if (pane) pane.classList.add('active');
        });
    });

    // Login Form
    document.getElementById('login-btn')?.addEventListener('click', handleLogin);
    document.getElementById('login-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        sessionStorage.removeItem('hh_admin_token');
        location.reload();
    });

    // Manual Appointment Submission
    document.getElementById('submit-appointment')?.addEventListener('click', submitManualOrder);

    // Initial check
    checkSession();
});

async function handleLogin() {
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');

    if (!password) return;
    btn.disabled = true;
    btn.innerText = 'Verifying...';
    err.style.display = 'none';

    try {
        const res = await fetch(`${API_BASE}/api/admin-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        if (res.ok) {
            const { token } = await res.json();
            sessionStorage.setItem('hh_admin_token', token);
            checkSession();
        } else if (res.status === 429) {
            err.innerText = 'Too many attempts. Locked for 15 minutes.';
            err.style.display = 'block';
        } else {
            err.innerText = 'Invalid password. Access denied.';
            err.style.display = 'block';
        }
    } catch (e) {
        err.innerText = 'Connection failed. Please try again.';
        err.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerText = 'Sign In';
    }
}

function checkSession() {
    const token = sessionStorage.getItem('hh_admin_token');
    const root = document.documentElement;

    if (token) {
        root.classList.add('auth-valid');
        loadAll();
        // Auto-refresh every 2 mins
        if (!window._refreshInterval) {
            window._refreshInterval = setInterval(loadAll, 120000);
        }
    } else {
        root.classList.remove('auth-valid');
        if (window._refreshInterval) {
            clearInterval(window._refreshInterval);
            window._refreshInterval = null;
        }
    }
}

async function loadAll() {
    const syncText = document.getElementById('last-refreshed');
    if (syncText) syncText.innerText = 'Syncing...';
    
    Promise.all([loadOrders(), loadLogs(), loadProducts()]).then(() => {
        if (syncText) {
            syncText.innerText = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        }
    });
}

async function loadOrders() {
    const token = sessionStorage.getItem('hh_admin_token');
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin-data?type=orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 401) { logout(); return; }
        const data = await res.json();
        const orders = data.orders || [];

        renderOrderTables(orders);
        calculateStats(orders);
    } catch (e) {
        console.error('Failed to load orders', e);
    }
}

async function loadLogs() {
    const token = sessionStorage.getItem('hh_admin_token');
    if (!token) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin-data?type=logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        renderLogsTable(data.logs || []);
    } catch (e) {
        console.error('Failed to load logs', e);
    }
}

// ─── Products Logic ───
let currentProducts = [];

function updateImagePreview(url) {
    const preview = document.getElementById('p-preview');
    const placeholder = document.getElementById('p-placeholder');
    if (!preview || !placeholder) return;

    if (url && url.trim().startsWith('http')) {
        preview.src = url;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        preview.src = '';
        preview.style.display = 'none';
        placeholder.style.display = 'block';
    }
}

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const token = sessionStorage.getItem('hh_admin_token');
    const btn = document.getElementById('p-upload-btn');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Uploading to Drive...';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/api/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        if (res.ok) {
            const data = await res.json();
            document.getElementById('p-image').value = data.url;
            updateImagePreview(data.url);
        } else {
            alert('Upload failed. Please check backend logs.');
        }
    } catch (err) {
        alert('Connection error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        e.target.value = ''; // Reset input
    }
}

async function loadProducts() {
    const token = sessionStorage.getItem('hh_admin_token');
    const tbody = document.getElementById('products-body');
    if (!token || !tbody) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin-products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        currentProducts = data.products || [];
        renderProductsTable(currentProducts);
    } catch (e) {
        console.error('Failed to load products', e);
    }
}

function renderProductsTable(products) {
    const tbody = document.getElementById('products-body');
    if (!tbody) return;

    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">No items in catalog.</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => `
        <tr>
            <td><img src="${p.ImageURL || 'https://via.placeholder.com/40'}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"></td>
            <td class="fw-bold">${p.Name}</td>
            <td class="text-success fw-bold">₹${p.Price}</td>
            <td><span class="badge badge-info">${p.Category}</span></td>
            <td><span class="badge ${p.Active === 'TRUE' ? 'badge-clinic' : 'badge-warn'}">${p.Active === 'TRUE' ? 'Active' : 'Hidden'}</span></td>
            <td>
                <button class="btn-refresh" onclick="editProduct('${p.ID}')" title="Edit"><i class="bi bi-pencil"></i></button>
                <button class="btn-refresh" onclick="deleteProduct('${p.ID}')" title="Delete" style="color:var(--error); border-color:var(--error);"><i class="bi bi-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

function openProductModal(isEdit = false) {
    document.getElementById('product-modal').style.display = 'flex';
    document.getElementById('p-modal-title').innerText = isEdit ? 'Edit Item' : 'Add New Item';
    if (!isEdit) {
        document.getElementById('p-id').value = '';
        document.getElementById('p-name').value = '';
        document.getElementById('p-price').value = '';
        document.getElementById('p-desc').value = '';
        document.getElementById('p-image').value = '';
        document.getElementById('p-category').value = 'Treatment';
        document.getElementById('p-active').value = 'TRUE';
        updateImagePreview('');
    }
}

function closeProductModal() {
    document.getElementById('product-modal').style.display = 'none';
}

function editProduct(id) {
    const p = currentProducts.find(x => x.ID === id);
    if (!p) return;
    document.getElementById('p-id').value = p.ID;
    document.getElementById('p-name').value = p.Name;
    document.getElementById('p-price').value = p.Price;
    document.getElementById('p-desc').value = p.Description;
    document.getElementById('p-image').value = p.ImageURL;
    document.getElementById('p-category').value = p.Category;
    document.getElementById('p-active').value = p.Active;
    updateImagePreview(p.ImageURL);
    openProductModal(true);
}

async function saveProduct() {
    const token = sessionStorage.getItem('hh_admin_token');
    const btn = document.getElementById('submit-product');

    const id = document.getElementById('p-id').value || 'prod_' + Date.now();
    const name = document.getElementById('p-name').value;
    const price = document.getElementById('p-price').value;
    const desc = document.getElementById('p-desc').value;
    const image = document.getElementById('p-image').value;
    const cat = document.getElementById('p-category').value;
    const active = document.getElementById('p-active').value;

    if (!name || !price) { alert('Name and Price are required'); return; }

    btn.disabled = true;
    btn.innerText = 'Synchronizing...';

    // Prepare new array
    let newProducts = [...currentProducts];
    const index = newProducts.findIndex(p => p.ID === id);
    const productData = { ID: id, Name: name, Price: price, Description: desc, ImageURL: image, Category: cat, Active: active };

    if (index >= 0) newProducts[index] = productData;
    else newProducts.push(productData);

    try {
        const res = await fetch(`${API_BASE}/api/admin-products`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ products: newProducts })
        });

        if (res.ok) {
            closeProductModal();
            loadProducts();
            alert('Cloud catalog updated successfully.');
        } else {
            alert('Failed to update catalog.');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Update Healthcare Catalog';
    }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to remove this item from the catalog?')) return;
    const token = sessionStorage.getItem('hh_admin_token');
    const newProducts = currentProducts.filter(p => p.ID !== id);

    try {
        const res = await fetch(`${API_BASE}/api/admin-products`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ products: newProducts })
        });
        if (res.ok) {
            loadProducts();
            alert('Item removed.');
        }
    } catch (e) {
        alert('Error removing item.');
    }
}

document.getElementById('submit-product')?.addEventListener('click', saveProduct);

function renderOrderTables(orders) {
    const fullBody = document.getElementById('orders-body');
    const recentBody = document.getElementById('recent-orders-body');

    if (!fullBody || !recentBody) return;

    if (orders.length === 0) {
        if (fullBody) fullBody.innerHTML = '<tr><td colspan="8" class="text-center py-5">No records found.</td></tr>';
        if (recentBody) recentBody.innerHTML = '<tr><td colspan="7" class="text-center py-5">No recent orders.</td></tr>';
        return;
    }

    const rows = orders.map(o => {
        const typeStr = (o.Type || o.type || '').toLowerCase();
        const isHome = typeStr.includes('delivery') || typeStr.includes('home');
        const badge = isHome ? 'badge-home' : 'badge-clinic';
        const label = isHome ? 'Home Visit' : 'Clinic';
        
        // Robust Timestamp Formatting
        let displayTimeFull = o.Timestamp || o.timestamp || '—';
        let displayTimeShort = '—';
        try {
            const d = new Date(displayTimeFull);
            if (!isNaN(d.getTime())) {
                displayTimeFull = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + 
                                  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                displayTimeShort = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            }
        } catch(e) {}

        // WhatsApp & Contact — guard against legacy #ERROR! values (old '+91' formula-parse bug)
        const rawPhone = o.Phone || o.phone || '';
        const phone = rawPhone.startsWith('#') ? '' : rawPhone;  // Treat Sheets error values as empty
        const email = o.Email || o.email || '';
        const cleanPhone = phone.replace(/\D/g, '');
        const waIcon = cleanPhone ? `<a href="https://wa.me/${cleanPhone}" target="_blank" class="text-success me-1" style="text-decoration:none;"><i class="bi bi-whatsapp"></i></a>` : '';

        // Treatment & Product details
        const itemKeys = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Products'];
        const itemParts = [];
        itemKeys.forEach(k => {
            if (o[k] && o[k] !== 'N/A') {
                const label = k === 'Products' ? '📦 Items' : k.slice(0,3);
                itemParts.push(`${label}: ${o[k]}`);
            }
        });
        const detailStr = itemParts.join(' | ') || 'General Consultation';

        const totalVal = o.Total || o.total || '0';
        const orderId = (o.ID || o.id || '').slice(-6);

        return {
            full: `
                <tr>
                    <td class="small text-muted">${displayTimeFull}</td>
                    <td class="fw-bold">${o.Name || o.name || 'Unknown'}</td>
                    <td>
                        <div class="small">${waIcon}${phone}</div>
                        <div class="small opacity-50">${email}</div>
                    </td>
                    <td><span class="badge ${badge}">${label}</span></td>
                    <td class="small">${o.Address || o.address || '—'}</td>
                    <td class="small opacity-75">${detailStr}</td>
                    <td class="fw-bold text-success">₹${totalVal}</td>
                    <td class="small font-monospace opacity-50">${orderId}</td>
                </tr>
            `,
            recent: `
                <tr>
                    <td class="small">${displayTimeShort}</td>
                    <td class="fw-bold">${o.Name || o.name || 'Patient'}</td>
                    <td class="small">${waIcon}${phone || '—'}</td>
                    <td><span class="badge ${badge}">${label}</span></td>
                    <td class="small opacity-75">${detailStr}</td>
                    <td class="fw-bold">₹${totalVal}</td>
                    <td class="small opacity-50">${orderId}</td>
                </tr>
            `
        };
    });

    fullBody.innerHTML = rows.map(r => r.full).join('');
    recentBody.innerHTML = rows.slice(0, 10).map(r => r.recent).join('');
}

function renderLogsTable(logs) {
    const body = document.getElementById('logs-body');
    if (!body) return;

    body.innerHTML = logs.map(l => {
        const level = (l.Level || '').toUpperCase();
        const badge = level === 'ERROR' ? 'badge-error' : level === 'WARN' ? 'badge-warn' : 'badge-info';
        return `
            <tr>
                <td class="small text-muted">${l.Timestamp || ''}</td>
                <td><span class="badge ${badge}">${level}</span></td>
                <td class="fw-medium">${l.Event || ''}</td>
                <td class="small opacity-75">${l.Details || ''}</td>
            </tr>
        `;
    }).join('');
}

function calculateStats(orders) {
    const total = orders.length;
    let homeCount = 0;
    let clinicCount = 0;
    let weekTotal = 0;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    orders.forEach(o => {
        const type = (o.Type || '').toLowerCase();
        if (type.includes('delivery') || type.includes('home')) homeCount++;
        else clinicCount++;

        // Basic date check for week total
        const parts = (o.Timestamp || '').split(',')[0].split('/');
        if (parts.length === 3) {
            const [d, m, y] = parts;
            const orderDate = new Date(y, m - 1, d);
            if (orderDate >= weekAgo) {
                weekTotal += parseFloat(o.Total || 0);
            }
        }
    });

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-pickups').innerText = clinicCount;
    document.getElementById('stat-deliveries').innerText = homeCount;
    document.getElementById('stat-revenue').innerText = '₹' + weekTotal.toLocaleString('en-IN');
}

// ─── Modals ───
function openOrderModal() { document.getElementById('appointment-modal').style.display = 'flex'; }
function closeOrderModal() { document.getElementById('appointment-modal').style.display = 'none'; }

async function submitManualOrder() {
    const token = sessionStorage.getItem('hh_admin_token');
    const btn = document.getElementById('submit-appointment');
    if (!btn) return;

    const name = document.getElementById('m-name').value;
    const phone = document.getElementById('m-phone').value;
    const type = document.getElementById('m-type').value;
    const fee = parseFloat(document.getElementById('m-fee').value || 0);

    const days = {};
    document.querySelectorAll('.session-day').forEach(inp => {
        if (inp.value) days[inp.getAttribute('data-day')] = inp.value;
    });

    if (!name || !fee) { alert('Name and Fee are required'); return; }

    btn.disabled = true;
    btn.innerText = 'Saving...';

    const payload = {
        customerName: name,
        customerPhone: phone,
        requestType: type,
        deliveryCost: 0,
        totals: { subtotal: fee, total: fee },
        days: days
    };

    try {
        const res = await fetch(`${API_BASE}/api/admin-appointment`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert('Success! Manual order saved.');
            closeOrderModal();
            loadAll();
            // Clear inputs
            document.getElementById('m-name').value = '';
            document.getElementById('m-phone').value = '';
            document.getElementById('m-fee').value = '';
            document.querySelectorAll('.session-day').forEach(i => i.value = '');
        } else {
            alert('Error adding order. Check logs.');
        }
    } catch (e) {
        alert('API error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Order to Cloud';
    }
}

function logout() {
    sessionStorage.removeItem('hh_admin_token');
    location.reload();
}

// Global Exports
window.loadAll = loadAll;
window.loadOrders = loadOrders;
window.loadLogs = loadLogs;
window.loadProducts = loadProducts;
window.openOrderModal = openOrderModal;
window.closeOrderModal = closeOrderModal;
window.submitManualOrder = submitManualOrder;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
