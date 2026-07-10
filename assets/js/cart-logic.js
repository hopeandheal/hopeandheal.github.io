/**
 * assets/js/cart-logic.js — Product Cart Management
 * Always home delivery: ₹50 Gujarat, ₹100 other states.
 */

let cart = [];
try {
    const saved = localStorage.getItem('hh_cart');
    if (saved) cart = JSON.parse(saved);
} catch (e) {
    console.error('Failed to load cart', e);
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => typeof updateUI === 'function' && updateUI(), 50);
});

function addToCart(productId, evt) {
    if (evt) evt.stopPropagation(); // prevent double triggers if needed
    const item = window.TREATMENTS?.find(t => t.id === productId);
    if (!item) return;

    const exists = cart.find(i => i.id === productId);
    if (exists) {
        exists.quantity = (exists.quantity || 1) + 1;
    } else {
        cart.push({ ...item, quantity: 1 });
    }

    saveCart();
    updateUI();
    showToast(`${item.name} added to cart!`);
}

function updateQuantity(productId, delta) {
    const exists = cart.find(i => i.id === productId);
    if (!exists) return;

    exists.quantity += delta;
    if (exists.quantity <= 0) {
        cart = cart.filter(i => i.id !== productId);
    }

    saveCart();
    updateUI();
}

function saveCart() {
    try {
        localStorage.setItem('hh_cart', JSON.stringify(cart));
    } catch (e) { }
}

function updateUI() {
    const summaryEl = document.getElementById('summary-items');
    const subtotalEl = document.getElementById('subtotal');
    const totalEl = document.getElementById('total');
    const btnTotalEl = document.getElementById('btn-total');
    const feeSpanEl = document.getElementById('delivery-charge-span');
    const svcRowEl = document.getElementById('service-fee-row');
    const svcSpanEl = document.getElementById('service-fee-span');
    const countEl = document.getElementById('item-count');
    const checkoutBtn = document.getElementById('btn-checkout');
    const breakdownEl = document.getElementById('price-breakdown');

    if (!summaryEl) return;

    // ── Empty cart ────────────────────────────────────────────────────────────
    if (cart.length === 0) {
        summaryEl.innerHTML = '<div class="cart-empty">Add products to get started</div>';
        if (subtotalEl) subtotalEl.innerText = '₹0.00';
        if (feeSpanEl) feeSpanEl.innerText = '₹0.00';
        if (totalEl) totalEl.innerText = '₹0.00';
        if (btnTotalEl) btnTotalEl.innerText = '₹0.00';
        if (countEl) countEl.innerText = '0';
        if (svcRowEl) svcRowEl.style.display = 'none';
        if (breakdownEl) breakdownEl.style.display = 'none';
        if (checkoutBtn) checkoutBtn.disabled = true;
        syncCardStates();
        return;
    }

    // ── Show breakdown ────────────────────────────────────────────────────────
    if (breakdownEl) breakdownEl.style.display = 'block';

    // ── Cart rows ─────────────────────────────────────────────────────────────
    summaryEl.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div style="flex: 1;">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-qty-row">
                    <div class="qty-control">
                        <button type="button" class="btn-qty" onclick="updateQuantity('${item.id}', -1)" aria-label="Decrease quantity">−</button>
                        <span class="qty-val">${item.quantity}</span>
                        <button type="button" class="btn-qty" onclick="updateQuantity('${item.id}', 1)" aria-label="Increase quantity">+</button>
                    </div>
                </div>
            </div>
            <div class="cart-item-right">
                <span class="cart-item-price">₹${(item.price * item.quantity).toFixed(2)}</span>
                <button class="btn-rm" title="Remove" onclick="updateQuantity('${item.id}', -999)">✕</button>
            </div>
        </div>
    `).join('');

    // ── Totals ─────────────────────────────────────────────────────────────────
    const subtotal = cart.reduce((s, i) => s + (i.price * i.quantity), 0);
    const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    const deliveryFee = typeof window.deliveryFee === 'number' ? window.deliveryFee : 50;

    const finalTotal = subtotal + deliveryFee;

    if (subtotalEl) subtotalEl.innerText = `₹${subtotal.toFixed(2)}`;
    if (feeSpanEl) feeSpanEl.innerText = `₹${deliveryFee.toFixed(2)}`;

    if (svcRowEl) svcRowEl.style.display = 'none'; // No service fee

    if (totalEl) totalEl.innerText = `₹${finalTotal.toFixed(2)}`;
    if (btnTotalEl) btnTotalEl.innerText = `₹${finalTotal.toFixed(2)}`;
    if (countEl) countEl.innerText = totalItems;
    if (checkoutBtn) checkoutBtn.disabled = false;

    // ── Update floating mobile cart bar ─────────────────────────────────────────
    const mobileBar = document.getElementById('mobile-cart-bar');
    const mobileCount = document.getElementById('mobile-cart-count');
    const mobileTotal = document.getElementById('mobile-cart-total');
    if (mobileBar) {
        if (totalItems > 0 && window.innerWidth < 1024) {
            mobileBar.style.display = 'block';
            if (mobileCount) mobileCount.innerText = totalItems + (totalItems === 1 ? ' item' : ' items');
            if (mobileTotal) mobileTotal.innerText = '₹' + finalTotal.toFixed(2);
        } else {
            mobileBar.style.display = 'none';
        }
    }

    syncCardStates();
}

function syncCardStates() {
    document.querySelectorAll('.product-card').forEach(card => {
        const id = card.dataset.id;
        if (!id) return;
        const inCart = !!cart.find(i => i.id === id);
        card.classList.toggle('selected', inCart);
        // Update badge and button text
        const badge = card.querySelector('.selected-badge');
        const btn = card.querySelector('.btn-add');
        if (badge) badge.style.display = inCart ? '' : 'none';
        if (btn) {
            btn.textContent = inCart ? '✓ Added' : '+ Add';
            btn.classList.toggle('btn-add-selected', inCart);
        }
    });
}

function showToast(msg) {
    const box = document.getElementById('toast-container');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast show align-items-center border-0 shadow-lg mb-2';
    // Using green theme for Hope & Heal
    t.style.cssText = 'background: linear-gradient(135deg, #6b8c00, #8aaf00); color: #fff; border-radius: 12px; min-width: 280px; animation: slideDown 0.3s ease-out;';
    t.innerHTML = `
        <div class="d-flex align-items-center px-3 py-2">
            <span style="font-size: 1.2rem; margin-right: 8px;">✅ 🌱</span>
            <div class="toast-body fw-semibold" style="font-size: 0.9rem;">${msg}</div>
        </div>`;
    box.appendChild(t);
    setTimeout(() => {
        t.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        t.style.opacity = '0';
        t.style.transform = 'translateY(-20px)';
        setTimeout(() => t.remove(), 400);
    }, 2200);
}

window.addToCart = addToCart;
window.updateQuantity = updateQuantity;
window.getCart = () => cart;
window.updateUI = updateUI;
