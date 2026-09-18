# MediaHub: Hosting Database on a NAS (Network Attached Storage)

**Yes, absolutely!** You can host the database directly on a **NAS (Network Attached Storage)**.

MediaHub uses standard **PostgreSQL** syntax and schemas. Any PostgreSQL instance running on a NAS (Synology, QNAP, TrueNAS, Unraid, etc.) will work seamlessly.

---

## Why a NAS is a Great Choice (Especially with Offline Mode)

With the **offline-first engine**:
- **On-Site**: When the laptop is connected to your club’s local WiFi / LAN, it communicates directly with the NAS at high speed with low latency.
- **Off-Site or WiFi Outage**: If the WiFi cuts out, or if you take the laptop on location for an event away from the NAS, the laptop **saves all checkouts and scans locally** in encrypted device storage.
- **Auto-Sync on Reconnect**: As soon as the laptop returns to the studio/club room and reconnects to the network, all queued checkouts and returns automatically sync to the NAS database in chronological order.

---

## Step-by-Step Guide to Transferring to a NAS

### 1. Run PostgreSQL on Your NAS
Almost all modern NAS systems (**Synology DSM Container Manager**, **QNAP Container Station**, **TrueNAS SCALE**, **Unraid**) support Docker.

You can spin up a PostgreSQL instance using **Docker Compose** or your NAS Container GUI:

```yaml
version: "3.8"

services:
  mediahub-db:
    image: postgres:16-alpine
    container_name: mediahub-postgres
    restart: always
    environment:
      POSTGRES_DB: mediahub_db
      POSTGRES_USER: mediahub_user
      POSTGRES_PASSWORD: YourSecurePasswordHere
    ports:
      - "5432:5432"
    volumes:
      # Store database data permanently on your NAS RAID storage pool:
      - /volume1/docker/mediahub/pgdata:/var/lib/postgresql/data
```

---

### 2. Connect MediaHub to Your NAS Database
In your MediaHub project’s `.env.local` (or server deployment environment), set the PostgreSQL connection string pointing to your NAS IP address:

```env
# Replace 192.168.1.100 with your NAS's local IP address or local hostname:
POSTGRES_URL="postgresql://mediahub_user:YourSecurePasswordHere@192.168.1.100:5432/mediahub_db?sslmode=disable"
```

MediaHub’s built-in `ensureSchema()` will automatically create all tables (`equipment`, `checkouts`, `nfc_cards`, `users`, `events`, `sop_documents`) the first time the app starts.

---

### 3. Migrating Existing Data (If Any)
If you already have existing data on a cloud database that you want to move over:
1. **Export existing data**:
   ```bash
   pg_dump -d "YOUR_OLD_POSTGRES_URL" --data-only --exclude-table=_vercel* > mediahub_backup.sql
   ```
2. **Import into your NAS database**:
   ```bash
   psql -h 192.168.1.100 -U mediahub_user -d mediahub_db < mediahub_backup.sql
   ```
3. Alternatively, you can use the Excel import feature in the MediaHub dashboard to bulk upload equipment to the new database.

---

### 4. Remote / Off-Site Access to the NAS (Optional)
If you want the web app to connect to the NAS even when away from the club room:
- **Tailscale (Recommended)**: Install the free Tailscale package on your NAS and the host machine. You get a secure, encrypted private IP (e.g. `100.x.x.x`) with zero port forwarding or router configuration required.
- **Cloudflare Tunnels**: Free and secure way to expose the service to an internal domain without opening router ports.
- **VPN**: WireGuard / OpenVPN server built into the NAS.
