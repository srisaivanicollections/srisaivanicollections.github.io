# Sri Sai Vani Collections

Premium editorial storefront for Sri Sai Vani Collections.

## Included

- Premium responsive fashion storefront
- Sarees and Dresses catalogue
- Search and price filtering
- New Arrivals and Best Seller labels
- WhatsApp product enquiries
- Instagram and Google Maps CTAs
- Client reviews section
- Responsive desktop, tablet and mobile layouts
- Lightweight Admin Studio for add/edit/delete
- Shop name, WhatsApp and Instagram settings

## Catalogue architecture

GitHub is the **single source of truth** for catalogue and storefront settings.

- Product metadata: `data/products.json`
- Store settings: `data/settings.json`
- Product images: `assets/products/`
- Storefront reads the committed JSON through GitHub's public API and raw asset URLs.
- Admin writes catalogue JSON and uploaded images back to the repository.
- Product writes are serialized and verified after the GitHub commit.
- Product deletion is re-read and verified so a deleted item cannot silently return from a stale browser snapshot.
- Admin logout clears browser-stored GitHub credentials.

There is intentionally no localStorage catalogue fallback. This prevents stale browser data from reappearing after refresh.

## Admin

Open **ADMIN** on the website.

On first setup, the Admin screen connects GitHub and asks you to create an Admin password. The password is stored only as a salted PBKDF2 hash, never as plaintext and never hardcoded in JavaScript. Subsequent sessions use the Admin password. **Forgot password?** uses the hidden GitHub connection to verify repository access and create a new password. The GitHub token is not displayed in the storefront UI.

> Note: this is a lightweight browser-based Admin Studio. A production-grade authentication system should use a server-side authentication boundary rather than a frontend password.

## Deployment

The site can be deployed as a static GitHub Pages/Netlify-style site. The current storefront does not depend on a Netlify serverless catalogue function.

Keep repository write credentials out of committed source code. The Admin Studio stores its GitHub credential in browser storage because the current lightweight architecture writes directly to GitHub. The Admin password hash and salt are stored in `data/settings.json`; the plaintext password is never committed.

## Maintenance

After any catalogue change, test this sequence:

1. Add/edit/delete from Admin.
2. Confirm the GitHub JSON/image commit succeeds.
3. Refresh the storefront.
4. Confirm the change remains.
5. Test the same flow on mobile.

