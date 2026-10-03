# Sri Sai Vani Collections

Standalone storefront built from an empty repository.

This project was created from scratch. It does not copy the previous Sri Sai Vani repository files.

## Included
- Premium editorial fashion layout
- Sarees and Dresses categories
- Search and price filtering
- New Arrivals and Best Seller labels
- WhatsApp product enquiries
- Responsive mobile/desktop design
- Local admin studio for add/edit/delete
- Shop name, WhatsApp and Instagram settings
- Original local SVG demo artwork

## Admin
Open ADMIN on the website.

Demo password: sriSai@2026

Change the password in app.js before public production use.

## Deployment
The repository is static and can be deployed directly to Netlify with the publish directory set to the repository root.


## Secure catalogue storage

The Admin catalogue is persisted in GitHub through the Netlify serverless function. Configure these Netlify environment variables (never put them in frontend code):

- `GITHUB_TOKEN`: fine-grained GitHub token with Contents read/write permission for this repository
- `GITHUB_REPO`: `vinith1111/premium_saree_website_libas`
- `GITHUB_BRANCH`: `rebuild/premium-storefront` during testing, then the deployment branch after approval
- `ADMIN_PASSWORD`: private Admin password

Product metadata is stored in `data/products.json`, settings in `data/settings.json`, and uploaded product images in `public/products/`.
