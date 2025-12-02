"use client";
import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createBooking, subscribeBookingsForOwnerAndDate } from "@/lib/bookings";

function BookPageContent() {
  const searchParams = useSearchParams();
  // Default ownerUid for this salon, can be overridden via URL params
  const DEFAULT_OWNER_UID = "0Z0k6PleLzLHXrYG8UdUKvp7DUt2";
  const ownerUid = searchParams.get("ownerUid") || DEFAULT_OWNER_UID;

  // Booking wizard state
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
  const [bkClientName, setBkClientName] = useState<string>("");
  const [bkClientEmail, setBkClientEmail] = useState<string>("");
  const [bkClientPhone, setBkClientPhone] = useState<string>("");
  const [bkNotes, setBkNotes] = useState<string>("");
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);

  // Real data from Firestore
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
        
        // Fetch branches
        const branchesRes = await fetch(`/api/branches?ownerUid=${encodeURIComponent(ownerUid)}`);
        if (!branchesRes.ok) {
          const errorData = await branchesRes.json().catch(() => ({}));
          const errorMsg = errorData.error || errorData.details || `Failed to fetch branches: ${branchesRes.status}`;
          console.error("Branches API error:", errorMsg);
          throw new Error(errorMsg);
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
          throw new Error(errorData.error || `Failed to fetch services: ${servicesRes.status}`);
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
          throw new Error(errorData.error || `Failed to fetch staff: ${staffRes.status}`);
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

  const resetWizard = () => {
    setBkStep(1);
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
    const staffName = bkStaffId ? staffList.find((s: any) => String(s.id) === String(bkStaffId))?.name || "" : "";
    const client = bkClientName?.trim() || "Guest";
    
    try {
      await createBooking({
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
        date: formatLocalYmd(bkDate),
        time: bkTime,
        duration: service?.duration || 60,
        status: "Pending",
        price: service?.price || 0,
      });
      
      setShowSuccess(true);
      setTimeout(() => {
        resetWizard();
        setShowSuccess(false);
      }, 3000);
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

  if (showSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4 text-center">
          <i className="fas fa-check-circle text-6xl text-green-500 mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Booking Confirmed!</h2>
          <p className="text-slate-600">Your appointment has been successfully booked.</p>
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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-purple-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-2xl w-full">
          <div className="text-center">
            <i className="fas fa-exclamation-triangle text-4xl text-yellow-500 mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Unable to Load Data</h2>
            <p className="text-slate-600 mb-4 font-mono text-sm break-words">{error}</p>
            {isFirebaseError && (
              <div className="bg-slate-50 rounded-lg p-4 text-left text-sm">
                <p className="font-semibold mb-2">To fix this issue, check your <code className="bg-slate-200 px-1 rounded">.env</code> file has:</p>
                <div className="bg-slate-800 text-green-400 p-3 rounded text-xs overflow-x-auto mb-3">
                  <div className="mb-1">FIREBASE_PROJECT_ID=bmspro-pink</div>
                  <div className="mb-1">FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@bmspro-pink.iam.gserviceaccount.com</div>
                  <div>FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n..."</div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Owner UID: <code className="bg-slate-200 px-1 rounded">{ownerUid}</code></p>
                <p className="mt-2 text-xs text-slate-500 font-semibold">⚠️ Make sure to restart your dev server after updating .env file!</p>
              </div>
            )}
            {!isFirebaseError && (
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
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">Book Your Appointment</h1>
          <p className="text-slate-600">Select your service, time, and complete your booking</p>
        </div>

        {/* Booking Wizard */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Stepper */}
          <div className="px-6 pt-6 pb-4 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center justify-between max-w-2xl mx-auto">
              {[
                { num: 1, label: "Branch & Service" },
                { num: 2, label: "Date, Time & Staff" },
                { num: 3, label: "Confirm Details" }
              ].map((step, i) => (
                <div key={step.num} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm font-bold transition-all ${bkStep >= step.num ? "bg-gradient-to-br from-pink-600 to-purple-600 text-white shadow-lg" : "bg-white border-2 border-slate-300 text-slate-500"}`}>
                      {bkStep > step.num ? <i className="fas fa-check" /> : step.num}
                    </div>
                    <span className="text-[10px] text-slate-600 font-semibold hidden sm:block text-center whitespace-nowrap">{step.label}</span>
                  </div>
                  {i < 2 && <div className={`h-1 flex-1 mx-1 sm:mx-2 rounded transition-all ${bkStep > step.num ? "bg-gradient-to-r from-pink-500 to-purple-500" : "bg-slate-300"}`} />}
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Step 1 - Branch & Service */}
            {bkStep === 1 && (
              <div className="space-y-6">
                <div>
                  <div className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <i className="fas fa-map-marker-alt text-pink-600" />
                    Select Location
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {branches.length === 0 ? (
                      <div className="col-span-2 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                        <i className="fas fa-store-slash text-4xl text-slate-300 mb-2 block" />
                        <p className="text-slate-500 font-medium text-sm">No branches available</p>
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
                          className={`text-left border rounded-lg p-3 hover:shadow-md transition ${selected ? "border-pink-400 bg-pink-50 shadow-md" : "border-slate-200 bg-white"}`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className={`w-10 h-10 rounded-lg ${selected ? "bg-pink-100" : "bg-slate-100"} flex items-center justify-center shrink-0`}>
                              <i className={`fas fa-store ${selected ? "text-pink-600" : "text-slate-400"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-slate-800 truncate text-sm">{br.name}</div>
                              <div className="text-xs text-slate-500 truncate">{br.address}</div>
                            </div>
                            {selected && <i className="fas fa-check-circle text-pink-600 shrink-0" />}
                          </div>
                        </button>
                      );
                      })
                    )}
                  </div>
                </div>

                <div className={!bkBranchId ? "opacity-50 pointer-events-none" : ""}>
                  <div className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <i className="fas fa-concierge-bell text-purple-600" />
                    Select Service {!bkBranchId && <span className="text-xs font-normal text-slate-500">(Select branch first)</span>}
                  </div>
                  {!bkBranchId ? (
                    <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                      <i className="fas fa-map-marker-alt text-4xl text-slate-300 mb-2 block" />
                      <p className="text-slate-500 font-medium text-sm">Select a branch first</p>
                    </div>
                  ) : servicesList.length === 0 ? (
                    <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                      <i className="fas fa-concierge-bell text-4xl text-slate-300 mb-2 block" />
                      <p className="text-slate-500 font-medium text-sm">No services available for this branch</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {servicesList
                        .filter((srv: any) => {
                          // Show service if:
                          // 1. Service has no branches array (available at all branches), OR
                          // 2. Service's branches array is empty (available at all branches), OR
                          // 3. Service's branches array includes the selected branch ID
                          if (!srv.branches || srv.branches.length === 0) return true;
                          return srv.branches.includes(String(bkBranchId));
                        })
                        .map((srv: any) => {
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
                              className={`text-left border rounded-lg p-3 hover:shadow-md transition ${selected ? "border-purple-400 bg-purple-50 shadow-md" : "border-slate-200 bg-white"}`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className={`w-10 h-10 rounded-lg ${selected ? "bg-purple-100" : "bg-slate-100"} flex items-center justify-center shrink-0 overflow-hidden`}>
                                  {srv.imageUrl ? (
                                    <img src={srv.imageUrl} alt={srv.name} className="w-full h-full object-cover" />
                                  ) : (
                                    <i className={`fas fa-cut ${selected ? "text-purple-600" : "text-slate-400"}`} />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-slate-800 truncate text-sm">{srv.name}</div>
                                  <div className="text-xs text-slate-500">{srv.duration} min • ${srv.price}</div>
                                </div>
                                {selected && <i className="fas fa-check-circle text-purple-600 shrink-0" />}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-200">
                  <button
                    disabled={!bkBranchId || !bkServiceId}
                    onClick={() => setBkStep(2)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkBranchId && bkServiceId ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:shadow-lg" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue to Date & Time
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 - Date, Time & Staff */}
            {bkStep === 2 && (
              <div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold text-slate-700 text-sm">Pick a Date</div>
                        <div className="flex items-center gap-1">
                          <button onClick={goPrevMonth} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs">
                            <i className="fas fa-chevron-left" />
                          </button>
                          <div className="text-xs font-semibold text-slate-800 px-2">{monthName}</div>
                          <button onClick={goNextMonth} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs">
                            <i className="fas fa-chevron-right" />
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="grid grid-cols-7 text-[10px] font-semibold bg-slate-50 text-slate-600">
                          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                            <div key={i} className="px-1 py-1.5 text-center">{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7">
                          {buildMonthCells().map((c, idx) => {
                            const isSelected = c.date && bkDate && bkDate.getFullYear() === c.date.getFullYear() && bkDate.getMonth() === c.date.getMonth() && bkDate.getDate() === c.date.getDate();
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const isPast = !!(c.date && c.date.getTime() < today.getTime());
                            const baseClickable = c.date && !isPast ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/40 cursor-not-allowed opacity-60";
                            return (
                              <div
                                key={idx}
                                className={`h-10 border border-slate-100 p-1 text-xs flex items-center justify-center ${baseClickable} ${isSelected ? "bg-pink-50 ring-2 ring-pink-500 font-bold" : ""}`}
                                onClick={() => c.date && !isPast && (setBkDate(c.date), setBkTime(null))}
                              >
                                <span className={`text-slate-700 ${!c.date ? "opacity-0" : ""}`}>{c.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="font-bold text-slate-700 mb-2 flex items-center gap-2 text-sm">
                        <i className="fas fa-clock text-purple-600" />
                        Select a Time
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto p-2 bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg border-2 border-purple-200">
                        {!bkDate ? (
                          <div className="col-span-4 text-center text-slate-400 text-xs py-4">
                            <i className="fas fa-calendar-day text-2xl mb-1 block text-slate-300" />
                            Select date first
                          </div>
                        ) : computeSlots().length === 0 ? (
                          <div className="col-span-4 text-center text-slate-400 text-xs py-4">
                            <i className="fas fa-clock text-2xl mb-1 block text-slate-300" />
                            No slots available
                          </div>
                        ) : (
                          computeSlots().map((t) => (
                            <button
                              key={t}
                              onClick={() => setBkTime(t)}
                              className={`py-2 px-1 rounded-md font-semibold text-xs transition-all ${
                                bkTime === t 
                                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-md" 
                                  : "bg-white text-slate-700 border border-purple-200 hover:border-pink-400"
                              }`}
                            >
                              {t}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="font-bold text-slate-700 mb-2 flex items-center gap-2 text-sm">
                      <i className="fas fa-user-tie text-pink-600" />
                      Choose Stylist {!bkDate || !bkTime ? "" : "(Optional)"}
                    </div>
                    <div className={`space-y-2 max-h-[400px] overflow-y-auto ${!bkDate || !bkTime ? "opacity-50 pointer-events-none" : ""}`}>
                      {!bkDate || !bkTime ? (
                        <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
                          <i className="fas fa-calendar-clock text-4xl text-slate-300 mb-2 block" />
                          <p className="text-slate-500 font-medium text-sm mb-1">Select Date & Time First</p>
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
                                className={`w-full text-left border rounded-lg p-2.5 hover:shadow transition flex items-center gap-2.5 ${selected ? "border-pink-400 bg-pink-50 shadow-md" : "border-slate-200 bg-white"}`}
                              >
                                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(st.avatar || st.name)}`} className="w-9 h-9 rounded-full bg-slate-100 shrink-0" alt="" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-slate-800 truncate text-sm">{st.name}</div>
                                  <div className="text-xs text-slate-500 truncate">{st.role}</div>
                                </div>
                                {selected && <i className="fas fa-check-circle text-pink-600 text-sm shrink-0" />}
                              </button>
                            );
                          })
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-3 mt-2 border-t border-slate-200">
                  <button onClick={() => setBkStep(1)} className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium">
                    Back
                  </button>
                  <button
                    disabled={!bkDate || !bkTime}
                    onClick={() => setBkStep(3)}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkDate && bkTime ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    Continue to Details
                  </button>
                </div>
              </div>
            )}

            {/* Step 3 - Customer Details + Summary */}
            {bkStep === 3 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="font-bold text-slate-700 mb-4">Your Details</div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Full Name *</label>
                      <input
                        type="text"
                        value={bkClientName}
                        onChange={(e) => setBkClientName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="John Doe"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
                      <input
                        type="email"
                        value={bkClientEmail}
                        onChange={(e) => setBkClientEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="john@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        value={bkClientPhone}
                        onChange={(e) => setBkClientPhone(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="+1 555 000 1111"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Additional Notes (Optional)</label>
                      <textarea
                        value={bkNotes}
                        onChange={(e) => setBkNotes(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="Any special requests or information…"
                        rows={4}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="font-bold text-slate-700 mb-4">Booking Summary</div>
                  <div className="bg-pink-50 rounded-xl border border-pink-100 p-4 space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Branch</span><span className="font-semibold text-slate-800">{branches.find((b: any) => b.id === bkBranchId)?.name || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Service</span><span className="font-semibold text-slate-800">{servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.name || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Staff</span><span className="font-semibold text-slate-800">{bkStaffId ? staffList.find((s: any) => s.id === bkStaffId)?.name : <span className="text-slate-500 italic">Any Available</span>}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Date</span><span className="font-semibold text-slate-800">{bkDate ? bkDate.toLocaleDateString() : "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Time</span><span className="font-semibold text-slate-800">{bkTime || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Price</span><span className="font-bold text-pink-600">${servicesList.find((s: any) => String(s.id) === String(bkServiceId))?.price || 0}</span></div>
                  </div>
                </div>

                <div className="lg:col-span-2 mt-1 flex justify-between">
                  <button disabled={submittingBooking} onClick={() => setBkStep(2)} className={`px-5 py-2 rounded-lg border border-slate-300 ${submittingBooking ? "text-slate-400 cursor-not-allowed" : "text-slate-700 hover:bg-slate-50"} font-medium`}>
                    Back
                  </button>
                  <button
                    disabled={!bkBranchId || !bkServiceId || !bkDate || !bkTime || submittingBooking || !bkClientName.trim()}
                    onClick={handleConfirmBooking}
                    className={`px-5 py-2 rounded-lg text-white font-semibold ${bkBranchId && bkServiceId && bkDate && bkTime && !submittingBooking && bkClientName.trim() ? "bg-pink-600 hover:bg-pink-700" : "bg-slate-300 cursor-not-allowed"}`}
                  >
                    {submittingBooking ? <span className="inline-flex items-center"><i className="fas fa-spinner animate-spin mr-2" /> Confirming…</span> : "Confirm Booking"}
                  </button>
                </div>
              </div>
            )}
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

