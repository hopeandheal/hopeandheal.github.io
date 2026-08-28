# Hope and Heal - Project Documentation & Disaster Recovery

This document contains all the necessary information to restart, rebuild, or migrate the Hope and Heal website in the event of a catastrophic failure, server migration, or developer handover. 

## 🚀 Deployment Status
The project is completely serverless and hosted on **Vercel**. 
All frontend assets (`.html`, `.css`, `.js`, `.webp`) are statically hosted.
All backend logic (`/api/`) runs on Vercel Serverless Functions.

To deploy the project manually from the terminal:
```bash
npx vercel --prod --yes
```

## 🔐 Environment Variables (Secrets)
The codebase itself contains **ZERO** hardcoded secrets. If you ever migrate away from Vercel or need to set up a new environment, you MUST provide the following environment variables. In Vercel, these are stored in the project settings. For local development, they are stored in `.env.local` (which is ignored by Git).

### Payment Gateway (Razorpay)
- `RAZORPAY_KEY_ID`: Live key for Razorpay checkout.
- `RAZORPAY_KEY_SECRET`: Secret key for signature verification.

### Email Notifications (EmailJS)
- `EMAILJS_SERVICE_ID`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_PRIVATE_KEY`
- `EMAILJS_TEMPLATE_OWNER`: Template ID for notifying the clinic.
- `EMAILJS_TEMPLATE_CUSTOMER`: Template ID for sending the customer their receipt.

### Admin Dashboard Authentication
- `ADMIN_PWD`: The password required to log into `/admin.html`.
- `ADMIN_JWT_SECRET`: A secure random string used to sign session cookies.

### Telegram Notifications
- `TG_BOT_TOKEN`: The bot token from BotFather.
- `TG_CHAT_ID`: The group ID where order alerts are sent.

### Google APIs (Sheets & Drive)
- `GOOGLE_SERVICE_ACCOUNT_JSON`: The full JSON credentials for the Google Service Account.
- `GOOGLE_SHEET_ID`: The ID of the spreadsheet where orders are logged.
- `GOOGLE_DRIVE_FOLDER_ID`: The folder ID where prescription/payment images are uploaded.

### Image Hosting (ImgBB)
- `IMGBB_API_KEY`: API key for hosting uploaded images directly via ImgBB.

*(Legacy/Unused)*
- `FAST2SMS_API_KEY`: Previously used for SMS alerts.

## 🛠 Local Development
To run the project locally and test the API endpoints without deploying to Vercel:
1. Ensure you have Node.js installed.
2. Run `npm install` to install dependencies (like `razorpay`, `jsonwebtoken`).
3. Ensure `.env.local` is present in the root directory with the variables listed above.
4. Run the local development server:
   ```bash
   node dev-server.js
   ```
5. Open `http://localhost:3002` in your browser.

## 📁 Critical Project Structure
- `index.html`: The main homepage (SEO optimized).
- `order.html`: The shopping cart and Razorpay checkout flow.
- `admin.html`: The secure admin dashboard.
- `api/`: Contains all Vercel serverless functions (`create-razorpay-order.js`, `notify.js`, `upload.js`, `auth.js`, etc.).
- `assets/js/`: Contains the frontend logic (`cart-logic.js`, `order-ui.js`, `admin-logic.js`). **Note:** These are minified into `.min.js` during the Vercel build process.
- `vercel.json`: The configuration file that tells Vercel how to build the site and handle routing/headers.

## 🛡 Security & SEO Highlights
- **No Secrets in Code:** Fully secured.
- **WebP Images:** All `.jpg` and `.png` files were converted to `.webp` for maximum performance.
- **Lazy Loading:** Implemented on all off-screen images to ensure a 95+ Desktop / 70+ Mobile Lighthouse score.
- **SEO:** Fully equipped with OpenGraph, Twitter Cards, Canonical Links, `robots.txt`, `sitemap.xml`, and Schema.org JSON-LD structured data.

## 🔄 GitHub Repository
The source code is stored on GitHub at `hopeandheal/hopeandheal.github.io`. 
We have configured a specific SSH Key (`id_ed25519_hopeandheal`) for this repository to ensure pushes are successfully authenticated under the `hopeandheal` organization.

To push changes:
```bash
git add .
git commit -m "Your message"
git push origin main
```

---

## 📱 Mobile Navigation System & Architecture Details (Added August 2026)

### 1. Navigation Structure & Behavior
- **Floating Pill Navbar**: Managed across `index.html`, `order.html`, and `assets/css/custom.css`.
- **Mobile Dropdown Card**: On screens $\le 991\text{px}$, `#navbarSupportedContent` (class `.navbar-collapse`) renders as a solid opaque card (`background: #ffffff !important; opacity: 1 !important; z-index: 1050 !important;`) directly beneath the pill navbar.
- **Backdrop Overlay (`.nav-backdrop`)**: Injected into the DOM to softly dim the background when the menu is opened.
- **Auto-Closing**: Governed by `assets/dropdown/js/navbar-dropdownd3c6.js`. Clicking ANY navigation item (`.nav-link`, `Order Online`, `Book Appointment`) or tapping the backdrop immediately triggers `bootstrap.Collapse.hide()` and resets `aria-expanded="false"` and `body.navbar-dropdown-open`.
- **Smooth Scroll & Navbar Offset**: Set via `html { scroll-padding-top: 85px; }` and section IDs `scroll-margin-top: 85px !important;` to ensure hash navigation (`/#about`, `/#team-1-uqUIPDdYEs`, `/#contact`) lands accurately without titles being obscured by the floating navbar.

### 2. Key Files for Mobile Navigation
- `assets/dropdown/js/navbar-dropdownd3c6.js`: Navigation controller (backdrop injection, auto-close listener, offset calculation).
- `assets/theme/js/scriptd3c6.js`: Mobirise core anchor click and scroll handler (offset set to 85px).
- `assets/css/custom.css`: Modern design system tokens, floating pill rules, mobile navbar flex layout (`flex-basis: 100%`), and `.nav-backdrop`.
- `assets/css/mbr-additionald3c6.css`: Mobirise overrides (set `.navbar-collapse` to `background: #ffffff !important; z-index: 1050 !important; flex-basis: 100% !important;`).
- `index.html` & `order.html`: Asset version strings (`v=3.2`) for immediate cache invalidation.

