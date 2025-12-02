"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-white shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <span className="text-2xl font-bold text-pink-600">
              BMS Pro Pink
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className={`text-gray-700 hover:text-pink-600 font-medium transition-colors ${
                pathname === "/" ? "text-pink-600" : ""
              }`}
            >
              Home
            </Link>

            <Link
              href="/book"
              className={`text-gray-700 hover:text-pink-600 font-medium transition-colors ${
                pathname === "/book" ? "text-pink-600" : ""
              }`}
            >
              Book Now
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

