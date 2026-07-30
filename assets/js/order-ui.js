/**
 * assets/js/order-ui.js
 * Handles checkout flow: delivery fee calculation, form validation and submit.
 * Supports Clinic Pickup (Rajkot) and Home Delivery.
 */

function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

document.addEventListener('DOMContentLoaded', () => {

    const checkoutBtn = document.getElementById('btn-checkout');
    const checkoutSection = document.getElementById('checkout-section');
    const bookingForm = document.getElementById('booking-form');
    const stateSelect = document.getElementById('p-address-state');

    if (!checkoutBtn) return;

    // ── Always home delivery: initialise fee from default state ──────────────
    function getDeliveryFee() {
        const isPickup = document.getElementById('typePickup')?.checked;
        if (isPickup) return 0;
        return 1;
    }

    function refreshTotals() {
        window.deliveryFee = getDeliveryFee();
        if (typeof window.updateUI === 'function') window.updateUI();
    }

    // Update fee instantly when state changes
    stateSelect?.addEventListener('change', refreshTotals);

    // Set initial fee
    window.deliveryFee = getDeliveryFee();

    // ── Payment & Order Type toggles ──────────────────────────────────────────
    const tileOnline = document.getElementById('tile-online');
    const tileCod = document.getElementById('tile-cod');
    const tileDelivery = document.getElementById('tile-delivery');
    const tilePickup = document.getElementById('tile-pickup');
    const deliveryAddressSection = document.getElementById('delivery-address-section');

    document.querySelectorAll('input[name="orderType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const isPickup = document.getElementById('typePickup')?.checked;
            tilePickup?.classList.toggle('active', isPickup);
            tileDelivery?.classList.toggle('active', !isPickup);
            if (deliveryAddressSection) deliveryAddressSection.style.display = isPickup ? 'none' : 'block';
            refreshTotals();
        });
    });

    // ── Proceed button ────────────────────────────────────────────────────────
    checkoutBtn.addEventListener('click', () => {
        checkoutBtn.style.display = 'none';
        checkoutSection.style.display = 'block';
        // Small delay so display kicks in before scroll
        setTimeout(() => {
            const nav = document.querySelector('.navbar');
            const isFixed = nav && (getComputedStyle(nav).position === 'fixed' || getComputedStyle(nav).position === 'sticky');
            const offset = isFixed ? nav.offsetHeight + 20 : 20;
            const targetPos = checkoutSection.getBoundingClientRect().top + window.pageYOffset - offset;
            window.scrollTo({ top: targetPos, behavior: 'smooth' });
        }, 100);
        refreshTotals(); // update totals now that section is visible
    });


    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const cart = window.getCart ? window.getCart() : [];
        if (cart.length === 0) {
            alert('Please select at least one product before placing your order.');
            return;
        }

        // Collect fields
        const name = document.getElementById('p-name').value.trim();
        const email = document.getElementById('p-email').value.trim();
        const code = document.getElementById('phone-code').value;
        const phone = document.getElementById('phone').value.trim();
        const street = document.getElementById('p-address-street').value.trim();
        const city = document.getElementById('p-address-city').value.trim();
        const pin = document.getElementById('p-address-pin').value.trim();
        const state = document.getElementById('p-address-state').value;
        const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'delivery';
        const isPickup = orderType === 'pickup';
        const payType = 'upi';

        // Basic validation
        if (!name) { showFieldError('p-name', 'Full name is required.'); return; }
        if (!email || !email.includes('@')) { showFieldError('p-email', 'Valid email is required.'); return; }
        if (!phone) { showFieldError('phone', 'Phone number is required.'); return; }
        
        if (!isPickup) {
            if (!street) { showFieldError('p-address-street', 'Street address is required.'); return; }
            if (!city) { showFieldError('p-address-city', 'City is required.'); return; }
            if (!pin || pin.length < 5) { showFieldError('p-address-pin', 'Enter a valid pincode.'); return; }
        }

        const deliveryFee = getDeliveryFee();
        const subtotal = cart.reduce((s, i) => s + (i.price * i.quantity), 0);
        const serviceFee = 0; // Removed the 2% dummy fee
        const total = subtotal + deliveryFee + serviceFee;
        const paymentId = 'HH-' + Date.now().toString(36).toUpperCase();
        const addressStr = isPickup ? 'Clinic Pickup (Rajkot)' : `${street}, ${city}, ${state} - ${pin}`;

        const payload = {
            customer: {
                name: esc(name),
                email: esc(email),
                phone: esc(`${code} ${phone}`),
                type: orderType,
                address: esc(addressStr),
                paymentMethod: payType
            },
            items: cart.map(i => ({
                id: i.id,
                name: esc(i.name),
                price: i.price,
                qty: i.quantity || 1,
                day: i.day || 'Products'
            })),
            deliveryCost: deliveryFee,
            total,
            paymentId: esc(paymentId)
        };

        const submitBtn = document.getElementById('btn-place-order');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="loader-dots">Processing…</span>';
        }

        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3002' : '';
            
            // Create Razorpay order on the server
            const orderRes = await fetch(`${API_BASE}/api/create-razorpay-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: cart.map(i => ({ price: i.price, qty: i.quantity || 1 })),
                    deliveryCost: deliveryFee
                })
            });

            if (!orderRes.ok) {
                const errData = await orderRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to initialize payment gateway.');
            }

            const orderData = await orderRes.json();

            // Local development server simulation modal
            if (orderData.orderId.startsWith('order_mock_')) {
                const confirmPaid = confirm(`[DEV MODE] Simulate Razorpay payment for ₹${total.toFixed(2)}?\n\nClick OK for Success, Cancel for Failure.`);
                if (confirmPaid) {
                    const mockPaymentId = 'pay_mock_' + Math.random().toString(36).substring(2, 10).toUpperCase();
                    const mockSignature = 'mock-signature';
                    
                    const mockPayload = {
                        ...payload,
                        razorpay_order_id: orderData.orderId,
                        razorpay_payment_id: mockPaymentId,
                        razorpay_signature: mockSignature
                    };

                    await sendNotifications(mockPayload, cart, total, API_BASE);
                } else {
                    alert('Payment cancelled by user.');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = `Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
                    }
                }
                return;
            }

            // Production real Razorpay checkout flow
            if (!window.Razorpay) {
                throw new Error('Payment gateway failed to load. Please refresh the page and try again.');
            }

            const options = {
                "key": orderData.keyId,
                "amount": orderData.amount,
                "currency": "INR",
                "name": "Hope & Heal Clinic",
                "description": "Herbal Products Order",
                "image": "assets/images/favicon.png",
                "order_id": orderData.orderId,
                "handler": async function (response) {
                    const finalPayload = {
                        ...payload,
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature
                    };
                    
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<span class="loader-dots">Confirming…</span>';
                    }

                    await sendNotifications(finalPayload, cart, total, API_BASE);
                },
                "prefill": {
                    "name": name,
                    "email": email,
                    "contact": phone
                },
                "theme": {
                    "color": "#7c9a3d"
                },
                "modal": {
                    "ondismiss": function() {
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = `Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
                        }
                    }
                }
            };

            const rzp = new window.Razorpay(options);
            rzp.open();

        } catch (err) {
            console.error('Order failed:', err);
            alert(err.message || 'Connection failed. Please try again or call 84690 22764.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
            }
        }
    });

    async function sendNotifications(payload, cart, total, API_BASE) {
        const submitBtn = document.getElementById('btn-place-order');
        const paymentId = payload.paymentId;
        const email = payload.customer.email;

        try {
            const res = await fetch(`${API_BASE}/api/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                document.getElementById('ref-id').innerText = data.ref || paymentId;

                // Pre-fill WhatsApp Receipt
                const waPhone = '918469022764';
                const itemsList = cart.map(i => `• ${i.name} (x${i.quantity || 1})`).join('\n');
                const waMsg = encodeURIComponent(`Hello Hope & Heal Team,\n\nI have just placed an order!\n\nReference: ${paymentId}\nItems:\n${itemsList}\nTotal: \u20B9${total.toFixed(2)}\n\nThank you!`);
                const waBtn = document.getElementById('btn-wa-receipt');
                if (waBtn) waBtn.href = `https://wa.me/${waPhone}?text=${waMsg}`;

                try {
                    localStorage.removeItem('hh_cart');
                    if (window.cart) window.cart.length = 0;
                    if (typeof window.updateUI === 'function') window.updateUI();
                } catch (e) { }

                showToast('Order placed successfully!');
                const modal = new bootstrap.Modal(document.getElementById('successModal'));
                modal.show();
            } else {
                const errData = await res.json().catch(() => ({}));
                alert(errData.error || 'Something went wrong. Please call/WhatsApp 84690 22764.');
            }
        } catch (err) {
            console.error('Notification failed:', err);
            alert('Something went wrong. Please call/WhatsApp 84690 22764 to confirm your order.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `🛒 Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function showFieldError(fieldId, msg) {
        const el = document.getElementById(fieldId);
        if (!el) return;
        el.classList.add('is-invalid');
        // remove existing feedback
        const existing = el.parentNode.querySelector('.invalid-feedback');
        if (existing) existing.remove();
        const fb = document.createElement('div');
        fb.className = 'invalid-feedback';
        fb.textContent = msg;
        el.parentNode.appendChild(fb);
        el.focus();
    }

    function clearFieldError(fieldId) {
        const el = document.getElementById(fieldId);
        if (!el) return;
        el.classList.remove('is-invalid');
        const fb = el.parentNode.querySelector('.invalid-feedback');
        if (fb) fb.remove();
    }

    // ── Pincode Autofill ──────────────────────────────────────────────────────
    const pinInput = document.getElementById('p-address-pin');
    const cityInput = document.getElementById('p-address-city');
    const stateSelect_p = document.getElementById('p-address-state');

    pinInput?.addEventListener('input', async (e) => {
        const pin = e.target.value.trim();
        if (pin.length === 6 && /^\d+$/.test(pin)) {
            try {
                const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
                const data = await res.json();
                if (data && data[0] && data[0].Status === 'Success') {
                    const postOffice = data[0].PostOffice[0];
                    if (postOffice) {
                        cityInput.value = postOffice.District || postOffice.Block || postOffice.Name;
                        if (postOffice.State) {
                            // Map state if possible, else use first word
                            const stateName = postOffice.State.trim();
                            // Attempt to select from existing options
                            let found = false;
                            for (let i = 0; i < stateSelect_p.options.length; i++) {
                                if (stateSelect_p.options[i].value === stateName) {
                                    stateSelect_p.selectedIndex = i;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found && stateName === 'Gujarat') { // common case
                                stateSelect_p.value = 'Gujarat';
                            }
                        }
                        if (typeof refreshTotals === 'function') refreshTotals();
                    }
                }
            } catch (err) { console.error('Pincode lookup failed:', err); }
        }
    });

    // Clear error on input
    document.querySelectorAll('.form-control, .form-select').forEach(el => {
        el.addEventListener('input', () => el.classList.remove('is-invalid'));
    });
    // ── Mobile UI Helpers ─────────────────────────────────────────────────────
    window.scrollToCart = function () {
        const cartEl = document.querySelector('.cart-card');
        if (!cartEl) return;
        const navHeight = document.activeElement ? 120 : 100; // Offset for fixed header + breathing room
        const targetPos = cartEl.getBoundingClientRect().top + window.pageYOffset - navHeight;
        window.scrollTo({ top: targetPos, behavior: 'smooth' });
    };
});
