"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBooking, subscribeBookingsForOwnerAndDate } from "@/lib/bookings";
import { auth, db } from "@/lib/firebase";
import { signInWithCustomToken, onAuthStateChanged, signOut } from "firebase/auth";
import { createCustomerDocument, incrementCustomerBookings } from "@/lib/customers";
import NotificationPanel from "@/components/NotificationPanel";

function BookPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const DEFAULT_OWNER_UID = "0Z0k6PleLzLHXrYG8UdUKvp7DUt2";
  const ownerUid = searchParams.get("ownerUid") || DEFAULT_OWNER_UID;

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentCustomer, setCurrentCustomer] = useState<any>(null);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState<boolean>(false);
  
  // Auth form fields
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authFullName, setAuthFullName] = useState<string>("");
  const [authPhone, setAuthPhone] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  
  // Notification panel
  const [showNotificationPanel, setShowNotificationPanel] = useState<boolean>(false);

  // Booking wizard state - 3 steps
  const [bkStep, setBkStep] = useState<1 | 2 | 3>(1);
  const [bkBranchId, setBkBranchId] = useState<string | null>(null);
  const [bkSelectedServices, setBkSelectedServices] = useState<Array<number | string>>([]); // Multiple services
  const [bkServiceTimes, setBkServiceTimes] = useState<Record<string, string>>({}); // Time for each service
  const [bkStaffId, setBkStaffId] = useState<string | null>(null);
  const [bkMonthYear, setBkMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [bkDate, setBkDate] = useState<Date | null>(null);
  const [bkNotes, setBkNotes] = useState<string>("");
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [bookingCode, setBookingCode] = useState<string>("");

  // Real data from Firestore
  const [salonName, setSalonName] = useState<string>("Salon");
  const [branches, setBranches] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string | number; name: string; price?: number; duration?: number; icon?: string; branches?: string[]; staffIds?: string[] }>>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role?: string; status?: string; avatar?: string; branchId?: string; branch?: string }>>([]);
  const [bookings, setBookings] = useState<Array<{ id: string; staffId?: string; date: string; time: string; duration: number; status: string }>>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Check authentication status
  useEffect(() => {
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
        
        setIsAuthenticated(true);
        
        // Fetch customer details
        try {
          const { doc, getDoc } = await import("firebase/firestore");
          const customerRef = doc(db, "customers", user.uid);
          const customerSnap = await getDoc(customerRef);
          
          const customerData = customerSnap.exists() 
            ? {
              uid: user.uid,
                email: customerSnap.data().email || user.email,
                fullName: customerSnap.data().fullName || user.displayName,
                phone: customerSnap.data().phone || "",
              }
            : {
              uid: user.uid,
              email: user.email,
              fullName: user.displayName,
              phone: "",
              };
          
          setCurrentCustomer(customerData);
          
          // Save to localStorage
          if (typeof window !== "undefined") {
            localStorage.setItem("customerAuth", JSON.stringify(customerData));
          }
        } catch (error: any) {
          const customerData = {
            uid: user.uid,
            email: user.email,
            fullName: user.displayName,
            phone: "",
          };
          setCurrentCustomer(customerData);
          
          // Save to localStorage
          if (typeof window !== "undefined") {
            localStorage.setItem("customerAuth", JSON.stringify(customerData));
          }
        }
        
        setShowAuthModal(false);
      } else {
        setIsAuthenticated(false);
        setCurrentCustomer(null);
        setShowAuthModal(true);
        // Clear localStorage when not authenticated
        if (typeof window !== "undefined") {
          localStorage.removeItem("customerAuth");
        }
      }
    });

    return () => unsubscribe();
  }, []);

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
      
      // User is now signed in
      setIsAuthenticated(true);
      
      const customerData = {
        uid: userCredential.user.uid,
        email: userCredential.user.email || "",
        fullName: userCredential.user.displayName || "",
        phone: "",
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
      setBkStaffId(null);
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

  // Compute available time slots
  const computeSlots = (forServiceId?: number | string): string[] => {
    if (!bkDate) return [];
    
    // Get duration of the service we're scheduling
    let serviceDuration = 60;
    if (forServiceId) {
      const service = servicesList.find((s) => String(s.id) === String(forServiceId));
      serviceDuration = service?.duration || 60;
    }
    
    const slots: string[] = [];
    const startHour = 9;
    const endHour = 18;
    
    for (let h = startHour; h < endHour; h++) {
      for (let m of [0, 30]) {
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        
        // Check if this slot + duration fits within working hours
        const [hours, minutes] = timeStr.split(':').map(Number);
        const slotEndMinutes = hours * 60 + minutes + serviceDuration;
        const endHourMinutes = endHour * 60;
        
        if (slotEndMinutes <= endHourMinutes) {
          slots.push(timeStr);
        }
      }
    }
    
    return slots;
  };
  
  // Filter services and staff based on selection
  const availableServices = bkBranchId
    ? servicesList.filter((s) => !s.branches || s.branches.length === 0 || s.branches.includes(bkBranchId))
    : [];

  // Filter staff based on branch, selected services, and availability on selected date
  const availableStaff = (() => {
    if (!bkBranchId) return [];
    
    // Get day of week from selected date
    let dayOfWeek: string | null = null;
    if (bkDate) {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      dayOfWeek = days[bkDate.getDay()];
    }
    
    let filtered = staffList.filter((st) => {
      // Only show active staff
      if (st.status && st.status !== "Active") return false;
      
      // If date is selected, check weekly schedule
      if (dayOfWeek && (st as any).weeklySchedule) {
        const schedule = (st as any).weeklySchedule[dayOfWeek];
        
        // If schedule is null or undefined for this day, staff is not working
        if (!schedule) return false;
        
        // Check if staff works at the selected branch on this day
        if (schedule.branchId && schedule.branchId !== bkBranchId) return false;
      } else {
        // If no date selected yet, use basic branch filter
        if (st.branchId && st.branchId !== bkBranchId) return false;
      }
      
      return true;
    });

    // If services are selected, filter by service staffIds
    if (bkSelectedServices.length > 0) {
      const selectedServiceObjects = bkSelectedServices
        .map((serviceId) => servicesList.find((s) => String(s.id) === String(serviceId)))
        .filter(Boolean);
      
      // Check if any service has staffIds restrictions
      const servicesWithStaffRestrictions = selectedServiceObjects.filter(
        (s) => s?.staffIds && s.staffIds.length > 0
      );
      
      if (servicesWithStaffRestrictions.length > 0) {
        // Get all staff IDs that can perform at least one of the selected services
        const allowedStaffIds = new Set<string>();
        servicesWithStaffRestrictions.forEach((service) => {
          service?.staffIds?.forEach((staffId) => allowedStaffIds.add(String(staffId)));
        });
        
        // Filter to only staff who can perform the services
        // Check both id and uid fields since staffIds might reference either
        filtered = filtered.filter((st) => 
          allowedStaffIds.has(st.id) || allowedStaffIds.has((st as any).uid || "")
        );
      }
    }

    return filtered;
  })();
  
  // Handle booking confirmation
  const handleConfirmBooking = async () => {
    // Validate all required fields
    if (!bkBranchId || bkSelectedServices.length === 0 || !bkDate || !currentCustomer) return;
    
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
    const selectedStaff = bkStaffId ? staffList.find((st) => st.id === bkStaffId) : null;
    
    try {
      const result = await createBooking({
        ownerUid,
        client: currentCustomer.fullName || "Customer",
        clientEmail: currentCustomer.email || "",
        clientPhone: currentCustomer.phone || "",
        notes: bkNotes?.trim() || undefined,
        serviceId: serviceIds, // Multiple service IDs as comma-separated
        serviceName: serviceNames, // Multiple service names
        staffId: bkStaffId || null,
        staffName: selectedStaff?.name || "Any Available",
        branchId: bkBranchId,
        branchName: selectedBranch?.name || "",
        date: formatLocalYmd(bkDate),
        time: mainBookingTime,
        duration: totalDuration,
        status: "Pending",
        price: totalPrice,
        customerUid: currentCustomer.uid,
        services: selectedServiceObjects.map((s) => ({
          id: s?.id || "",
          name: s?.name || "",
          price: s?.price || 0,
          duration: s?.duration || 0,
          time: bkServiceTimes[String(s?.id)] || ""
        })),
      });
      
      await incrementCustomerBookings(currentCustomer.uid);
      
      setBookingCode(result.bookingCode || "");
      setShowSuccess(true);
      
      // Reset wizard
      setBkStep(1);
      setBkBranchId(null);
      setBkSelectedServices([]);
      setBkServiceTimes({});
      setBkStaffId(null);
      setBkDate(null);
      setBkNotes("");
    } catch (error) {
      console.error("Error creating booking:", error);
      alert("Failed to create booking. Please try again.");
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
          <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 p-8">
            
            {/* Toggle Switch */}
            <div className="relative flex bg-gray-100 rounded-full p-1 mb-8">
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
            <div className="space-y-4">
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
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
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
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
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
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
                    disabled={authLoading}
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
                  className="w-full pl-12 pr-12 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
                    disabled={authLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-900 transition-colors"
                    tabIndex={-1}
                  >
                  <i className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"}`}></i>
                  </button>
                </div>

                {authMode === "register" && (
                <p className="text-xs text-gray-500 flex items-center gap-2">
                  <i className="fas fa-info-circle text-slate-600"></i>
                  Password must be at least 6 characters
                  </p>
                )}

              <button
                onClick={authMode === "login" ? handleLogin : handleRegister}
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
            </div>
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
        {/* Notification and Logout Buttons */}
        <div className="absolute top-8 right-6 z-50 flex items-center gap-3">
          <button
            onClick={() => setShowNotificationPanel(true)}
            className="w-10 h-10 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
            title="Notifications"
          >
            <i className="fas fa-bell"></i>
          </button>
          <button
            onClick={handleLogoutClick}
            className="w-10 h-10 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
            title="Logout"
          >
            <i className="fas fa-sign-out-alt"></i>
          </button>
        </div>

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
        <div className="relative z-10 px-6 py-12 text-center">
          <div className="inline-block px-6 py-2 bg-white/10 backdrop-blur-sm rounded-full text-white text-sm font-medium mb-4">
            WELCOME TO
                </div>
          <h1 className="text-5xl font-bold text-white mb-2">{salonName}</h1>
          <p className="text-white/80">BOOK YOUR APPOINTMENT</p>
                </div>
                </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 py-4 sm:p-6 lg:p-8">
        {/* Progress Steps */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center justify-center max-w-3xl mx-auto">
            {[
              { num: 1, label: "Location & Service" },
              { num: 2, label: "Date, Time & Staff" },
              { num: 3, label: "Confirm" }
            ].map((step, i) => (
              <div key={step.num} className="flex items-center">
                <div className="flex flex-col items-center gap-1 sm:gap-2 px-2 sm:px-4">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm sm:text-base font-bold transition-all ${
                    bkStep >= step.num 
                      ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white shadow-lg" 
                      : "bg-gray-200 text-gray-500"
                  }`}>
                    {bkStep > step.num ? <i className="fas fa-check text-xs sm:text-sm" /> : step.num}
                </div>
                  <span className="text-[10px] sm:text-xs text-gray-600 font-semibold text-center leading-tight hidden sm:block max-w-[100px]">{step.label}</span>
                  <span className="text-[9px] sm:hidden text-gray-600 font-semibold text-center leading-tight">
                    {step.num === 1 ? "Select" : step.num === 2 ? "Schedule" : "Confirm"}
                  </span>
              </div>
                {i < 2 && (
                  <div className={`h-0.5 sm:h-1 w-8 sm:w-16 md:w-24 rounded transition-all ${
                    bkStep > step.num ? "bg-gradient-to-r from-pink-500 to-purple-500" : "bg-gray-300"
                  }`} />
                )}
            </div>
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
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                        const isPast = cell.date && cell.date < today;

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

                {/* Time Selection for Each Service */}
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <i className="fas fa-clock text-purple-600 text-base sm:text-lg"></i>
                    <span className="text-sm sm:text-xl">Select Time for Each Service</span>
                  </h3>
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
                    <div className="space-y-3 sm:space-y-4">
                      {bkSelectedServices.map((serviceId) => {
                        const service = servicesList.find((s) => String(s.id) === String(serviceId));
                        if (!service) return null;
                        
                        const slots = computeSlots(serviceId);
                        const selectedTime = bkServiceTimes[String(serviceId)];
                        
                        return (
                          <div key={String(serviceId)} className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg sm:rounded-xl p-3 sm:p-4 border-2 border-purple-200">
                            <div className="flex items-center justify-between mb-2 sm:mb-3">
                              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                                <i className="fas fa-cut text-purple-600 text-xs sm:text-base flex-shrink-0"></i>
                                <span className="font-bold text-gray-800 text-sm sm:text-base truncate">{service.name}</span>
                              </div>
                              <span className="text-[10px] sm:text-xs bg-white px-2 sm:px-3 py-1 rounded-full border border-purple-300 font-semibold text-purple-700 ml-2 flex-shrink-0">
                                {service.duration}min
                              </span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5 sm:gap-2">
                              {slots.length === 0 ? (
                                <div className="col-span-full text-center text-gray-400 py-4 text-xs">
                                  No available slots
                                </div>
                              ) : (
                                slots.map((time) => (
                                  <button
                                    key={time}
                                    onClick={() => setBkServiceTimes({ ...bkServiceTimes, [String(serviceId)]: time })}
                                    className={`py-1.5 sm:py-2 px-1 rounded-md sm:rounded-lg font-semibold text-[10px] sm:text-xs transition-all ${
                                      selectedTime === time
                                        ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg"
                                        : "bg-white text-gray-700 border border-purple-200 hover:border-pink-400"
                                    }`}
                                  >
                                    {time}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Staff Selection - Separate Section with More Gap */}
                <div className="pt-6 sm:pt-8 border-t-2 border-gray-100">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 sm:mb-6 flex items-center gap-2">
                    <i className="fas fa-user text-indigo-600 text-base sm:text-lg"></i>
                    Select Staff <span className="text-sm sm:text-base font-normal text-gray-500">(Optional)</span>
                  </h3>
                  <div className="space-y-3">
                              <button
                      onClick={() => setBkStaffId(null)}
                      className={`w-full text-left border-2 rounded-xl p-4 transition-all ${
                        bkStaffId === null
                          ? "border-indigo-500 bg-indigo-50 shadow-md"
                          : "border-gray-200 hover:border-indigo-300"
                                }`}
                              >
                                <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          bkStaffId === null ? "bg-indigo-100" : "bg-gray-100"
                        }`}>
                          <i className={`fas fa-random text-lg ${
                            bkStaffId === null ? "text-indigo-600" : "text-gray-400"
                          }`}></i>
                </div>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-800 text-base">Any Available Staff</div>
                          <div className="text-sm text-gray-500">We'll assign the best available</div>
                                    </div>
                        {bkStaffId === null && (
                          <i className="fas fa-check-circle text-indigo-600 text-xl"></i>
                                  )}
                                </div>
                              </button>

                    {/* Show available staff members */}
                    {availableStaff.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between px-2 mb-2">
                          <div className="text-sm font-semibold text-gray-600">
                            Or choose a specific staff member:
                    </div>
                          {bkDate && (
                            <div className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                              <i className="fas fa-check-circle mr-1"></i>
                              {availableStaff.length} available
                  </div>
                          )}
                        </div>
                        {availableStaff.map((staff) => {
                          // Get staff's branch for the selected day
                          const staffAny = staff as any;
                          let dayBranch = staffAny.branchName || branches.find(b => b.id === staff.branchId)?.name || "";
                          if (bkDate && staffAny.weeklySchedule) {
                            const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                            const dayOfWeek = days[bkDate.getDay()];
                            const daySchedule = staffAny.weeklySchedule[dayOfWeek];
                            if (daySchedule?.branchName) {
                              dayBranch = daySchedule.branchName;
                            }
                          }
                          
                            return (
                              <button
                              key={staff.id}
                              onClick={() => setBkStaffId(staff.id)}
                              className={`w-full text-left border-2 rounded-xl p-4 transition-all ${
                                bkStaffId === staff.id
                                  ? "border-indigo-500 bg-indigo-50 shadow-md"
                                  : "border-gray-200 hover:border-indigo-300"
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center ${
                                  bkStaffId === staff.id ? "bg-indigo-100 ring-2 ring-indigo-500" : "bg-gray-100"
                                }`}>
                                  {staff.avatar ? (
                                    <img 
                                      src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(staff.avatar)}`}
                                      alt={staff.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <i className={`fas fa-user text-lg ${
                                      bkStaffId === staff.id ? "text-indigo-600" : "text-gray-400"
                                    }`}></i>
                                  )}
                                  </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-gray-800 text-base">{staff.name}</div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-sm text-gray-500">
                                      {(staff as any).staffRole || staff.role || "Staff Member"}
                                    </span>
                                    {dayBranch && (
                                      <>
                                        <span className="text-gray-300">•</span>
                                        <span className="text-xs text-green-600 font-medium">
                                          <i className="fas fa-calendar-check mr-1"></i>
                                          {dayBranch}
                                        </span>
                                      </>
                                    )}
                                    </div>
                                  </div>
                                {bkStaffId === staff.id && (
                                  <i className="fas fa-check-circle text-indigo-600 text-xl"></i>
                                  )}
                                </div>
                              </button>
                            );
                        })}
                    </div>
                    )}

                    {/* Show message if no staff available */}
                    {availableStaff.length === 0 && (
                      <div className="bg-gray-50 rounded-xl p-6 text-center border-2 border-dashed border-gray-300">
                        <i className="fas fa-user-slash text-3xl text-gray-300 mb-2"></i>
                        <p className="text-gray-500 text-sm">No specific staff available for selected services</p>
                        <p className="text-xs text-gray-400 mt-1">We'll assign the best available staff</p>
                    </div>
                          )}
                  </div>
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
                  onClick={() => setBkStep(3)}
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

                {/* Booking Summary */}
              <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-lg sm:rounded-xl p-4 sm:p-6 space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between text-sm sm:text-base">
                  <span className="text-gray-600 font-medium">Location:</span>
                  <span className="font-semibold text-gray-800 text-right">
                    {branches.find((b) => b.id === bkBranchId)?.name}
                  </span>
                        </div>
                
                {/* Multiple Services with Times */}
                <div className="border-t border-purple-200 pt-3 sm:pt-4">
                  <span className="text-gray-600 font-medium block mb-2 sm:mb-3 text-sm sm:text-base">Services ({bkSelectedServices.length}):</span>
                  <div className="space-y-2">
                    {bkSelectedServices.map((serviceId) => {
                      const service = servicesList.find((s) => String(s.id) === String(serviceId));
                              const time = bkServiceTimes[String(serviceId)];
                              return (
                        <div key={String(serviceId)} className="bg-white rounded-lg p-2.5 sm:p-3 border border-purple-200">
                          <div className="flex justify-between items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-gray-800 text-sm sm:text-base truncate">{service?.name}</div>
                              <div className="text-[10px] sm:text-xs text-purple-600 mt-1">
                                <i className="fas fa-clock mr-1"></i>
                                {time} • {service?.duration} min
                          </div>
                      </div>
                            <div className="font-bold text-pink-600 text-sm sm:text-base flex-shrink-0">${service?.price}</div>
                    </div>
                              </div>
                              );
                            })}
                            </div>
                          </div>

                <div className="flex items-center justify-between text-sm sm:text-base">
                  <span className="text-gray-600 font-medium">Date:</span>
                  <span className="font-semibold text-gray-800 text-right">
                    {bkDate?.toLocaleDateString()}
                  </span>
                            </div>
                <div className="flex items-center justify-between text-sm sm:text-base">
                  <span className="text-gray-600 font-medium">Staff:</span>
                  <span className="font-semibold text-gray-800 text-right truncate ml-2">
                    {bkStaffId 
                      ? staffList.find((st) => st.id === bkStaffId)?.name 
                      : "Any Available"}
                  </span>
                      </div>
                <div className="flex items-center justify-between pt-3 sm:pt-4 border-t-2 border-purple-300">
                  <span className="text-gray-600 font-medium text-sm sm:text-base">Total Duration:</span>
                  <span className="font-semibold text-gray-800 text-sm sm:text-base">
                    {bkSelectedServices.reduce((sum: number, serviceId) => {
                      const service = servicesList.find((s) => String(s.id) === String(serviceId));
                      return sum + (Number(service?.duration) || 0);
                    }, 0)} min
                        </span>
                      </div>
                <div className="flex items-center justify-between pt-2 border-t-2 border-purple-300">
                  <span className="text-gray-600 font-medium text-base sm:text-lg">Total Price:</span>
                  <span className="font-bold text-2xl sm:text-3xl text-pink-600">
                    ${bkSelectedServices.reduce((sum: number, serviceId) => {
                      const service = servicesList.find((s) => String(s.id) === String(serviceId));
                      return sum + (Number(service?.price) || 0);
                          }, 0)}
                        </span>
                      </div>
                            </div>

              {/* Notes */}
                            <div>
                <label className="block text-gray-700 font-semibold mb-2 text-sm sm:text-base">
                  Additional Notes (Optional)
                              </label>
                <textarea
                  value={bkNotes}
                  onChange={(e) => setBkNotes(e.target.value)}
                  placeholder="Any special requests or notes..."
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                ></textarea>
                            </div>

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
                  disabled={submittingBooking}
                  className={`px-6 sm:px-8 py-3 sm:py-4 rounded-lg font-bold text-sm sm:text-base text-white transition-all ${
                    submittingBooking
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
                    </div>
                </div>

      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8">
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
                              return (
                        <div key={String(serviceId)} className="bg-white rounded-lg p-3 border border-purple-200 flex justify-between items-center">
                          <div>
                            <div className="font-semibold text-gray-800">{service?.name}</div>
                            <div className="text-xs text-purple-600 mt-1">
                              <i className="fas fa-clock mr-1"></i>
                              {time}
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
        onClose={() => setShowNotificationPanel(false)}
        customerEmail={currentCustomer?.email}
        customerPhone={currentCustomer?.phone}
        customerUid={currentCustomer?.uid}
      />

      {/* Font Awesome */}
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
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

