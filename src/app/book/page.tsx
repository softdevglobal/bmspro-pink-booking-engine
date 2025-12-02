"use client";
import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createBooking, subscribeBookingsForOwnerAndDate } from "@/lib/bookings";

function BookPageContent() {
  const searchParams = useSearchParams();
  // Default ownerUid for this salon, can be overridden via URL params
  const DEFAULT_OWNER_UID = "0Z0k6PleLzLHXrYG8UdUKvp7DUt2";
  const ownerUid = searchParams.get("ownerUid") || DEFAULT_OWNER_UID;

  // Booking state
  const [bkBranchId, setBkBranchId] = useState<string | null>(null);
  const [bkServiceId, setBkServiceId] = useState<number | null>(null);
  const [bkStaffId, setBkStaffId] = useState<string | null>(null);
  const [bkMonthYear, setBkMonthYear] = useState<{ month: number; year: number }>(() => {
    const t = new Date();
    return { month: t.getMonth(), year: t.getFullYear() };
  });
  const [bkDate, setBkDate] = useState<Date | null>(null);
  const [bkTime, setBkTime] = useState<string | null>(null);
  const [bkClientName, setBkClientName] = useState<string>("");
  const [bkClientEmail, setBkClientEmail] = useState<string>("");
  const [bkClientPhone, setBkClientPhone] = useState<string>("");
  const [bkNotes, setBkNotes] = useState<string>("");
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [bookingSummary, setBookingSummary] = useState<{
    bookingCode?: string;
    client: string;
    serviceName: string;
    branchName: string;
    staffName: string;
    date: string;
    time: string;
    price: number;
    duration: number;
  } | null>(null);

  // Real data from Firestore
  const [salonName, setSalonName] = useState<string>("Salon");
  const [branches, setBranches] = useState<Array<{ id: string; name: string; address?: string }>>([]);
  const [servicesList, setServicesList] = useState<Array<{ id: string | number; name: string; price?: number; duration?: number; icon?: string; branches?: string[]; staffIds?: string[] }>>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role?: string; status?: string; avatar?: string; branchId?: string; branch?: string }>>([]);
  const [bookings, setBookings] = useState<Array<{ id: string; staffId?: string; date: string; time: string; duration: number; status: string }>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data from API routes
  useEffect(() => {
    if (!ownerUid) {
      setLoading(false);
      console.warn("No ownerUid provided");
      return;
    }
    
    console.log("Fetching data for ownerUid:", ownerUid);
    setLoading(true);
    setError(null);
    
    const fetchData = async () => {
      try {
        // Test API connection first
        try {
          const testRes = await fetch("/api/test");
          if (!testRes.ok) {
            throw new Error("API test failed");
          }
          console.log("API test successful");
        } catch (testError) {
          console.error("API test error:", testError);
          throw new Error("API routes are not working. Please check server logs.");
        }
        
        // Fetch salon owner information first
        const ownerRes = await fetch(`/api/owner?ownerUid=${encodeURIComponent(ownerUid)}`);
        if (ownerRes.ok) {
          const ownerData = await ownerRes.json();
          const salonNameFromOwner = ownerData.owner?.salonName || ownerData.owner?.businessName || ownerData.owner?.name || "Salon";
          setSalonName(salonNameFromOwner);
          console.log("Salon name set from owner:", salonNameFromOwner);
        } else {
          console.warn("Failed to fetch owner info, using default");
          setSalonName("Salon");
        }
        
        // Fetch branches
        const branchesRes = await fetch(`/api/branches?ownerUid=${encodeURIComponent(ownerUid)}`);
        if (!branchesRes.ok) {
          const errorData = await branchesRes.json().catch(() => ({}));
          const errorMsg = errorData.error || errorData.details || `Failed to fetch branches: ${branchesRes.status}`;
          const helpText = errorData.helpText || "";
          console.error("Branches API error:", errorMsg);
          console.error("Help text:", helpText);
          throw new Error(errorMsg + (helpText ? ` ${helpText}` : ""));
        }
        const branchesData = await branchesRes.json();
        const mappedBranches = (branchesData.branches || []).map((r: any) => ({ 
          id: String(r.id), 
          name: String(r.name || ""), 
          address: String(r.address || "") 
        }));
        console.log("Branches received:", mappedBranches.length, mappedBranches);
        setBranches(mappedBranches);
        
        if (mappedBranches.length === 0) {
          setError("No branches found for this salon. Please add branches in the admin panel for owner UID: " + ownerUid);
        }
        
        // Fetch services
        const servicesRes = await fetch(`/api/services?ownerUid=${encodeURIComponent(ownerUid)}`);
        if (!servicesRes.ok) {
          const errorData = await servicesRes.json().catch(() => ({}));
          const errorMsg = errorData.error || `Failed to fetch services: ${servicesRes.status}`;
          const helpText = errorData.helpText || "";
          console.error("Services API error:", errorMsg);
          console.error("Help text:", helpText);
          throw new Error(errorMsg + (helpText ? ` ${helpText}` : ""));
        }
        const servicesData = await servicesRes.json();
        const mappedServices = (servicesData.services || [])
          .filter(Boolean)
          .map((s: any) => ({
            id: String(s.id),
            name: String(s.name || "Service"),
            price: typeof s.price === "number" ? s.price : 0,
            duration: typeof s.duration === "number" ? s.duration : 60,
            icon: String(s.icon || "fa-solid fa-star"),
            imageUrl: s.imageUrl ? String(s.imageUrl) : undefined,
            branches: Array.isArray(s.branches) ? s.branches.map(String) : [],
            staffIds: Array.isArray(s.staffIds) ? s.staffIds.map(String) : [],
          }));
        console.log("Services received:", mappedServices.length, mappedServices);
        setServicesList(mappedServices);
        
        if (mappedServices.length === 0 && mappedBranches.length > 0) {
          setError("No services found for this salon. Please add services in the admin panel.");
        }
        
        // Fetch staff
        const staffRes = await fetch(`/api/staff?ownerUid=${encodeURIComponent(ownerUid)}`);
        if (!staffRes.ok) {
          const errorData = await staffRes.json().catch(() => ({}));
          const errorMsg = errorData.error || `Failed to fetch staff: ${staffRes.status}`;
          const helpText = errorData.helpText || "";
          console.error("Staff API error:", errorMsg);
          console.error("Help text:", helpText);
          throw new Error(errorMsg + (helpText ? ` ${helpText}` : ""));
        }
        const staffData = await staffRes.json();
        const mappedStaff = (staffData.staff || []).map((r: any) => ({
          id: String(r.id),
          name: String(r.name || r.displayName || ""),
          role: r.staffRole || r.role || "Staff",
          status: r.status || "Active",
          avatar: r.avatar || r.name || r.displayName,
          branchId: r.branchId ? String(r.branchId) : undefined,
          branch: r.branchName || r.branch,
        }));
        console.log("Staff received:", mappedStaff.length, mappedStaff);
        setStaffList(mappedStaff);
        
        setLoading(false);
      } catch (error: any) {
        console.error("Error fetching data:", error);
        setError(error?.message || "Failed to load data. Please check your Firebase configuration.");
        setLoading(false);
      }
    };
    
    fetchData();
  }, [ownerUid]);

  // Subscribe to bookings for selected date
  useEffect(() => {
    if (!ownerUid || !bkDate) return;
    const dateStr = formatLocalYmd(bkDate);
    const unsub = subscribeBookingsForOwnerAndDate(ownerUid, dateStr, (rows) => {
      setBookings(
        rows.map((r: any) => ({
          id: String(r.id),
          staffId: r.staffId ? String(r.staffId) : undefined,
          date: String(r.date || dateStr),
          time: String(r.time || ""),
          duration: Number(r.duration || 0),
          status: String(r.status || "Pending"),
        }))
      );
    });
    return () => unsub();
  }, [ownerUid, bkDate]);

  const resetBooking = () => {
    setBkBranchId(null);
    setBkServiceId(null);
    setBkStaffId(null);
    const t = new Date();
    setBkMonthYear({ month: t.getMonth(), year: t.getFullYear() });
    setBkDate(null);
    setBkTime(null);
    setBkClientName("");
    setBkClientEmail("");
    setBkClientPhone("");
    setBkNotes("");
  };

  const monthName = new Date(bkMonthYear.year, bkMonthYear.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  
  const goPrevMonth = () =>
    setBkMonthYear(({ month, year }) => {
      const nm = month - 1;
      return nm < 0 ? { month: 11, year: year - 1 } : { month: nm, year };
    });
  
  const goNextMonth = () =>
    setBkMonthYear(({ month, year }) => {
      const nm = month + 1;
      return nm > 11 ? { month: 0, year: year + 1 } : { month: nm, year };
    });
  
  const buildMonthCells = () => {
    const firstDayWeekIdx = new Date(bkMonthYear.year, bkMonthYear.month, 1).getDay();
    const numDays = new Date(bkMonthYear.year, bkMonthYear.month + 1, 0).getDate();
    const cells: Array<{ label?: number; date?: Date }> = [];
    for (let i = 0; i < firstDayWeekIdx; i++) cells.push({});
    for (let d = 1; d <= numDays; d++) cells.push({ label: d, date: new Date(bkMonthYear.year, bkMonthYear.month, d) });
    while (cells.length % 7 !== 0) cells.push({});
    return cells;
  };
  
  const calculateEndTime = (startTime: string, duration: number) => {
    const [startH, startM] = startTime.split(":").map(Number);
    const totalMinutes = startH * 60 + startM + duration;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    const pad = (num: number) => num.toString().padStart(2, "0");
    return `${pad(endH)}:${pad(endM)}`;
  };
  
  const formatLocalYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  
  const timeToMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  
  const computeSlots = () => {
    if (!bkServiceId || !bkDate) return [];
    const service = servicesList.find((s) => String(s.id) === String(bkServiceId));
    if (!service) return [];
    const duration = Number(service?.duration) || 60;
    
    // Filter out occupied slots
    const dateStr = formatLocalYmd(bkDate);
    const occupied = bookings
      .filter((b) => {
        if (b.date !== dateStr || b.status === "Canceled") return false;
        if (bkStaffId && b.staffId !== bkStaffId) return false;
        return true;
      })
      .map((b) => ({ start: b.time, end: calculateEndTime(b.time, b.duration) }));
    
    const startHour = 9;
    const endHour = 17;
    const interval = 30;
    const slots: string[] = [];
    let current = startHour * 60;
    const max = endHour * 60;
    const format = (minutes: number) => {
      const h = Math.floor(minutes / 60) % 24;
      const m = minutes % 60;
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    };
    
    while (current < max) {
      const start = format(current);
      const end = calculateEndTime(start, duration);
      const ok = occupied.every((o: any) => !(timeToMinutes(o.start) < timeToMinutes(end) && timeToMinutes(o.end) > timeToMinutes(start)));
      if (ok && timeToMinutes(end) <= max) slots.push(start);
      current += interval;
    }
    return slots;
  };
  
  const handleConfirmBooking = async () => {
    if (!bkServiceId || !bkBranchId || !bkDate || !bkTime || !ownerUid) return;
    setSubmittingBooking(true);
    
    const service = servicesList.find((s) => String(s.id) === String(bkServiceId));
    if (!service) {
      alert("Service not found. Please try again.");
      setSubmittingBooking(false);
      return;
    }
    const serviceName = service?.name || "";
    const branchName = branches.find((b: any) => String(b.id) === String(bkBranchId))?.name || "";
    const staffName = bkStaffId ? staffList.find((s: any) => String(s.id) === String(bkStaffId))?.name || "" : "Any Available";
    const client = bkClientName?.trim() || "Guest";
    const bookingDate = formatLocalYmd(bkDate);
    const bookingPrice = service?.price || 0;
    const bookingDuration = service?.duration || 60;
    
    try {
      const result = await createBooking({
        ownerUid,
        client,
        clientEmail: bkClientEmail?.trim() || undefined,
        clientPhone: bkClientPhone?.trim() || undefined,
        notes: bkNotes?.trim() || undefined,
        serviceId: bkServiceId,
        serviceName,
        staffId: bkStaffId,
        staffName: staffName || "Any Available",
        branchId: bkBranchId,
        branchName,
        date: bookingDate,
        time: bkTime,
        duration: bookingDuration,
        status: "Pending",
        price: bookingPrice,
      });
      
      // Store booking summary for success popup
      setBookingSummary({
        bookingCode: result.bookingCode,
        client,
        serviceName,
        branchName,
        staffName: staffName || "Any Available",
        date: bookingDate,
        time: bkTime || "",
        price: bookingPrice,
        duration: bookingDuration,
      });
      
      setShowSuccess(true);
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

  if (showSuccess && bookingSummary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 max-w-lg w-full">
          <div className="text-center mb-6">
            <i className="fas fa-check-circle text-5xl sm:text-6xl text-green-500 mb-4" />
            <h2 className="text-xl sm:text-2xl font-bold text-slate-800 mb-2">Booking Confirmed!</h2>
            <p className="text-slate-600 text-sm sm:text-base">Your appointment has been successfully booked.</p>
          </div>
          
          {/* Booking Summary */}
          <div className="border-2 sm:border-4 border-pink-300 rounded-lg p-4 sm:p-5 bg-pink-50 mb-6">
            <div className="space-y-3 text-sm sm:text-base">
              {bookingSummary.bookingCode && (
                <div className="flex items-center justify-between pb-2 border-b-2 border-pink-200">
                  <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Booking Code</span>
                  <span className="font-mono font-bold text-slate-800">{bookingSummary.bookingCode}</span>
                </div>
              )}
              <div className="flex items-center justify-between py-2 border-b-2 border-pink-200">
                <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Service</span>
                <span className="font-bold text-slate-800 text-right">{bookingSummary.serviceName}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b-2 border-pink-200">
                <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Branch</span>
                <span className="font-bold text-slate-800 text-right">{bookingSummary.branchName}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b-2 border-pink-200">
                <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Staff</span>
                <span className="font-bold text-slate-800 text-right">{bookingSummary.staffName}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b-2 border-pink-200">
                <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Date & Time</span>
                <span className="font-bold text-slate-800 text-right">{new Date(bookingSummary.date).toLocaleDateString()} {bookingSummary.time}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b-2 border-pink-200">
                <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Duration</span>
                <span className="font-bold text-slate-800">{bookingSummary.duration} mins</span>
              </div>
              <div className="flex items-center justify-between pt-3 mt-2 border-t-4 border-pink-500">
                <span className="text-slate-800 font-bold text-base sm:text-lg uppercase tracking-wide">Total</span>
                <span className="font-black text-2xl sm:text-3xl text-pink-600">${bookingSummary.price}</span>
              </div>
            </div>
          </div>
          
          <button
            onClick={() => {
              resetBooking();
              setShowSuccess(false);
              setBookingSummary(null);
            }}
            className="w-full px-6 py-3 bg-indigo-900 hover:bg-indigo-800 text-white font-semibold rounded-lg transition-all transform hover:scale-105"
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="text-center">
          <i className="fas fa-spinner animate-spin text-4xl text-pink-600 mb-4" />
          <p className="text-slate-600">Loading services and locations...</p>
          <p className="text-xs text-slate-400 mt-2">Owner UID: {ownerUid}</p>
        </div>
      </div>
    );
  }

  if (error && branches.length === 0 && servicesList.length === 0) {
    const isFirebaseError = error.includes("Firebase") || error.includes("credentials") || error.includes("Missing");
    const isServerConfigError = error.includes("Server configuration") || error.includes("Internal error");
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full">
          <div className="text-center">
            <i className="fas fa-exclamation-triangle text-4xl text-yellow-500 mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Unable to Load Data</h2>
            <p className="text-slate-600 mb-4 font-mono text-sm break-words">{error}</p>
            {(isFirebaseError || isServerConfigError) && (
            <div className="bg-red-50 rounded-lg p-4 text-left text-sm border-2 border-red-200">
                <p className="font-semibold mb-2 text-red-800">⚠️ Server Configuration Issue</p>
                <p className="text-slate-700 mb-3">The booking engine requires Firebase Admin credentials to be configured on the server.</p>
                <p className="font-semibold mb-2">For Server Deployment (Vercel, etc.):</p>
                <div className="bg-slate-800 text-green-400 p-3 rounded text-xs overflow-x-auto mb-3">
                  <div className="mb-1">Add these environment variables:</div>
                  <div className="mb-1">FIREBASE_PROJECT_ID=bmspro-pink</div>
                  <div className="mb-1">FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@bmspro-pink.iam.gserviceaccount.com</div>
                  <div>FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n..."</div>
                </div>
                <p className="text-xs text-slate-600 mb-2">How to get credentials:</p>
                <ol className="text-xs text-slate-600 list-decimal ml-4 space-y-1">
                  <li>Go to Firebase Console → Project Settings → Service Accounts</li>
                  <li>Click "Generate New Private Key"</li>
                  <li>Copy the values from the downloaded JSON file</li>
                  <li>Add them as environment variables in your deployment platform</li>
                </ol>
                <p className="mt-3 text-xs text-slate-500">Owner UID: <code className="bg-slate-200 px-1 rounded">{ownerUid}</code></p>
            </div>
            )}
            {!isFirebaseError && !isServerConfigError && (
              <div className="bg-blue-50 rounded-lg p-4 text-left text-sm">
                <p className="text-slate-600">This might mean there are no branches/services set up for this salon owner yet.</p>
                <p className="mt-2 text-xs text-slate-500">Owner UID: <code className="bg-slate-200 px-1 rounded">{ownerUid}</code></p>
                <p className="mt-2 text-xs text-slate-500">Please add branches and services in the admin panel first.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50">
      {/* Creative Header with Salon Name */}
      <div className="relative overflow-hidden bg-indigo-900">
        {/* Creative Pattern Background */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)`,
          }}></div>
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 20px)`,
          }}></div>
        </div>

        {/* Decorative geometric shapes */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500 opacity-20 rounded-full -mr-32 -mt-32"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500 opacity-15 rounded-full -ml-48 -mb-48"></div>
        <div className="absolute top-1/2 right-1/4 w-32 h-32 bg-rose-400 opacity-25 rotate-45"></div>
        
        {/* Decorative corner elements */}
        <div className="absolute top-0 left-0 w-24 h-24 border-t-4 border-l-4 border-white/20"></div>
        <div className="absolute top-0 right-0 w-24 h-24 border-t-4 border-r-4 border-white/20"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 border-b-4 border-l-4 border-white/20"></div>
        <div className="absolute bottom-0 right-0 w-24 h-24 border-b-4 border-r-4 border-white/20"></div>
        
        <div className="relative max-w-7xl mx-auto px-3 sm:px-4 py-12 sm:py-16 md:py-20 lg:py-24">
          <div className="text-center relative z-10">
            {/* Top decorative line */}
            <div className="flex items-center justify-center mb-4 sm:mb-6 md:mb-8">
              <div className="h-0.5 w-12 sm:w-16 md:w-20 bg-white/40"></div>
              <div className="mx-2 sm:mx-3 md:mx-4 w-2 h-2 sm:w-3 sm:h-3 bg-white/60 rotate-45"></div>
              <div className="h-0.5 w-12 sm:w-16 md:w-20 bg-white/40"></div>
                    </div>
            
            {/* Salon name with creative styling */}
            <div className="mb-4 sm:mb-6 md:mb-8">
              <div className="inline-block px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 mb-3 sm:mb-4 md:mb-6 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full">
                <span className="text-white/90 text-xs sm:text-sm font-semibold tracking-wider uppercase">Welcome To</span>
                  </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl 2xl:text-8xl font-black mb-2 sm:mb-3 md:mb-4 tracking-tighter">
                <span className="block text-white [text-shadow:_4px_4px_0_rgb(0_0_0_/_40%)]">
                  {salonName.split(' ').map((word, i) => (
                    <span key={i} className="inline-block mr-4 relative">
                      <span className="relative z-10">{word}</span>
                      <span className="absolute inset-0 text-pink-400 blur-sm opacity-50 -z-0">{word}</span>
                    </span>
                  ))}
                </span>
              </h1>
              
              {/* Decorative underline */}
              <div className="flex items-center justify-center gap-2 sm:gap-3 mt-3 sm:mt-4 md:mt-6">
                <div className="w-6 sm:w-8 h-0.5 sm:h-1 bg-pink-400"></div>
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-pink-400 rotate-45"></div>
                <div className="w-12 sm:w-16 h-0.5 sm:h-1 bg-pink-400"></div>
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-pink-400 rotate-45"></div>
                <div className="w-6 sm:w-8 h-0.5 sm:h-1 bg-pink-400"></div>
              </div>
            </div>

            {/* Subtitle */}
            <p className="text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl text-white font-light tracking-wider mb-6 sm:mb-8 md:mb-10 uppercase px-2">
              Book Your Appointment
            </p>
            
            {/* Bottom decorative line */}
            <div className="flex items-center justify-center">
              <div className="h-0.5 w-12 sm:w-16 bg-white/40"></div>
              <div className="mx-2 sm:mx-3 w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white/60 rounded-full"></div>
              <div className="h-0.5 w-12 sm:w-16 bg-white/40"></div>
            </div>
          </div>
        </div>
        
        {/* Bottom transition with pattern */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-pink-50">
          <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-900"></div>
          <div className="absolute top-1 left-0 right-0 h-1 bg-pink-400"></div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8 -mt-6 relative z-10">
        {/* Single Page Booking Form */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-10 xl:gap-16">
              {/* Left Column: Selection & Scheduling */}
              <div className="space-y-4 sm:space-y-6 md:space-y-8">
                {/* Branch Selection */}
                <div className="p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-pink-500 bg-white shadow-lg">
                  <div className="font-bold text-slate-800 mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-pink-500 flex items-center justify-center text-white border-2 border-pink-600">
                      <i className="fas fa-map-marker-alt text-sm sm:text-base"></i>
                    </div>
                    <span className="uppercase tracking-wide text-sm sm:text-base">Select Location</span>
                  </div>
                    <div className="grid grid-cols-1 gap-3 sm:gap-4">
                      {branches.length === 0 ? (
                        <div className="border-4 border-dashed border-pink-300 p-8 text-center relative">
                          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-pink-300"></div>
                          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-pink-300"></div>
                          <i className="fas fa-store-slash text-4xl text-pink-300 mb-2 block" />
                          <p className="text-slate-500 font-medium">No branches available</p>
                        </div>
                      ) : (
                        branches.map((br: any) => {
                          const selected = bkBranchId === br.id;
                          return (
                            <button
                              key={br.id}
                              onClick={() => {
                                setBkBranchId(br.id);
                                setBkServiceId(null);
                                setBkStaffId(null);
                                setBkDate(null);
                                setBkTime(null);
                              }}
                              className={`text-left border-2 sm:border-4 p-3 sm:p-4 md:p-5 hover:shadow-xl transition-all relative ${
                                selected 
                                  ? "border-pink-500 bg-pink-50 shadow-lg" 
                                  : "border-slate-300 bg-white hover:border-pink-400"
                              }`}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-16 h-16 ${selected ? "bg-pink-500" : "bg-slate-200"} flex items-center justify-center shrink-0 transition-all`}>
                                  <i className={`fas fa-store text-xl ${selected ? "text-white" : "text-slate-500"}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`font-bold text-slate-800 truncate text-lg ${selected ? "text-pink-700" : ""}`}>{br.name}</div>
                                  <div className="text-xs text-slate-500 truncate mt-1 flex items-center gap-1">
                                    <i className="fas fa-map-pin text-pink-400"></i>
                                    {br.address}
                                  </div>
                                </div>
                                {selected && (
                                  <div className="w-10 h-10 bg-pink-500 flex items-center justify-center text-white">
                                    <i className="fas fa-check"></i>
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                </div>

                {/* Service Selection */}
                <div className={`p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-purple-500 bg-white shadow-lg ${!bkBranchId ? "opacity-50 pointer-events-none" : ""}`}>
                  <div className="font-bold text-slate-800 mb-3 sm:mb-4 md:mb-5 flex items-center gap-2 sm:gap-3 text-lg sm:text-xl">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-500 flex items-center justify-center text-white border-2 border-purple-600">
                      <i className="fas fa-concierge-bell text-sm sm:text-base"></i>
                    </div>
                    <span className="uppercase tracking-wide text-sm sm:text-base">Select Service</span>
                  </div>
                  {!bkBranchId ? (
                      <div className="border-2 sm:border-4 border-dashed border-purple-300 p-6 sm:p-8 md:p-10 text-center relative">
                        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-purple-300"></div>
                        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-purple-300"></div>
                        <div className="w-20 h-20 border-2 border-purple-300 mx-auto mb-4 flex items-center justify-center">
                          <i className="fas fa-map-marker-alt text-4xl text-purple-400"></i>
                        </div>
                        <p className="text-slate-600 font-semibold">Select a branch first</p>
                    </div>
                  ) : servicesList.length === 0 ? (
                      <div className="border-4 border-dashed border-purple-300 p-10 text-center relative">
                        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-purple-300"></div>
                        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-purple-300"></div>
                        <div className="w-20 h-20 border-2 border-purple-300 mx-auto mb-4 flex items-center justify-center">
                          <i className="fas fa-concierge-bell text-4xl text-purple-400"></i>
                        </div>
                        <p className="text-slate-600 font-semibold">No services available</p>
                    </div>
                  ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {servicesList
                        .filter((srv: any) => {
                          if (!srv.branches || srv.branches.length === 0) return true;
                          return srv.branches.includes(String(bkBranchId));
                        })
                          .map((srv: any, index: number) => {
                          const selected = String(bkServiceId) === String(srv.id);
                            return (
                              <button
                                key={srv.id}
                                onClick={() => {
                                  setBkServiceId(srv.id);
                                  setBkStaffId(null);
                                  setBkDate(null);
                                  setBkTime(null);
                                }}
                                className={`group relative border-4 p-3 sm:p-4 md:p-5 hover:shadow-xl transition-all w-full ${
                                  selected 
                                    ? "border-purple-500 bg-purple-50 shadow-lg" 
                                    : "border-slate-300 bg-white hover:border-purple-400"
                                }`}
                              >
                                <div className="relative flex flex-col items-center text-center gap-2 sm:gap-3">
                                  <div className={`w-full max-w-[120px] h-[120px] sm:max-w-[140px] sm:h-[140px] md:max-w-[160px] md:h-[160px] lg:max-w-[180px] lg:h-[180px] aspect-square ${selected ? "bg-purple-500" : "bg-slate-200"} flex items-center justify-center shrink-0 overflow-hidden transition-all rounded-lg`}>
                                    {srv.imageUrl ? (
                                      <img src={srv.imageUrl} alt={srv.name} className="w-full h-full object-cover" />
                                    ) : (
                                      <i className={`fas fa-cut text-3xl sm:text-4xl md:text-5xl lg:text-6xl ${selected ? "text-white" : "text-slate-500"}`} />
                                    )}
                                  </div>
                                  <div className="flex-1 w-full">
                                    <div className={`font-bold text-slate-800 text-sm sm:text-base mb-1 sm:mb-2 ${selected ? "text-purple-700" : ""}`}>
                                      {srv.name}
                                    </div>
                                    <div className="flex items-center justify-center gap-2 text-xs flex-wrap">
                                      <span className={`px-2 py-1 border-2 ${selected ? "bg-purple-200 border-purple-300 text-purple-700" : "bg-slate-100 border-slate-200 text-slate-600"}`}>
                                        <i className="fas fa-clock mr-1"></i>
                                        {srv.duration} min
                                      </span>
                                      <span className={`px-2 py-1 border-2 font-bold ${selected ? "bg-pink-500 border-pink-600 text-white" : "bg-purple-100 border-purple-200 text-purple-700"}`}>
                                        <i className="fas fa-dollar-sign mr-1"></i>
                                        {srv.price}
                                      </span>
                                    </div>
                                  </div>
                                  {selected && (
                                    <div className="absolute -top-2 -right-2 w-6 h-6 sm:w-8 sm:h-8 bg-purple-500 border-2 border-purple-600 flex items-center justify-center text-white rounded-full">
                                      <i className="fas fa-check text-xs sm:text-sm"></i>
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                        })}
                    </div>
                  )}
                </div>

                {/* Date Selection */}
                <div className="p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-indigo-500 bg-white shadow-lg">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 sm:mb-4 gap-3 sm:gap-0">
                    <div className="font-bold text-slate-800 flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 bg-indigo-500 flex items-center justify-center text-white border-2 border-indigo-600">
                        <i className="fas fa-calendar text-sm sm:text-base"></i>
                      </div>
                      <span className="uppercase tracking-wide text-sm sm:text-base">Pick a Date</span>
                    </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button onClick={goPrevMonth} className="w-8 h-8 sm:w-10 sm:h-10 border-2 border-indigo-300 hover:bg-indigo-100 hover:border-indigo-500 text-slate-700 text-xs sm:text-sm transition-all transform hover:scale-110">
                            <i className="fas fa-chevron-left" />
                          </button>
                        <div className="text-xs sm:text-sm font-bold text-slate-800 px-2 sm:px-4 min-w-[120px] sm:min-w-[140px] text-center border-2 border-indigo-300 py-1 sm:py-2 flex-1 sm:flex-initial">{monthName}</div>
                        <button onClick={goNextMonth} className="w-8 h-8 sm:w-10 sm:h-10 border-2 border-indigo-300 hover:bg-indigo-100 hover:border-indigo-500 text-slate-700 text-xs sm:text-sm transition-all transform hover:scale-110">
                            <i className="fas fa-chevron-right" />
                          </button>
                        </div>
                      </div>
                    <div className="border-2 sm:border-4 border-indigo-300 overflow-hidden w-full">
                      <div className="grid grid-cols-7 text-xs font-bold bg-indigo-100 border-b-2 border-indigo-300 text-indigo-700">
                          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                          <div key={i} className="px-2 py-3 text-center border-r border-indigo-200 last:border-r-0">{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7">
                        {buildMonthCells().map((c, idx) => {
                          const isSelected = c.date && bkDate && bkDate.getFullYear() === c.date.getFullYear() && bkDate.getMonth() === c.date.getMonth() && bkDate.getDate() === c.date.getDate();
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const isPast = !!(c.date && c.date.getTime() < today.getTime());
                          const isToday = c.date && c.date.getTime() === today.getTime();
                          const baseClickable = c.date && !isPast ? "cursor-pointer transition-all border-r border-b border-indigo-200" : "bg-slate-50 cursor-not-allowed opacity-60 border-r border-b border-slate-200";
                          return (
                            <div
                              key={idx}
                              className={`h-10 sm:h-12 md:h-14 p-1 text-xs sm:text-sm flex items-center justify-center ${baseClickable} ${
                                isSelected 
                                  ? "bg-pink-500 text-white font-bold border-4 border-pink-600 hover:bg-pink-600" 
                                  : isToday 
                                  ? "bg-indigo-200 font-semibold border-2 border-indigo-400 hover:bg-indigo-300" 
                                  : !isPast ? "hover:bg-indigo-50" : ""
                              }`}
                              onClick={() => c.date && !isPast && (setBkDate(c.date), setBkTime(null))}
                            >
                              <span className={!c.date ? "opacity-0" : ""}>{c.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                </div>

                {/* Time Selection */}
                <div className="p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-pink-500 bg-white shadow-lg">
                  <div className="font-bold text-slate-800 mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-pink-500 flex items-center justify-center text-white border-2 border-pink-600">
                      <i className="fas fa-clock text-sm sm:text-base"></i>
                    </div>
                    <span className="uppercase tracking-wide text-sm sm:text-base">Select a Time</span>
                  </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 border-2 sm:border-4 border-pink-300">
                        {!bkDate ? (
                        <div className="col-span-4 text-center text-slate-400 py-8 border-4 border-dashed border-pink-300 relative">
                          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-pink-300"></div>
                          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-pink-300"></div>
                          <i className="fas fa-calendar-day text-3xl mb-2 block text-pink-300" />
                          <p className="text-sm font-semibold">Select date first</p>
                          </div>
                        ) : computeSlots().length === 0 ? (
                        <div className="col-span-4 text-center text-slate-400 py-8 border-4 border-dashed border-pink-300 relative">
                          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-pink-300"></div>
                          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-pink-300"></div>
                          <i className="fas fa-clock text-3xl mb-2 block text-pink-300" />
                          <p className="text-sm font-semibold">No slots available</p>
                          </div>
                        ) : (
                          computeSlots().map((t) => (
                            <button
                              key={t}
                              onClick={() => setBkTime(t)}
                            className={`py-2 sm:py-3 px-1 sm:px-2 font-bold text-xs sm:text-sm transition-all border-2 sm:border-4 transform hover:scale-105 ${
                                bkTime === t 
                                ? "bg-pink-500 text-white border-pink-600 shadow-lg scale-105" 
                                : "bg-white text-slate-700 border-pink-200 hover:border-pink-400 hover:bg-pink-50"
                              }`}
                            >
                              {t}
                            </button>
                          ))
                        )}
                    </div>
                </div>

                {/* Staff Selection */}
                <div className={`p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-amber-500 bg-white shadow-lg ${!bkDate || !bkTime ? "opacity-50 pointer-events-none" : ""}`}>
                  <div className="font-bold text-slate-800 mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-500 flex items-center justify-center text-white border-2 border-amber-600">
                      <i className="fas fa-user-tie text-sm sm:text-base"></i>
                    </div>
                    <span className="uppercase tracking-wide text-sm sm:text-base">Choose Stylist <span className="text-xs sm:text-sm font-normal text-slate-500 normal-case">(Optional)</span></span>
                  </div>
                    <div className="space-y-2 sm:space-y-3 max-h-[200px] sm:max-h-[250px] overflow-y-auto">
                      {!bkDate || !bkTime ? (
                        <div className="border-4 border-dashed border-amber-300 p-6 text-center relative">
                          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-amber-300"></div>
                          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-amber-300"></div>
                          <i className="fas fa-calendar-clock text-4xl text-amber-300 mb-2 block" />
                          <p className="text-slate-500 font-medium text-sm">Select Date & Time First</p>
                        </div>
                      ) : (
                        staffList
                          .filter((st: any) => {
                            if (st.status !== "Active") return false;
                            if (bkBranchId && st.branchId !== bkBranchId) return false;
                            if (bkServiceId) {
                              const selectedService = servicesList.find((s) => s.id === bkServiceId);
                              if (selectedService?.staffIds && selectedService.staffIds.length > 0) {
                                return selectedService.staffIds.includes(st.id);
                              }
                            }
                            return true;
                          })
                          .map((st: any) => {
                            const selected = bkStaffId === st.id;
                            return (
                              <button
                                key={st.id}
                                onClick={() => setBkStaffId(st.id)}
                                className={`w-full text-left border-2 sm:border-4 p-3 sm:p-4 hover:shadow-xl transition-all ${
                                  selected 
                                    ? "border-amber-500 bg-amber-50 shadow-lg" 
                                    : "border-slate-300 bg-white hover:border-amber-400"
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className={`w-16 h-16 border-2 ${selected ? "border-amber-600" : "border-slate-300"} overflow-hidden`}>
                                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(st.avatar || st.name)}`} className="w-full h-full" alt="" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className={`font-bold text-slate-800 truncate text-base ${selected ? "text-amber-700" : ""}`}>{st.name}</div>
                                    <div className="text-xs text-slate-500 truncate mt-1 flex items-center gap-1">
                                      <i className="fas fa-briefcase text-amber-400"></i>
                                      {st.role}
                                    </div>
                                  </div>
                                  {selected && (
                                    <div className="w-10 h-10 bg-amber-500 flex items-center justify-center text-white">
                                      <i className="fas fa-check"></i>
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })
                      )}
                    </div>
                </div>
              </div>

              {/* Right Column: Customer Details & Summary */}
              <div className="space-y-4 sm:space-y-6 md:space-y-8">
                {/* Customer Details */}
                <div className="p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-slate-500 bg-white shadow-lg">
                  <div className="font-bold text-slate-800 mb-3 sm:mb-4 md:mb-5 flex items-center gap-2 sm:gap-3 text-lg sm:text-xl">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-500 flex items-center justify-center text-white border-2 border-slate-600">
                      <i className="fas fa-user text-sm sm:text-base"></i>
                    </div>
                    <span className="uppercase tracking-wide text-sm sm:text-base">Your Details</span>
                  </div>
                  <div className="space-y-3 sm:space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <i className="fas fa-user text-pink-500"></i>
                          Full Name <span className="text-pink-600">*</span>
                        </label>
                        <input
                          type="text"
                          value={bkClientName}
                          onChange={(e) => setBkClientName(e.target.value)}
                          className="w-full border-2 border-slate-300 px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-200 transition-all"
                          placeholder="Enter your full name"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <i className="fas fa-envelope text-pink-500"></i>
                          Email Address
                        </label>
                        <input
                          type="email"
                          value={bkClientEmail}
                          onChange={(e) => setBkClientEmail(e.target.value)}
                          className="w-full border-2 border-slate-300 px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-200 transition-all"
                          placeholder="your.email@example.com"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <i className="fas fa-phone text-pink-500"></i>
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          value={bkClientPhone}
                          onChange={(e) => setBkClientPhone(e.target.value)}
                          className="w-full border-2 border-slate-300 px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-200 transition-all"
                          placeholder="+1 555 000 1111"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <i className="fas fa-sticky-note text-pink-500"></i>
                          Additional Notes <span className="text-slate-400 font-normal">(Optional)</span>
                        </label>
                        <textarea
                          value={bkNotes}
                          onChange={(e) => setBkNotes(e.target.value)}
                          className="w-full border-2 border-slate-300 px-4 py-3 text-sm focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-200 transition-all resize-none"
                          placeholder="Any special requests or information..."
                          rows={4}
                        />
                      </div>
                    </div>
                </div>

                {/* Booking Summary */}
                <div className="p-3 sm:p-4 md:p-6 border-2 sm:border-4 border-pink-500 bg-white shadow-lg">
                  <div className="font-bold text-slate-800 mb-3 sm:mb-4 md:mb-5 flex items-center gap-2 sm:gap-3 text-lg sm:text-xl">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-pink-500 flex items-center justify-center text-white border-2 border-pink-600">
                      <i className="fas fa-receipt text-sm sm:text-base"></i>
                    </div>
                    <span className="uppercase tracking-wide text-sm sm:text-base">Booking Summary</span>
                  </div>
                  <div className="border-2 sm:border-4 border-pink-300 p-3 sm:p-4 md:p-5 space-y-2 sm:space-y-3 text-xs sm:text-sm bg-pink-50">
                      <div className="flex justify-between items-center py-2 border-b-2 border-pink-200">
                        <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Branch</span>
                        <span className="font-bold text-slate-800">{branches.find((b: any) => b.id === bkBranchId)?.name || <span className="text-slate-400">-</span>}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b-2 border-pink-200">
                        <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Service</span>
                        <span className="font-bold text-slate-800">{servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.name || <span className="text-slate-400">-</span>}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b-2 border-pink-200">
                        <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Staff</span>
                        <span className="font-bold text-slate-800">{bkStaffId ? staffList.find((s: any) => s.id === bkStaffId)?.name : <span className="text-slate-400 italic">Any Available</span>}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b-2 border-pink-200">
                        <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Date</span>
                        <span className="font-bold text-slate-800">{bkDate ? bkDate.toLocaleDateString() : <span className="text-slate-400">-</span>}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b-2 border-pink-200">
                        <span className="text-slate-600 font-semibold uppercase text-xs tracking-wide">Time</span>
                        <span className="font-bold text-slate-800">{bkTime || <span className="text-slate-400">-</span>}</span>
                      </div>
                      <div className="flex justify-between items-center pt-3 mt-2 border-t-4 border-pink-500">
                        <span className="text-slate-800 font-bold text-lg uppercase tracking-wide">Total</span>
                        <span className="font-black text-3xl text-pink-600">
                          ${servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.price || 0}
                        </span>
                      </div>
                    </div>
                </div>

                {/* Submit Button */}
                <button
                    disabled={!bkBranchId || !bkServiceId || !bkDate || !bkTime || submittingBooking || !bkClientName.trim()}
                    onClick={handleConfirmBooking}
                  className={`w-full px-4 sm:px-6 py-3 sm:py-4 md:py-5 text-white font-bold text-base sm:text-lg md:text-xl transition-all border-2 sm:border-4 relative overflow-hidden ${
                    bkBranchId && bkServiceId && bkDate && bkTime && !submittingBooking && bkClientName.trim() 
                      ? "bg-indigo-900 border-indigo-700 hover:bg-indigo-800 hover:border-indigo-600 active:scale-[0.98]" 
                      : "bg-slate-300 border-slate-400 cursor-not-allowed"
                  }`}
                >
                  {/* Diagonal stripe pattern */}
                  <div className={`absolute inset-0 opacity-10 ${bkBranchId && bkServiceId && bkDate && bkTime && !submittingBooking && bkClientName.trim() ? "" : "hidden"}`} style={{
                    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 10px, currentColor 10px, currentColor 11px)`,
                  }}></div>
                  
                  <span className="relative z-10 inline-flex items-center justify-center gap-2 uppercase tracking-wider">
                    {submittingBooking ? (
                      <>
                        <i className="fas fa-spinner animate-spin text-2xl"></i>
                        <span>Confirming Your Booking...</span>
                      </>
                    ) : (
                      <>
                        <i className="fas fa-check-circle text-2xl"></i>
                        <span>Confirm Booking</span>
                      </>
                    )}
                  </span>
                </button>
              </div>
            </div>
      </div>

      {/* Font Awesome for icons */}
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="text-center">
          <i className="fas fa-spinner animate-spin text-4xl text-pink-600 mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <BookPageContent />
    </Suspense>
  );
}

