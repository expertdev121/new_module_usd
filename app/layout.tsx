import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { LayoutWrapper } from "./layout-wrapper";

export const metadata: Metadata = {
  title: "Donor HQ",
  description: "Comprehensive donation and contact management system for efficient fundraising and donor relations.",
  icons: {
    icon: "https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Inter — purpose-built for UI / dashboards. Loaded directly from
            Google Fonts CDN so we sidestep any next/font edge cases. preconnect
            warms the connection before the stylesheet request fires. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <Providers>
          <LayoutWrapper>{children}</LayoutWrapper>
        </Providers>
      </body>
    </html>
  );
}
