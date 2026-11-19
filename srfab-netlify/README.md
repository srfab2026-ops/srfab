# SR FAB Cloth Bill – Netlify version

Your bill app with PhonePe Payment Gateway auto-confirm.
When a customer pays the "PhonePe auto-confirm QR", the bill is saved as paid
by itself and the "Payment Approved" screen with sound appears.

## What is in this folder
- `public/index.html`   – the bill app
- `public/thanks.html`  – page customers see after paying
- `netlify/functions/api.mjs` – the server part (login, saving bills, PhonePe)
- `package.json`, `netlify.toml` – Netlify settings (do not change)

## Step 1 – Put the files on GitHub
1. Make a GitHub account and click **New repository**. Name it `srfab`, choose **Private**.
2. On the new repository page click **uploading an existing file**.
3. Unzip this folder on your computer. Drag everything inside it
   (the folders `public` and `netlify`, and the files `package.json`,
   `netlify.toml`, `.gitignore`, `README.md`) into the GitHub page.
4. Click **Commit changes**.

## Step 2 – Create the Netlify site
1. Make a Netlify account (sign in with GitHub).
2. **Add new site → Import an existing project → GitHub**, pick `srfab`.
3. Leave all build settings as they are and click **Deploy**.
   (The first deploy works but login will not, until Step 3 is done.)

## Step 3 – Add your secrets in Netlify
Site configuration → **Environment variables** → add each of these.
Never share them with anyone and never put them in a file.

| Name | Value |
|---|---|
| `SHOP_MOBILE` | the 10-digit mobile number you log in with |
| `SHOP_PASSWORD` | the password you log in with (long and private) |
| `SESSION_SECRET` | any long random text, 40+ characters |
| `PHONEPE_ENV` | `sandbox` for testing, later `production` |
| `PHONEPE_CLIENT_ID` | from the PhonePe dashboard |
| `PHONEPE_CLIENT_VERSION` | from PhonePe (use `1` in sandbox) |
| `PHONEPE_CLIENT_SECRET` | from the PhonePe dashboard |
| `PHONEPE_WEBHOOK_USER` | a username you invent (for Step 4) |
| `PHONEPE_WEBHOOK_PASS` | a long password you invent (for Step 4) |

Then go to **Deploys → Trigger deploy → Deploy site** so the values are used.

## Step 4 – Tell PhonePe where to send "payment completed"
In the PhonePe business dashboard open the **Webhook** section and create one:
- URL: `https://YOUR-SITE-NAME.netlify.app/api/phonepe/webhook`
- Username / Password: the same `PHONEPE_WEBHOOK_USER` / `PHONEPE_WEBHOOK_PASS`
- Events: order completed and order failed

(The app also asks PhonePe directly every 3 seconds, so payments are still
confirmed if the webhook is slow, but set it up anyway.)

## Step 5 – Test, then go live
1. Open your Netlify link, log in, open Settings and fill in the shop details and cloth list.
2. Make a small bill and press **PhonePe auto-confirm QR**.
3. Pay it. The bill should become Paid by itself and show the green approved screen.
   (In sandbox you pay with PhonePe's test app, not real money.)
4. Change `PHONEPE_ENV` to `production`, use your live Client ID / version / secret,
   deploy again, and test once with ₹1.
5. Bring your old bills across: in the old page press **Download Excel**,
   then in this page open History and press **Import Excel**.

## Good to know
- Logging in, saving bills and PhonePe all run on the server; nobody can read
  bills without your mobile number and password.
- After 5 wrong passwords the login locks for 1 minute.
- If you change the bill after creating the QR and the customer then pays,
  the app shows a message and you must record that bill by hand.
- If you press **Cancel payment** and the customer still pays, the money
  arrives in PhonePe but no bill is recorded; check your PhonePe report.
- The plain UPI QR and the **Paid by UPI** button still work as a backup.
- Check PhonePe's charges for gateway payments.
