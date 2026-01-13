"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBooking, subscribeBookingsForOwnerAndDate } from "@/lib/bookings";
import { shouldBlockSlots } from "@/lib/bookingTypes";
import { auth, db } from "@/lib/firebase";
import { signInWithCustomToken, onAuthStateChanged, signOut } from "firebase/auth";
import { createCustomerDocument, incrementCustomerBookings } from "@/lib/customers";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import NotificationPanel from "@/components/NotificationPanel";
import { getCurrentDateTimeInTimezone } from "@/lib/timezone";

function BookPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const DEFAULT_OWNER_UID = process.env.NEXT_PUBLIC_DEFAULT_OWNER_UID || "";
  const ownerUid = searchParams.get("ownerUid") || DEFAULT_OWNER_UID;

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentCustomer, setCurrentCustomer] = useState<any>(null);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState<boolean>(false);
  const [pendingBookingConfirmation, setPendingBookingConfirmation] = useState<boolean>(false);
  const [pendingStep3Navigation, setPendingStep3Navigation] = useState<boolean>(false);
  
  // Auth form fields
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authFullName, setAuthFullName] = useState<string>("");
  const [authPhone, setAuthPhone] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  
  // Notification panel
  const [showNotificationPanel, setShowNotificationPanel] = useState<boolean>(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  
  // Profile modal
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [profileFullName, setProfileFullName] = useState<string>("");
  const [profilePhone, setProfilePhone] = useState<string>("");
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string>("");

  /**
   * Get the Firebase ID token for authenticated API requests
   */
  const getAuthToken = async (): Promise<string | null> => {
    try {
      const user = auth.currentUser;
      if (!user) {
        return null;
      }
      const token = await user.getIdToken();
      return token;
    } catch (error) {
      console.error("Error getting auth token:", error);
      return null;
    }
  };

  // Fetch unread notification count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!isAuthenticated || !currentCustomer) return;

      try {
        // Get auth token for secure API access
        const token = await getAuthToken();
        if (!token) {
          return;
        }

        const params = new URLSearchParams();
        params.set("limit", "50");

        const response = await fetch(`/api/notifications?${params.toString()}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        const data = await response.json();

        if (response.ok && Array.isArray(data.notifications)) {
          const unreadCount = data.notifications.filter((n: any) => !n.read).length;
          setUnreadNotificationCount(unreadCount);
        }
      } catch (err) {
        console.error("Error fetching unread count:", err);
      }
    };

    fetchUnreadCount();
    
    // Refresh count every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, currentCustomer]);

  // Booking wizard state - 3 steps
  const [bkStep, setBkStep] = useState<1 | 2 | 3>(1);
  const [bkBranchId, setBkBranchId] = useState<string | null>(null);
  const [bkSelectedServices, setBkSelectedServices] = useState<Array<number | string>>([]); // Multiple services
  const [bkServiceTimes, setBkServiceTimes] = useState<Record<string, string>>({}); // Time for each service
  const [bkServiceStaff, setBkServiceStaff] = useState<Record<string, string>>({}); // Staff for each service
  const [bkMonthYear, setBkMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [bkDate, setBkDate] = useState<Date | null>(null);
  const [bkNotes, setBkNotes] = useState<string>("");
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [bookingCode, setBookingCode] = useState<string>("");
  
  // Branch timezone time - refreshes every minute to keep time slots accurate
  const [branchCurrentTime, setBranchCurrentTime] = useState<{ date: string; time: string }>({ date: '', time: '' });

  // Terms and conditions
  const [agreedToTerms, setAgreedToTerms] = useState<boolean>(false);
  const [termsAndConditions, setTermsAndConditions] = useState<string>("");
  const [showTermsModal, setShowTermsModal] = useState<boolean>(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState<boolean>(false);

  // Real data from Firestore
  const [salonName, setSalonName] = useState<string>("Salon");
  const [salonAddress, setSalonAddress] = useState<string>("");
  const [salonPhone, setSalonPhone] = useState<string>("");
  const [salonAbn, setSalonAbn] = useState<string>("");
  const [salonLogo, setSalonLogo] = useState<string>("");
  const [branches, setBranches] = useState<Array<{ id: string; name: string; address?: string; hours?: any; timezone?: string }>>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string | number; name: string; price?: number; duration?: number; icon?: string; branches?: string[]; staffIds?: string[] }>>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role?: string; status?: string; avatar?: string; branchId?: string; branch?: string }>>([]);
  const [bookings, setBookings] = useState<Array<{ id: string; staffId?: string; date: string; time: string; duration: number; status: string; services?: Array<{ staffId?: string; time?: string; duration?: number }> }>>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Check authentication status
  useEffect(() => {
    if (!ownerUid) return; // Wait for ownerUid to be available
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Check if user is an admin
        try {
          const { doc, getDoc } = await import("firebase/firestore");
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            const userRole = (userData?.role || "").toString().toLowerCase();
            const adminRoles = ["salon_owner", "salon_branch_admin", "super_admin"];
            
            if (adminRoles.includes(userRole)) {
              await signOut(auth);
              setAuthError("This is the customer booking portal. Please use the admin panel to manage bookings.");
              setIsAuthenticated(false);
              setCurrentCustomer(null);
              setShowAuthModal(true);
              // Clear localStorage
              if (typeof window !== "undefined") {
                localStorage.removeItem("customerAuth");
              }
              return;
            }
          }
        } catch (error) {
          console.log("User not in admin users collection, proceeding as customer");
        }
        
        // Check if customer is registered for THIS specific salon
        // Structure: owners/{ownerUid}/customers/{customerUid}
        try {
          const { doc, getDoc } = await import("firebase/firestore");
          const customerRef = doc(db, "owners", ownerUid, "customers", user.uid);
          const customerSnap = await getDoc(customerRef);
          
          if (!customerSnap.exists()) {
            // User is authenticated in Firebase Auth but NOT registered for this salon
            await signOut(auth);
            setAuthError("You are not registered for this salon. Please create an account first.");
            setAuthMode("register");
            setIsAuthenticated(false);
            setCurrentCustomer(null);
            setShowAuthModal(true);
            // Clear localStorage
            if (typeof window !== "undefined") {
              localStorage.removeItem("customerAuth");
            }
            return;
          }
          
          // Customer is registered for this salon
          setIsAuthenticated(true);
          
          const customerData = {
            uid: user.uid,
            email: customerSnap.data().email || user.email || "",
            fullName: customerSnap.data().fullName || user.displayName || "",
            phone: customerSnap.data().phone || customerSnap.data().phoneNumber || "",
          };
          
          setCurrentCustomer(customerData);
          
          // Save to localStorage with salon context
          if (typeof window !== "undefined") {
            localStorage.setItem("customerAuth", JSON.stringify({
              ...customerData,
              ownerUid: ownerUid, // Store which salon this auth is for
            }));
          }
          
          setShowAuthModal(false);
        } catch (error: any) {
          console.error("Error checking salon customer:", error);
          // On error, sign out to be safe
          await signOut(auth);
          setIsAuthenticated(false);
          setCurrentCustomer(null);
          setShowAuthModal(true);
        }
      } else {
        setIsAuthenticated(false);
        setCurrentCustomer(null);
        // Don't show auth modal automatically - let users browse first
        // Auth modal will show when they try to confirm booking
        // Clear localStorage when not authenticated
        if (typeof window !== "undefined") {
          localStorage.removeItem("customerAuth");
        }
      }
    });

    return () => unsubscribe();
  }, [ownerUid]);

  // Refresh customer data from Firestore when authenticated to ensure phone number is loaded
  useEffect(() => {
    const refreshCustomerData = async () => {
      if (!isAuthenticated || !currentCustomer?.uid || !ownerUid) return;
      
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        // Use salon-specific customer collection: owners/{ownerUid}/customers/{uid}
        const customerRef = doc(db, "owners", ownerUid, "customers", currentCustomer.uid);
        const customerSnap = await getDoc(customerRef);
        
        if (customerSnap.exists()) {
          const customerData = customerSnap.data();
          // Update currentCustomer with latest data, especially phone number
          // Check for both 'phone' and 'phoneNumber' field names
          const phoneNumber = customerData.phone || customerData.phoneNumber || currentCustomer.phone || "";
          setCurrentCustomer({
            uid: currentCustomer.uid,
            email: customerData.email || currentCustomer.email || "",
            fullName: customerData.fullName || currentCustomer.fullName || "",
            phone: phoneNumber,
          });
        }
      } catch (error) {
        console.error("Error refreshing customer data:", error);
      }
    };

    refreshCustomerData();
  }, [isAuthenticated, currentCustomer?.uid]);

  // Load salon data
  useEffect(() => {
    if (!ownerUid) return;

    const loadData = async () => {
      try {
        // Load owner/salon name via API
        const ownerRes = await fetch(`/api/owner?ownerUid=${ownerUid}`);
        if (ownerRes.ok) {
          const ownerData = await ownerRes.json();
          setSalonName(ownerData.salonName || "Salon");
          setSalonAddress(ownerData.address || "");
          setSalonPhone(ownerData.phone || "");
          setSalonAbn(ownerData.abn || "");
          setSalonLogo(ownerData.logoUrl || "");
          setTermsAndConditions(ownerData.termsAndConditions || "");
        }

        // Load branches via API
        const branchesRes = await fetch(`/api/branches?ownerUid=${ownerUid}`);
        if (branchesRes.ok) {
          const branchesData = await branchesRes.json();
          setBranches(branchesData.branches || []);
        }

        // Load services via API
        const servicesRes = await fetch(`/api/services?ownerUid=${ownerUid}`);
        if (servicesRes.ok) {
          const servicesData = await servicesRes.json();
          setServicesList(servicesData.services || []);
        }

        // Load staff via API
        const staffRes = await fetch(`/api/staff?ownerUid=${ownerUid}`);
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaffList(staffData.staff || []);
        }

        setLoading(false);
      } catch (error) {
        console.error("Error loading data:", error);
        setLoading(false);
      }
    };

    loadData();
  }, [ownerUid]);

  // Subscribe to bookings for selected date
  useEffect(() => {
    if (!ownerUid || !bkDate) return;
    
    const dateStr = formatLocalYmd(bkDate);
    const unsub = subscribeBookingsForOwnerAndDate(ownerUid, dateStr, (data) => {
      setBookings(data as any);
    });
    
    return () => unsub();
  }, [ownerUid, bkDate]);

  // Update branch current time every minute for accurate slot availability
  useEffect(() => {
    if (!bkBranchId) return;
    
    const selectedBranch = branches.find((b) => b.id === bkBranchId);
    const branchTimezone = selectedBranch?.timezone || 'Australia/Sydney';
    
    // Update immediately
    const updateTime = () => {
      const branchTime = getCurrentDateTimeInTimezone(branchTimezone);
      setBranchCurrentTime({ date: branchTime.date, time: branchTime.time });
    };
    
    updateTime();
    
    // Update every minute
    const interval = setInterval(updateTime, 60000);
    
    return () => clearInterval(interval);
  }, [bkBranchId, branches]);

  const formatLocalYmd = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Handle customer registration
  const handleRegister = async () => {
    setAuthError("");
    
    if (!authEmail || !authPassword || !authFullName || !authPhone) {
      setAuthError("Please fill in all required fields");
      return;
    }

    if (authPassword.length < 6) {
      setAuthError("Password must be at least 6 characters");
      return;
    }

    setAuthLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          fullName: authFullName,
          phone: authPhone,
          ownerUid: ownerUid, // Salon-specific registration
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }

      // Now login with the created credentials
      setAuthEmail(authEmail);
      setAuthPassword(authPassword);
      await handleLogin();
    } catch (error: any) {
      setAuthError(error.message || "Registration failed");
      setAuthLoading(false);
    }
  };

  // Handle customer login
  const handleLogin = async () => {
    setAuthError("");
    
    if (!authEmail || !authPassword) {
      setAuthError("Please enter email and password");
      return;
    }

    setAuthLoading(true);

    try {
      // Use direct Firebase Authentication
      const { signInWithEmailAndPassword } = await import("firebase/auth");
      const userCredential = await signInWithEmailAndPassword(auth, authEmail, authPassword);
      
      // Verify customer is registered for this specific salon
      const verifyResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          ownerUid: ownerUid, // Salon-specific verification
        }),
      });
      
      const verifyData = await verifyResponse.json();
      
      if (!verifyResponse.ok) {
        // Sign out from Firebase Auth since they're not registered for this salon
        await signOut(auth);
        
        if (verifyData.needsRegistration) {
          setAuthError("You are not registered for this salon. Please create an account first.");
          setAuthMode("register"); // Switch to register mode
        } else {
          throw new Error(verifyData.error || "Verification failed");
        }
        return;
      }
      
      // User is verified for this salon
      setIsAuthenticated(true);
      
      const customerData = {
        uid: userCredential.user.uid,
        email: verifyData.customer?.email || userCredential.user.email || "",
        fullName: verifyData.customer?.fullName || userCredential.user.displayName || "",
        phone: verifyData.customer?.phone || "",
      };
      
      setCurrentCustomer(customerData);
      
      // Save to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("customerAuth", JSON.stringify(customerData));
        // Also save the auth token
        const token = await userCredential.user.getIdToken();
        localStorage.setItem("idToken", token);
      }
      
      setShowAuthModal(false);
      
      // Clear form
      setAuthEmail("");
      setAuthPassword("");
      
      // If there was a pending step 3 navigation, move to step 3
      if (pendingStep3Navigation) {
        setPendingStep3Navigation(false);
        setBkStep(3);
      }
      
      // If there was a pending booking confirmation, proceed with it
      if (pendingBookingConfirmation) {
        setPendingBookingConfirmation(false);
        // Small delay to ensure state is updated
        setTimeout(() => {
          handleConfirmBooking();
        }, 100);
      }
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
        setAuthError("Invalid email or password");
      } else if (error.code === "auth/invalid-email") {
        setAuthError("Invalid email format");
      } else if (error.code === "auth/too-many-requests") {
        setAuthError("Too many failed attempts. Please try again later.");
      } else {
        setAuthError(error.message || "Failed to login");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    try {
      // Clear localStorage before signing out
      if (typeof window !== "undefined") {
        localStorage.removeItem("customerAuth");
        localStorage.removeItem("idToken");
      }
      
      await signOut(auth);
      setIsAuthenticated(false);
      setCurrentCustomer(null);
      setShowAuthModal(true);
      setShowLogoutConfirm(false);
      
      // Reset booking state
      setBkStep(1);
      setBkBranchId(null);
      setBkSelectedServices([]);
      setBkServiceTimes({});
      setBkServiceStaff({});
      setBkDate(null);
      setBkNotes("");
    } catch (error) {
      console.error("Logout error:", error);
      setShowLogoutConfirm(false);
    }
  };

  const cancelLogout = () => {
    setShowLogoutConfirm(false);
  };

  // Handle profile modal open
  const handleOpenProfile = () => {
    if (currentCustomer) {
      setProfileFullName(currentCustomer.fullName || "");
      setProfilePhone(currentCustomer.phone || "");
      setProfileError("");
      setShowProfileModal(true);
    }
  };

  // Handle profile update
  const handleUpdateProfile = async () => {
    if (!currentCustomer || !ownerUid) return;
    
    if (!profileFullName.trim()) {
      setProfileError("Full name is required");
      return;
    }

    setProfileLoading(true);
    setProfileError("");

    try {
      const customerRef = doc(db, "owners", ownerUid, "customers", currentCustomer.uid);
      await updateDoc(customerRef, {
        fullName: profileFullName.trim(),
        phone: profilePhone.trim() || "",
        updatedAt: serverTimestamp(),
      });

      // Update local state
      setCurrentCustomer({
        ...currentCustomer,
        fullName: profileFullName.trim(),
        phone: profilePhone.trim() || "",
      });

      // Update localStorage
      if (typeof window !== "undefined") {
        const storedAuth = localStorage.getItem("customerAuth");
        if (storedAuth) {
          const authData = JSON.parse(storedAuth);
          localStorage.setItem("customerAuth", JSON.stringify({
            ...authData,
            fullName: profileFullName.trim(),
            phone: profilePhone.trim() || "",
          }));
        }
      }

      setShowProfileModal(false);
    } catch (error: any) {
      console.error("Error updating profile:", error);
      setProfileError(error.message || "Failed to update profile. Please try again.");
    } finally {
      setProfileLoading(false);
    }
  };

  // Calendar functions
  const buildMonthCells = () => {
    const { month, year } = bkMonthYear;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const cells: Array<{ date: Date | null; label: string }> = [];
    
    for (let i = 0; i < startDayOfWeek; i++) {
      cells.push({ date: null, label: "" });
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: new Date(year, month, day), label: String(day) });
        }
        
    return cells;
  };

  const goPrevMonth = () => {
    setBkMonthYear((prev) => {
      if (prev.month === 0) return { month: 11, year: prev.year - 1 };
      return { month: prev.month - 1, year: prev.year };
    });
  };

  const goNextMonth = () => {
    setBkMonthYear((prev) => {
      if (prev.month === 11) return { month: 0, year: prev.year + 1 };
      return { month: prev.month + 1, year: prev.year };
    });
  };

  const monthName = new Date(bkMonthYear.year, bkMonthYear.month).toLocaleDateString("en", { month: "long", year: "numeric" });

  // Compute all time slots with availability status
  const computeSlots = (forServiceId?: number | string): Array<{ time: string; available: boolean; reason?: string }> => {
    if (!bkDate || !bkBranchId) return [];
    
    // Get duration of the service we're scheduling
    let serviceDuration = 60;
    if (forServiceId) {
      const service = servicesList.find((s) => String(s.id) === String(forServiceId));
      serviceDuration = service?.duration || 60;
    }
    
    // Get branch hours for the selected date
    const selectedBranch = branches.find((b) => b.id === bkBranchId);
    if (!selectedBranch) {
      // If branch not found, use default hours
      console.warn("Branch not found for ID:", bkBranchId, "- using default hours");
    }
    
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayOfWeek = dayNames[bkDate.getDay()];
    
    // Get branch hours for this day
    let startHour = 9; // Default fallback
    let endHour = 18; // Default fallback
    let isClosed = false;
    
    // Handle branch hours - can be object or string
    if (selectedBranch?.hours) {
      if (typeof selectedBranch.hours === 'object' && !Array.isArray(selectedBranch.hours)) {
        const dayHours = (selectedBranch.hours as any)[dayOfWeek];
        if (dayHours) {
          if (dayHours.closed) {
            isClosed = true;
          } else {
            if (dayHours.open) {
              const [openH, openM] = dayHours.open.split(':').map(Number);
              startHour = openH + (openM || 0) / 60;
            }
            if (dayHours.close) {
              const [closeH, closeM] = dayHours.close.split(':').map(Number);
              endHour = closeH + (closeM || 0) / 60;
            }
          }
        }
      }
      // If hours is a string, ignore it and use defaults
    }

    if (isClosed) {
      return []; // Return empty slots if branch is closed
    }

    const slots: Array<{ time: string; available: boolean; reason?: string }> = [];
    
    // Get the branch's timezone (default to Australia/Sydney if not set)
    const branchTimezone = selectedBranch?.timezone || 'Australia/Sydney';
    
    // Get current date and time in the BRANCH's timezone (not user's local time)
    // This ensures that if user is in Sri Lanka but branch is in Perth,
    // we use Perth's current time to determine which slots have passed
    const branchNow = getCurrentDateTimeInTimezone(branchTimezone);
    const branchTodayDate = branchNow.date; // YYYY-MM-DD in branch timezone
    const branchNowTime = branchNow.time; // HH:mm in branch timezone
    
    // Check if selected date is today IN THE BRANCH'S TIMEZONE
    const selectedDateStr = formatLocalYmd(bkDate);
    const isToday = selectedDateStr === branchTodayDate;
    
    // Calculate current minutes based on branch's local time
    const currentMinutes = isToday 
      ? parseInt(branchNowTime.split(':')[0]) * 60 + parseInt(branchNowTime.split(':')[1])
      : -1;

    // Get the staff member selected for this service
    const staffIdForService = forServiceId ? bkServiceStaff[String(forServiceId)] : null;
    
    // Use centralized helper to check if booking status should block slots
    const isActiveStatus = (status: string | undefined): boolean => {
      return shouldBlockSlots(status);
    };
    
    // Helper function to check if a booking involves the selected staff
    const bookingInvolvesStaff = (booking: any, targetStaffId: string): boolean => {
      // Check root-level staffId
      if (booking.staffId === targetStaffId) return true;
      
      // Check services array for multi-service bookings
      if (Array.isArray(booking.services)) {
        for (const svc of booking.services) {
          if (svc && svc.staffId === targetStaffId) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    // Filter bookings to only those relevant to the selected staff
    // NOTE: When a booking is cancelled, isActiveStatus returns false (via shouldBlockSlots),
    // so it's automatically excluded, making the slot available again in real-time
    const relevantBookings = staffIdForService && staffIdForService !== "any"
      ? bookings.filter(b => isActiveStatus(b.status) && bookingInvolvesStaff(b, staffIdForService))
      : [];

    // Check if a slot is blocked by OTHER services selected in the CURRENT booking session
    // (for the same staff member) - checks for ANY overlap with the new service duration
    const isSlotBlockedByCurrentSelection = (slotStartMin: number): { blocked: boolean; reason?: string } => {
      if (!staffIdForService || staffIdForService === "any") return { blocked: false };
      if (!forServiceId) return { blocked: false };
      
      // Calculate when this new service would END
      const newServiceEndMin = slotStartMin + serviceDuration;
      
      // Go through all other services selected in this booking
      for (const otherServiceId of bkSelectedServices) {
        // Skip the current service we're computing slots for
        if (String(otherServiceId) === String(forServiceId)) continue;
        
        // Get the staff selected for this other service
        const otherStaffId = bkServiceStaff[String(otherServiceId)];
        
        // Only block if SAME staff member is selected for both services
        if (otherStaffId !== staffIdForService) continue;
        
        // Get the time selected for this other service
        const otherTime = bkServiceTimes[String(otherServiceId)];
        if (!otherTime) continue;
        
        // Get the duration of the other service
        const otherService = servicesList.find((s) => String(s.id) === String(otherServiceId));
        const otherDuration = otherService?.duration || 60;
        
        // Parse the other service's time
        const otherTimeParts = otherTime.split(':').map(Number);
        if (otherTimeParts.length < 2) continue;
        
        const otherStartMin = otherTimeParts[0] * 60 + otherTimeParts[1];
        const otherEndMin = otherStartMin + otherDuration;
        
        // Check for ANY overlap between the new service and the other selected service
        // Overlap occurs if: newStart < otherEnd AND otherStart < newEnd
        if (slotStartMin < otherEndMin && otherStartMin < newServiceEndMin) {
          // Determine the reason for the conflict
          if (slotStartMin >= otherStartMin && slotStartMin < otherEndMin) {
            return { blocked: true, reason: 'selected' }; // Slot starts during other selected service
          } else {
            return { blocked: true, reason: 'insufficient_time_selected' }; // Would extend into other service
          }
        }
      }
      
      return { blocked: false };
    };

    // Check if a specific time slot is OCCUPIED (booking is in progress at that time)
    // Also checks if the NEW service would OVERLAP with any existing booking
    const isSlotOccupied = (slotStartMin: number): { occupied: boolean; reason?: string } => {
      if (!staffIdForService || staffIdForService === "any") return { occupied: false };
      
      // Calculate when this new service would END
      const newServiceEndMin = slotStartMin + serviceDuration;
      
      for (const booking of relevantBookings) {
        // If booking has individual services, check each service's time slot separately
        if (Array.isArray(booking.services) && booking.services.length > 0) {
          for (const svc of booking.services) {
            // Only check if this service involves our staff
            if (svc && svc.staffId === staffIdForService && svc.time) {
              const svcTimeParts = svc.time.split(':').map(Number);
              if (svcTimeParts.length >= 2) {
                const svcStartMin = svcTimeParts[0] * 60 + svcTimeParts[1];
                const svcDuration = svc.duration || 60;
                const svcEndMin = svcStartMin + svcDuration;
                
                // Check for ANY overlap between the new service and existing service
                // Overlap occurs if: newStart < existingEnd AND existingStart < newEnd
                if (slotStartMin < svcEndMin && svcStartMin < newServiceEndMin) {
                  // Determine the reason for the conflict
                  if (slotStartMin >= svcStartMin && slotStartMin < svcEndMin) {
                    return { occupied: true, reason: 'booked' }; // Slot starts during existing booking
                  } else {
                    return { occupied: true, reason: 'insufficient_time' }; // Service would extend into existing booking
                  }
                }
              }
            }
          }
        } else {
          // Single-service booking - use main booking time and duration
          if (booking.time) {
            const timeParts = booking.time.split(':').map(Number);
            if (timeParts.length >= 2) {
              const bStartMin = timeParts[0] * 60 + timeParts[1];
              const bEndMin = bStartMin + (booking.duration || 60);
              
              // Check for ANY overlap between the new service and existing booking
              // Overlap occurs if: newStart < existingEnd AND existingStart < newEnd
              if (slotStartMin < bEndMin && bStartMin < newServiceEndMin) {
                // Determine the reason for the conflict
                if (slotStartMin >= bStartMin && slotStartMin < bEndMin) {
                  return { occupied: true, reason: 'booked' }; // Slot starts during existing booking
                } else {
                  return { occupied: true, reason: 'insufficient_time' }; // Service would extend into existing booking
                }
              }
            }
          }
        }
      }
      
      return { occupied: false };
    };
    
    // Generate slots using branch hours
    // Convert hours to minutes (e.g., 9.5 hours = 9*60 + 30 = 570 minutes)
    const startMinutes = Math.floor(startHour) * 60 + Math.round((startHour % 1) * 60);
    const endMinutes = Math.floor(endHour) * 60 + Math.round((endHour % 1) * 60);
    const interval = 15;
    
    // Helper to format time
    const formatTime = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    
    // Generate all slots within branch hours
    for (let slotStartMinutes = startMinutes; slotStartMinutes < endMinutes; slotStartMinutes += interval) {
      // Skip past times if date is today
      if (isToday && slotStartMinutes <= currentMinutes) {
        continue;
      }

      const timeStr = formatTime(slotStartMinutes);
      
      // Check if service would extend past closing time
      if (slotStartMinutes + serviceDuration > endMinutes) {
        const closeTimeStr = formatTime(endMinutes);
        slots.push({ 
          time: timeStr, 
          available: false, 
          reason: 'closes_before_finish',
          message: `Service ends after closing time (${closeTimeStr})`
        } as any);
        continue;
      }
      
      // Check availability status
      const occupiedResult = isSlotOccupied(slotStartMinutes);
      const blockedResult = isSlotBlockedByCurrentSelection(slotStartMinutes);
      
      if (occupiedResult.occupied) {
        slots.push({ time: timeStr, available: false, reason: occupiedResult.reason || 'booked' });
      } else if (blockedResult.blocked) {
        slots.push({ time: timeStr, available: false, reason: blockedResult.reason || 'selected' });
      } else {
        slots.push({ time: timeStr, available: true });
      }
    }
    
    return slots;
  };
  
  // Filter services and staff based on selection
  // Service must have at least one branch assigned, and selected branch must be in the list
  const availableServices = bkBranchId
    ? servicesList.filter((s) => s.branches && s.branches.length > 0 && s.branches.includes(bkBranchId))
    : [];

  // Get available staff for a specific service
  const getAvailableStaffForService = (serviceId: string | number) => {
    if (!bkBranchId) return [];
    
    // Get day of week from selected date
    let dayOfWeek: string | null = null;
    if (bkDate) {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      dayOfWeek = days[bkDate.getDay()];
    }
    
    const service = servicesList.find(s => String(s.id) === String(serviceId));
    
    return staffList.filter((st) => {
      // Only show active staff
      if (st.status && st.status !== "Active") return false;
      
      // CRITICAL: Check service capability FIRST
      if (service?.staffIds && service.staffIds.length > 0) {
         // Check both id and uid
         const canPerform = service.staffIds.some(id => String(id) === st.id || String(id) === (st as any).uid);
         if (!canPerform) return false;
      }
      
      // If date is selected, check weekly schedule for branch assignment
      if (dayOfWeek && (st as any).weeklySchedule && typeof (st as any).weeklySchedule === 'object') {
        const daySchedule = (st as any).weeklySchedule[dayOfWeek];
        
        // If staff has a schedule entry for this day with a specific branch, check it matches
        if (daySchedule && daySchedule.branchId) {
          return daySchedule.branchId === bkBranchId;
        }
        
        // If schedule entry is null/undefined for this day, staff is not working
        if (daySchedule === null || daySchedule === undefined) {
          return false;
        }
        
        // Schedule exists but no branchId specified - fall through to default branch check
      }
      
      // Default: check staff's primary branchId
      return st.branchId === bkBranchId;
    });
  };
  
  // Handle booking confirmation
  const handleConfirmBooking = async () => {
    // Check if user is authenticated first
    if (!isAuthenticated || !currentCustomer) {
      // Show auth modal and set pending booking flag
      setPendingBookingConfirmation(true);
      setShowAuthModal(true);
      return;
    }
    
    // Validate all required fields
    if (!bkBranchId || bkSelectedServices.length === 0 || !bkDate) return;
    
    // Ensure all services have times selected
    if (Object.keys(bkServiceTimes).length !== bkSelectedServices.length) {
      alert("Please select a time for each service.");
      return;
    }

    setSubmittingBooking(true);
    
    // Get selected service objects
    const selectedServiceObjects = bkSelectedServices.map((serviceId) => 
      servicesList.find((s) => String(s.id) === String(serviceId))
    ).filter(Boolean);
    
    // Calculate totals
    const totalPrice = selectedServiceObjects.reduce((sum, s) => sum + (s?.price || 0), 0);
    const totalDuration = selectedServiceObjects.reduce((sum, s) => sum + (s?.duration || 0), 0);
    const serviceNames = selectedServiceObjects.map((s) => s?.name || "").join(", ");
    const serviceIds = selectedServiceObjects.map((s) => s?.id).join(",");
    
    // Use first service's time as main booking time
    const firstServiceId = bkSelectedServices[0];
    const mainBookingTime = bkServiceTimes[String(firstServiceId)] || "";
    
    const selectedBranch = branches.find((b) => b.id === bkBranchId);
    
    // Determine top-level staff info (if multiple/mixed, say "Multiple Staff" or similar)
    const uniqueStaffIds = new Set(Object.values(bkServiceStaff).filter(Boolean));
    let mainStaffId: string | null = null;
    let mainStaffName = "Any Available";
    
    if (uniqueStaffIds.size === 1) {
      const sid = Array.from(uniqueStaffIds)[0];
      mainStaffId = sid;
      mainStaffName = staffList.find(st => st.id === sid)?.name || "Any Available";
    } else if (uniqueStaffIds.size > 1) {
      mainStaffName = "Multiple Staff";
    }

    try {
      // Build services array with times
      const servicesWithTimes = selectedServiceObjects.map((s) => {
        const sId = String(s?.id);
        const stId = bkServiceStaff[sId];
        const stName = stId ? staffList.find(st => st.id === stId)?.name : "Any Available";
        return {
          id: s?.id || "",
          name: s?.name || "",
          price: s?.price || 0,
          duration: s?.duration || 0,
          time: bkServiceTimes[sId] || "",
          staffId: stId || null,
          staffName: stName
        };
      });
      
      // Sort services by time (earliest first)
      servicesWithTimes.sort((a, b) => {
        const timeA = a.time.split(':').map(Number);
        const timeB = b.time.split(':').map(Number);
        const minutesA = timeA[0] * 60 + (timeA[1] || 0);
        const minutesB = timeB[0] * 60 + (timeB[1] || 0);
        return minutesA - minutesB;
      });
      
      // Use earliest service's time as main booking time
      const earliestTime = servicesWithTimes[0]?.time || mainBookingTime;
      
      // Recalculate service names/IDs in time order
      const sortedServiceNames = servicesWithTimes.map(s => s.name).join(", ");
      const sortedServiceIds = servicesWithTimes.map(s => s.id).join(",");
      
      const result = await createBooking({
        ownerUid,
        client: currentCustomer.fullName || "Customer",
        clientEmail: currentCustomer.email || "",
        clientPhone: currentCustomer.phone || "",
        notes: bkNotes?.trim() || undefined,
        serviceId: sortedServiceIds, // Multiple service IDs as comma-separated (sorted by time)
        serviceName: sortedServiceNames, // Multiple service names (sorted by time)
        staffId: mainStaffId,
        staffName: mainStaffName,
        branchId: bkBranchId,
        branchName: selectedBranch?.name || "",
        branchTimezone: selectedBranch?.timezone || "Australia/Sydney", // Include branch timezone
        date: formatLocalYmd(bkDate),
        time: earliestTime, // Use the earliest service time
        duration: totalDuration,
        status: "Pending",
        price: totalPrice,
        customerUid: currentCustomer.uid,
        services: servicesWithTimes, // Already sorted by time
      });
      
      await incrementCustomerBookings(ownerUid, currentCustomer.uid);
      
      setBookingCode(result.bookingCode || "");
      setShowSuccess(true);
      
      // We don't reset here anymore, we reset when closing the success modal
    } catch (error: any) {
      console.error("Error creating booking:", error);
      
      // Check if it's a conflict error (409) or contains booking conflict message
      let errorMessage = "Failed to create booking. Please try again.";
      
      if (error.status === 409 || (error.message && error.message.includes("already booked"))) {
        errorMessage = error.details || "This time slot has already been booked by another customer. Please select a different time.";
      } else if (error.message && error.message.includes("conflicts")) {
        errorMessage = error.message;
      } else if (error.details) {
        errorMessage = error.details;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(errorMessage);
    } finally {
      setSubmittingBooking(false);
    }
  };

  if (!ownerUid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <i className="fas fa-exclamation-triangle text-4xl text-yellow-500 mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Salon Not Found</h2>
            <p className="text-slate-600">Please provide a valid salon ID in the URL.</p>
          </div>
        </div>
      </div>
    );
  }

  // Authentication Modal - Creative Design
  if (showAuthModal) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50 relative overflow-hidden">
        {/* Animated Background Blobs */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-20 left-10 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
          <div className="absolute top-40 right-10 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-20 left-1/2 w-72 h-72 bg-indigo-300 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-4000"></div>
        </div>

        {/* Auth Card */}
        <div className="w-full max-w-md relative z-10">
          <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 p-8 pt-12 relative">
            {/* Close Button */}
            <button
              onClick={() => {
                setShowAuthModal(false);
                setPendingBookingConfirmation(false);
                setPendingStep3Navigation(false);
                setAuthError("");
              }}
              className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all shadow-sm hover:shadow-md z-20"
              title="Close"
            >
              <i className="fas fa-times text-xl"></i>
            </button>
            
            {/* Toggle Switch */}
            <div className="relative flex bg-gray-100 rounded-full p-1 mb-8 mt-2">
              <div 
                className={`absolute top-1 h-[calc(100%-8px)] w-[calc(50%-4px)] bg-slate-900 rounded-full shadow-lg transition-all duration-300 ease-out ${
                  authMode === "register" ? "translate-x-[calc(100%+4px)]" : "translate-x-0"
                }`}
              />
              
              <button
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
                disabled={authLoading}
                className={`flex-1 py-3 rounded-full font-bold text-sm relative z-10 transition-all duration-300 ${
                  authMode === "login"
                    ? "text-white"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <i className="fas fa-sign-in-alt mr-2"></i>
                Login
              </button>
              <button
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                }}
                disabled={authLoading}
                className={`flex-1 py-3 rounded-full font-bold text-sm relative z-10 transition-all duration-300 ${
                  authMode === "register"
                    ? "text-white"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <i className="fas fa-user-plus mr-2"></i>
                Register
              </button>
            </div>
            
            {/* Title */}
            <div className="text-center mb-6">
              <h2 className="text-3xl font-black text-slate-900 mb-2">
                {authMode === "login" ? "Welcome Back!" : "Join Us Today!"}
              </h2>
              <p className="text-gray-600 text-sm">
                {authMode === "login" 
                  ? "Sign in to book your appointment" 
                  : "Create your account to get started"}
              </p>
            </div>

            {/* Error Message */}
            {authError && (
              <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg animate-shake">
                <div className="flex items-center gap-2">
                  <i className="fas fa-exclamation-circle text-red-600"></i>
                  <p className="text-red-700 text-sm font-medium">{authError}</p>
                </div>
              </div>
            )}

            {/* Form */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (authMode === "login") {
                  handleLogin();
                } else {
                  handleRegister();
                }
              }}
              className="space-y-4"
            >
              {authMode === "register" && (
                <>
                    <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600">
                  <i className="fas fa-user"></i>
                </div>
                      <input
                        type="text"
                        placeholder="Full Name"
                        value={authFullName}
                        onChange={(e) => setAuthFullName(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all text-slate-900"
                        disabled={authLoading}
                      />
                    </div>
                    <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600">
                  <i className="fas fa-phone"></i>
                </div>
                      <input
                        type="tel"
                        placeholder="Phone Number"
                        value={authPhone}
                        onChange={(e) => setAuthPhone(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all text-slate-900"
                        disabled={authLoading}
                      />
                  </div>
                </>
              )}

                <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600">
                  <i className="fas fa-envelope"></i>
                </div>
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all text-slate-900"
                    disabled={authLoading}
                    required
                  />
              </div>

                <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600">
                  <i className="fas fa-lock"></i>
                </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full pl-12 pr-12 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all text-slate-900"
                    disabled={authLoading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-slate-900 transition-colors z-10"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                  <i className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"} text-lg`}></i>
                  </button>
                </div>

                {authMode === "register" && (
                <p className="text-xs text-gray-500 flex items-center gap-2">
                  <i className="fas fa-info-circle text-slate-600"></i>
                  Password must be at least 6 characters
                  </p>
                )}

              <button
                type="submit"
                disabled={authLoading}
                className={`w-full py-4 rounded-xl font-bold text-white transition-all transform shadow-lg ${
                  authLoading
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-slate-900 hover:bg-slate-800 hover:scale-105 hover:shadow-2xl active:scale-95"
                }`}
              >
                  {authLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <i className="fas fa-spinner fa-spin"></i>
                      {authMode === "login" ? "Signing in..." : "Creating account..."}
                  </span>
                  ) : (
                  <span className="flex items-center justify-center gap-2 uppercase tracking-wider">
                    <i className={`fas ${authMode === "login" ? "fa-sign-in-alt" : "fa-user-plus"}`}></i>
                    {authMode === "login" ? "Sign In" : "Create Account"}
                </span>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Animation Styles */}
        <style jsx>{`
          @keyframes blob {
            0%, 100% { transform: translate(0, 0) scale(1); }
            25% { transform: translate(20px, -30px) scale(1.1); }
            50% { transform: translate(-20px, 20px) scale(0.9); }
            75% { transform: translate(30px, 10px) scale(1.05); }
          }
          .animate-blob {
            animation: blob 7s infinite;
          }
          .animation-delay-2000 {
            animation-delay: 2s;
          }
          .animation-delay-4000 {
            animation-delay: 4s;
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
          }
          .animate-shake {
            animation: shake 0.3s ease-in-out;
          }
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          .animate-fadeIn {
            animation: fadeIn 0.2s ease-out;
          }
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .animate-slideUp {
            animation: slideUp 0.3s ease-out;
          }
        `}</style>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-pink-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50">
      {/* Header */}
      <div className="relative overflow-hidden bg-indigo-900">
        {/* Notification and Auth Buttons */}
        <div className="absolute top-4 sm:top-8 right-4 sm:right-6 z-50 flex items-center gap-2 sm:gap-3">
          {isAuthenticated && (
            <>
              <button
                onClick={() => setShowNotificationPanel(true)}
                className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center relative"
                title="Notifications"
              >
                <i className="fas fa-bell text-sm sm:text-base"></i>
                {unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-red-500 text-white text-[10px] sm:text-xs font-bold rounded-full flex items-center justify-center shadow-lg border-2 border-purple-700 animate-pulse">
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </span>
                )}
              </button>
              <button
                onClick={handleOpenProfile}
                className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
                title="Profile"
              >
                <i className="fas fa-user-circle text-sm sm:text-base"></i>
              </button>
              <button
                onClick={handleLogoutClick}
                className="w-9 h-9 sm:w-10 sm:h-10 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
                title="Logout"
              >
                <i className="fas fa-sign-out-alt text-sm sm:text-base"></i>
              </button>
            </>
          )}
          {!isAuthenticated && (
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-3 py-2 sm:px-4 sm:py-2.5 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
              title="Login to Book"
            >
              <i className="fas fa-sign-in-alt text-xs sm:text-sm"></i>
              <span className="text-xs sm:text-sm whitespace-nowrap">Login to Book</span>
            </button>
          )}
        </div>

        {/* Profile Edit Modal */}
        {showProfileModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-slideUp">
              {/* Header with Gradient */}
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 sm:px-8 pt-6 sm:pt-8 pb-4 relative">
                {/* Close Button */}
                <button
                  onClick={() => {
                    setShowProfileModal(false);
                    setProfileError("");
                  }}
                  className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-all"
                  title="Close"
                >
                  <i className="fas fa-times text-lg"></i>
                </button>

                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                    <i className="fas fa-user-edit text-2xl text-white"></i>
                  </div>
                  <div>
                    <h3 className="text-2xl sm:text-3xl font-bold text-white mb-1">Edit Profile</h3>
                    <p className="text-white/90 text-sm">Update your profile information</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 sm:p-8">
                {/* Error Message */}
                {profileError && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl animate-shake">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-exclamation-circle text-red-600"></i>
                      </div>
                      <p className="text-red-700 text-sm font-medium">{profileError}</p>
                    </div>
                  </div>
                )}

                {/* Profile Form */}
                <div className="space-y-5">
                  {/* Email (Read-only) */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2.5">
                      <i className="fas fa-envelope text-indigo-600 mr-2"></i>
                      Email Address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        value={currentCustomer?.email || ""}
                        disabled
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-600 cursor-not-allowed pr-12"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <i className="fas fa-lock text-gray-400 text-sm"></i>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <i className="fas fa-info-circle text-gray-400"></i>
                      Email cannot be changed
                    </p>
                  </div>

                  {/* Full Name */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2.5">
                      <i className="fas fa-user text-indigo-600 mr-2"></i>
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={profileFullName}
                      onChange={(e) => setProfileFullName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 transition-all placeholder:text-gray-400"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2.5">
                      <i className="fas fa-phone text-indigo-600 mr-2"></i>
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      placeholder="Enter your phone number"
                      className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 transition-all placeholder:text-gray-400"
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 mt-8 pt-6 border-t border-gray-200">
                  <button
                    onClick={() => {
                      setShowProfileModal(false);
                      setProfileError("");
                    }}
                    className="flex-1 px-6 py-3.5 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all"
                  >
                    <i className="fas fa-times mr-2"></i>
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateProfile}
                    disabled={profileLoading}
                    className="flex-1 px-6 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                  >
                    {profileLoading ? (
                      <>
                        <i className="fas fa-spinner fa-spin mr-2"></i>
                        Saving...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-save mr-2"></i>
                        Save Changes
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Logout Confirmation Modal */}
        {showLogoutConfirm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                  <i className="fas fa-sign-out-alt text-2xl text-red-600"></i>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">Logout Confirmation</h3>
                <p className="text-slate-600 text-sm">Are you sure you want to logout?</p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={cancelLogout}
                  className="flex-1 px-4 py-3 border-2 border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLogout}
                  className="flex-1 px-4 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-all"
                >
                  Yes, Logout
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)`,
          }}></div>
        </div>

        {/* Header Content */}
        <div className="relative z-10 px-4 sm:px-6 py-6 sm:py-10">
          <div className="max-w-5xl mx-auto">
            {/* Mobile Layout */}
            <div className="block sm:hidden text-center pt-10">
              {/* Logo - Mobile */}
              {salonLogo ? (
                <div className="w-16 h-16 mx-auto rounded-xl bg-white p-1.5 shadow-lg mb-3">
                  <img src={salonLogo} alt={salonName} className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-16 h-16 mx-auto rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3">
                  <i className="fas fa-spa text-2xl text-white/80"></i>
                </div>
              )}
              <div className="inline-block px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full text-white/90 text-[10px] font-medium mb-1">
                WELCOME TO
              </div>
              <h1 className="text-2xl font-bold text-white">{salonName}</h1>
              <p className="text-white/70 text-xs mt-0.5">BOOK YOUR APPOINTMENT</p>
              
              {/* Contact Info - Mobile */}
              {(salonAddress || salonPhone || salonAbn) && (
                <div className="flex flex-col items-center gap-1.5 mt-3 pt-3 border-t border-white/20">
                  {salonAddress && (
                    <div className="flex items-center gap-1.5 text-white/80 text-[10px] bg-white/10 px-2.5 py-1 rounded-full">
                      <i className="fas fa-map-marker-alt text-pink-300 text-[9px]"></i>
                      <span>{salonAddress}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {salonPhone && (
                      <div className="flex items-center gap-1.5 text-white/80 text-[10px] bg-white/10 px-2.5 py-1 rounded-full">
                        <i className="fas fa-phone text-pink-300 text-[9px]"></i>
                        <span>{salonPhone}</span>
                      </div>
                    )}
                    {salonAbn && (
                      <div className="flex items-center gap-1.5 text-white/80 text-[10px] bg-white/10 px-2.5 py-1 rounded-full">
                        <i className="fas fa-building text-pink-300 text-[9px]"></i>
                        <span>ABN: {salonAbn}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Layout */}
            <div className="hidden sm:flex flex-col items-center text-center">
              <div className="flex items-start gap-5">
                {/* Logo - Desktop */}
                {salonLogo ? (
                  <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-2xl bg-white p-2 shadow-lg flex-shrink-0">
                    <img src={salonLogo} alt={salonName} className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-spa text-3xl lg:text-4xl text-white/80"></i>
                  </div>
                )}
                
                {/* Salon Name & Welcome - Desktop */}
                <div className="text-left pt-0">
                  <div className="inline-block px-4 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-white/90 text-sm font-medium mb-1">
                    WELCOME TO
                  </div>
                  <h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold text-white">{salonName}</h1>
                  <p className="text-white/70 text-sm lg:text-base mt-0.5">BOOK YOUR APPOINTMENT</p>
                </div>
              </div>
              
              {/* Contact Info - Desktop (below, centered) */}
              {(salonAddress || salonPhone || salonAbn) && (
                <div className="flex flex-wrap items-center justify-center gap-3 mt-4 pt-4 border-t border-white/20 w-full">
                  {salonAddress && (
                    <div className="flex items-center gap-2 text-white/80 text-sm bg-white/10 px-3 py-1.5 rounded-full">
                      <i className="fas fa-map-marker-alt text-pink-300"></i>
                      <span>{salonAddress}</span>
                    </div>
                  )}
                  {salonPhone && (
                    <div className="flex items-center gap-2 text-white/80 text-sm bg-white/10 px-3 py-1.5 rounded-full">
                      <i className="fas fa-phone text-pink-300"></i>
                      <span>{salonPhone}</span>
                    </div>
                  )}
                  {salonAbn && (
                    <div className="flex items-center gap-2 text-white/80 text-sm bg-white/10 px-3 py-1.5 rounded-full">
                      <i className="fas fa-building text-pink-300"></i>
                      <span>ABN: {salonAbn}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 py-4 sm:p-6 lg:p-8">
        {/* Progress Steps */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            {[
              { num: 1, label: "Location & Service" },
              { num: 2, label: "Date, Time & Staff" },
              { num: 3, label: "Confirm" }
            ].map((step, i) => (
              <React.Fragment key={step.num}>
                <div className="flex flex-col items-center gap-1 sm:gap-2 flex-1">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm sm:text-base font-bold transition-all ${
                    bkStep >= step.num 
                      ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white shadow-lg" 
                      : "bg-gray-200 text-gray-500"
                  }`}>
                    {bkStep > step.num ? <i className="fas fa-check text-xs sm:text-sm" /> : step.num}
                </div>
                  <span className="text-[10px] sm:text-xs text-gray-600 font-semibold text-center leading-tight whitespace-nowrap px-1">{step.label}</span>
              </div>
                {i < 2 && (
                  <div className={`h-0.5 sm:h-1 w-12 sm:w-20 md:w-28 -mt-6 sm:-mt-7 rounded transition-all flex-shrink-0 ${
                    bkStep > step.num ? "bg-gradient-to-r from-pink-500 to-purple-500" : "bg-gray-300"
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        
        {/* Step Content */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-4 sm:p-6">
          {/* Step 1: Location & Service */}
          {bkStep === 1 && (
            <div className="space-y-4 sm:space-y-6">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                  <i className="fas fa-map-marker-alt text-pink-600 text-base sm:text-lg"></i>
                  Select Location
                </h3>
                    <div className="grid grid-cols-1 gap-3 sm:gap-4">
                  {branches.map((branch) => (
                            <button
                      key={branch.id}
                              onClick={() => {
                        setBkBranchId(branch.id);
                                setBkSelectedServices([]);
                        setBkServiceTimes({});
                              }}
                      className={`text-left border-2 rounded-lg sm:rounded-xl p-3 sm:p-4 transition-all ${
                        bkBranchId === branch.id
                                  ? "border-pink-500 bg-pink-50 shadow-lg" 
                          : "border-gray-200 hover:border-pink-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          bkBranchId === branch.id ? "bg-pink-100" : "bg-gray-100"
                        }`}>
                          <i className={`fas fa-store text-base sm:text-xl ${
                            bkBranchId === branch.id ? "text-pink-600" : "text-gray-400"
                          }`}></i>
                                </div>
                                <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-800 text-sm sm:text-base truncate">{branch.name}</div>
                          <div className="text-xs sm:text-sm text-gray-500 truncate">{branch.address}</div>
                          {/* Show timezone for the branch */}
                          {branch.timezone && (
                            <div className="flex items-center gap-1 mt-1">
                              <i className={`fas fa-globe text-[10px] ${bkBranchId === branch.id ? "text-pink-500" : "text-gray-400"}`}></i>
                              <span className={`text-[10px] sm:text-xs ${bkBranchId === branch.id ? "text-pink-600" : "text-gray-400"}`}>
                                {branch.timezone.split('/').pop()?.replace(/_/g, ' ')}
                              </span>
                            </div>
                          )}
                                  </div>
                        {bkBranchId === branch.id && (
                          <i className="fas fa-check-circle text-pink-600 text-lg sm:text-xl flex-shrink-0"></i>
                                )}
                              </div>
                            </button>
                  ))}
                </div>
              </div>

              {/* Service Selection - Separate Section with More Gap */}
              <div className={`pt-6 sm:pt-8 border-t-2 border-gray-100 ${!bkBranchId ? "opacity-50 pointer-events-none" : ""}`}>
                <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2 flex-wrap">
                  <i className="fas fa-concierge-bell text-purple-600 text-base sm:text-lg"></i>
                  <span>Select Service</span>
                  {!bkBranchId && <span className="text-xs sm:text-sm font-normal text-gray-500">(Select location first)</span>}
                </h3>
                  {!bkBranchId ? (
                  <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-8 sm:p-12 text-center">
                    <i className="fas fa-map-marker-alt text-4xl sm:text-5xl text-gray-300 mb-3 sm:mb-4"></i>
                    <p className="text-sm sm:text-base text-gray-500 font-medium">Select a location first</p>
                    </div>
                  ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
                    {availableServices.map((service) => {
                      const isSelected = bkSelectedServices.includes(service.id);
                            return (
                              <button
                          key={service.id}
                                onClick={() => {
                            if (isSelected) {
                                    // Remove service
                              setBkSelectedServices(bkSelectedServices.filter((id) => id !== service.id));
                              const newTimes = { ...bkServiceTimes };
                              delete newTimes[String(service.id)];
                              setBkServiceTimes(newTimes);
                                  } else {
                                    // Add service
                              setBkSelectedServices([...bkSelectedServices, service.id]);
                                  }
                                }}
                          className={`text-left border-2 rounded-lg sm:rounded-xl p-2 sm:p-4 transition-all ${
                            isSelected
                                    ? "border-purple-500 bg-purple-50 shadow-lg" 
                              : "border-gray-200 hover:border-purple-300"
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:gap-3">
                            {/* Service Image */}
                            <div className={`w-full aspect-square rounded-md sm:rounded-lg overflow-hidden flex items-center justify-center ${
                              isSelected ? "bg-purple-100" : "bg-gray-100"
                            }`}>
                              {(service as any).imageUrl ? (
                                <img 
                                  src={(service as any).imageUrl} 
                                  alt={service.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <i className={`fas fa-cut text-2xl sm:text-4xl ${
                                  isSelected ? "text-purple-600" : "text-gray-400"
                                }`}></i>
                                    )}
                                  </div>
                            {/* Service Info */}
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1 sm:mb-2">
                                <div className="font-semibold text-gray-800 text-xs sm:text-base truncate">{service.name}</div>
                                {isSelected && (
                                  <i className="fas fa-check-circle text-purple-600 text-sm sm:text-xl flex-shrink-0 ml-1"></i>
                                )}
                                    </div>
                              <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-sm text-gray-500 flex-wrap">
                                <span className="flex items-center gap-0.5 sm:gap-1">
                                  <i className="fas fa-clock text-[8px] sm:text-xs"></i>
                                  {service.duration}min
                                      </span>
                                <span className="text-gray-400 hidden sm:inline">•</span>
                                <span className="font-bold text-purple-600">${service.price}</span>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                        })}
                    </div>
                  )}
                </div>

              {/* Navigation Button */}
              <div className="flex justify-end pt-6 sm:pt-8 mt-6 sm:mt-8 border-t-2 border-gray-100">
                <button
                  onClick={() => setBkStep(2)}
                  disabled={!bkBranchId || bkSelectedServices.length === 0}
                  className={`px-6 sm:px-8 py-3 rounded-lg font-semibold text-sm sm:text-base text-white transition-all ${
                    bkBranchId && bkSelectedServices.length > 0
                      ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:shadow-lg"
                      : "bg-gray-300 cursor-not-allowed"
                  }`}
                >
                  Continue to Date & Time ({bkSelectedServices.length} service{bkSelectedServices.length !== 1 ? 's' : ''})
                  <i className="fas fa-arrow-right ml-2"></i>
                </button>
              </div>
                    </div>
          )}

          {/* Step 2: Date, Time & Staff */}
          {bkStep === 2 && (
            <div className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Date Selection */}
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <i className="fas fa-calendar text-pink-600 text-base sm:text-lg"></i>
                    Select Date
                  </h3>
                  <div className="bg-gray-50 rounded-lg sm:rounded-xl p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-3 sm:mb-4">
                      <button onClick={goPrevMonth} className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <i className="fas fa-chevron-left text-gray-600 text-sm sm:text-base"></i>
                          </button>
                      <div className="font-semibold text-gray-800 text-sm sm:text-base px-2 text-center">{monthName}</div>
                      <button onClick={goNextMonth} className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-white hover:bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <i className="fas fa-chevron-right text-gray-600 text-sm sm:text-base"></i>
                          </button>
                        </div>
                    <div className="grid grid-cols-7 gap-1 text-xs sm:text-sm font-semibold text-gray-600 mb-2">
                          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                        <div key={i} className="text-center py-2">{d}</div>
                          ))}
                        </div>
                    <div className="grid grid-cols-7 gap-1">
                      {buildMonthCells().map((cell, idx) => {
                        const isSelected = cell.date && bkDate && 
                          cell.date.getTime() === bkDate.getTime();
                        
                        // Use branch timezone to determine "today" and past dates
                        const selectedBranch = branches.find((b) => b.id === bkBranchId);
                        const branchTimezone = selectedBranch?.timezone || 'Australia/Sydney';
                        const branchCurrentDate = getCurrentDateTimeInTimezone(branchTimezone).date;
                        
                        // Compare cell date with branch's current date
                        let isPast = false;
                        if (cell.date) {
                          const cellDateStr = formatLocalYmd(cell.date);
                          isPast = cellDateStr < branchCurrentDate;
                        }

                          return (
                          <button
                              key={idx}
                            onClick={() => cell.date && !isPast && (setBkDate(cell.date), setBkServiceTimes({}))}
                            disabled={!cell.date || !!isPast}
                            className={`aspect-square rounded-md sm:rounded-lg text-sm sm:text-base font-medium transition-all ${
                                isSelected 
                                ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white shadow-lg"
                                : cell.date && !isPast
                                ? "bg-white hover:bg-pink-50 text-gray-700"
                                : "bg-transparent text-gray-300 cursor-not-allowed"
                            }`}
                          >
                            {cell.label}
                          </button>
                          );
                        })}
                      </div>
                    </div>
                </div>

                {/* Time & Staff Selection for Each Service */}
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <i className="fas fa-clock text-purple-600 text-base sm:text-lg"></i>
                    <span className="text-sm sm:text-xl">Select Staff & Time for Each Service</span>
                  </h3>
                  
                  {/* Branch Timezone Indicator */}
                  {bkBranchId && (() => {
                    const selectedBranch = branches.find((b) => b.id === bkBranchId);
                    const branchTimezone = selectedBranch?.timezone || 'Australia/Sydney';
                    
                    // Get timezone display name
                    const tzLabel = branchTimezone.split('/').pop()?.replace(/_/g, ' ') || branchTimezone;
                    
                    return (
                      <div className="mb-4 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <i className="fas fa-globe text-blue-600"></i>
                            <span className="text-xs sm:text-sm font-medium text-blue-800">
                              Branch Time Zone: <span className="font-bold">{tzLabel}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-blue-200">
                            <i className="fas fa-clock text-blue-500 text-xs"></i>
                            <span className="text-xs sm:text-sm font-bold text-blue-700">
                              Current Time: {branchCurrentTime.time || '--:--'}
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] sm:text-xs text-blue-600 mt-2">
                          <i className="fas fa-info-circle mr-1"></i>
                          Times shown are in the branch's local timezone. Past slots are automatically hidden.
                        </p>
                      </div>
                    );
                  })()}
                  
                  {!bkDate ? (
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg sm:rounded-xl p-4 text-center py-8 sm:py-12">
                      <i className="fas fa-calendar-day text-3xl sm:text-4xl text-gray-300 mb-2"></i>
                      <p className="text-gray-500 text-xs sm:text-sm">Select a date first</p>
                    </div>
                  ) : bkSelectedServices.length === 0 ? (
                    <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg sm:rounded-xl p-4 text-center py-8 sm:py-12">
                      <i className="fas fa-concierge-bell text-3xl sm:text-4xl text-gray-300 mb-2"></i>
                      <p className="text-gray-500 text-xs sm:text-sm">Select services first</p>
                    </div>
                  ) : (
                    <div className="space-y-4 sm:space-y-6">
                      {bkSelectedServices.map((serviceId) => {
                        const service = servicesList.find((s) => String(s.id) === String(serviceId));
                        if (!service) return null;
                        
                        const slots = computeSlots(serviceId);
                        const selectedTime = bkServiceTimes[String(serviceId)];
                        const selectedStaffId = bkServiceStaff[String(serviceId)];
                        const availableStaffForService = getAvailableStaffForService(serviceId);
                        
                        return (
                          <div key={String(serviceId)} className="bg-white rounded-lg sm:rounded-xl p-4 sm:p-5 border-2 border-purple-100 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                                  <i className="fas fa-cut text-xs sm:text-sm"></i>
                                </div>
                                <div>
                                  <div className="font-bold text-gray-800 text-sm sm:text-base truncate">{service.name}</div>
                                  <div className="text-xs text-gray-500">{service.duration} min • ${service.price}</div>
                                </div>
                              </div>
                            </div>

                            {/* Staff Selection */}
                            <div className="mb-4">
                              <label className="text-xs font-bold text-gray-500 mb-2 block uppercase tracking-wide">Select Stylist</label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => {
                                    const newStaff = { ...bkServiceStaff };
                                    delete newStaff[String(serviceId)];
                                    setBkServiceStaff(newStaff);
                                    // Reset time when staff changes
                                    const newTimes = { ...bkServiceTimes };
                                    delete newTimes[String(serviceId)];
                                    setBkServiceTimes(newTimes);
                                  }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                                    !selectedStaffId 
                                      ? "border-indigo-500 bg-indigo-50 text-indigo-700" 
                                      : "border-gray-100 bg-gray-50 text-gray-600 hover:border-indigo-200"
                                  }`}
                                >
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${!selectedStaffId ? "bg-indigo-200" : "bg-gray-200"}`}>
                                    <i className="fas fa-random text-[10px]"></i>
                                  </div>
                                  <span className="text-xs font-medium">Any Staff</span>
                                  {!selectedStaffId && <i className="fas fa-check-circle text-indigo-600 text-xs ml-1 flex-shrink-0"></i>}
                                </button>

                                {availableStaffForService.map((st) => (
                                  <button
                                    key={st.id}
                                    onClick={() => {
                                      setBkServiceStaff({ ...bkServiceStaff, [String(serviceId)]: st.id });
                                      // Reset time when staff changes
                                      const newTimes = { ...bkServiceTimes };
                                      delete newTimes[String(serviceId)];
                                      setBkServiceTimes(newTimes);
                                    }}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ${
                                      selectedStaffId === st.id
                                        ? "border-indigo-500 bg-indigo-50 text-indigo-700" 
                                        : "border-gray-100 bg-gray-50 text-gray-600 hover:border-indigo-200"
                                    }`}
                                  >
                                    <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                                      {st.avatar ? (
                                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(st.avatar)}`} alt="" className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-300"><i className="fas fa-user text-[10px] text-gray-500"></i></div>
                                      )}
                                    </div>
                                    <span className="text-xs font-medium">{st.name}</span>
                                    {selectedStaffId === st.id && <i className="fas fa-check-circle text-indigo-600 text-xs ml-1 flex-shrink-0"></i>}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Time Selection */}
                            <div>
                              <label className="text-xs font-bold text-gray-500 mb-2 block uppercase tracking-wide">Select Time</label>
                              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                                {slots.length === 0 ? (
                                  <div className="col-span-full text-center text-gray-400 py-4 text-xs bg-gray-50 rounded-lg border border-gray-100 border-dashed">
                                    No available slots for this staff/time combination
                                  </div>
                                ) : (
                                  slots.map((slot) => {
                                    const isSelected = selectedTime === slot.time;
                                    const isDisabled = !slot.available;
                                    const isBookedByOther = slot.reason === 'booked';
                                    const isSelectedForOtherService = slot.reason === 'selected';
                                    const isInsufficientTime = slot.reason === 'insufficient_time' || slot.reason === 'insufficient_time_selected';
                                    const isClosesBeforeFinish = slot.reason === 'closes_before_finish';
                                    
                                    // Determine tooltip message
                                    let tooltipMessage = 'Available';
                                    if (isDisabled) {
                                      if (isClosesBeforeFinish) {
                                        tooltipMessage = (slot as any).message || 'Service would end after branch closing time';
                                      } else if (isInsufficientTime) {
                                        tooltipMessage = 'Not enough time - service would overlap with next booking';
                                      } else if (isBookedByOther) {
                                        tooltipMessage = 'Already booked by another customer';
                                      } else if (isSelectedForOtherService) {
                                        tooltipMessage = 'Selected for another service in this booking';
                                      }
                                    }
                                    
                                    return (
                                      <button
                                        key={slot.time}
                                        onClick={() => {
                                          if (!isDisabled) {
                                            setBkServiceTimes({ ...bkServiceTimes, [String(serviceId)]: slot.time });
                                          }
                                        }}
                                        disabled={isDisabled}
                                        title={tooltipMessage}
                                        className={`py-2 px-1 rounded-lg font-semibold text-xs transition-all relative ${
                                          isSelected
                                            ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-md transform scale-105"
                                            : isClosesBeforeFinish
                                              ? "bg-orange-50 text-orange-400 border border-orange-200 cursor-not-allowed"
                                              : isInsufficientTime
                                                ? "bg-yellow-50 text-yellow-600 border border-yellow-300 cursor-not-allowed"
                                                : isBookedByOther
                                                  ? "bg-red-50 text-red-400 border border-red-200 cursor-not-allowed line-through"
                                                  : isSelectedForOtherService
                                                    ? "bg-amber-50 text-amber-500 border border-amber-200 cursor-not-allowed"
                                                    : "bg-white text-gray-700 border border-gray-200 hover:border-pink-300 hover:bg-pink-50"
                                        }`}
                                      >
                                        {slot.time}
                                        {(isClosesBeforeFinish || isInsufficientTime) && (
                                          <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full flex items-center justify-center">
                                            <span className="text-white text-[8px]">!</span>
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                              {/* Show legend for unavailable slot reasons */}
                              {slots.some(s => s.reason === 'closes_before_finish' || s.reason === 'insufficient_time') && (
                                <div className="mt-3 text-[10px] text-gray-500 flex flex-wrap gap-3 bg-gray-50 p-2 rounded-lg">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded bg-orange-300"></span>
                                    Branch closes before service ends
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded bg-yellow-300"></span>
                                    Would overlap with next booking
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                          </div>

              {/* Navigation Buttons */}
              <div className="flex justify-between items-center gap-3 pt-6 sm:pt-8 mt-6 sm:mt-8 border-t-2 border-gray-100">
                <button
                  onClick={() => setBkStep(1)}
                  className="px-6 sm:px-8 py-3 border-2 border-gray-300 text-gray-700 font-semibold text-sm sm:text-base rounded-lg hover:bg-gray-50 transition-all"
                >
                  <i className="fas fa-arrow-left mr-2"></i>
                  Back
                </button>
                <button
                  onClick={() => {
                    // Check if user is authenticated before proceeding to confirmation
                    if (!isAuthenticated || !currentCustomer) {
                      // Show auth modal and set pending step 3 navigation flag
                      setPendingStep3Navigation(true);
                      setShowAuthModal(true);
                    } else {
                      // User is authenticated, proceed to step 3
                      setBkStep(3);
                    }
                  }}
                  disabled={!bkDate || Object.keys(bkServiceTimes).length !== bkSelectedServices.length}
                  className={`px-6 sm:px-8 py-3 rounded-lg font-semibold text-sm sm:text-base text-white transition-all ${
                    bkDate && Object.keys(bkServiceTimes).length === bkSelectedServices.length
                      ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:shadow-lg"
                      : "bg-gray-300 cursor-not-allowed"
                  }`}
                >
                  Continue to Confirm
                  <i className="fas fa-arrow-right ml-2"></i>
                </button>
              </div>
                        </div>
                    )}

          {/* Step 3: Confirm */}
          {bkStep === 3 && (
            <div className="space-y-4 sm:space-y-6">
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6 text-center">
                Confirm Your Booking
              </h3>

              {/* Two Column Layout: Customer Details (Left) & Booking Summary (Right) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                
                {/* LEFT: Customer Details */}
                <div className="bg-gray-50 rounded-lg sm:rounded-xl p-4 sm:p-6 border-2 border-gray-200">
                  <div className="flex items-center gap-2 mb-4">
                    <i className="fas fa-user-circle text-pink-600 text-xl"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">Customer Details</h4>
                  </div>
                  
                  <div className="space-y-4">
                    {/* Full Name */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        <i className="fas fa-user text-gray-500 mr-2"></i>
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={currentCustomer?.fullName || ""}
                        onChange={(e) => setCurrentCustomer({ ...currentCustomer, fullName: e.target.value })}
                        placeholder="Enter your full name"
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base text-gray-900"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        <i className="fas fa-envelope text-gray-500 mr-2"></i>
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={currentCustomer?.email || ""}
                        onChange={(e) => setCurrentCustomer({ ...currentCustomer, email: e.target.value })}
                        placeholder="Enter your email"
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base text-gray-900"
                      />
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        <i className="fas fa-phone text-gray-500 mr-2"></i>
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={currentCustomer?.phone || ""}
                        onChange={(e) => setCurrentCustomer({ ...currentCustomer, phone: e.target.value })}
                        placeholder="Enter your phone number"
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base text-gray-900"
                      />
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        <i className="fas fa-sticky-note text-gray-500 mr-2"></i>
                        Additional Notes (Optional)
                      </label>
                      <textarea
                        value={bkNotes}
                        onChange={(e) => setBkNotes(e.target.value)}
                        placeholder="Any special requests or notes..."
                        rows={3}
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base resize-none text-gray-900"
                      ></textarea>
                    </div>
                  </div>
                </div>

                {/* RIGHT: Booking Summary */}
                <div className="bg-gray-50 rounded-lg sm:rounded-xl p-4 sm:p-6 border-2 border-gray-200">
                  <div className="flex items-center gap-2 mb-4">
                    <i className="fas fa-clipboard-list text-pink-600 text-xl"></i>
                    <h4 className="text-lg sm:text-xl font-bold text-gray-800">Booking Summary</h4>
                  </div>

                  <div className="space-y-3 sm:space-y-4">
                    {/* Location */}
                    <div className="flex items-center justify-between text-sm sm:text-base pb-3 border-b border-gray-200">
                      <span className="text-gray-600 font-medium flex items-center gap-2">
                        <i className="fas fa-map-marker-alt text-gray-500"></i>
                        Location:
                      </span>
                      <span className="font-semibold text-gray-800 text-right">
                        {branches.find((b) => b.id === bkBranchId)?.name}
                      </span>
                    </div>
                    
                    {/* Services */}
                    <div className="pb-3 border-b border-gray-200">
                      <span className="text-gray-600 font-medium block mb-3 text-sm sm:text-base flex items-center gap-2">
                        <i className="fas fa-concierge-bell text-gray-500"></i>
                        Services ({bkSelectedServices.length}):
                      </span>
                      <div className="space-y-2">
                        {bkSelectedServices.map((serviceId) => {
                          const service = servicesList.find((s) => String(s.id) === String(serviceId));
                          const time = bkServiceTimes[String(serviceId)];
                          const staffId = bkServiceStaff[String(serviceId)];
                          const staffName = staffId ? staffList.find(s => s.id === staffId)?.name : "Any Staff";
                          
                          return (
                            <div key={String(serviceId)} className="bg-white rounded-lg p-3 border border-gray-200">
                              <div className="flex justify-between items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-gray-800 text-sm sm:text-base truncate">{service?.name}</div>
                                  <div className="text-[10px] sm:text-xs text-gray-600 mt-1">
                                    <span className="mr-3"><i className="fas fa-clock mr-1"></i> {time} ({service?.duration} min)</span>
                                    <span className="block sm:inline sm:ml-0 mt-1 sm:mt-0"><i className="fas fa-user mr-1"></i> {staffName}</span>
                                  </div>
                                </div>
                                <div className="font-bold text-gray-800 text-sm sm:text-base flex-shrink-0">${service?.price}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Date */}
                    <div className="flex items-center justify-between text-sm sm:text-base pb-3 border-b border-gray-200">
                      <span className="text-gray-600 font-medium flex items-center gap-2">
                        <i className="fas fa-calendar text-gray-500"></i>
                        Date:
                      </span>
                      <span className="font-semibold text-gray-800 text-right">
                        {bkDate?.toLocaleDateString()}
                      </span>
                    </div>


                    {/* Total Duration */}
                    <div className="flex items-center justify-between pt-3 border-t-2 border-gray-300">
                      <span className="text-gray-700 font-semibold text-sm sm:text-base flex items-center gap-2">
                        <i className="fas fa-hourglass-half text-gray-500"></i>
                        Total Duration:
                      </span>
                      <span className="font-bold text-gray-800 text-sm sm:text-base">
                        {bkSelectedServices.reduce((sum: number, serviceId) => {
                          const service = servicesList.find((s) => String(s.id) === String(serviceId));
                          return sum + (Number(service?.duration) || 0);
                        }, 0)} min
                      </span>
                    </div>

                    {/* Total Price */}
                    <div className="flex items-center justify-between pt-3 bg-white rounded-lg p-4 border-2 border-gray-300">
                      <span className="text-gray-800 font-bold text-base sm:text-lg flex items-center gap-2">
                        <i className="fas fa-dollar-sign text-gray-600"></i>
                        Total Price:
                      </span>
                      <span className="font-black text-2xl sm:text-3xl text-gray-800">
                        ${bkSelectedServices.reduce((sum: number, serviceId) => {
                          const service = servicesList.find((s) => String(s.id) === String(serviceId));
                          return sum + (Number(service?.price) || 0);
                        }, 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Terms and Conditions */}
              {termsAndConditions && (
                <div className="bg-purple-50 rounded-xl p-4 border-2 border-purple-200">
                  <div className="flex items-start gap-3">
                    <div 
                      onClick={() => !agreedToTerms && setShowTermsModal(true)}
                      className={`w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        agreedToTerms 
                          ? "bg-purple-600 border-purple-600" 
                          : "border-purple-400 bg-white cursor-pointer hover:border-purple-500"
                      }`}
                    >
                      {agreedToTerms && <i className="fas fa-check text-white text-xs"></i>}
                    </div>
                    <div className="text-sm text-gray-700">
                      I have read and agree to the{" "}
                      <button
                        type="button"
                        onClick={() => setShowTermsModal(true)}
                        className="text-purple-600 font-semibold underline hover:text-purple-800"
                      >
                        Terms and Conditions
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Messages */}
              {(!currentCustomer?.fullName || !currentCustomer?.email || !currentCustomer?.phone) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                  <i className="fas fa-exclamation-triangle text-amber-500"></i>
                  <span className="text-sm text-amber-700">Please fill in all required customer details (Name, Email, Phone)</span>
                </div>
              )}

              {termsAndConditions && !agreedToTerms && currentCustomer?.fullName && currentCustomer?.email && currentCustomer?.phone && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                  <i className="fas fa-exclamation-triangle text-amber-500"></i>
                  <span className="text-sm text-amber-700">Please agree to the Terms and Conditions to proceed</span>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between items-center gap-3 pt-6 sm:pt-8 mt-6 sm:mt-8 border-t-2 border-gray-100">
                <button
                  onClick={() => setBkStep(2)}
                  className="px-6 sm:px-8 py-3 border-2 border-gray-300 text-gray-700 font-semibold text-sm sm:text-base rounded-lg hover:bg-gray-50 transition-all"
                >
                  <i className="fas fa-arrow-left mr-2"></i>
                  Back
                </button>
                <button
                  onClick={handleConfirmBooking}
                  disabled={
                    submittingBooking || 
                    !currentCustomer?.fullName || 
                    !currentCustomer?.email || 
                    !currentCustomer?.phone ||
                    (!!termsAndConditions && !agreedToTerms)
                  }
                  className={`px-6 sm:px-8 py-3 sm:py-4 rounded-lg font-bold text-sm sm:text-base text-white transition-all ${
                    submittingBooking || 
                    !currentCustomer?.fullName || 
                    !currentCustomer?.email || 
                    !currentCustomer?.phone ||
                    (!!termsAndConditions && !agreedToTerms)
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-pink-600 to-purple-600 hover:shadow-2xl hover:scale-105"
                  }`}
                >
                  {submittingBooking ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                      Confirming...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check-circle mr-2"></i>
                      Confirm Booking
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Terms and Conditions Modal */}
          {showTermsModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[75vh] flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <i className="fas fa-file-contract text-purple-600 text-xs"></i>
                    Terms and Conditions
                  </h3>
                  <button
                    onClick={() => {
                      setShowTermsModal(false);
                      setHasScrolledToBottom(false);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <i className="fas fa-times text-sm text-gray-500"></i>
                  </button>
                </div>
                <div 
                  className="px-4 py-3 overflow-y-auto flex-1"
                  onScroll={(e) => {
                    const target = e.target as HTMLDivElement;
                    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 20;
                    if (isAtBottom && !hasScrolledToBottom) {
                      setHasScrolledToBottom(true);
                    }
                  }}
                >
                  <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {termsAndConditions}
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-gray-200">
                  {!hasScrolledToBottom ? (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                      <i className="fas fa-arrow-down animate-bounce"></i>
                      <span>Please scroll down to read all terms</span>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setShowTermsModal(false);
                          setHasScrolledToBottom(false);
                        }}
                        className="px-4 py-2 text-xs border border-gray-300 text-gray-600 font-medium rounded-lg hover:bg-gray-50 transition-all"
                      >
                        Close
                      </button>
                      <button
                        onClick={() => {
                          setAgreedToTerms(true);
                          setShowTermsModal(false);
                          setHasScrolledToBottom(false);
                        }}
                        className="px-4 py-2 text-xs bg-gradient-to-r from-pink-600 to-purple-600 text-white font-medium rounded-lg hover:shadow-lg transition-all"
                      >
                        <i className="fas fa-check mr-1.5"></i>
                        I Agree
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
                    </div>
                </div>

      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 relative">
            {/* Close Button */}
            <button
              onClick={() => {
                setShowSuccess(false);
                setBkStep(1);
                setBkBranchId(null);
                setBkSelectedServices([]);
                setBkServiceTimes({});
                setBkServiceStaff({});
                setBkDate(null);
                setBkNotes("");
                setAgreedToTerms(false);
              }}
              className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <i className="fas fa-times text-xl text-gray-500 hover:text-gray-700"></i>
            </button>
            
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
                <i className="fas fa-check-circle text-4xl text-green-600"></i>
                    </div>
              <h3 className="text-3xl font-bold text-gray-800 mb-4">
                Booking Confirmed!
              </h3>
              {bookingCode && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <p className="text-sm text-gray-600 mb-1">Your Booking Code</p>
                  <p className="text-2xl font-bold text-pink-600">{bookingCode}</p>
                  </div>
              )}
              
              {/* Show booked services with times */}
              {bkSelectedServices.length > 0 && (
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 mb-4 text-left">
                  <p className="text-sm text-gray-600 font-semibold mb-3 text-center">Your Services:</p>
                  <div className="space-y-2">
                    {bkSelectedServices.map((serviceId) => {
                      const service = servicesList.find((s) => String(s.id) === String(serviceId));
                              const time = bkServiceTimes[String(serviceId)];
                              const staffId = bkServiceStaff[String(serviceId)];
                              const staffName = staffId ? staffList.find(s => s.id === staffId)?.name : "Any Staff";
                              return (
                        <div key={String(serviceId)} className="bg-white rounded-lg p-3 border border-purple-200 flex justify-between items-center">
                          <div>
                            <div className="font-semibold text-gray-800">{service?.name}</div>
                            <div className="text-xs text-purple-600 mt-1">
                              <span className="mr-2"><i className="fas fa-clock mr-1"></i> {time}</span>
                              <span className="text-gray-500"><i className="fas fa-user mr-1"></i> {staffName}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-gray-500">{service?.duration} min</div>
                            <div className="font-bold text-pink-600">${service?.price}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                  <div className="mt-3 pt-3 border-t border-purple-200 flex justify-between items-center">
                    <span className="font-semibold text-gray-700">Total:</span>
                    <span className="font-bold text-xl text-pink-600">
                      ${bkSelectedServices.reduce((sum: number, serviceId) => {
                        const service = servicesList.find((s) => String(s.id) === String(serviceId));
                        return sum + (Number(service?.price) || 0);
                          }, 0)}
                    </span>
                      </div>
                    </div>
              )}

              <p className="text-gray-600 mb-6">
                Your appointment{bkSelectedServices.length > 1 ? 's have' : ' has'} been successfully booked for {bkDate?.toLocaleDateString()}!
              </p>
                <button
                onClick={() => {
                  setShowSuccess(false);
                  setBkStep(1);
                  setBkBranchId(null);
                  setBkSelectedServices([]);
                  setBkServiceTimes({});
                  setBkServiceStaff({});
                  setBkDate(null);
                  setBkNotes("");
                  setAgreedToTerms(false);
                }}
                className="w-full px-6 py-3 bg-gradient-to-r from-pink-600 to-purple-600 text-white font-semibold rounded-lg hover:shadow-lg transition-all"
              >
                Book Another Appointment
                </button>
              </div>
            </div>
      </div>
      )}

      {/* Notification Panel */}
      <NotificationPanel
        isOpen={showNotificationPanel}
        onClose={() => {
          setShowNotificationPanel(false);
          // Refresh unread count when panel closes
          setTimeout(() => {
            if (currentCustomer) {
              const fetchCount = async () => {
                try {
                  // Get auth token for secure API access
                  const token = await getAuthToken();
                  if (!token) {
                    return;
                  }

                  const params = new URLSearchParams();
                  params.set("limit", "50");
                  const response = await fetch(`/api/notifications?${params.toString()}`, {
                    method: "GET",
                    headers: {
                      "Authorization": `Bearer ${token}`,
                      "Content-Type": "application/json",
                    },
                  });
                  const data = await response.json();
                  if (response.ok && Array.isArray(data.notifications)) {
                    setUnreadNotificationCount(data.notifications.filter((n: any) => !n.read).length);
                  }
                } catch (err) {
                  console.error("Error refreshing unread count:", err);
                }
              };
              fetchCount();
            }
          }, 500);
        }}
        customerEmail={currentCustomer?.email}
        customerPhone={currentCustomer?.phone}
        customerUid={currentCustomer?.uid}
      />

      {/* Google Fonts - Open Sans */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      
      {/* Font Awesome loaded in layout.tsx */}
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-pink-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <BookPageContent />
    </Suspense>
  );
}

