import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: any = null;

export function getAdminApp() {
  if (adminApp) return adminApp;
  if (!getApps().length) {
    let serviceAccount: any | null = null;

    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    
    // Debug logging
    console.log("Firebase Admin Debug - Environment variables check:");
    console.log("- FIREBASE_SERVICE_ACCOUNT:", saJson ? "SET (length: " + saJson.length + ")" : "NOT SET");
    console.log("- FIREBASE_SERVICE_ACCOUNT_BASE64:", saB64 ? "SET" : "NOT SET");
    console.log("- FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID ? "SET" : "NOT SET");
    console.log("- FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL ? "SET" : "NOT SET");
    console.log("- FIREBASE_PRIVATE_KEY:", process.env.FIREBASE_PRIVATE_KEY ? "SET (length: " + process.env.FIREBASE_PRIVATE_KEY.length + ")" : "NOT SET");
    
    if (saJson) {
      try {
        serviceAccount = JSON.parse(saJson);
        console.log("✓ Using FIREBASE_SERVICE_ACCOUNT (JSON)");
      } catch (error) {
        console.error("✗ Failed to parse FIREBASE_SERVICE_ACCOUNT:", error);
        throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON format");
      }
    } else if (saB64) {
      try {
        const decoded = Buffer.from(saB64, "base64").toString("utf8");
        serviceAccount = JSON.parse(decoded);
        console.log("✓ Using FIREBASE_SERVICE_ACCOUNT_BASE64");
      } catch (error) {
        console.error("✗ Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:", error);
        throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_BASE64 format");
      }
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      serviceAccount = {
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      };
      console.log("✓ Using individual Firebase credentials");
    } else {
      // Try to use default project ID from client config
      const defaultProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "bmspro-pink";
      if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        serviceAccount = {
          project_id: defaultProjectId,
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        };
        console.log(`✓ Using Firebase credentials with default project ID: ${defaultProjectId}`);
      } else if (process.env.FIREBASE_PRIVATE_KEY) {
        // If we only have private key, try to extract email from it or use a default pattern
        // This is a fallback - ideally they should provide the email
        console.warn("⚠️  Only FIREBASE_PRIVATE_KEY found. Attempting to use default service account email pattern.");
        console.warn("⚠️  For best results, add FIREBASE_CLIENT_EMAIL to your .env file.");
        console.warn("⚠️  You can find it at: Firebase Console → Project Settings → Service Accounts");
        
        // Try common service account email pattern
        // This might not work if the email is different, but worth trying
        const defaultEmail = `firebase-adminsdk@${defaultProjectId}.iam.gserviceaccount.com`;
        serviceAccount = {
          project_id: defaultProjectId,
          client_email: defaultEmail,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        };
        console.log(`⚠️  Using default email pattern: ${defaultEmail}`);
        console.log("⚠️  If this doesn't work, please add the correct FIREBASE_CLIENT_EMAIL to your .env file");
      } else {
        console.error("\n=== Firebase Admin: Missing credentials ===");
        console.error("You need to provide Firebase Admin credentials.");
        console.error("\nOption 1 - Add individual credentials to .env:");
        console.error("FIREBASE_PROJECT_ID=bmspro-pink");
        console.error("FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@bmspro-pink.iam.gserviceaccount.com");
        console.error("FIREBASE_PRIVATE_KEY=\"-----BEGIN PRIVATE KEY-----\\n...\"");
        console.error("\nOption 2 - Use full service account JSON:");
        console.error("FIREBASE_SERVICE_ACCOUNT='{\"type\":\"service_account\",\"project_id\":\"bmspro-pink\",\"client_email\":\"...\",\"private_key\":\"...\",...}'");
        console.error("\nTo get your service account credentials:");
        console.error("1. Go to Firebase Console → Project Settings → Service Accounts");
        console.error("2. Click 'Generate New Private Key' to download JSON file");
        console.error("3. Extract client_email and private_key from the JSON");
        console.error("===========================================\n");
        throw new Error("Missing Firebase Admin credentials. Please add them to your .env file. See server logs for details.");
      }
    }

    if (serviceAccount) {
      try {
        adminApp = initializeApp({ credential: cert(serviceAccount) });
        console.log("✓ Firebase Admin initialized successfully");
      } catch (error) {
        console.error("✗ Failed to initialize Firebase Admin:", error);
        throw error;
      }
    }
  } else {
    adminApp = getApps()[0]!;
  }
  return adminApp!;
}

export const adminDb = () => {
  try {
    return getFirestore(getAdminApp());
  } catch (error) {
    console.error("Error getting Firestore:", error);
    throw error;
  }
};

export const adminAuth = () => {
  try {
    const { getAuth } = require("firebase-admin/auth");
    return getAuth(getAdminApp());
  } catch (error) {
    console.error("Error getting Auth:", error);
    throw error;
  }
};

