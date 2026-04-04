/**
 * assets/js/order-logic.js — Product Catalog & Rendering
 * Static fallback products used when Google Sheets API is empty.
 */

let TREATMENTS = [
    {
        id: 'prod_shampoo',
        name: 'Heal Root Herbal Shampoo',
        price: 350,
        desc: 'Natural scalp healing & hair strengthening with Bhringraj, Neem & Brahmi (500 ml).',
        day: 'Hair Care',
        image: 'assets/images/products/shampoo_product_jpg_1772792947462.png'
    },
    {
        id: 'prod_oil',
        name: 'Hope & Heal Hair Oil',
        price: 200,
        desc: 'Ayurvedic blend for hair growth & deep nourishment with 12 herbs (100 ml).',
        day: 'Hair Care',
        image: 'assets/images/products/hair_oil_product_jpg_1772792969625.png'
    },
    {
        id: 'prod_soap',
        name: 'Neem & Aloe Spark Soap Bar',
        price: 60,
        desc: 'Deeply refreshing herbal bathing bar. Neem + Aloe Vera for clear, healthy skin (100g).',
        day: 'Skin Care',
        image: null
    }
];

window.TREATMENTS = TREATMENTS;

document.addEventListener('DOMContentLoaded', () => {
    loadTreatments();
});

async function loadTreatments() {
    const container = document.getElementById('treatments-container');
    if (!container) return;

    try {
        const API_BASE = window.location.hostname === 'localhost' ? `${window.location.protocol}//${window.location.host}` : '';
        const res = await fetch(`${API_BASE}/api/products`);
        const data = await res.json();

        if (data && data.products && data.products.length > 0) {
            TREATMENTS = data.products.map(p => ({
                id: p.ID,
                name: p.Name,
                price: parseFloat(p.Price),
                desc: p.Description,
                day: p.Category || 'Product',
                image: p.ImageURL || null
            }));
            window.TREATMENTS = TREATMENTS;
        }
    } catch (e) {
        console.info('[HopeHeal] Using static product catalogue.');
    }

    renderTreatments(container);
}

window.renderTreatments = renderTreatments;

function renderTreatments(container) {
    if (!TREATMENTS || TREATMENTS.length === 0) {
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <p class="text-muted">No products found. Please check back soon.</p>
            </div>`;
        return;
    }

    container.innerHTML = TREATMENTS.map(item => {
        const cart = window.getCart ? window.getCart() : [];
        const isSelected = !!cart.find(c => c.id === item.id);

        // Safe image: no inline onerror — we use a data-src approach via a simple img with class
        const imgHtml = item.image
            ? `<img class="product-img" src="${item.image}" alt="${item.name}" loading="lazy">`
            : `<div class="product-img-placeholder">🌿</div>`;

        const categoryColors = {
            'Hair Care': '#5c6a00',
            'Skin Care': '#1a6a5a',
            'Supplement': '#6a3a00',
            'Product': '#4a5030'
        };
        const catColor = categoryColors[item.day] || '#4a5030';

        return `
            <div class="product-card${isSelected ? ' selected' : ''}"
                 data-id="${item.id}"
                 onclick="addToCart('${item.id}')">
                ${isSelected ? '<div class="selected-badge">✓ In Cart</div>' : ''}
                <div class="product-img-wrap">
                    ${imgHtml}
                    <button class="product-quick-add${isSelected ? ' selected-state' : ''}" type="button">
                        ${isSelected ? '✓ Added to Cart' : 'Quick Add +'}
                    </button>
                </div>
                <div class="product-body">
                    <div class="product-cat" style="color:${catColor};">${item.day}</div>
                    <div class="product-name">${item.name}</div>
                    <div class="product-desc">${item.desc}</div>
                    <div class="product-footer">
                        <div class="product-price">₹${item.price}<span class="product-price-note"> incl. taxes</span></div>
                        <button class="btn-add${isSelected ? ' btn-add-selected' : ''}" type="button">
                            ${isSelected ? '✓ Added' : '+ Add'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // After rendering, attach image error handlers safely via JS (not inline)
    container.querySelectorAll('.product-img').forEach(img => {
        img.addEventListener('error', function () {
            this.parentElement.innerHTML = '<div class="product-img-placeholder">🌿</div>';
        });
    });

    // Update count badge
    const badge = document.getElementById('products-count-badge');
    if (badge) {
        badge.textContent = `${TREATMENTS.length} item${TREATMENTS.length !== 1 ? 's' : ''} available`;
    }
}
