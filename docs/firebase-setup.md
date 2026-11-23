# Firebase setup

SteelProcure uses Firebase Authentication for identity only. Roles, status and permissions live in MongoDB.

## 1. Create the project

1. Create a project in the Firebase console.
2. **Authentication → Sign-in method**: enable *Email/Password* and *Google*.
3. **Project settings → General → Your apps → Web app**: register a web app and copy its config into `frontend/.env.local`:
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._PROJECT_ID`, `..._APP_ID`.
4. **Authentication → Settings → Authorized domains**: make sure `localhost` is listed.

## 2. Backend credentials (Admin SDK)

1. **Project settings → Service accounts → Generate new private key**.
2. Copy `project_id`, `client_email` and `private_key` into `backend/.env` as `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
3. Keep the private key on **one line** with literal `\n` sequences; `config/firebase.ts` converts them.
4. Never commit the JSON file or `.env`. `.gitignore` already excludes both. These credentials must never appear in frontend code.

## 3. First administrator

Set `BOOTSTRAP_ADMIN_EMAIL=you@example.com` in `backend/.env`, then register or sign in with that address. It is provisioned as System Administrator only if Firebase reports the email as **verified** (Google sign-in is verified automatically; for email/password, click the verification link first, then sign in again).

## 4. Demo users

Do not hardcode passwords. For each demo role:

1. Create the account in **Authentication → Users → Add user** (use a strong password you keep outside the repo), or sign up through the app.
2. Copy the user's **UID**.
3. Run the seed with that UID:

```bash
cd backend
DEMO_UID_SYSTEM_ADMIN=<uid> \
DEMO_UID_PROCUREMENT_MANAGER=<uid> \
DEMO_UID_DEPARTMENT_MANAGER=<uid> \
DEMO_UID_INVENTORY_OFFICER=<uid> \
DEMO_UID_FINANCE_OFFICER=<uid> \
DEMO_UID_SUPPLIER=<uid> \
DEMO_UID_MANAGEMENT=<uid> \
npm run seed
```

Suggested demo emails are listed in `backend/scripts/seed.ts`. Re-running the seed updates records in place and never creates duplicates.

Alternative without the seed: sign in as each person, then use **Settings → User Management** as the administrator to approve them and assign roles.
