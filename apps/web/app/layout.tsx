import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "../components/ui/toast";

export const metadata: Metadata = {
  title: "Databeat Prospecting",
  description: "AI-powered B2B prospecting workflow platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
