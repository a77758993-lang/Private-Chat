# Private Chat — 10 users

A Persian RTL, text-only group chat with a professional dark interface.

## Features
- Site-wide password gate before users can see the app.
- User registration and login.
- Maximum of **10 registered accounts**.
- One shared live text chat room.
- Online member list.
- Messages expire one hour after being sent and are removed server-side.
- Passwords are hashed with bcrypt.
- Responsive layout for mobile and desktop.

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
```

Set environment variables before starting:

```bash
# Windows PowerShell
$env:SITE_PASSWORD="your-site-password"
$env:SESSION_SECRET="put-a-long-random-secret-here"
npm start
```

```bash
# macOS / Linux
SITE_PASSWORD="your-site-password" SESSION_SECRET="put-a-long-random-secret-here" npm start
```

Open http://localhost:3000

Default values are provided only to make local testing possible:
- `SITE_PASSWORD`: `ChangeThisSitePassword`
- `SESSION_SECRET`: generated randomly on each server start (sessions will reset after restart)

**Change the site password before sharing the site.** Do not commit real secrets to GitHub.

## Render deployment
1. Push this folder's files to your GitHub repository.
2. In Render, create a **Web Service** and connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Add environment variables:
   - `SITE_PASSWORD`: a private site-wide password
   - `SESSION_SECRET`: a long random secret
   - `DB_PATH`: `/var/data/chat.sqlite` if you attach a persistent disk at `/var/data`
5. For persistent user accounts on Render, attach a persistent disk and mount it at `/var/data`. The disk may not be included in Render's free tier; without persistent storage, account records may be lost when the service restarts or redeploys.

## Important behavior
- The 10-person limit is **10 total registered accounts**, not just 10 simultaneous connections.
- Only one shared room is included in this version.
- Messages are kept in server memory and are automatically removed after 60 minutes. They are also removed on server restart.
- The one-hour expiration is enforced on the server, not only in the browser.
- This starter uses Express's in-memory session store. For a larger production deployment, replace it with a persistent session store.
