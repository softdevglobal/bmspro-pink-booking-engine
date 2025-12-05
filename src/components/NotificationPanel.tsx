"use client";

import { useState, useEffect } from "react";
import { Notification } from "@/lib/notifications";

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  customerEmail?: string;
  customerPhone?: string;
  customerUid?: string;
}

export default function NotificationPanel({
  isOpen,
  onClose,
  customerEmail,
  customerPhone,
  customerUid,
}: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (isOpen && (customerEmail || customerPhone || customerUid)) {
      fetchNotifications();
    }
  }, [isOpen, customerEmail, customerPhone, customerUid]);

  const fetchNotifications = async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (customerUid) {
        params.set("uid", customerUid);
      } else if (customerEmail) {
        params.set("email", customerEmail);
      } else if (customerPhone) {
        params.set("phone", customerPhone);
      }
      // Fetch up to 200 notifications
      params.set("limit", "200");

      const response = await fetch(`/api/notifications?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch notifications");
      }

      setNotifications(data.notifications || []);
    } catch (err: any) {
      setError(err.message || "Failed to load notifications");
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.map((notif) =>
            notif.id === notificationId ? { ...notif, read: true } : notif
          )
        );
      }
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const openDeleteConfirm = (notificationId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent marking as read when opening delete dialog
    setNotificationToDelete(notificationId);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmOpen(false);
    setNotificationToDelete(null);
  };

  const confirmDelete = async () => {
    if (!notificationToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/notifications/${notificationToDelete}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.filter((notif) => notif.id !== notificationToDelete)
        );
        closeDeleteConfirm();
      } else {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete notification");
      }
    } catch (err: any) {
      console.error("Error deleting notification:", err);
      setError(err.message || "Failed to delete notification");
    } finally {
      setDeleting(false);
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "Confirmed":
        return {
          bg: "bg-emerald-50",
          text: "text-emerald-700",
          badge: "bg-emerald-500",
          icon: "fa-check-circle",
          iconColor: "text-emerald-500"
        };
      case "Completed":
        return {
          bg: "bg-blue-50",
          text: "text-blue-700",
          badge: "bg-blue-500",
          icon: "fa-circle-check",
          iconColor: "text-blue-500"
        };
      case "Canceled":
        return {
          bg: "bg-red-50",
          text: "text-red-700",
          badge: "bg-red-500",
          icon: "fa-circle-xmark",
          iconColor: "text-red-500"
        };
      default:
        return {
          bg: "bg-gray-50",
          text: "text-gray-700",
          badge: "bg-gray-500",
          icon: "fa-circle-info",
          iconColor: "text-gray-500"
        };
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "";

    try {
      let date: Date;
      
      // Handle Firestore Timestamp with seconds
      if (timestamp.seconds !== undefined) {
        date = new Date(timestamp.seconds * 1000);
      } 
      // Handle Firestore Timestamp with nanoseconds
      else if (timestamp._seconds !== undefined) {
        date = new Date(timestamp._seconds * 1000);
      }
      // Handle Firestore Timestamp with toDate method
      else if (typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      }
      // Handle string or number timestamps
      else {
        date = new Date(timestamp);
      }

      // Check if date is valid
      if (isNaN(date.getTime())) {
        return "Recently";
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString();
    } catch (error) {
      console.error("Error formatting date:", error, timestamp);
      return "Recently";
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredNotifications = filter === "unread" 
    ? notifications.filter((n) => !n.read)
    : notifications;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop - transparent click area */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-x-4 top-20 sm:top-20 sm:right-6 sm:left-auto w-auto sm:w-full sm:max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 z-[70] max-h-[80vh] sm:max-h-[80vh] flex flex-col animate-slide-in overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center flex-shrink-0">
                <i className="fas fa-bell text-white text-base sm:text-lg"></i>
              </div>
              <div className="min-w-0">
                <h3 className="text-lg sm:text-xl font-bold text-white truncate">Notifications</h3>
                {unreadCount > 0 && (
                  <p className="text-white/80 text-xs">{unreadCount} unread</p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors text-white flex-shrink-0"
              aria-label="Close"
            >
              <i className="fas fa-times text-lg"></i>
            </button>
          </div>
          
          {/* Filter Tabs */}
          {notifications.length > 0 && (
            <div className="flex gap-2 mt-3 sm:mt-4">
              <button
                onClick={() => setFilter("all")}
                className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  filter === "all"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "bg-white/20 text-white hover:bg-white/30"
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                onClick={() => setFilter("unread")}
                className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  filter === "unread"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "bg-white/20 text-white hover:bg-white/30"
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="relative">
                <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              </div>
              <p className="text-gray-500 mt-4 font-medium">Loading notifications...</p>
            </div>
          )}

          {error && (
            <div className="m-4">
              <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
                <div className="flex items-center gap-3">
                  <i className="fas fa-exclamation-circle text-red-500 text-xl"></i>
                  <p className="text-red-700 text-sm font-medium">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && filteredNotifications.length === 0 && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center mb-4">
                <i className="fas fa-bell-slash text-3xl text-indigo-400"></i>
              </div>
              <h4 className="text-lg font-semibold text-gray-800 mb-1">No notifications yet</h4>
              <p className="text-sm text-gray-500 text-center">You&apos;ll see booking updates here</p>
            </div>
          )}

          {!loading && !error && filteredNotifications.length === 0 && notifications.length > 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-20 h-20 bg-gradient-to-br from-green-100 to-emerald-100 rounded-full flex items-center justify-center mb-4">
                <i className="fas fa-check-double text-3xl text-green-500"></i>
              </div>
              <h4 className="text-lg font-semibold text-gray-800 mb-1">All caught up!</h4>
              <p className="text-sm text-gray-500 text-center">No unread notifications</p>
            </div>
          )}

          {!loading && !error && filteredNotifications.length > 0 && (
            <div className="divide-y divide-gray-200">
              {filteredNotifications.map((notification) => {
                const statusStyle = getStatusStyle(notification.status);
                return (
                  <div
                    key={notification.id}
                    onClick={() => !notification.read && markAsRead(notification.id!)}
                    className={`p-3 sm:p-4 transition-all cursor-pointer hover:bg-white relative group ${
                      notification.read ? "bg-gray-50/50" : "bg-white"
                    }`}
                  >
                    {/* Unread indicator */}
                    {!notification.read && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-purple-500"></div>
                    )}

                    <div className="flex items-start gap-2 sm:gap-3 pl-2">
                      {/* Icon */}
                      <div className={`flex-shrink-0 w-10 h-10 sm:w-11 sm:h-11 ${statusStyle.bg} rounded-xl flex items-center justify-center shadow-sm`}>
                        <i className={`fas ${statusStyle.icon} ${statusStyle.iconColor} text-base sm:text-lg`}></i>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className={`font-semibold text-xs sm:text-sm ${notification.read ? "text-gray-600" : "text-gray-900"} break-words`}>
                            {notification.title}
                          </h4>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {!notification.read && (
                              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                            )}
                            {/* Delete button - visible on hover on desktop, always visible on mobile */}
                            <button
                              onClick={(e) => openDeleteConfirm(notification.id!, e)}
                              className="sm:opacity-0 sm:group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-all"
                              aria-label="Delete notification"
                              title="Delete"
                            >
                              <i className="fas fa-trash text-xs"></i>
                            </button>
                          </div>
                        </div>

                        <p className={`text-xs sm:text-sm mb-2.5 ${notification.read ? "text-gray-500" : "text-gray-700"} break-words`}>
                          {notification.message}
                        </p>

                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 ${statusStyle.bg} ${statusStyle.text} rounded-full text-[10px] sm:text-xs font-semibold`}>
                            <span className={`w-1.5 h-1.5 ${statusStyle.badge} rounded-full flex-shrink-0`}></span>
                            <span className="truncate">{notification.status}</span>
                          </span>

                          {notification.bookingCode && (
                            <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-gray-500 font-medium truncate">
                              <i className="fas fa-ticket text-[8px] sm:text-[10px] flex-shrink-0"></i>
                              <span className="truncate">{notification.bookingCode}</span>
                            </span>
                          )}

                          <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-gray-400 ml-auto flex-shrink-0">
                            <i className="far fa-clock text-[8px] sm:text-[10px]"></i>
                            {formatDate(notification.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t border-gray-200 bg-white p-3">
            <button
              onClick={fetchNotifications}
              disabled={loading}
              className="w-full py-2 sm:py-2.5 px-3 sm:px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <i className="fas fa-sync-alt text-sm"></i>
              <span>Refresh</span>
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={!deleting ? closeDeleteConfirm : undefined}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full animate-scale-in overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-red-500 to-rose-600 p-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                  <i className="fas fa-exclamation-triangle text-white text-xl"></i>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Delete Notification</h3>
                  <p className="text-white/80 text-sm">This action cannot be undone</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-gray-700 text-sm leading-relaxed">
                Are you sure you want to delete this notification? Once deleted, you won&apos;t be able to view this notification again.
              </p>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={closeDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2.5 rounded-lg text-gray-700 hover:bg-gray-200 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm shadow-lg shadow-red-200"
              >
                {deleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-trash"></i>
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.2s ease-out;
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.2s ease-out;
        }
      `}</style>
    </>
  );
}

