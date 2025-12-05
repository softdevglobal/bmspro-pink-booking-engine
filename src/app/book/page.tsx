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
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);

  // Fetch unread notification count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!isAuthenticated || !currentCustomer) return;

      try {
        const params = new URLSearchParams();
        if (currentCustomer.uid) {
          params.set("uid", currentCustomer.uid);
        } else if (currentCustomer.email) {
          params.set("email", currentCustomer.email);
        } else if (currentCustomer.phone) {
          params.set("phone", currentCustomer.phone);
        } else {
          return;
        }
        params.set("limit", "50");

        const response = await fetch(`/api/notifications?${params.toString()}`);
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

    // Get occupied slots if a staff member is selected for this service
    const staffIdForService = forServiceId ? bkServiceStaff[String(forServiceId)] : null;
    const relevantBookings = staffIdForService
      ? bookings.filter(b => b.staffId === staffIdForService && b.status !== "Canceled")
      : []; // If no staff selected, we might need to check if ANY staff is available, but for now let's assume generic availability if no staff picked
      // Actually, if no staff is picked ("Any Available"), we should ideally check if *at least one* staff is free.
      // But the current logic didn't seem to do that deeply. Let's stick to: if staff selected, check their calendar.

    const isSlotOccupied = (startMin: number, endMin: number) => {
       if (!staffIdForService) return false; // optimizing for "Any"
       // Check overlap with relevant bookings
       // This is a simplified check; real system might need more complex availability
       return relevantBookings.some(b => {
         const bStart = b.time.split(':').map(Number);
         const bStartMin = bStart[0] * 60 + bStart[1];
         const bEndMin = bStartMin + b.duration;
         return (startMin < bEndMin && endMin > bStartMin);
       });
    };
    
    for (let h = startHour; h < endHour; h++) {
      for (let m of [0, 30]) {
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        
        // Check if this slot + duration fits within working hours
        const [hours, minutes] = timeStr.split(':').map(Number);
        const slotStartMinutes = hours * 60 + minutes;
        const slotEndMinutes = slotStartMinutes + serviceDuration;
        const endHourMinutes = endHour * 60;
        
        if (slotEndMinutes <= endHourMinutes && !isSlotOccupied(slotStartMinutes, slotEndMinutes)) {
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
      
      // If date is selected, check weekly schedule
      if (dayOfWeek && (st as any).weeklySchedule) {
        const schedule = (st as any).weeklySchedule[dayOfWeek];
        if (!schedule) return false;
        if (schedule.branchId && schedule.branchId !== bkBranchId) return false;
      } else {
        if (st.branchId && st.branchId !== bkBranchId) return false;
      }
      
      // Check service capability
      if (service?.staffIds && service.staffIds.length > 0) {
         // Check both id and uid
         const canPerform = service.staffIds.some(id => String(id) === st.id || String(id) === (st as any).uid);
         if (!canPerform) return false;
      }
      
      return true;
    });
  };
  
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
      const result = await createBooking({
        ownerUid,
        client: currentCustomer.fullName || "Customer",
        clientEmail: currentCustomer.email || "",
        clientPhone: currentCustomer.phone || "",
        notes: bkNotes?.trim() || undefined,
        serviceId: serviceIds, // Multiple service IDs as comma-separated
        serviceName: serviceNames, // Multiple service names
        staffId: mainStaffId,
        staffName: mainStaffName,
        branchId: bkBranchId,
        branchName: selectedBranch?.name || "",
        date: formatLocalYmd(bkDate),
        time: mainBookingTime,
        duration: totalDuration,
        status: "Pending",
        price: totalPrice,
        customerUid: currentCustomer.uid,
        services: selectedServiceObjects.map((s) => {
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
        }),
      });
      
      await incrementCustomerBookings(currentCustomer.uid);
      
      setBookingCode(result.bookingCode || "");
      setShowSuccess(true);
      
      // We don't reset here anymore, we reset when closing the success modal
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
                  className="w-full pl-12 pr-12 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
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
            className="w-10 h-10 bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 text-white font-semibold rounded-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center relative"
            title="Notifications"
          >
            <i className="fas fa-bell"></i>
            {unreadNotificationCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-lg border-2 border-purple-700 animate-pulse">
                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
              </span>
            )}
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

                {/* Time & Staff Selection for Each Service */}
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3 sm:mb-4 flex items-center gap-2">
                    <i className="fas fa-clock text-purple-600 text-base sm:text-lg"></i>
                    <span className="text-sm sm:text-xl">Select Staff & Time for Each Service</span>
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
                                  slots.map((time) => (
                                    <button
                                      key={time}
                                      onClick={() => setBkServiceTimes({ ...bkServiceTimes, [String(serviceId)]: time })}
                                      className={`py-2 px-1 rounded-lg font-semibold text-xs transition-all ${
                                        selectedTime === time
                                          ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-md transform scale-105"
                                          : "bg-white text-gray-700 border border-gray-200 hover:border-pink-300 hover:bg-pink-50"
                                      }`}
                                    >
                                      {time}
                                    </button>
                                  ))
                                )}
                              </div>
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
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base"
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
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base"
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
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base"
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
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm sm:text-base resize-none"
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
                  const params = new URLSearchParams();
                  if (currentCustomer.uid) params.set("uid", currentCustomer.uid);
                  else if (currentCustomer.email) params.set("email", currentCustomer.email);
                  else if (currentCustomer.phone) params.set("phone", currentCustomer.phone);
                  params.set("limit", "50");
                  const response = await fetch(`/api/notifications?${params.toString()}`);
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

