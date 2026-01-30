import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

// Firebase configuration (prefer env; fallback to production values)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyD08qXcZjC1N_wX8EE5YGgN4sA-ZrJQICg",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "bmspro-pink.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "bmspro-pink",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "bmspro-pink.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "960634304944",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:960634304944:web:9c9cb29b14b13924b73e75",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-M4XJKLN1Y2",
};

// Initialize (guarded for Next.js hot reload)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Stabilize Firestore in Next.js dev (Turbopack/HMR) and varied network environments
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

// Initialize Analytics (client-side only, with browser check)
// Analytics is optional and only works in browser environment
let analytics: any = null;
if (typeof window !== "undefined") {
  import("firebase/analytics")
    .then(({ getAnalytics, isSupported }) => {
      return isSupported().then((supported) => {
        if (supported) {
          analytics = getAnalytics(app);
        }
      });
    })
    .catch(() => {
      // Analytics not available or failed to load - this is fine
    });
}

export { app, auth, db, analytics };

