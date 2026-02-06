import Link from "next/link";

/**
 * Custom 404 page for when a salon slug is not found.
 */
export default function SalonNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="text-6xl mb-4">💇</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Salon Not Found
        </h1>
        <p className="text-gray-600 mb-6">
          Sorry, we couldn&apos;t find the salon you&apos;re looking for. The
          link may be incorrect or the salon may no longer be available.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold rounded-lg hover:from-pink-600 hover:to-purple-600 transition-all shadow-md"
        >
          Go to Homepage
        </Link>
      </div>
    </div>
  );
}
