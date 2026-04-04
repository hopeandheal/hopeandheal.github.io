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
            document.getElementById('tile-upi')?.classList.toggle('active', document.getElementById('payUPI').checked);
            document.getElementById('tile-online')?.classList.toggle('active', document.getElementById('payOnline').checked);
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

    // ── OTP flow ──────────────────────────────────────────────────────────────
    document.getElementById('btn-send-otp')?.addEventListener('click', async () => {
        const phone = document.getElementById('phone').value.trim();
        const code = document.getElementById('phone-code')?.value || '+91';
        if (!phone || phone.length < 7) {
            showFieldError('phone', 'Enter a valid phone number first.');
            return;
        }
        clearFieldError('phone');

        const btn = document.getElementById('btn-send-otp');
        btn.disabled = true;
        btn.textContent = 'Sending…';

        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3002' : '';
            const resp = await fetch(`${API_BASE}/api/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: `${code} ${phone}` })
            });
            const data = await resp.json();

            if (!resp.ok || !data.success) {
                showFieldError('phone', data.error || 'Failed to send OTP. Try again.');
                btn.disabled = false;
                btn.textContent = 'Send OTP';
                return;
            }

            // Show OTP input
            const otpSection = document.getElementById('otp-section');
            if (otpSection) otpSection.style.display = 'block';
            document.getElementById('otp-input')?.focus();
            btn.textContent = 'Resend OTP';
            btn.disabled = false;

            const successMsg = document.getElementById('otp-success-msg');
            if (successMsg) successMsg.innerHTML = '<span style="color:var(--green);font-size:0.85rem;">OTP sent to your phone. Valid for 10 minutes.</span>';

        } catch (err) {
            showFieldError('phone', 'Network error. Please try again.');
            btn.disabled = false;
            btn.textContent = 'Send OTP';
        }
    });

    document.getElementById('btn-verify-otp')?.addEventListener('click', async () => {
        const phone = document.getElementById('phone').value.trim();
        const code = document.getElementById('phone-code')?.value || '+91';
        const otpInput = document.getElementById('otp-input');
        const otp = otpInput?.value.trim();

        if (!otp || otp.length !== 6) {
            if (otpInput) otpInput.classList.add('is-invalid');
            return;
        }

        const btn = document.getElementById('btn-verify-otp');
        btn.disabled = true;
        btn.textContent = 'Verifying…';

        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3002' : '';
            const resp = await fetch(`${API_BASE}/api/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: `${code} ${phone}`, otp, action: 'verify' })
            });
            const data = await resp.json();

            if (!resp.ok || !data.verified) {
                if (otpInput) otpInput.classList.add('is-invalid');
                btn.disabled = false;
                btn.textContent = 'Verify OTP';
                const msg = document.getElementById('otp-success-msg');
                if (msg) msg.innerHTML = `<span style="color:#c0392b;font-size:0.85rem;">${data.error || 'Incorrect OTP. Try again.'}</span>`;
                return;
            }

            // Verified!
            document.getElementById('is-phone-verified').value = 'true';
            document.getElementById('phone').readOnly = true;
            if (otpInput) otpInput.readOnly = true;
            document.getElementById('otp-section').style.display = 'none';
            document.getElementById('btn-send-otp').style.display = 'none';

            const successMsg = document.getElementById('otp-success-msg');
            if (successMsg) successMsg.innerHTML = '<span class="verified-badge">✅ Phone Verified</span>';

        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Verify OTP';
            const msg = document.getElementById('otp-success-msg');
            if (msg) msg.innerHTML = '<span style="color:#c0392b;font-size:0.85rem;">Network error. Please try again.</span>';
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
            
            // ── Razorpay Payment Path ──────────────────────────────────────────
            if (payType === 'online') {
                const rpRes = await fetch(`${API_BASE}/api/razorpay-order`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount: total, paymentId })
                });
                const rpData = await rpRes.json();

                if (!rpRes.ok || !rpData.orderId) {
                    throw new Error(rpData.error || 'Payment gateway failed. Try again.');
                }

                const options = {
                    key: rpData.key,
                    amount: rpData.amount,
                    currency: rpData.currency,
                    name: "Hope & Heal Clinic",
                    description: "Clinical Products Order",
                    order_id: rpData.orderId,
                    handler: async function (response) {
                        // After payment success, verify on server first
                        const vResp = await fetch(`${API_BASE}/api/razorpay-order?verify=1&razorpay_order_id=${response.razorpay_order_id}&razorpay_payment_id=${response.razorpay_payment_id}&razorpay_signature=${response.razorpay_signature}`);
                        const vData = await vResp.json();
                        
                        if (vData.verified) {
                            payload.razorpay_payment_id = response.razorpay_payment_id;
                            // Proceed to send notifications
                            sendNotifications(payload, cart, total, API_BASE);
                        } else {
                            alert("Payment verification failed. Please contact the clinic.");
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = `🛒 Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
                        }
                    },
                    prefill: {
                        name: name,
                        email: email,
                        contact: phone
                    },
                    theme: { color: "#6b8c00" },
                    modal: {
                        ondismiss: function() {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = `🛒 Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
                        }
                    }
                };
                const rzp = new Razorpay(options);
                rzp.open();
                return; // Wait for callback
            }

            // ── Offline Path (UPI/GPay manual check or COD if it was there) ───────
            await sendNotifications(payload, cart, total, API_BASE);

        } catch (err) {
            console.error('Order failed:', err);
            alert(err.message || 'Connection failed. Please try again or call 84690 22764.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `🛒 Place Order — <span id="btn-total">₹${total.toFixed(2)}</span>`;
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
                document.getElementById('ref-id').innerText = paymentId;

                // ── Send emails client-side via EmailJS SDK
                if (data.emailParams && typeof emailjs !== 'undefined') {
                    const ep = data.emailParams;
                    if (ep.serviceId && ep.publicKey) {
                        emailjs.init(ep.publicKey);
                        // Admin notification
                        if (ep.ownerTemplate) {
                            emailjs.send(ep.serviceId, ep.ownerTemplate, ep.owner)
                                .catch(err => console.warn('Admin email failed:', err));
                        }
                        // Customer receipt
                        if (ep.customerTemplate && email) {
                            emailjs.send(ep.serviceId, ep.customerTemplate, ep.customer)
                                .catch(err => console.warn('Customer email failed:', err));
                        }
                    }
                }

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
