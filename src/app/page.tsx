"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function HomeContent() {
  const searchParams = useSearchParams();
  const DEFAULT_OWNER_UID = process.env.NEXT_PUBLIC_DEFAULT_OWNER_UID || "";
  const ownerUid = searchParams.get("ownerUid") || DEFAULT_OWNER_UID;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <Link
        href={`/book${ownerUid !== DEFAULT_OWNER_UID ? `?ownerUid=${ownerUid}` : ''}`}
        className="px-12 py-4 bg-slate-900 hover:bg-slate-800 text-white text-xl font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all"
      >
        Book Now
      </Link>
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
