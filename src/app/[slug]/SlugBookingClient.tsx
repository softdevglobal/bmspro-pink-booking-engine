"use client";

import { Suspense } from "react";
import { BookPageContent } from "@/app/book/page";

interface SlugBookingClientProps {
  ownerUid: string;
  salonName: string;
  salonColors?: {
    primary?: string;
    secondary?: string;
  };
}

/**
 * Client wrapper for the slug-based booking page.
 *
 * Receives the resolved ownerUid from the server component
 * and passes it to the shared BookPageContent component.
 *
 * Also injects salon-specific CSS variables for theme customisation.
 */
export default function SlugBookingClient({
  ownerUid,
  salonName,
  salonColors,
}: SlugBookingClientProps) {
  return (
    <>
      {/* Inject salon-specific CSS variables for theming */}
      {salonColors && (
        <style>{`
          :root {
            ${salonColors.primary ? `--salon-primary: ${salonColors.primary};` : ""}
            ${salonColors.secondary ? `--salon-secondary: ${salonColors.secondary};` : ""}
          }
        `}</style>
      )}

      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
            <div className="text-center">
              <div className="animate-spin w-12 h-12 border-4 border-pink-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">Loading {salonName}...</p>
            </div>
          </div>
        }
      >
        <BookPageContent resolvedOwnerUid={ownerUid} />
      </Suspense>
    </>
  );
}
