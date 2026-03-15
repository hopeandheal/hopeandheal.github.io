/**
 * assets/js/order-ui.js
 * Handles checkout flow: OTP, delivery fee, form submit.
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
        const state = stateSelect ? stateSelect.value : 'Other';
        return state === 'Gujarat' ? 50 : 100;
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

    document.querySelectorAll('input[name="payType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            tileOnline?.classList.toggle('active', document.getElementById('payOnline').checked);
            tileCod?.classList.toggle('active', document.getElementById('payCod').checked);
            refreshTotals();
        });
    });

    // ── Proceed button ────────────────────────────────────────────────────────
    checkoutBtn.addEventListener('click', () => {
        checkoutBtn.style.display = 'none';
        checkoutSection.style.display = 'block';
        // Small delay so display kicks in before scroll
        setTimeout(() => checkoutSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        refreshTotals(); // update totals now that section is visible
    });

    // ── OTP flow ──────────────────────────────────────────────────────────────
    document.getElementById('btn-send-otp')?.addEventListener('click', async () => {
        const phone = document.getElementById('phone').value.trim();
        if (!phone || phone.length < 7) {
            showFieldError('phone', 'Enter a valid phone number first.');
            return;
        }
        clearFieldError('phone');

        const btn = document.getElementById('btn-send-otp');
        btn.disabled = true;
        btn.textContent = 'Sending…';

        // In production: call your OTP API here.
        await new Promise(r => setTimeout(r, 700)); // simulate network
        alert('TEST OTP: 1234\n\n(Note: This is a demo. In a real application, this would be sent via SMS.)');
        document.getElementById('otp-section').style.display = 'block';

        btn.textContent = 'Resend OTP';
        btn.disabled = false;
    });

    document.getElementById('btn-verify-otp')?.addEventListener('click', () => {
        const otp = document.getElementById('otp-input').value.trim();
        // DEV: accept any 4-digit OTP. Replace with real API verification in prod.
        if (otp.length === 4 && /^\d+$/.test(otp)) {
            document.getElementById('is-phone-verified').value = 'true';
            document.getElementById('otp-section').style.display = 'none';
            document.getElementById('btn-send-otp').style.display = 'none';
            document.getElementById('phone').readOnly = true;
            document.getElementById('otp-success-msg').innerHTML =
                '<span class="verified-badge">✅ Phone Verified</span>';
        } else {
            document.getElementById('otp-success-msg').innerHTML =
                '<span class="text-danger small">Invalid OTP. Enter a 4-digit code.</span>';
        }
    });

    // ── Form submission ────────────────────────────────────────────────────────
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const cart = window.getCart ? window.getCart() : [];
        if (cart.length === 0) {
            alert('Please select at least one product before placing your order.');
            return;
        }

        // Validate phone verification
        if (document.getElementById('is-phone-verified').value !== 'true') {
            alert('Please verify your phone number (Send OTP → Enter OTP → Verify).');
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
        const payType = document.querySelector('input[name="payType"]:checked')?.value || 'online';

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
        const serviceFee = payType === 'online' ? Math.round((subtotal + deliveryFee) * 0.02 * 100) / 100 : 0;
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
            items: cart.map(i => ({ id: i.id, name: esc(i.name), price: i.price, qty: i.quantity || 1 })),
            deliveryCost: deliveryFee,
            serviceFee,
            total,
            paymentId: esc(paymentId)
        };

        const submitBtn = bookingForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Placing Order…';

        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3002' : '';
            const res = await fetch(`${API_BASE}/api/notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                document.getElementById('ref-id').innerText = paymentId;
                try {
                    localStorage.removeItem('hh_cart');
                    if (window.cart) window.cart.length = 0;
                    if (typeof window.updateUI === 'function') window.updateUI();
                } catch (e) { }
                showToast("Order placed successfully!");
                const modal = new bootstrap.Modal(document.getElementById('successModal'));
                modal.show();
            } else {
                alert('Something went wrong. Please call/WhatsApp 84690 22764 to place your order.');
            }
        } catch (err) {
            console.error('Order failed:', err);
            alert('Connection failed. Please try again or call 84690 22764.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `🛒 Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
        }
    });

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
                        refreshTotals();
                    }
                }
            } catch (err) { console.error('Pincode lookup failed:', err); }
        }
    });

    // Clear error on input
    document.querySelectorAll('.form-control, .form-select').forEach(el => {
        el.addEventListener('input', () => el.classList.remove('is-invalid'));
    });
});
