import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/system/theme-provider";
import { ToastProvider } from "@/components/system/toast";

export const metadata: Metadata = {
  title: {
    default: "VANTYX® — Universal Business Operating System",
    template: "%s · VANTYX®",
  },
  description:
    "VANTYX® — One platform. Every business. Built to operate. POS, operações, inventário, CRM, compras, finanças e módulos verticais.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#101114" },
    { media: "(prefers-color-scheme: light)", color: "#F7F8FA" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
