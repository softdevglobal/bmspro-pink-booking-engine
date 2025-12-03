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
  const [bkServiceId, setBkServiceId] = useState<number | null>(null);
  const [bkStaffId, setBkStaffId] = useState<string | null>(null);
  const [bkMonthYear, setBkMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [bkDate, setBkDate] = useState<Date | null>(null);
  const [bkTime, setBkTime] = useState<string | null>(null);
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
          
          if (customerSnap.exists()) {
            const customerData = customerSnap.data();
            setCurrentCustomer({
              uid: user.uid,
              email: customerData.email || user.email,
              fullName: customerData.fullName || user.displayName,
              phone: customerData.phone || "",
            });
          } else {
            setCurrentCustomer({
              uid: user.uid,
              email: user.email,
              fullName: user.displayName,
              phone: "",
            });
          }
        } catch (error: any) {
          setCurrentCustomer({
            uid: user.uid,
            email: user.email,
            fullName: user.displayName,
            phone: "",
          });
        }
        
        setShowAuthModal(false);
      } else {
        setIsAuthenticated(false);
        setCurrentCustomer(null);
        setShowAuthModal(true);
      }
    });

    return () => unsubscribe();
  }, []);

  // Load salon data
  useEffect(() => {
    if (!ownerUid) return;

    const loadData = async () => {
      try {
        const { doc, getDoc, collection, query, where, getDocs } = await import("firebase/firestore");
        
        // Load owner/salon name
        const ownerDoc = await getDoc(doc(db, "users", ownerUid));
        if (ownerDoc.exists()) {
          setSalonName(ownerDoc.data().salonName || ownerDoc.data().displayName || "Salon");
        }

        // Load branches
        const branchesQuery = query(collection(db, "branches"), where("ownerUid", "==", ownerUid));
        const branchesSnap = await getDocs(branchesQuery);
        const branchesData = branchesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
        setBranches(branchesData);

        // Load services
        const servicesQuery = query(collection(db, "services"), where("ownerUid", "==", ownerUid));
        const servicesSnap = await getDocs(servicesQuery);
        const servicesData = servicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
        setServicesList(servicesData);

        // Load staff
        const staffQuery = query(collection(db, "salonStaff"), where("ownerUid", "==", ownerUid));
        const staffSnap = await getDocs(staffQuery);
        const staffData = staffSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
        setStaffList(staffData);

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

      // Sign in with the custom token
      await signInWithCustomToken(auth, data.token);
      await createCustomerDocument(auth.currentUser);
      
      setShowAuthModal(false);
    } catch (error: any) {
      setAuthError(error.message || "Registration failed");
    } finally {
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
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      // Sign in with the custom token
      await signInWithCustomToken(auth, data.token);
      
      setShowAuthModal(false);
    } catch (error: any) {
      setAuthError(error.message || "Login failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    await signOut(auth);
    setShowLogoutConfirm(false);
    router.push("/");
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
  const computeSlots = (): string[] => {
    if (!bkDate) return [];
    
    const slots: string[] = [];
    const startHour = 9;
    const endHour = 18;
    
    for (let h = startHour; h < endHour; h++) {
      for (let m of [0, 30]) {
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        slots.push(timeStr);
      }
    }
    
    return slots;
  };

  // Filter services and staff based on selection
  const availableServices = bkBranchId
    ? servicesList.filter((s) => !s.branches || s.branches.length === 0 || s.branches.includes(bkBranchId))
    : [];

  const availableStaff = bkBranchId
    ? staffList.filter((st) => !st.branchId || st.branchId === bkBranchId)
    : [];

  // Handle booking confirmation
  const handleConfirmBooking = async () => {
    if (!bkBranchId || !bkServiceId || !bkDate || !bkTime || !currentCustomer) return;

    setSubmittingBooking(true);

    const selectedService = servicesList.find((s) => String(s.id) === String(bkServiceId));
    const selectedBranch = branches.find((b) => b.id === bkBranchId);
    const selectedStaff = bkStaffId ? staffList.find((st) => st.id === bkStaffId) : null;

    try {
      const result = await createBooking({
        ownerUid,
        client: currentCustomer.fullName || "Customer",
        clientEmail: currentCustomer.email || "",
        clientPhone: currentCustomer.phone || "",
        notes: bkNotes?.trim() || undefined,
        serviceId: bkServiceId,
        serviceName: selectedService?.name || "",
        staffId: bkStaffId || null,
        staffName: selectedStaff?.name || "Any Available",
        branchId: bkBranchId,
        branchName: selectedBranch?.name || "",
        date: formatLocalYmd(bkDate),
        time: bkTime,
        duration: selectedService?.duration || 60,
        status: "Pending",
        price: selectedService?.price || 0,
        customerUid: currentCustomer.uid,
      });

      await incrementCustomerBookings(currentCustomer.uid);

      setBookingCode(result.bookingCode || "");
      setShowSuccess(true);
      
      // Reset wizard
      setBkStep(1);
      setBkBranchId(null);
      setBkServiceId(null);
      setBkStaffId(null);
      setBkDate(null);
      setBkTime(null);
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

  // Authentication Modal
  if (showAuthModal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-pink-100 rounded-full mb-4">
              <i className="fas fa-user text-2xl text-pink-600"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {authMode === "login" ? "Welcome Back" : "Create Account"}
            </h2>
            <p className="text-gray-600">
              {authMode === "login" ? "Sign in to book your appointment" : "Register to get started"}
            </p>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm">
              {authError}
            </div>
          )}

          <div className="space-y-4">
            {authMode === "register" && (
              <>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={authFullName}
                  onChange={(e) => setAuthFullName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                />
                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={authPhone}
                  onChange={(e) => setAuthPhone(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                />
              </>
            )}

            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
              >
                <i className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"}`}></i>
              </button>
            </div>

            <button
              onClick={authMode === "login" ? handleLogin : handleRegister}
              disabled={authLoading}
              className="w-full px-6 py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition disabled:bg-gray-400"
            >
              {authLoading ? "Please wait..." : authMode === "login" ? "Sign In" : "Register"}
            </button>

            <button
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
              className="w-full text-pink-600 hover:text-pink-700 font-medium"
            >
              {authMode === "login" ? "Don't have an account? Register" : "Already have an account? Sign In"}
            </button>
          </div>
        </div>
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
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Progress Steps */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {[
              { num: 1, label: "Location & Service" },
              { num: 2, label: "Date, Time & Staff" },
              { num: 3, label: "Confirm" }
            ].map((step, i) => (
              <div key={step.num} className="flex-1 flex items-center">
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    bkStep >= step.num 
                      ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white shadow-lg" 
                      : "bg-gray-200 text-gray-500"
                  }`}>
                    {bkStep > step.num ? <i className="fas fa-check" /> : step.num}
                  </div>
                  <span className="text-xs text-gray-600 font-semibold text-center">{step.label}</span>
                </div>
                {i < 2 && (
                  <div className={`h-1 flex-1 mx-2 rounded transition-all ${
                    bkStep > step.num ? "bg-gradient-to-r from-pink-500 to-purple-500" : "bg-gray-300"
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          {/* Step 1: Location & Service */}
          {bkStep === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fas fa-map-marker-alt text-pink-600"></i>
                  Select Location
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {branches.map((branch) => (
                    <button
                      key={branch.id}
                      onClick={() => {
                        setBkBranchId(branch.id);
                        setBkServiceId(null);
                      }}
                      className={`text-left border-2 rounded-xl p-4 transition-all ${
                        bkBranchId === branch.id
                          ? "border-pink-500 bg-pink-50 shadow-lg"
                          : "border-gray-200 hover:border-pink-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          bkBranchId === branch.id ? "bg-pink-100" : "bg-gray-100"
                        }`}>
                          <i className={`fas fa-store text-xl ${
                            bkBranchId === branch.id ? "text-pink-600" : "text-gray-400"
                          }`}></i>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-800">{branch.name}</div>
                          <div className="text-sm text-gray-500">{branch.address}</div>
                        </div>
                        {bkBranchId === branch.id && (
                          <i className="fas fa-check-circle text-pink-600 text-xl"></i>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className={!bkBranchId ? "opacity-50 pointer-events-none" : ""}>
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <i className="fas fa-concierge-bell text-purple-600"></i>
                  Select Service
                  {!bkBranchId && <span className="text-sm font-normal text-gray-500">(Select location first)</span>}
                </h3>
                {!bkBranchId ? (
                  <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                    <i className="fas fa-map-marker-alt text-5xl text-gray-300 mb-4"></i>
                    <p className="text-gray-500 font-medium">Select a location first</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {availableServices.map((service) => (
                      <button
                        key={service.id}
                        onClick={() => setBkServiceId(service.id as number)}
                        className={`text-left border-2 rounded-xl p-4 transition-all ${
                          bkServiceId === service.id
                            ? "border-purple-500 bg-purple-50 shadow-lg"
                            : "border-gray-200 hover:border-purple-300"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                            bkServiceId === service.id ? "bg-purple-100" : "bg-gray-100"
                          }`}>
                            <i className={`fas fa-cut text-xl ${
                              bkServiceId === service.id ? "text-purple-600" : "text-gray-400"
                            }`}></i>
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-gray-800">{service.name}</div>
                            <div className="text-sm text-gray-500">
                              {service.duration} min • ${service.price}
                            </div>
                          </div>
                          {bkServiceId === service.id && (
                            <i className="fas fa-check-circle text-purple-600 text-xl"></i>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={() => setBkStep(2)}
                  disabled={!bkBranchId || !bkServiceId}
                  className={`px-8 py-3 rounded-lg font-semibold text-white transition-all ${
                    bkBranchId && bkServiceId
                      ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:shadow-lg"
                      : "bg-gray-300 cursor-not-allowed"
                  }`}
                >
                  Continue to Date & Time
                  <i className="fas fa-arrow-right ml-2"></i>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Date, Time & Staff */}
          {bkStep === 2 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Date Selection */}
                <div>
                  <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <i className="fas fa-calendar text-pink-600"></i>
                    Select Date
                  </h3>
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={goPrevMonth} className="w-10 h-10 rounded-lg bg-white hover:bg-gray-100 flex items-center justify-center">
                        <i className="fas fa-chevron-left text-gray-600"></i>
                      </button>
                      <div className="font-semibold text-gray-800">{monthName}</div>
                      <button onClick={goNextMonth} className="w-10 h-10 rounded-lg bg-white hover:bg-gray-100 flex items-center justify-center">
                        <i className="fas fa-chevron-right text-gray-600"></i>
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-xs font-semibold text-gray-600 mb-2">
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
                            onClick={() => cell.date && !isPast && (setBkDate(cell.date), setBkTime(null))}
                            disabled={!cell.date || isPast}
                            className={`aspect-square rounded-lg text-sm font-medium transition-all ${
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

                {/* Time & Staff Selection */}
                <div>
                  <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <i className="fas fa-clock text-purple-600"></i>
                    Select Time
                  </h3>
                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 mb-4">
                    {!bkDate ? (
                      <div className="text-center py-12">
                        <i className="fas fa-calendar-day text-4xl text-gray-300 mb-2"></i>
                        <p className="text-gray-500 text-sm">Select a date first</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2">
                        {computeSlots().map((time) => (
                          <button
                            key={time}
                            onClick={() => setBkTime(time)}
                            className={`py-2 px-1 rounded-lg font-semibold text-sm transition-all ${
                              bkTime === time
                                ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-lg"
                                : "bg-white text-gray-700 border border-purple-200 hover:border-pink-400"
                            }`}
                          >
                            {time}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <i className="fas fa-user text-indigo-600"></i>
                    Select Staff (Optional)
                  </h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => setBkStaffId(null)}
                      className={`w-full text-left border-2 rounded-lg p-3 transition-all ${
                        bkStaffId === null
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-gray-200 hover:border-indigo-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          bkStaffId === null ? "bg-indigo-100" : "bg-gray-100"
                        }`}>
                          <i className={`fas fa-random ${
                            bkStaffId === null ? "text-indigo-600" : "text-gray-400"
                          }`}></i>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-800">Any Available Staff</div>
                          <div className="text-xs text-gray-500">We'll assign the best available</div>
                        </div>
                        {bkStaffId === null && (
                          <i className="fas fa-check-circle text-indigo-600"></i>
                        )}
                      </div>
                    </button>
                    {availableStaff.map((staff) => (
                      <button
                        key={staff.id}
                        onClick={() => setBkStaffId(staff.id)}
                        className={`w-full text-left border-2 rounded-lg p-3 transition-all ${
                          bkStaffId === staff.id
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            bkStaffId === staff.id ? "bg-indigo-100" : "bg-gray-100"
                          }`}>
                            <i className={`fas fa-user ${
                              bkStaffId === staff.id ? "text-indigo-600" : "text-gray-400"
                            }`}></i>
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-gray-800">{staff.name}</div>
                            <div className="text-xs text-gray-500">{staff.role || "Staff Member"}</div>
                          </div>
                          {bkStaffId === staff.id && (
                            <i className="fas fa-check-circle text-indigo-600"></i>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <button
                  onClick={() => setBkStep(1)}
                  className="px-8 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-all"
                >
                  <i className="fas fa-arrow-left mr-2"></i>
                  Back
                </button>
                <button
                  onClick={() => setBkStep(3)}
                  disabled={!bkDate || !bkTime}
                  className={`px-8 py-3 rounded-lg font-semibold text-white transition-all ${
                    bkDate && bkTime
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
            <div className="space-y-6">
              <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">
                Confirm Your Booking
              </h3>

              {/* Booking Summary */}
              <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Location:</span>
                  <span className="font-semibold text-gray-800">
                    {branches.find((b) => b.id === bkBranchId)?.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Service:</span>
                  <span className="font-semibold text-gray-800">
                    {servicesList.find((s) => String(s.id) === String(bkServiceId))?.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Date:</span>
                  <span className="font-semibold text-gray-800">
                    {bkDate?.toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Time:</span>
                  <span className="font-semibold text-gray-800">{bkTime}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Staff:</span>
                  <span className="font-semibold text-gray-800">
                    {bkStaffId 
                      ? staffList.find((st) => st.id === bkStaffId)?.name 
                      : "Any Available"}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-purple-200">
                  <span className="text-gray-600 font-medium">Total:</span>
                  <span className="font-bold text-2xl text-pink-600">
                    ${servicesList.find((s) => String(s.id) === String(bkServiceId))?.price}
                  </span>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-gray-700 font-semibold mb-2">
                  Additional Notes (Optional)
                </label>
                <textarea
                  value={bkNotes}
                  onChange={(e) => setBkNotes(e.target.value)}
                  placeholder="Any special requests or notes..."
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                ></textarea>
              </div>

              <div className="flex justify-between pt-4">
                <button
                  onClick={() => setBkStep(2)}
                  className="px-8 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-all"
                >
                  <i className="fas fa-arrow-left mr-2"></i>
                  Back
                </button>
                <button
                  onClick={handleConfirmBooking}
                  disabled={submittingBooking}
                  className={`px-8 py-4 rounded-lg font-bold text-white transition-all ${
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
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
              <p className="text-gray-600 mb-6">
                Your booking has been confirmed! We've sent you a confirmation email.
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

