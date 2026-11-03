import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SpanishValidation } from "@/components/spanish-validation";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Viajes",
  description: "CRM para agencias de viajes",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-slate-50 font-sans text-slate-900 antialiased">
        <SpanishValidation />
        {children}
      </body>
    </html>
  );
}
