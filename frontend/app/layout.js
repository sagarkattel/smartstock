import { ThemeSync } from "@/components/layout/ThemeSync";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata = {
  title: process.env.NEXT_PUBLIC_APP_TITLE ?? "SmartStock",
  description: "Stock forecasts and new-site recommendations for A to Z Vending",
};

export default function RootLayout({
  children,
}) {
  return (
    // The theme is set on <html> by a script before the first paint, so the attribute differs from the server's.
    <html lang="en-AU" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
