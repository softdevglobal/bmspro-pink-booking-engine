"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const DEFAULT_OWNER_UID = process.env.NEXT_PUBLIC_DEFAULT_OWNER_UID || "";
  const ownerUid = searchParams.get("ownerUid") || DEFAULT_OWNER_UID;

  useEffect(() => {
    // If ownerUid is provided via query param (legacy link), redirect to /book
    if (ownerUid) {
      router.push(`/book${ownerUid !== DEFAULT_OWNER_UID ? `?ownerUid=${ownerUid}` : ''}`);
    }
    // Otherwise, the landing page below is shown
  }, [router, ownerUid, DEFAULT_OWNER_UID]);

  // If ownerUid is set, show loading spinner while redirecting
  if (ownerUid) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-slate-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  // No ownerUid — show a branded landing page
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="text-5xl mb-4">💇✨</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">BMS Pro Pink</h1>
        <p className="text-lg text-gray-600 mb-6">
          Online Booking Platform
        </p>
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500">
          <p>
            If you received a booking link from your salon, please use
            that direct link to book your appointment.
          </p>
          <p className="mt-2 text-xs text-gray-400">
            Example: pink.bmspros.com.au/book-now/<span className="font-mono text-pink-500">your-salon</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-pink-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
