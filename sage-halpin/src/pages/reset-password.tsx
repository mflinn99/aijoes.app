import { useEffect } from "react";
import { useLocation } from "wouter";

export default function ResetPassword() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Auth is disabled, redirect to home
    setLocation("/");
  }, [setLocation]);

  return (
    <div
      className="w-full h-screen flex items-center justify-center bg-background"
      data-testid="reset-password-page"
    >
      <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}
