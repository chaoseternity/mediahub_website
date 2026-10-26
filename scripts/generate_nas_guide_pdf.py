import os
import subprocess
from pathlib import Path

HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MediaHub - Synology NAS Database Migration Guide</title>
<style>
  @page {
    size: A4;
    margin: 14mm 14mm 14mm 14mm;
  }
  @page :left {
    @bottom-left { content: "MediaHub - Synology NAS Migration Guide"; }
    @bottom-right { content: counter(page); }
  }
  @page :right {
    @bottom-left { content: "MediaHub - Synology NAS Migration Guide"; }
    @bottom-right { content: counter(page); }
  }

  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.55;
    font-size: 10pt;
    margin: 0;
    padding: 0;
  }

  /* Cover / Title Header */
  .header-card {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
    color: #ffffff;
    padding: 24px 28px;
    border-radius: 12px;
    margin-bottom: 22px;
  }
  .header-badge {
    display: inline-block;
    background: rgba(59, 130, 246, 0.3);
    border: 1px solid rgba(147, 197, 253, 0.4);
    color: #bfdbfe;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 8.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 20pt;
    font-weight: 800;
    margin: 4px 0 8px 0;
    color: #ffffff;
    letter-spacing: -0.5px;
  }
  .header-desc {
    font-size: 10pt;
    color: #cbd5e1;
    margin: 0;
    max-width: 90%;
  }
  .header-meta {
    display: flex;
    gap: 16px;
    margin-top: 14px;
    font-size: 8.5pt;
    color: #94a3b8;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    padding-top: 10px;
  }
  .header-meta span strong {
    color: #e2e8f0;
  }

  /* Headings */
  h2 {
    font-size: 13pt;
    color: #0f172a;
    border-bottom: 1.5px solid #e2e8f0;
    padding-bottom: 5px;
    margin-top: 22px;
    margin-bottom: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h3 {
    font-size: 10.5pt;
    color: #1e293b;
    margin-top: 14px;
    margin-bottom: 6px;
    font-weight: 600;
  }

  /* Step Cards */
  .step-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 16px;
    page-break-inside: avoid;
  }
  .step-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .step-num {
    background: #2563eb;
    color: #ffffff;
    font-weight: 700;
    font-size: 9pt;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .step-title {
    font-size: 11pt;
    font-weight: 700;
    color: #0f172a;
    margin: 0;
  }

  /* Code Blocks */
  pre {
    background: #0f172a;
    color: #f1f5f9;
    padding: 10px 14px;
    border-radius: 6px;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 8.5pt;
    line-height: 1.45;
    overflow-x: auto;
    margin: 8px 0;
    border: 1px solid #1e293b;
    page-break-inside: avoid;
  }
  code {
    font-family: "Consolas", "Courier New", monospace;
    background: #f1f5f9;
    color: #0f172a;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 8.5pt;
    border: 1px solid #e2e8f0;
  }
  pre code {
    background: transparent;
    color: inherit;
    padding: 0;
    border: none;
  }
  .code-comment {
    color: #64748b;
  }
  .code-keyword {
    color: #38bdf8;
    font-weight: 600;
  }
  .code-string {
    color: #4ade80;
  }

  /* Callout Boxes */
  .callout {
    padding: 10px 14px;
    border-radius: 6px;
    margin: 10px 0;
    font-size: 9pt;
    page-break-inside: avoid;
  }
  .callout-info {
    background: #eff6ff;
    border-left: 4px solid #3b82f6;
    color: #1e40af;
  }
  .callout-tip {
    background: #f0fdf4;
    border-left: 4px solid #22c55e;
    color: #166534;
  }
  .callout-warning {
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    color: #92400e;
  }
  .callout strong {
    display: inline-block;
    margin-bottom: 2px;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 8.5pt;
    page-break-inside: avoid;
  }
  th {
    background: #f1f5f9;
    color: #0f172a;
    font-weight: 700;
    text-align: left;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
  }
  td {
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    color: #334155;
  }
  tr:nth-child(even) td {
    background: #f8fafc;
  }

  /* Lists */
  ol, ul {
    margin: 6px 0 10px 20px;
    padding: 0;
  }
  li {
    margin-bottom: 4px;
  }

  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 7.5pt;
    font-weight: 600;
  }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-purple { background: #f3e8ff; color: #6b21a8; }

  .page-break {
    page-break-before: always;
  }
</style>
</head>
<body>

  <!-- COVER HEADER -->
  <div class="header-card">
    <div class="header-badge">Operations & Infrastructure Guide</div>
    <h1>MediaHub: Synology NAS Database Migration</h1>
    <p class="header-desc">
      A complete, step-by-step production handbook for consolidating MediaHub's Cloudflare and Vercel deployments onto a unified, self-hosted PostgreSQL database on a Synology NAS.
    </p>
    <div class="header-meta">
      <span><strong>Domain:</strong> nushmedia.app</span>
      <span><strong>Target Engine:</strong> PostgreSQL 16 (Docker)</span>
      <span><strong>Network Security:</strong> Cloudflare Zero Trust Tunnel</span>
      <span><strong>Target NAS:</strong> Synology DSM 7.2+</span>
    </div>
  </div>

  <!-- ARCHITECTURE SUMMARY -->
  <h2>1. Architecture Overview</h2>
  <p>
    Currently, MediaHub runs across two deployments: the production site on Cloudflare Workers (<code>nushmedia.app</code>, using D1 SQLite) and a preview/staging environment on Vercel (using Neon PostgreSQL). 
  </p>
  <p>
    By moving to a <strong>Synology NAS</strong>, both deployments (plus any local laptop kiosks) connect to a <strong>single, centralized PostgreSQL database</strong> running on your school/club hardware.
  </p>

  <table>
    <thead>
      <tr>
        <th>Component</th>
        <th>Before Migration</th>
        <th>After Migration (Synology NAS)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Database Engine</strong></td>
        <td>Cloudflare D1 (SQLite) + Neon PostgreSQL</td>
        <td><span class="badge badge-green">PostgreSQL 16 (Unified)</span></td>
      </tr>
      <tr>
        <td><strong>Storage & Ownership</strong></td>
        <td>Cloud-hosted, isolated data silos</td>
        <td><span class="badge badge-blue">Local NAS RAID Pool (Encrypted & Backed Up)</span></td>
      </tr>
      <tr>
        <td><strong>Public Domain</strong></td>
        <td><code>nushmedia.app</code> on Cloudflare Workers</td>
        <td><code>nushmedia.app</code> pointing to Synology via Cloudflare Tunnel</td>
      </tr>
      <tr>
        <td><strong>School Firewall</strong></td>
        <td>N/A (Hosted in Cloud)</td>
        <td><span class="badge badge-purple">Zero Open Ports Needed (Outbound Tunnel)</span></td>
      </tr>
      <tr>
        <td><strong>Database Latency</strong></td>
        <td>30-80ms cloud round-trip</td>
        <td><strong>&lt; 1ms</strong> for local kiosks; fast edge cached for web</td>
      </tr>
    </tbody>
  </table>

  <div class="callout callout-info">
    <strong>Key Security Concept:</strong> Your school NAS sits behind an internal firewall with a private IP (e.g. <code>192.168.1.x</code>). School IT will never permit opening public database ports. We solve this using <strong>Cloudflare Tunnel (cloudflared)</strong>, which establishes an encrypted <em>outbound-only</em> connection from the NAS to Cloudflare, requiring <strong>zero open router ports</strong>.
  </div>

  <!-- PREREQUISITES -->
  <h2>2. Prerequisites & Requirements</h2>
  <ul>
    <li><strong>Synology NAS:</strong> Running DSM 7.2 or later with <strong>Container Manager</strong> installed from the Package Center.</li>
    <li><strong>Cloudflare Zero Trust Account:</strong> Free tier, associated with your active domain <code>nushmedia.app</code>.</li>
    <li><strong>Storage Space:</strong> At least 2 GB free on your primary storage pool (e.g. <code>/volume1</code>).</li>
    <li><strong>Access Rights:</strong> Synology DSM administrator account and Cloudflare dashboard access.</li>
  </ul>

  <!-- STEP BY STEP -->
  <div class="page-break"></div>
  <h2>3. Step-by-Step Implementation</h2>

  <!-- STEP 1 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">1</div>
      <div class="step-title">Prepare NAS Shared Folder for Persistent Storage</div>
    </div>
    <p>To ensure database records, audit sessions, and user profiles survive container restarts and DSM upgrades, database files must be stored directly on the NAS storage pool.</p>
    <ol>
      <li>Log in to Synology DSM web portal (<code>http://&lt;NAS_IP&gt;:5000</code>).</li>
      <li>Open <strong>File Station</strong>.</li>
      <li>Under the <strong>docker</strong> shared folder (created when Container Manager was installed), create the following folder hierarchy:
        <br><code>/volume1/docker/mediahub/pgdata</code>
      </li>
      <li>Right-click the <code>mediahub</code> folder &gt; <strong>Properties</strong> &gt; <strong>Permissions</strong> &gt; verify your admin account has full Read & Write privileges.</li>
    </ol>
  </div>

  <!-- STEP 2 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">2</div>
      <div class="step-title">Deploy PostgreSQL 16 via Container Manager</div>
    </div>
    <p>Use Synology's built-in Docker Compose engine (Projects) to run PostgreSQL with optimized health checks and automatic restarts.</p>
    <ol>
      <li>Open <strong>Container Manager</strong> on your Synology NAS.</li>
      <li>Click <strong>Project</strong> in the left sidebar, then click <strong>Create</strong>.</li>
      <li>Enter Project Name: <code>mediahub</code>.</li>
      <li>Path: Click Browse and select <code>/docker/mediahub</code>.</li>
      <li>Source: Select <strong>Create docker-compose.yml</strong>, and paste the configuration below:</li>
    </ol>

<pre><code><span class="code-keyword">version:</span> <span class="code-string">"3.8"</span>

<span class="code-keyword">services:</span>
  <span class="code-keyword">mediahub-db:</span>
    <span class="code-keyword">image:</span> postgres:16-alpine
    <span class="code-keyword">container_name:</span> mediahub-postgres
    <span class="code-keyword">restart:</span> always
    <span class="code-keyword">environment:</span>
      <span class="code-keyword">POSTGRES_DB:</span> mediahub_db
      <span class="code-keyword">POSTGRES_USER:</span> mediahub_user
      <span class="code-keyword">POSTGRES_PASSWORD:</span> <span class="code-string">"ChangeMeToAStrongPassword123!"</span> <span class="code-comment"># &lt;-- Set your password</span>
      <span class="code-keyword">PGDATA:</span> /var/lib/postgresql/data/pgdata
    <span class="code-keyword">ports:</span>
      - <span class="code-string">"5432:5432"</span>
    <span class="code-keyword">volumes:</span>
      - /volume1/docker/mediahub/pgdata:/var/lib/postgresql/data/pgdata
    <span class="code-keyword">healthcheck:</span>
      <span class="code-keyword">test:</span> [<span class="code-string">"CMD-SHELL"</span>, <span class="code-string">"pg_isready -U mediahub_user -d mediahub_db"</span>]
      <span class="code-keyword">interval:</span> 10s
      <span class="code-keyword">timeout:</span> 5s
      <span class="code-keyword">retries:</span> 5</code></pre>

    <ol start="6">
      <li>Click <strong>Next</strong> &gt; verify the summary &gt; check <strong>Build image and start project</strong> &gt; click <strong>Done</strong>.</li>
      <li>Container Manager will pull <code>postgres:16-alpine</code> and start the database. Verify that the status indicator turns green (<strong>Healthy</strong>).</li>
    </ol>
  </div>

  <!-- STEP 3 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">3</div>
      <div class="step-title">Configure Cloudflare Zero Trust Tunnel on the NAS</div>
    </div>
    <p>This allows Cloudflare Workers and Vercel in the cloud to communicate with the NAS PostgreSQL instance securely over the web without requiring port forwarding.</p>
    
    <h3>Part A: Generate Tunnel in Cloudflare</h3>
    <ol>
      <li>Visit the <a href="https://one.dash.cloudflare.com/">Cloudflare Zero Trust Dashboard</a>.</li>
      <li>Go to <strong>Networks</strong> &gt; <strong>Tunnels</strong> &gt; Click <strong>Create a tunnel</strong>.</li>
      <li>Select <strong>Cloudflared</strong>, name it <code>synology-mediahub</code>, and click <strong>Save tunnel</strong>.</li>
      <li>Under <strong>Choose your environment</strong>, select <strong>Docker</strong>. Cloudflare will display a command with a tunnel token:
        <br><code>--token eyJhIjoi...</code> (copy this token).
      </li>
    </ol>

    <h3>Part B: Add Tunnel to Synology Container Manager</h3>
    <ol>
      <li>In DSM Container Manager, go to <strong>Project</strong> &gt; click <code>mediahub</code> &gt; <strong>Action</strong> &gt; <strong>Stop</strong>.</li>
      <li>Click <strong>YAML Configurations</strong> and add the <code>cloudflared</code> service right below PostgreSQL:</li>
    </ol>

<pre><code>  <span class="code-keyword">cloudflared:</span>
    <span class="code-keyword">image:</span> cloudflare/cloudflared:latest
    <span class="code-keyword">container_name:</span> mediahub-tunnel
    <span class="code-keyword">restart:</span> always
    <span class="code-keyword">command:</span> tunnel run --token <span class="code-string">"YOUR_CLOUDFLARE_TUNNEL_TOKEN_HERE"</span>
    <span class="code-keyword">depends_on:</span>
      - mediahub-db</code></pre>

    <ol start="3">
      <li>Click <strong>Save</strong> and restart the project. Cloudflare Dashboard will now show the tunnel status as <strong>HEALTHY</strong>.</li>
    </ol>

    <h3>Part C: Route Public Hostname to PostgreSQL</h3>
    <ol>
      <li>In Cloudflare Zero Trust &gt; Tunnels &gt; edit <code>synology-mediahub</code> &gt; <strong>Public Hostnames</strong> &gt; <strong>Add a public hostname</strong>.</li>
      <li>Set <strong>Subdomain:</strong> <code>db</code> | <strong>Domain:</strong> <code>nushmedia.app</code>.</li>
      <li>Set <strong>Service:</strong> Type = <code>TCP</code> | URL = <code>mediahub-db:5432</code>. Click <strong>Save Hostname</strong>.</li>
    </ol>
  </div>

  <div class="page-break"></div>

  <!-- STEP 4 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">4</div>
      <div class="step-title">Export Existing Data from Cloudflare / Vercel</div>
    </div>
    <p>Choose the method depending on where your current data resides:</p>

    <h3>Method A: Exporting from Vercel / Neon PostgreSQL</h3>
    <p>Run from PowerShell or terminal on your laptop:</p>
<pre><code>pg_dump -d "postgres://USER:PASSWORD@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  --data-only \
  --exclude-table=_vercel* \
  -f mediahub_data_backup.sql</code></pre>

    <h3>Method B: Exporting from Cloudflare D1 (Production)</h3>
    <p>Run using Wrangler CLI in your project directory:</p>
<pre><code>npx wrangler d1 export inventory-tracker-db --remote --output=./d1_backup.sql</code></pre>
    <div class="callout callout-tip">
      <strong>Fast Alternative:</strong> You can also log into <code>https://nushmedia.app</code>, go to <strong>Dashboard &gt; Equipment</strong>, and click <strong>Export to Excel (.xlsx)</strong> to get an instant, full spreadsheet of all inventory tags and serial numbers.
    </div>
  </div>

  <!-- STEP 5 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">5</div>
      <div class="step-title">Import Data into the Synology PostgreSQL Database</div>
    </div>
    <p>Connect to the NAS database from your workstation and import the dump file:</p>
<pre><code>psql -h &lt;NAS_LOCAL_IP&gt; -p 5432 -U mediahub_user -d mediahub_db -f mediahub_data_backup.sql</code></pre>
    <div class="callout callout-info">
      <strong>Automatic Schema Bootstrap:</strong> MediaHub includes an auto-migrating schema engine in <code>lib/d1.ts</code> (<code>ensurePostgresSchema</code>). As soon as MediaHub connects, it will automatically create all required tables (<code>equipment</code>, <code>checkouts</code>, <code>nfc_cards</code>, <code>events</code>, <code>sop_documents</code>, <code>storage_map_layout</code>) and apply missing columns or indexes if they don't already exist.
    </div>
  </div>

  <!-- STEP 6 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">6</div>
      <div class="step-title">Connect Cloudflare and Vercel to the Synology Database</div>
    </div>
    <p>Now configure the connection string across your cloud dashboards:</p>

    <h3>Connection String Format:</h3>
<pre><code>POSTGRES_URL="postgresql://mediahub_user:YourStrongPasswordHere@db.nushmedia.app:5432/mediahub_db?sslmode=prefer"</code></pre>

    <ol>
      <li><strong>On Vercel (vercel branch):</strong>
        <ul>
          <li>Go to <strong>Vercel Dashboard</strong> &gt; your project &gt; <strong>Settings</strong> &gt; <strong>Environment Variables</strong>.</li>
          <li>Update <code>POSTGRES_URL</code> and <code>DATABASE_URL</code> to the connection string above.</li>
          <li>Click <strong>Deployments</strong> &gt; <strong>Redeploy</strong> to apply.</li>
        </ul>
      </li>
      <li><strong>On Cloudflare Workers (main branch):</strong>
        <ul>
          <li>Go to <strong>Cloudflare Dashboard</strong> &gt; <strong>Workers & Pages</strong> &gt; <code>mediahub-website</code>.</li>
          <li>Click <strong>Settings</strong> &gt; <strong>Variables and Secrets</strong>.</li>
          <li>Add / Update <code>POSTGRES_URL</code> with the connection string.</li>
        </ul>
      </li>
      <li><strong>On Local Development / NFC Kiosk Laptops:</strong>
        <ul>
          <li>In your local <code>.env.local</code>, set:
            <br><code>POSTGRES_URL="postgresql://mediahub_user:YourStrongPasswordHere@&lt;NAS_LOCAL_IP&gt;:5432/mediahub_db?sslmode=disable"</code>
          </li>
          <li>Local kiosks talk directly to the NAS at <strong>&lt; 1ms speed</strong> over local WiFi!</li>
        </ul>
      </li>
    </ol>
  </div>

  <!-- STEP 7 -->
  <div class="step-card">
    <div class="step-header">
      <div class="step-num">7</div>
      <div class="step-title">Verification Checklist</div>
    </div>
    <ul>
      <li>[ ] <strong>Database Online:</strong> Container Manager shows <code>mediahub-postgres</code> is healthy.</li>
      <li>[ ] <strong>Tunnel Active:</strong> Cloudflare Zero Trust shows <code>synology-mediahub</code> is active and sending heartbeats.</li>
      <li>[ ] <strong>Live Checkouts:</strong> Open <code>https://nushmedia.app/dashboard/checkout</code>, perform a test checkout, and verify the checkout record immediately appears in the database.</li>
      <li>[ ] <strong>SOP Assistant:</strong> Test <code>/dashboard/sop</code> to ensure documents load and the Gemini AI responds.</li>
      <li>[ ] <strong>NFC Station:</strong> Test the kiosk scanning feature to ensure instant response.</li>
    </ul>
  </div>

  <!-- BONUS SECTION -->
  <div class="page-break"></div>
  <h2>4. Recommended Ultimate Setup: Host the Web App on the NAS Too!</h2>
  <p>
    Since your Synology NAS is already running Docker, you can achieve maximum performance by <strong>running both the Next.js web application container and PostgreSQL together on the NAS</strong>.
  </p>

  <div class="callout callout-tip">
    <strong>Why this is the gold standard for school media clubs:</strong>
    <ul>
      <li><strong>0ms Database Latency:</strong> App and database communicate over <code>localhost</code>.</li>
      <li><strong>Zero Cloud Subscription Limits:</strong> No Vercel Pro fees ($20/mo/user), no Neon compute pauses.</li>
      <li><strong>Offline Survival:</strong> If the school's external internet connection drops during an auditorium event, members on local school WiFi can still load <code>http://&lt;NAS_IP&gt;:3000</code> to check out gear!</li>
      <li><strong>Cloud Access:</strong> The Cloudflare Tunnel routes <code>https://nushmedia.app</code> directly into port <code>3000</code> of the web container with free SSL and DDoS protection.</li>
    </ul>
  </div>

  <h3>All-in-One <code>docker-compose.yml</code> for Synology NAS:</h3>
<pre><code><span class="code-keyword">version:</span> <span class="code-string">"3.8"</span>

<span class="code-keyword">services:</span>
  <span class="code-comment"># 1. PostgreSQL Database</span>
  <span class="code-keyword">mediahub-db:</span>
    <span class="code-keyword">image:</span> postgres:16-alpine
    <span class="code-keyword">container_name:</span> mediahub-postgres
    <span class="code-keyword">restart:</span> always
    <span class="code-keyword">environment:</span>
      <span class="code-keyword">POSTGRES_DB:</span> mediahub_db
      <span class="code-keyword">POSTGRES_USER:</span> mediahub_user
      <span class="code-keyword">POSTGRES_PASSWORD:</span> <span class="code-string">"YourStrongPassword"</span>
      <span class="code-keyword">PGDATA:</span> /var/lib/postgresql/data/pgdata
    <span class="code-keyword">volumes:</span>
      - /volume1/docker/mediahub/pgdata:/var/lib/postgresql/data/pgdata

  <span class="code-comment"># 2. MediaHub Next.js Application Container</span>
  <span class="code-keyword">mediahub-web:</span>
    <span class="code-keyword">image:</span> chaoseternity/mediahub:latest
    <span class="code-keyword">container_name:</span> mediahub-web
    <span class="code-keyword">restart:</span> always
    <span class="code-keyword">environment:</span>
      <span class="code-keyword">POSTGRES_URL:</span> <span class="code-string">"postgresql://mediahub_user:YourStrongPassword@mediahub-db:5432/mediahub_db"</span>
      <span class="code-keyword">AUTH_URL:</span> <span class="code-string">"https://nushmedia.app"</span>
      <span class="code-keyword">AUTH_SECRET:</span> <span class="code-string">"your-random-32-char-secret"</span>
      <span class="code-keyword">GOOGLE_CLIENT_ID:</span> <span class="code-string">"your-google-client-id"</span>
      <span class="code-keyword">GOOGLE_CLIENT_SECRET:</span> <span class="code-string">"your-google-client-secret"</span>
      <span class="code-keyword">AZURE_AD_CLIENT_ID:</span> <span class="code-string">"your-azure-client-id"</span>
      <span class="code-keyword">AZURE_AD_CLIENT_SECRET:</span> <span class="code-string">"your-azure-client-secret"</span>
    <span class="code-keyword">ports:</span>
      - <span class="code-string">"3000:3000"</span>
    <span class="code-keyword">depends_on:</span>
      - mediahub-db

  <span class="code-comment"># 3. Cloudflare Tunnel (Exposes nushmedia.app securely to port 3000)</span>
  <span class="code-keyword">cloudflared:</span>
    <span class="code-keyword">image:</span> cloudflare/cloudflared:latest
    <span class="code-keyword">container_name:</span> mediahub-tunnel
    <span class="code-keyword">restart:</span> always
    <span class="code-keyword">command:</span> tunnel run --token <span class="code-string">"YOUR_CLOUDFLARE_TUNNEL_TOKEN"</span>
    <span class="code-keyword">depends_on:</span>
      - mediahub-web</code></pre>

  <div class="callout callout-warning">
    <strong>Disaster Recovery &amp; Backups:</strong> Because your database is stored in <code>/volume1/docker/mediahub/pgdata</code>, you can use Synology's built-in <strong>Hyper Backup</strong> or <strong>Snapshot Replication</strong> to take daily automated snapshots to a secondary drive, external USB, or Synology C2 Cloud. If anything ever corrupts, you can roll back your entire club inventory with 1 click!
  </div>

  <p style="text-align: center; color: #94a3b8; font-size: 8pt; margin-top: 30px;">
    Document generated for MediaHub Operations &bull; Domain: nushmedia.app &bull; NUS High School Media Club
  </p>

</body>
</html>
"""

def generate_pdf():
    downloads_dir = Path("C:/Users/ZHANGBOHAN/Downloads")
    repo_dir = Path("C:/GitHub Code/mediahub_website")
    
    html_temp_file = downloads_dir / "mediahub_synology_guide_temp.html"
    downloads_pdf = downloads_dir / "MediaHub_Synology_NAS_Database_Migration_Guide.pdf"
    repo_pdf = repo_dir / "MediaHub_Synology_NAS_Database_Migration_Guide.pdf"

    print("Writing HTML source...")
    with open(html_temp_file, "w", encoding="utf-8") as f:
        f.write(HTML_CONTENT)

    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "msedge.exe"
    ]
    edge_executable = next((p for p in edge_paths if os.path.exists(p)), "msedge.exe")

    print(f"Rendering PDF via {edge_executable}...")
    edge_cmd = [
        edge_executable,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={downloads_pdf}",
        str(html_temp_file)
    ]
    
    res = subprocess.run(edge_cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error running Edge: {res.stderr}")
        return False

    if downloads_pdf.exists():
        print(f"[OK] Successfully created: {downloads_pdf} ({downloads_pdf.stat().st_size} bytes)")
        
        # Also copy to repo directory
        import shutil
        shutil.copy2(downloads_pdf, repo_pdf)
        print(f"[OK] Copied copy to: {repo_pdf}")
        
        # Clean up temporary HTML
        try:
            os.remove(html_temp_file)
        except Exception:
            pass
        return True
    else:
        print("[FAIL] PDF was not created.")
        return False

if __name__ == "__main__":
    generate_pdf()
