"use client";

import Link from "next/link";
import Navigation from "@/components/Navigation";

export default function Home() {
  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-800 mb-6">
            Welcome to <span className="text-pink-600">BMS Pro Pink</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Book your beauty appointments online with ease
          </p>
          
          <div className="max-w-md mx-auto">
            <Link
              href="/book"
              className="block bg-pink-600 hover:bg-pink-700 text-white font-bold py-8 px-12 rounded-2xl shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
            >
              <div className="text-5xl mb-4">📅</div>
              <div className="text-2xl mb-2">Book Now</div>
              <div className="text-sm opacity-90">Schedule your appointment and get notifications</div>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
