"use client";

type Props = {
  reason: string;
  message?: string;
  isAdmin?: boolean;
  onRefresh?: () => void;
  onLogout?: () => void;
};

/**
 * Screen shown when access is blocked for various reasons
 */
export function AccessBlockedScreen({ reason, message: messageProp, isAdmin, onRefresh, onLogout }: Props) {
  // Determine message based on reason
  let title = "Access Restricted";
  let message = messageProp || reason;
  let showRefresh = false;
  let showContactAdmin = false;
  let showContactSupport = false;
  
  switch (reason) {
    case "not_a_member":
      title = "Access Required";
      message = messageProp || "Contact your administrator to be added.";
      showContactAdmin = true;
      showContactSupport = true;
      break;

    case "no_organization":
      title = "No Organization";
      message = messageProp || "Your email domain is not registered with any organization.";
      showContactAdmin = true;
      break;

    case "blocked_domain":
      title = "Access Restricted";
      message = messageProp || "Please use your corporate email to sign in.";
      showContactSupport = true;
      break;

    case "subscription_required":
      title = "Subscription Required";
      message = messageProp || "Your organization needs an active subscription to access RV Service Desk.";
      if (isAdmin) {
        message = messageProp || "Please subscribe to continue.";
      }
      showRefresh = true;
      break;

    case "seat_limit_exceeded":
      title = "Seat Limit Reached";
      message = messageProp || (isAdmin
        ? "Your organization has exceeded its seat limit. Please purchase more seats."
        : "Seat limit reached. Contact your administrator to add seats.");
      showRefresh = true;
      if (!isAdmin) showContactAdmin = true;
      break;

    case "inactive":
      title = "Account Deactivated";
      message = messageProp || "Your account has been deactivated. Contact your administrator.";
      showRefresh = true;
      showContactAdmin = true;
      break;

    case "pending":
      title = "Account Pending";
      message = messageProp || "Your account is pending approval. Contact your administrator.";
      showRefresh = true;
      showContactAdmin = true;
      break;

    default:
      showRefresh = true;
      showContactAdmin = !isAdmin;
  }
  
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-8 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
          {/* Icon */}
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/30">
            <svg
              className="h-8 w-8 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          
          <h1
            data-testid="blocked-title"
            className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {title}
          </h1>
          
          <p
            data-testid="blocked-message"
            className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
          >
            {message}
          </p>
          
          <div className="mt-6 flex flex-col gap-3">
            {showRefresh && onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                data-testid="blocked-refresh-button"
                className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-white"
              >
                Refresh Status
              </button>
            )}
            
            {/* Logout button - always shown */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                data-testid="blocked-logout-button"
                className="w-full rounded-md border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Logout
              </button>
            )}
            
            {showContactAdmin && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Please contact your organization administrator for assistance.
              </div>
            )}
            
            {showContactSupport && (
              <a
                href="mailto:support@rvservicedesk.com"
                data-testid="blocked-contact-support"
                className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Contact Support
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
