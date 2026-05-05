const LOGO_URL =
  "https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png";

export function unauthorizedPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Access Denied – Donor HQ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: #f5f7f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #1a2e1a;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);
      max-width: 480px;
      width: 100%;
      padding: 48px 40px;
      text-align: center;
    }
    .logo {
      width: 64px;
      height: 64px;
      object-fit: contain;
      margin: 0 auto 28px;
      display: block;
    }
    .icon-wrap {
      width: 72px;
      height: 72px;
      background: #f0faf3;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon-wrap svg {
      width: 36px;
      height: 36px;
      color: #3a9c5f;
    }
    .badge {
      display: inline-block;
      background: #fef2f2;
      color: #b91c1c;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    p {
      font-size: 15px;
      color: #6b7280;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .divider {
      height: 1px;
      background: #f0f0f0;
      margin: 0 -40px 32px;
    }
    .btn {
      display: inline-block;
      background: #3a9c5f;
      color: #ffffff;
      font-family: 'Outfit', sans-serif;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 28px;
      border-radius: 8px;
      text-decoration: none;
      transition: background 0.15s;
    }
    .btn:hover { background: #2d7d4b; }
    .footer {
      margin-top: 32px;
      font-size: 12px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <img
      src="${LOGO_URL}"
      alt="Donor HQ"
      class="logo"
      onerror="this.style.display='none'"
    />
    <div class="icon-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    </div>
    <span class="badge">Access Denied</span>
    <h1>You are not authorized to see this contact details.</h1>
    <p>This contact belongs to a different location. Please contact your administrator if you believe this is a mistake.</p>
    <div class="divider"></div>
    <a href="/dashboard" class="btn">Go to Dashboard</a>
    <div class="footer">Donor HQ &nbsp;·&nbsp; Contact Management</div>
  </div>
</body>
</html>`;
}
