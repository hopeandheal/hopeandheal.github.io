/**
 * api/products.js — Public Product List
 * 
 * Public API to fetch treatments and clinical products.
 * No authentication needed — public-facing for visitors.
 */

import { readProducts } from './sheets.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const products = await readProducts();
        const activeProducts = (products || []).filter(p => p.Active === 'TRUE' || p.Active === true);
        return res.status(200).json({ products: activeProducts });
    } catch (err) {
        console.error('Products API error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch items' });
    }
}
